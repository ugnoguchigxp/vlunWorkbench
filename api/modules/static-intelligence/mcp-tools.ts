import { and, desc, eq } from "drizzle-orm";
import { ZodError, type z } from "zod";
import type {
	StaticIntelligenceAgentQueryFailure,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import { staticIntelligenceAgentQueryResultSchema } from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type {
	CodeStructureSnapshotFailure,
	CodeStructureSnapshotResult,
} from "../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	codeStructureSnapshotFailureSchema,
	codeStructureSnapshotResultSchema,
} from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type {
	StaticIntelligenceGuardrailMaterialFailure,
	StaticIntelligenceGuardrailMaterialResult,
} from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import { staticIntelligenceGuardrailMaterialResultSchema } from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import type {
	StaticIntelligenceKnowledgeSourceManifestFailure,
	StaticIntelligenceKnowledgeSourceManifestResult,
} from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import { staticIntelligenceKnowledgeSourceManifestResultSchema } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type { AppDatabase } from "../../db";
import { projects, scanRuns } from "../../db/schema";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import {
	StaticIntelligenceAgentQueryInvalidRequestError,
	runStaticIntelligenceAgentQuery,
} from "./agent-query";
import { StaticIntelligenceScanRunNotFoundError } from "./export-builder";
import { buildStaticIntelligenceGuardrailMaterial } from "./guardrail-material";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import { StaticIntelligenceReadModelResolver } from "./read-model-resolver";
import {
	type GetEvidenceBundleInput,
	type GetVerificationCommandsInput,
	type ListKnowledgeSourcesInput,
	type StaticIntelligenceKnowledgeSourceListResult,
	type StaticIntelligenceMcpToolFailure,
	getCodeStructureSnapshotInputSchema,
	getEvidenceBundleInputSchema,
	getGuardrailMaterialInputSchema,
	getKnowledgeSourceManifestInputSchema,
	getVerificationCommandsInputSchema,
	listKnowledgeSourcesInputSchema,
	staticIntelligenceKnowledgeSourceListResultSchema,
	staticIntelligenceMcpToolFailureSchema,
} from "./mcp-tool-schemas";

export type StaticIntelligenceMcpToolResult =
	| StaticIntelligenceKnowledgeSourceListResult
	| StaticIntelligenceMcpToolFailure
	| CodeStructureSnapshotResult
	| CodeStructureSnapshotFailure
	| StaticIntelligenceKnowledgeSourceManifestResult
	| StaticIntelligenceKnowledgeSourceManifestFailure
	| StaticIntelligenceGuardrailMaterialResult
	| StaticIntelligenceGuardrailMaterialFailure
	| StaticIntelligenceAgentQueryResult
	| StaticIntelligenceAgentQueryFailure;

export type StaticIntelligenceMcpToolHandler = (params: {
	db: AppDatabase;
	input: unknown;
}) => Promise<StaticIntelligenceMcpToolResult>;

export type StaticIntelligenceMcpToolDefinition = {
	name: string;
	description: string;
	inputSchema: z.ZodType;
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
	const rows = await params.db
		.select({
			scanRunId: scanRuns.id,
		})
		.from(scanRuns)
		.innerJoin(projects, eq(scanRuns.projectId, projects.id))
		.where(projectFilter(parsed.input))
		.orderBy(desc(scanRuns.updatedAt), desc(scanRuns.id))
		.limit(100);

	const degradedReasons: string[] = [];
	const sources: StaticIntelligenceKnowledgeSourceListResult["sources"] = [];
	for (const row of rows) {
		if (sources.length >= sourceLimit) break;
		try {
			const generation = await loadPersistedGeneration(
				params.db,
				row.scanRunId,
			);
			if (!generation) {
				degradedReasons.push(
					`scan ${row.scanRunId} skipped: generation_missing`,
				);
				continue;
			}
			const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
				generation.export.payload,
				{
					generatedAt,
					generation,
					readiness: await readinessForGeneration(params.db, generation),
				},
			);
			sources.push({
				sourceId: manifest.source.sourceId,
				projectId: manifest.project.id,
				projectName: manifest.project.name,
				scanRunId: manifest.scan.id,
				generationId: generation.generationId,
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

export async function getStaticIntelligenceKnowledgeSourceManifestTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<
	| StaticIntelligenceKnowledgeSourceManifestResult
	| StaticIntelligenceKnowledgeSourceManifestFailure
> {
	const parsed = parseToolInput(
		getKnowledgeSourceManifestInputSchema,
		params.input,
	);
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
	const parsed = parseToolInput(getGuardrailMaterialInputSchema, params.input);
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
	const parsed = parseToolInput(getEvidenceBundleInputSchema, params.input);
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
		getVerificationCommandsInputSchema,
		params.input,
	);
	if (!parsed.ok) return parsed.failure;

	return runAgentQueryTool(params.db, parsed.input, {
		queryKind: "verification_commands",
	});
}

export async function getStaticIntelligenceCodeStructureSnapshotTool(params: {
	db: AppDatabase;
	input: unknown;
}): Promise<CodeStructureSnapshotResult | CodeStructureSnapshotFailure> {
	const parsed = parseToolInput(
		getCodeStructureSnapshotInputSchema,
		params.input,
	);
	if (!parsed.ok) return parsed.failure;

	try {
		const generation = await requirePersistedGeneration(
			params.db,
			parsed.input.scanRunId,
			parsed.input.generationId,
		);
		const snapshot = generation.structure.snapshot;
		return codeStructureSnapshotResultSchema.parse({
			ok: true,
			status: "completed",
			version: "v1",
			generatedAt: snapshot.generatedAt,
			snapshot,
			generation: {
				generationId: generation.generationId,
				snapshotRef: generation.structure.metadata.snapshotRef,
				sourceTreeHash: generation.structure.metadata.sourceTreeHash,
			},
		});
	} catch {
		return codeStructureFailure(
			"Persisted code structure generation unavailable.",
		);
	}
}

export const staticIntelligenceMcpToolRegistry: StaticIntelligenceMcpToolDefinition[] =
	[
		{
			name: "vuln_list_knowledge_sources",
			description:
				"Read-only Static Intelligence knowledge source discovery. Returns candidate-only manifest summaries without project root paths, raw artifact bodies, or evidence snippets.",
			inputSchema: listKnowledgeSourcesInputSchema,
			handler: listStaticIntelligenceKnowledgeSources,
		},
		{
			name: "vuln_get_knowledge_source_manifest",
			description:
				"Read-only fetch for one Static Intelligence knowledge source manifest. Uses the CLI-compatible Phase 34 manifest contract and does not return raw artifact bodies or evidence snippets.",
			inputSchema: getKnowledgeSourceManifestInputSchema,
			handler: getStaticIntelligenceKnowledgeSourceManifestTool,
		},
		{
			name: "vuln_get_guardrail_material",
			description:
				"Read-only fetch for candidate-only Static Intelligence guardrail material. Does not register contextStill candidates or infer active/rejected/deprecated state.",
			inputSchema: getGuardrailMaterialInputSchema,
			handler: getStaticIntelligenceGuardrailMaterialTool,
		},
		{
			name: "vuln_get_evidence_bundle",
			description:
				"Read-only fetch for a candidate-only evidence bundle for one finding. Returns refs and sanitized metadata only, not raw artifact bodies or evidence snippets.",
			inputSchema: getEvidenceBundleInputSchema,
			handler: getStaticIntelligenceEvidenceBundleTool,
		},
		{
			name: "vuln_get_verification_commands",
			description:
				"Read-only fetch for candidate-only verification commands. Commands are returned as stored candidates and are not executed.",
			inputSchema: getVerificationCommandsInputSchema,
			handler: getStaticIntelligenceVerificationCommandsTool,
		},
		{
			name: "vuln_get_code_structure_snapshot",
			description:
				"Read-only fetch for a persisted redacted code structure snapshot. It never scans the repository or accepts arbitrary filesystem paths.",
			inputSchema: getCodeStructureSnapshotInputSchema,
			handler: getStaticIntelligenceCodeStructureSnapshotTool,
		},
	];

function projectFilter(input: ListKnowledgeSourcesInput) {
	return input.projectId
		? and(eq(scanRuns.projectId, input.projectId))
		: undefined;
}

async function runAgentQueryTool(
	db: AppDatabase,
	input: GetEvidenceBundleInput | GetVerificationCommandsInput,
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

function codeStructureFailure(message: string): CodeStructureSnapshotFailure {
	return codeStructureSnapshotFailureSchema.parse({
		ok: false,
		status: "failed",
		message,
	});
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
