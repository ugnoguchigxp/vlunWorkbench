import { and, desc, eq } from "drizzle-orm";
import { ZodError, z } from "zod";
import type {
	ProjectStructureSnapshotFailure,
	ProjectStructureSnapshotResult,
} from "../../../shared/schemas/project-structure.schema";
import { projectStructureSnapshotFailureSchema } from "../../../shared/schemas/project-structure.schema";
import type {
	StaticIntelligenceAgentQueryFailure,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import { staticIntelligenceAgentQueryResultSchema } from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type {
	ProjectExplorationCatalogFailure,
	ProjectExplorationCatalogResult,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import { projectExplorationCatalogInputSchema as generationProjectExplorationCatalogInputSchema } from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import type {
	StaticIntelligenceGuardrailMaterialFailure,
	StaticIntelligenceGuardrailMaterialResult,
} from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import {
	staticIntelligenceGuardrailMaterialResultSchema,
	staticIntelligenceGuardrailMaterialTypeSchema,
} from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import type {
	StaticIntelligenceKnowledgeSourceManifestFailure,
	StaticIntelligenceKnowledgeSourceManifestResult,
} from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import { staticIntelligenceKnowledgeSourceManifestResultSchema } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type { AppDatabase } from "../../db";
import { findings, projects, scanRuns } from "../../db/schema";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import {
	runStaticIntelligenceAgentQuery,
	StaticIntelligenceAgentQueryInvalidRequestError,
} from "./agent-query";
import {
	buildProjectExplorationCatalog,
	type ProjectExplorationGenerationView,
} from "./exploration-catalog";
import { StaticIntelligenceScanRunNotFoundError } from "./export-builder";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import { buildStaticIntelligenceGuardrailMaterial } from "./guardrail-material";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import {
	getEvidenceBundleInputSchema,
	getGuardrailMaterialInputSchema,
	getKnowledgeSourceManifestInputSchema,
	getProjectIntelligenceStatusInputSchema,
	getProjectStructureSnapshotInputSchema,
	getVerificationCommandsInputSchema,
	type ListKnowledgeSourcesInput,
	listKnowledgeSourcesInputSchema,
	prepareProjectIntelligenceInputSchema,
	projectExplorationCatalogInputSchema,
	type StaticIntelligenceKnowledgeSourceListResult,
	type StaticIntelligenceMcpToolFailure,
	staticIntelligenceKnowledgeSourceListResultSchema,
	staticIntelligenceMcpToolFailureSchema,
} from "./mcp-tool-schemas";
import {
	getProjectIntelligenceStatus,
	loadLatestPublishedGeneration,
	prepareProjectIntelligence,
} from "./prepare-service";
import {
	ProjectPathResolutionError,
	resolveStaticIntelligenceProjectByPath,
} from "./project-path-resolver";
import { StaticIntelligenceReadModelResolver } from "./read-model-resolver";

export type StaticIntelligenceMcpToolResult =
	| StaticIntelligenceKnowledgeSourceListResult
	| StaticIntelligenceMcpToolFailure
	| ProjectStructureSnapshotResult
	| ProjectStructureSnapshotFailure
	| StaticIntelligenceKnowledgeSourceManifestResult
	| StaticIntelligenceKnowledgeSourceManifestFailure
	| StaticIntelligenceGuardrailMaterialResult
	| StaticIntelligenceGuardrailMaterialFailure
	| StaticIntelligenceAgentQueryResult
	| StaticIntelligenceAgentQueryFailure
	| ProjectExplorationCatalogResult
	| ProjectExplorationCatalogFailure
	| Record<string, unknown>;

type ProjectStructureMcpSuccess = {
	ok: true;
	status: "completed";
	version: "v2";
	generatedAt: string;
	view: "summary" | "files" | "references";
	generation: { generationId: string };
	summary?: unknown;
	coverage?: unknown;
	readiness?: unknown;
	diagnostics?: unknown[];
	modules?: unknown[];
	items?: unknown[];
	nextCursor?: number | null;
	total?: number;
};

const generationInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1),
		generationId: z.string().uuid().optional(),
	})
	.strict();
const generationGuardrailInputSchema = generationInputSchema.extend({
	type: staticIntelligenceGuardrailMaterialTypeSchema.optional(),
	includeMarkdown: z.boolean().optional(),
});
const generationEvidenceInputSchema = generationInputSchema.extend({
	findingId: z.string().trim().min(1),
});
const generationVerificationInputSchema = generationInputSchema.extend({
	findingId: z.string().trim().min(1).optional(),
});
const generationProjectStructureInputSchema = generationInputSchema.extend({
	view: z.enum(["summary", "files", "references"]).default("summary"),
	cursor: z.number().int().nonnegative().default(0),
	limit: z.number().int().min(1).max(200).default(100),
});

export type StaticIntelligenceMcpToolHandler = (params: {
	db: AppDatabase;
	input: unknown;
	allowedProjectRoots?: string[];
	projectCreationPolicy?: "registered_only" | "create_within_allowed_roots";
}) => Promise<StaticIntelligenceMcpToolResult>;

export type StaticIntelligenceMcpToolDefinition = {
	name: string;
	description: string;
	inputSchema: z.ZodType;
	readOnlyHint: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	handler: StaticIntelligenceMcpToolHandler;
};

export async function listStaticIntelligenceKnowledgeSources(params: {
	db: AppDatabase;
	input: unknown;
	generatedAt?: Date;
}): Promise<
	StaticIntelligenceKnowledgeSourceListResult | StaticIntelligenceMcpToolFailure
> {
	const parsed = parseToolInput(listKnowledgeSourcesInputSchema, params.input);
	if (!parsed.ok) return parsed.failure;

	const generatedAt = params.generatedAt ?? new Date();
	const sourceLimit = parsed.input.limit ?? 20;
	const generationRepository = new StaticIntelligenceGenerationRepository(
		params.db,
	);
	const rootRefGenerations = parsed.input.rootRef
		? await generationRepository.listLatestValidGenerationsByRootRef({
				rootRef: parsed.input.rootRef,
				projectId: parsed.input.projectId,
				limit: sourceLimit,
			})
		: null;
	const rows = rootRefGenerations
		? rootRefGenerations.map((generation) => ({
				scanRunId: generation.scanRunId,
				generation,
			}))
		: (
				await params.db
					.select({ scanRunId: scanRuns.id })
					.from(scanRuns)
					.innerJoin(projects, eq(scanRuns.projectId, projects.id))
					.where(projectFilter(parsed.input))
					.orderBy(desc(scanRuns.updatedAt), desc(scanRuns.id))
					.limit(100)
			).map((row) => ({ ...row, generation: null }));

	const degradedReasons: string[] = [];
	const sources: StaticIntelligenceKnowledgeSourceListResult["sources"] = [];
	for (const row of rows) {
		if (sources.length >= sourceLimit) break;
		try {
			const generation =
				row.generation ??
				(await loadPersistedGeneration(params.db, row.scanRunId));
			if (!generation) {
				degradedReasons.push(
					`scan ${row.scanRunId} skipped: generation_missing`,
				);
				continue;
			}
			const readiness = await readinessForGeneration(params.db, generation);
			const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
				generation.export.payload,
				{
					generatedAt,
					generation,
					readiness,
				},
			);
			sources.push({
				sourceId: manifest.source.sourceId,
				projectId: manifest.project.id,
				rootRef: generation.structure.metadata.rootRef,
				projectName: manifest.project.name,
				scanRunId: manifest.scan.id,
				generationId: generation.generationId,
				generationGeneratedAt: generation.structure.metadata.generatedAt,
				sourceRevision: generation.structure.metadata.sourceRevision,
				readiness: summarizeGenerationReadiness(readiness, generation.status),
				scanProfile: manifest.scan.profile,
				scanStatus: manifest.scan.status,
				findingCount: manifest.scan.findingCount,
				reviewStatus: manifest.scan.reviewStatus,
				riskBand: manifest.risk.band,
				evidenceQuality: manifest.risk.evidenceQuality,
				contentHash: manifest.source.contentHash,
				exportHash: manifest.source.exportHash,
				generatedAt: manifest.generatedAt,
				command: [
					"bun",
					"run",
					"intelligence:knowledge-source",
					"--",
					"--scan-run-id",
					manifest.scan.id,
					"--generation-id",
					generation.generationId,
				],
			});
		} catch (error) {
			degradedReasons.push(`scan ${row.scanRunId} skipped: ${message(error)}`);
		}
	}

	return staticIntelligenceKnowledgeSourceListResultSchema.parse({
		ok: true,
		status: "completed",
		version: "v1",
		generatedAt: generatedAt.toISOString(),
		sources,
		degradedReasons: sortedUnique(degradedReasons),
	});
}

export async function getProjectExplorationCatalogTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<
	ProjectExplorationCatalogResult | ProjectExplorationCatalogFailure
> {
	const parsed = generationProjectExplorationCatalogInputSchema.safeParse(
		params.input,
	);
	if (!parsed.success) {
		return catalogFailure(
			parsed.error.issues.some((issue) => issue.message === "focus_required")
				? "focus_required"
				: "invalid_input",
			message(parsed.error),
		);
	}
	try {
		const repository = new StaticIntelligenceGenerationRepository(params.db);
		const generation = await repository.loadGeneration(
			parsed.data.scanRunId,
			parsed.data.generationId,
		);
		if (!generation) {
			return catalogFailure(
				"generation_missing",
				"Static Intelligence generation missing.",
			);
		}
		if (
			generation.scanRunId !== parsed.data.scanRunId ||
			generation.generationId !== parsed.data.generationId
		) {
			return catalogFailure(
				"generation_mismatch",
				"Static Intelligence generation identity mismatch.",
			);
		}
		const readiness = await readinessForGeneration(params.db, generation);
		const view: ProjectExplorationGenerationView = {
			projectId: generation.projectId,
			scanRunId: generation.scanRunId,
			generationId: generation.generationId,
			status: generation.status,
			structure: {
				metadata: generation.structure.metadata,
				snapshot: generation.structure.snapshot,
			},
			export: { payload: generation.export.payload },
		};
		return buildProjectExplorationCatalog({
			generation: view,
			readiness: summarizeGenerationReadiness(readiness, generation.status),
			focus: parsed.data.focus,
			limits: parsed.data.limits,
			generatedAt: generation.structure.metadata.generatedAt,
		});
	} catch {
		return catalogFailure(
			"catalog_unavailable",
			"Project exploration catalog unavailable.",
		);
	}
}

export async function getStaticIntelligenceKnowledgeSourceManifestTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<
	| StaticIntelligenceKnowledgeSourceManifestResult
	| StaticIntelligenceKnowledgeSourceManifestFailure
> {
	const parsed = parseToolInput(generationInputSchema, params.input);
	if (!parsed.ok) return parsed.failure;

	try {
		const generation = await requirePersistedGeneration(
			params.db,
			parsed.input.scanRunId,
			parsed.input.generationId,
		);
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			generation.export.payload,
			{
				generation,
				readiness: await readinessForGeneration(params.db, generation),
			},
		);
		return staticIntelligenceKnowledgeSourceManifestResultSchema.parse({
			ok: true,
			status: "completed",
			version: "v1",
			generatedAt: manifest.generatedAt,
			manifest,
		});
	} catch (error) {
		return toolFailure(error);
	}
}

export async function getStaticIntelligenceGuardrailMaterialTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<
	| StaticIntelligenceGuardrailMaterialResult
	| StaticIntelligenceGuardrailMaterialFailure
> {
	const parsed = parseToolInput(generationGuardrailInputSchema, params.input);
	if (!parsed.ok) return parsed.failure;

	try {
		const generation = await requirePersistedGeneration(
			params.db,
			parsed.input.scanRunId,
			parsed.input.generationId,
		);
		const sourceManifest = buildStaticIntelligenceKnowledgeSourceManifest(
			generation.export.payload,
			{
				generation,
				readiness: await readinessForGeneration(params.db, generation),
			},
		);
		const result = buildStaticIntelligenceGuardrailMaterial({
			exportPayload: generation.export.payload,
			sourceManifest,
			type: parsed.input.type,
			includeMarkdown: parsed.input.includeMarkdown ?? false,
		});
		return staticIntelligenceGuardrailMaterialResultSchema.parse(result);
	} catch (error) {
		return toolFailure(error);
	}
}

export async function getStaticIntelligenceEvidenceBundleTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<
	StaticIntelligenceAgentQueryResult | StaticIntelligenceAgentQueryFailure
> {
	const parsed = parseToolInput(generationEvidenceInputSchema, params.input);
	if (!parsed.ok) return parsed.failure;

	return runAgentQueryTool(params.db, parsed.input, {
		queryKind: "evidence_bundle",
	});
}

export async function getStaticIntelligenceVerificationCommandsTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<
	StaticIntelligenceAgentQueryResult | StaticIntelligenceAgentQueryFailure
> {
	const parsed = parseToolInput(
		generationVerificationInputSchema,
		params.input,
	);
	if (!parsed.ok) return parsed.failure;

	return runAgentQueryTool(params.db, parsed.input, {
		queryKind: "verification_commands",
	});
}

export async function getStaticIntelligenceProjectStructureSnapshotTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<ProjectStructureMcpSuccess | ProjectStructureSnapshotFailure> {
	const parsed = parseToolInput(
		generationProjectStructureInputSchema,
		params.input,
	);
	if (!parsed.ok) {
		return projectStructureSnapshotFailureSchema.parse({
			ok: false,
			status: "failed",
			message: parsed.failure.message,
		});
	}
	try {
		const generation = await requirePersistedGeneration(
			params.db,
			parsed.input.scanRunId,
			parsed.input.generationId,
		);
		const snapshot = generation.projectStructure.snapshot;
		const view = parsed.input.view;
		const cursor = parsed.input.cursor;
		const limit = parsed.input.limit;
		if (view === "summary") {
			return {
				ok: true,
				status: "completed",
				version: "v2",
				generatedAt: snapshot.generatedAt,
				view,
				generation: { generationId: generation.generationId },
				summary: snapshot.summary,
				coverage: snapshot.inventory.coverage,
				readiness: snapshot.readiness,
				diagnostics: snapshot.diagnostics.slice(0, 200),
				modules: snapshot.modules,
			};
		}
		const source = view === "files" ? snapshot.files : snapshot.references;
		const items = source.slice(cursor, cursor + limit);
		return {
			ok: true,
			status: "completed",
			version: "v2",
			generatedAt: snapshot.generatedAt,
			view,
			generation: { generationId: generation.generationId },
			items,
			nextCursor:
				cursor + items.length < source.length ? cursor + items.length : null,
			total: source.length,
		};
	} catch {
		return projectStructureSnapshotFailureSchema.parse({
			ok: false,
			status: "failed",
			message: "Persisted project structure generation unavailable.",
		});
	}
}

export async function prepareProjectIntelligenceTool(params: {
	db: AppDatabase;
	input: unknown;
	allowedProjectRoots?: string[];
	projectCreationPolicy?: "registered_only" | "create_within_allowed_roots";
}): Promise<Record<string, unknown>> {
	const parsed = prepareProjectIntelligenceInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	return await prepareProjectIntelligence({
		db: params.db,
		projectPath: parsed.data.projectPath,
		allowedProjectRoots: params.allowedProjectRoots ?? [],
		createProject:
			params.projectCreationPolicy === "create_within_allowed_roots",
	});
}

export async function getProjectIntelligenceStatusTool(params: {
	db: AppDatabase;
	input: unknown;
	allowedProjectRoots?: string[];
}): Promise<Record<string, unknown>> {
	const parsed = getProjectIntelligenceStatusInputSchema.safeParse(
		params.input,
	);
	if (!parsed.success) return pathInputFailure(parsed.error);
	return await getProjectIntelligenceStatus({
		db: params.db,
		projectPath: parsed.data.projectPath,
		allowedProjectRoots: params.allowedProjectRoots ?? [],
	});
}

async function getProjectStructureSnapshotFacade(
	params: Parameters<StaticIntelligenceMcpToolHandler>[0],
): Promise<StaticIntelligenceMcpToolResult> {
	const parsed = getProjectStructureSnapshotInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	const context = await resolvePathReadContext(
		params.db,
		parsed.data.projectPath,
		params.allowedProjectRoots ?? [],
	);
	if (!context.ok) return context.failure;
	const result = await getStaticIntelligenceProjectStructureSnapshotTool({
		db: params.db,
		input: {
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
			view: parsed.data.view,
			cursor: parsed.data.cursor,
			limit: parsed.data.limit,
		},
	});
	return withPathMetadata(result, context);
}

async function getExplorationCatalogFacade(
	params: Parameters<StaticIntelligenceMcpToolHandler>[0],
): Promise<StaticIntelligenceMcpToolResult> {
	const parsed = projectExplorationCatalogInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	const context = await resolvePathReadContext(
		params.db,
		parsed.data.projectPath,
		params.allowedProjectRoots ?? [],
	);
	if (!context.ok) return context.failure;
	const defaultPaths = context.generation.structure.snapshot.files
		.slice(0, 10)
		.map((file) => file.path);
	const focus = parsed.data.focus
		? {
				paths: parsed.data.focus.paths,
				moduleIds: parsed.data.focus.modules,
				terms: parsed.data.focus.terms,
			}
		: {
				paths: defaultPaths.length > 0 ? defaultPaths : undefined,
				terms: ["project"],
			};
	const readiness = await readinessForGeneration(params.db, context.generation);
	const result = buildProjectExplorationCatalog({
		generation: {
			projectId: context.generation.projectId,
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
			status: context.generation.status,
			structure: {
				metadata: context.generation.structure.metadata,
				snapshot: context.generation.structure.snapshot,
			},
			export: { payload: context.generation.export.payload },
		},
		readiness: summarizeGenerationReadiness(
			readiness,
			context.generation.status,
		),
		focus,
		limits: parsed.data.limits,
		generatedAt: context.generation.structure.metadata.generatedAt,
	});
	return withPathMetadata(result, context);
}

async function getManifestFacade(
	params: Parameters<StaticIntelligenceMcpToolHandler>[0],
): Promise<StaticIntelligenceMcpToolResult> {
	const parsed = getKnowledgeSourceManifestInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	const context = await resolvePathReadContext(
		params.db,
		parsed.data.projectPath,
		params.allowedProjectRoots ?? [],
	);
	if (!context.ok) return context.failure;
	const result = await getStaticIntelligenceKnowledgeSourceManifestTool({
		db: params.db,
		input: {
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
		},
	});
	return withPathMetadata(result, context);
}

async function getGuardrailFacade(
	params: Parameters<StaticIntelligenceMcpToolHandler>[0],
): Promise<StaticIntelligenceMcpToolResult> {
	const parsed = getGuardrailMaterialInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	const context = await resolvePathReadContext(
		params.db,
		parsed.data.projectPath,
		params.allowedProjectRoots ?? [],
	);
	if (!context.ok) return context.failure;
	const result = await getStaticIntelligenceGuardrailMaterialTool({
		db: params.db,
		input: {
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
			type: parsed.data.type,
			includeMarkdown: parsed.data.includeMarkdown,
		},
	});
	return withPathMetadata(result, context);
}

async function getEvidenceFacade(
	params: Parameters<StaticIntelligenceMcpToolHandler>[0],
): Promise<StaticIntelligenceMcpToolResult> {
	const parsed = getEvidenceBundleInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	const context = await resolvePathReadContext(
		params.db,
		parsed.data.projectPath,
		params.allowedProjectRoots ?? [],
	);
	if (!context.ok) return context.failure;
	const finding = await resolveFindingByFingerprint({
		db: params.db,
		projectId: context.generation.projectId,
		scanRunId: context.generation.scanRunId,
		fingerprint: parsed.data.findingFingerprint,
	});
	if (!finding.ok) return finding.failure;
	const result = await getStaticIntelligenceEvidenceBundleTool({
		db: params.db,
		input: {
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
			findingId: finding.id,
		},
	});
	return {
		...withPathMetadata(result, context, [finding.id]),
		findingFingerprint: parsed.data.findingFingerprint,
	};
}

async function getVerificationFacade(
	params: Parameters<StaticIntelligenceMcpToolHandler>[0],
): Promise<StaticIntelligenceMcpToolResult> {
	const parsed = getVerificationCommandsInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	const context = await resolvePathReadContext(
		params.db,
		parsed.data.projectPath,
		params.allowedProjectRoots ?? [],
	);
	if (!context.ok) return context.failure;
	let findingId: string | undefined;
	if (parsed.data.findingFingerprint) {
		const finding = await resolveFindingByFingerprint({
			db: params.db,
			projectId: context.generation.projectId,
			scanRunId: context.generation.scanRunId,
			fingerprint: parsed.data.findingFingerprint,
		});
		if (!finding.ok) return finding.failure;
		findingId = finding.id;
	}
	const result = await getStaticIntelligenceVerificationCommandsTool({
		db: params.db,
		input: {
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
			...(findingId ? { findingId } : {}),
		},
	});
	return {
		...withPathMetadata(result, context, findingId ? [findingId] : []),
		...(parsed.data.findingFingerprint
			? { findingFingerprint: parsed.data.findingFingerprint }
			: {}),
	};
}

export const staticIntelligenceMcpToolRegistry: StaticIntelligenceMcpToolDefinition[] =
	[
		{
			name: "vuln_prepare_project_intelligence",
			description:
				"Queues persisted structure-only preparation and Static Intelligence generation for an allowed canonical project path. External security scanners are not started. This is the only path-first tool with side effects.",
			inputSchema: prepareProjectIntelligenceInputSchema,
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			handler: prepareProjectIntelligenceTool,
		},
		{
			name: "vuln_get_project_intelligence_status",
			description:
				"Read-only status and freshness lookup for a project path. It never creates a project, scan, prepare job, or generation.",
			inputSchema: getProjectIntelligenceStatusInputSchema,
			readOnlyHint: true,
			handler: getProjectIntelligenceStatusTool,
		},
		{
			name: "vuln_list_knowledge_sources",
			description:
				"Read-only Static Intelligence knowledge source discovery. Returns candidate-only manifest summaries without project root paths, raw artifact bodies, or evidence snippets.",
			inputSchema: listKnowledgeSourcesInputSchema,
			readOnlyHint: true,
			handler: listStaticIntelligenceKnowledgeSources,
		},
		{
			name: "vuln_get_knowledge_source_manifest",
			description:
				"Read-only fetch for one Static Intelligence knowledge source manifest. Uses the CLI-compatible Phase 34 manifest contract and does not return raw artifact bodies or evidence snippets.",
			inputSchema: getKnowledgeSourceManifestInputSchema,
			readOnlyHint: true,
			handler: getManifestFacade,
		},
		{
			name: "vuln_get_guardrail_material",
			description:
				"Read-only fetch for candidate-only Static Intelligence guardrail material. Does not register contextStill candidates or infer active/rejected/deprecated state.",
			inputSchema: getGuardrailMaterialInputSchema,
			readOnlyHint: true,
			handler: getGuardrailFacade,
		},
		{
			name: "vuln_get_evidence_bundle",
			description:
				"Read-only fetch for a candidate-only evidence bundle for one finding. Returns refs and sanitized metadata only, not raw artifact bodies or evidence snippets.",
			inputSchema: getEvidenceBundleInputSchema,
			readOnlyHint: true,
			handler: getEvidenceFacade,
		},
		{
			name: "vuln_get_verification_commands",
			description:
				"Read-only fetch for candidate-only verification commands. Commands are returned as stored candidates and are not executed.",
			inputSchema: getVerificationCommandsInputSchema,
			readOnlyHint: true,
			handler: getVerificationFacade,
		},
		{
			name: "vuln_get_project_structure_snapshot",
			description:
				"Read-only fetch for the persisted Project Structure Scanner v2 snapshot. It includes safe inventory coverage and typed references, and never starts a scan or generation build.",
			inputSchema: getProjectStructureSnapshotInputSchema,
			readOnlyHint: true,
			handler: getProjectStructureSnapshotFacade,
		},
		{
			name: "vuln_get_project_exploration_catalog",
			description:
				"Read-only bounded exploration clues for the latest projectPath generation. Returns ranked project-relative candidates without source bodies, command execution, or mutation.",
			inputSchema: projectExplorationCatalogInputSchema,
			readOnlyHint: true,
			handler: getExplorationCatalogFacade,
		},
	];

type PathReadContext = {
	ok: true;
	projectPath: string;
	generation: NonNullable<
		Awaited<ReturnType<typeof loadLatestPublishedGeneration>>
	>;
	freshness: "fresh" | "stale";
};

async function resolvePathReadContext(
	db: AppDatabase,
	projectPath: string,
	allowedProjectRoots: string[],
): Promise<PathReadContext | { ok: false; failure: Record<string, unknown> }> {
	try {
		const resolved = await resolveStaticIntelligenceProjectByPath({
			db,
			projectPath,
			allowedProjectRoots,
			createProject: false,
		});
		if (!resolved.project) {
			return {
				ok: false,
				failure: notPreparedFailure(resolved.projectPath),
			};
		}
		const status = await getProjectIntelligenceStatus({
			db,
			projectPath: resolved.projectPath,
			allowedProjectRoots,
		});
		if (
			status.ok &&
			status.status === "ready" &&
			status.provenance?.scanRunId &&
			status.provenance.generationId
		) {
			const generation = await new StaticIntelligenceGenerationRepository(
				db,
			).loadGeneration(
				status.provenance.scanRunId,
				status.provenance.generationId,
			);
			if (!generation) {
				return {
					ok: false,
					failure: notPreparedFailure(resolved.projectPath),
				};
			}
			return {
				ok: true,
				projectPath: resolved.projectPath,
				generation,
				freshness: "fresh",
			};
		}
		const generation = await loadLatestPublishedGeneration(
			db,
			resolved.project.id,
		);
		if (!generation) {
			return {
				ok: false,
				failure: notPreparedFailure(resolved.projectPath),
			};
		}
		return {
			ok: true,
			projectPath: resolved.projectPath,
			generation,
			freshness: "stale",
		};
	} catch (error) {
		if (error instanceof ProjectPathResolutionError) {
			return {
				ok: false,
				failure: {
					ok: false,
					status: "failed",
					projectPath,
					errorCode: error.code,
					message: error.message,
					retryable: error.retryable,
				},
			};
		}
		return {
			ok: false,
			failure: {
				ok: false,
				status: "failed",
				projectPath,
				errorCode: "INTERNAL_ERROR",
				message: "Static Intelligence is temporarily unavailable.",
				retryable: true,
			},
		};
	}
}

async function resolveFindingByFingerprint(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	fingerprint: string;
}): Promise<
	{ ok: true; id: string } | { ok: false; failure: Record<string, unknown> }
> {
	const rows = await params.db
		.select({
			id: findings.id,
			fingerprint: findings.fingerprint,
			sourceTool: findings.sourceTool,
			ruleId: findings.ruleId,
		})
		.from(findings)
		.where(
			and(
				eq(findings.projectId, params.projectId),
				eq(findings.scanRunId, params.scanRunId),
				eq(findings.fingerprint, params.fingerprint),
			),
		)
		.orderBy(findings.sourceTool, findings.ruleId)
		.limit(20);
	if (rows.length === 1 && rows[0]) return { ok: true, id: rows[0].id };
	if (rows.length > 1) {
		return {
			ok: false,
			failure: {
				ok: false,
				status: "failed",
				errorCode: "AMBIGUOUS_FINDING",
				message:
					"The finding fingerprint is not unique in the selected generation.",
				retryable: false,
				candidates: rows.map(({ fingerprint, sourceTool, ruleId }) => ({
					fingerprint,
					sourceTool,
					ruleId,
				})),
			},
		};
	}
	return {
		ok: false,
		failure: {
			ok: false,
			status: "failed",
			errorCode: "FINDING_NOT_FOUND",
			message:
				"The finding fingerprint was not found in the selected generation.",
			retryable: false,
		},
	};
}

function withPathMetadata(
	result: StaticIntelligenceMcpToolResult,
	context: PathReadContext,
	additionalInternalIds: string[] = [],
): StaticIntelligenceMcpToolResult {
	if (!result || typeof result !== "object") return result;
	const internalIds = new Set([
		context.generation.projectId,
		context.generation.scanRunId,
		context.generation.generationId,
		...additionalInternalIds,
	]);
	const sanitized = stripInternalIdentifiers(
		result,
		"",
		internalIds,
		context.generation.export.metadata.exportHash ??
			context.generation.structure.metadata.sourceTreeHash,
	) as Record<string, unknown>;
	return {
		...sanitized,
		projectPath: context.projectPath,
		freshness: { status: context.freshness },
		provenance: {
			projectId: context.generation.projectId,
			scanRunId: context.generation.scanRunId,
			generationId: context.generation.generationId,
		},
	};
}

const INTERNAL_IDENTIFIER_KEYS = new Set([
	"projectId",
	"scanRunId",
	"generationId",
	"findingId",
	"findingIds",
]);

function stripInternalIdentifiers(
	value: unknown,
	parentKey: string,
	internalIds: Set<string>,
	replacement: string,
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) =>
			stripInternalIdentifiers(item, parentKey, internalIds, replacement),
		);
	}
	if (typeof value === "string") {
		let sanitized = value;
		for (const internalId of internalIds) {
			sanitized = sanitized.replaceAll(internalId, replacement);
		}
		return sanitized;
	}
	if (!value || typeof value !== "object") return value;
	const sanitized: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (INTERNAL_IDENTIFIER_KEYS.has(key)) {
			if (key === "findingId" && parentKey === "requires") {
				sanitized.findingFingerprint = child;
			}
			continue;
		}
		if (key === "id" && ["project", "scan", "finding"].includes(parentKey)) {
			continue;
		}
		if (
			key === "command" &&
			Array.isArray(child) &&
			child.some(
				(item) => item === "--scan-run-id" || item === "--generation-id",
			)
		) {
			continue;
		}
		sanitized[key] = stripInternalIdentifiers(
			child,
			key,
			internalIds,
			replacement,
		);
	}
	return sanitized;
}

function notPreparedFailure(projectPath: string): Record<string, unknown> {
	return {
		ok: false,
		status: "not_prepared",
		projectPath,
		errorCode: "PROJECT_NOT_PREPARED",
		message: "Static Intelligence has not been prepared for this project.",
		retryable: true,
		nextAction: "vuln_prepare_project_intelligence",
	};
}

function pathInputFailure(error?: ZodError): Record<string, unknown> {
	return {
		ok: false,
		status: "failed",
		errorCode: "PROJECT_PATH_REQUIRED",
		message: error ? message(error) : "Invalid path-first request.",
		retryable: false,
	};
}

function projectFilter(input: ListKnowledgeSourcesInput) {
	return input.projectId
		? and(eq(scanRuns.projectId, input.projectId))
		: undefined;
}

async function runAgentQueryTool(
	db: AppDatabase,
	input: {
		scanRunId: string;
		generationId?: string;
		findingId?: string;
	},
	options: { queryKind: "evidence_bundle" | "verification_commands" },
): Promise<
	StaticIntelligenceAgentQueryResult | StaticIntelligenceAgentQueryFailure
> {
	try {
		const generation = await requirePersistedGeneration(
			db,
			input.scanRunId,
			input.generationId,
		);
		const result = await runStaticIntelligenceAgentQuery({
			db,
			input: {
				scanRunId: input.scanRunId,
				queryKind: options.queryKind,
				findingId: input.findingId,
				includeSemantic: false,
				includeCommunities: false,
				includeLandscape: false,
			},
			exportPayload: generation.export.payload,
		});
		return staticIntelligenceAgentQueryResultSchema.parse(result);
	} catch (error) {
		return toolFailure(error);
	}
}

async function loadPersistedGeneration(
	db: AppDatabase,
	scanRunId: string,
	generationId?: string,
) {
	const repository = new StaticIntelligenceGenerationRepository(db);
	return generationId
		? await repository.loadGeneration(scanRunId, generationId)
		: await repository.loadLatestValidGeneration(scanRunId);
}

async function requirePersistedGeneration(
	db: AppDatabase,
	scanRunId: string,
	generationId?: string,
) {
	const generation = await loadPersistedGeneration(db, scanRunId, generationId);
	if (!generation) throw new Error("Static Intelligence generation missing.");
	return generation;
}

async function readinessForGeneration(
	db: AppDatabase,
	generation: NonNullable<Awaited<ReturnType<typeof loadPersistedGeneration>>>,
) {
	const projectRepository = new ProjectRepository(db);
	const project = await projectRepository.findById(generation.projectId);
	if (!project) throw new Error("Static Intelligence project missing.");
	return await new StaticIntelligenceReadModelResolver(
		db,
		projectRepository,
		new ScanRepository(db),
	).resolveReadiness(project, generation, false);
}

function summarizeGenerationReadiness(
	readiness: Awaited<ReturnType<typeof readinessForGeneration>>,
	generationStatus: "available" | "degraded",
): "available" | "stale" | "degraded" {
	if (
		readiness.codeStructure.status === "stale" ||
		readiness.ontologyHandoff.status === "stale"
	) {
		return "stale";
	}
	const statuses = Object.values(readiness).map((item) => item.status);
	if (
		generationStatus === "degraded" ||
		statuses.some((status) =>
			["failed", "missing", "degraded"].includes(status),
		)
	) {
		return "degraded";
	}
	return "available";
}

function parseToolInput<T extends z.ZodType>(
	schema: T,
	input: unknown,
):
	| { ok: true; input: z.output<T> }
	| { ok: false; failure: StaticIntelligenceMcpToolFailure } {
	try {
		return { ok: true, input: schema.parse(input) };
	} catch (error) {
		return { ok: false, failure: toolFailure(error) };
	}
}

function toolFailure(error: unknown): StaticIntelligenceMcpToolFailure {
	return staticIntelligenceMcpToolFailureSchema.parse({
		ok: false,
		status: "failed",
		message: message(error),
	});
}

function catalogFailure(
	reasonCode: NonNullable<ProjectExplorationCatalogFailure["reasonCode"]>,
	failureMessage: string,
): ProjectExplorationCatalogFailure {
	return {
		ok: false,
		status: "failed",
		message: failureMessage,
		reasonCode,
	};
}

function message(error: unknown): string {
	if (error instanceof ZodError)
		return error.issues.map((issue) => issue.message).join("; ");
	if (
		error instanceof StaticIntelligenceScanRunNotFoundError ||
		error instanceof StaticIntelligenceAgentQueryInvalidRequestError
	) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
