import { and, eq } from "drizzle-orm";
import { ZodError, type z } from "zod";
import type {
	StaticIntelligenceAgentQueryFailure,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import { staticIntelligenceAgentQueryResultSchema } from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type { ProjectExplorationCatalogFailure } from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import type { AppDatabase } from "../../db";
import { findings, scanRuns } from "../../db/schema";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import {
	runStaticIntelligenceAgentQuery,
	StaticIntelligenceAgentQueryInvalidRequestError,
} from "./agent-query";
import { StaticIntelligenceScanRunNotFoundError } from "./export-builder";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import type {
	ListKnowledgeSourcesInput,
	StaticIntelligenceMcpToolFailure,
} from "./mcp-tool-schemas";
import { staticIntelligenceMcpToolFailureSchema } from "./mcp-tool-schemas";
import type { StaticIntelligenceMcpToolResult } from "./mcp-tools";
import {
	getProjectIntelligenceStatus,
	loadLatestPublishedGeneration,
} from "./prepare-service";
import {
	ProjectPathResolutionError,
	resolveStaticIntelligenceProjectByPath,
} from "./project-path-resolver";
import { StaticIntelligenceReadModelResolver } from "./read-model-resolver";

export type PathReadContext = {
	ok: true;
	projectPath: string;
	generation: NonNullable<
		Awaited<ReturnType<typeof loadLatestPublishedGeneration>>
	>;
	freshness: "fresh" | "stale";
};

export async function resolvePathReadContext(
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

export async function resolveFindingByFingerprint(params: {
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

export function withPathMetadata(
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

export function pathInputFailure(error?: ZodError): Record<string, unknown> {
	return {
		ok: false,
		status: "failed",
		errorCode: "PROJECT_PATH_REQUIRED",
		message: error ? message(error) : "Invalid path-first request.",
		retryable: false,
	};
}

export function projectFilter(input: ListKnowledgeSourcesInput) {
	return input.projectId
		? and(eq(scanRuns.projectId, input.projectId))
		: undefined;
}

export async function runAgentQueryTool(
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

export async function loadPersistedGeneration(
	db: AppDatabase,
	scanRunId: string,
	generationId?: string,
) {
	const repository = new StaticIntelligenceGenerationRepository(db);
	return generationId
		? await repository.loadGeneration(scanRunId, generationId)
		: await repository.loadLatestValidGeneration(scanRunId);
}

export async function requirePersistedGeneration(
	db: AppDatabase,
	scanRunId: string,
	generationId?: string,
) {
	const generation = await loadPersistedGeneration(db, scanRunId, generationId);
	if (!generation) throw new Error("Static Intelligence generation missing.");
	return generation;
}

export async function readinessForGeneration(
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

export function summarizeGenerationReadiness(
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

export function parseToolInput<T extends z.ZodType>(
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

export function toolFailure(error: unknown): StaticIntelligenceMcpToolFailure {
	return staticIntelligenceMcpToolFailureSchema.parse({
		ok: false,
		status: "failed",
		message: message(error),
	});
}

export function catalogFailure(
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

export function message(error: unknown): string {
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

export function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
