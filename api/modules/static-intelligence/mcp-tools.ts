import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type {
	ProjectStructureSnapshotFailure,
	ProjectStructureSnapshotResult,
} from "../../../shared/schemas/project-structure.schema";
import { projectStructureSnapshotFailureSchema } from "../../../shared/schemas/project-structure.schema";
import type {
	StaticIntelligenceAgentQueryFailure,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
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
import { projects, scanRuns } from "../../db/schema";
import {
	buildProjectExplorationCatalog,
	type ProjectExplorationGenerationView,
} from "./exploration-catalog";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import { buildStaticIntelligenceGuardrailMaterial } from "./guardrail-material";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import { createStaticIntelligenceMcpToolRegistry } from "./mcp-path-tools";
import {
	listKnowledgeSourcesInputSchema,
	type StaticIntelligenceKnowledgeSourceListResult,
	type StaticIntelligenceMcpToolFailure,
	staticIntelligenceKnowledgeSourceListResultSchema,
} from "./mcp-tool-schemas";
import {
	catalogFailure,
	loadPersistedGeneration,
	message,
	parseToolInput,
	projectFilter,
	readinessForGeneration,
	requirePersistedGeneration,
	runAgentQueryTool,
	sortedUnique,
	summarizeGenerationReadiness,
	toolFailure,
} from "./mcp-tool-support";

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

export {
	getProjectIntelligenceStatusTool,
	prepareProjectIntelligenceTool,
} from "./mcp-path-tools";

export const staticIntelligenceMcpToolRegistry =
	createStaticIntelligenceMcpToolRegistry({
		listKnowledgeSources: listStaticIntelligenceKnowledgeSources,
		getManifest: getStaticIntelligenceKnowledgeSourceManifestTool,
		getGuardrail: getStaticIntelligenceGuardrailMaterialTool,
		getEvidence: getStaticIntelligenceEvidenceBundleTool,
		getVerification: getStaticIntelligenceVerificationCommandsTool,
		getProjectStructure: getStaticIntelligenceProjectStructureSnapshotTool,
	});
