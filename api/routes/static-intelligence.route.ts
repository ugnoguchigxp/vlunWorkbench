import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDatabase } from "../db";
import { buildStaticIntelligenceGeneration } from "../modules/static-intelligence/build-service";
import { codeStructureFileTagSchema } from "../../shared/schemas/static-intelligence-code-structure.schema";
import { projectStructureInventoryKindSchema } from "../../shared/schemas/project-structure.schema";
import { buildStaticIntelligenceModuleCandidates } from "../modules/static-intelligence/module-candidates";
import {
	projectStructureRolloutMode,
	shouldPreferProjectStructureV2,
} from "../modules/static-intelligence/project-structure/rollout";
import { toProjectRelativePath } from "../modules/static-intelligence/path-boundary";
import {
	StaticIntelligenceReadModelResolver,
	StaticIntelligenceSelectionNotFoundError,
} from "../modules/static-intelligence/read-model-resolver";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { runStaticIntelligenceAgentQuery } from "../modules/static-intelligence/agent-query";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";

type StaticIntelligenceRouteDeps = {
	db: AppDatabase;
	projectRepository: ProjectRepository;
	scanRepository: ScanRepository;
	runAgentQuery?: typeof runStaticIntelligenceAgentQuery;
	readResolver?: StaticIntelligenceReadModelResolver;
	buildGeneration?: typeof buildStaticIntelligenceGeneration;
};

const viewQuerySchema = z.object({
	scanRunId: z.string().trim().min(1).optional(),
});

const structureQuerySchema = z.object({
	scanRunId: z.string().trim().min(1),
	generationId: z.string().uuid().optional(),
	query: z.string().trim().optional(),
	tag: codeStructureFileTagSchema.optional(),
	status: z.enum(["parsed", "degraded", "skipped"]).optional(),
	cursor: z.coerce.number().int().nonnegative().default(0),
	limit: z.coerce.number().int().min(1).max(500).default(100),
});

const structureFileQuerySchema = z.object({
	scanRunId: z.string().trim().min(1),
	generationId: z.string().uuid().optional(),
	path: z.string().trim().min(1),
});

const projectStructureQuerySchema = z.object({
	scanRunId: z.string().trim().min(1),
	generationId: z.string().uuid().optional(),
	view: z.enum(["summary", "files", "references"]).default("summary"),
	query: z.string().trim().max(1024).optional(),
	kind: projectStructureInventoryKindSchema.optional(),
	analyzerId: z.string().trim().min(1).max(128).optional(),
	status: z.enum(["resolved", "unresolved", "external", "ignored"]).optional(),
	cursor: z.coerce.number().int().nonnegative().default(0),
	limit: z.coerce.number().int().min(1).max(500).default(100),
});

const ontologyHandoffQuerySchema = z.object({
	scanRunId: z.string().trim().min(1),
	generationId: z.string().uuid().optional(),
});

const refreshBodySchema = z.object({
	scanRunId: z.string().trim().min(1),
	includeSemantic: z.boolean().optional(),
});

const agentModeSchema = z.object({
	mode: z
		.enum(["overview", "risk", "evidence", "verification", "export"])
		.default("overview"),
	query: z.string().trim().min(1).optional(),
	findingId: z.string().trim().min(1).optional(),
	file: z.string().trim().min(1).optional(),
	ruleId: z.string().trim().min(1).optional(),
	scanner: z.string().trim().min(1).optional(),
	generationId: z.string().uuid().optional(),
});

export function createStaticIntelligenceRoute(
	deps: StaticIntelligenceRouteDeps,
) {
	const runAgentQuery = deps.runAgentQuery ?? runStaticIntelligenceAgentQuery;
	const resolver =
		deps.readResolver ??
		new StaticIntelligenceReadModelResolver(
			deps.db,
			deps.projectRepository,
			deps.scanRepository,
		);
	const buildGeneration =
		deps.buildGeneration ?? buildStaticIntelligenceGeneration;
	const activeRefreshes = new Set<string>();

	async function assertProjectOwner(projectId: string, userId: string) {
		const project = await deps.projectRepository.findById(projectId);
		if (!project) throw new HttpError(404, "Project not found");
		if (project.ownerUserId !== userId) throw new HttpError(403, "Forbidden");
		return project;
	}

	async function assertScanOwner(scanRunId: string, userId: string) {
		const scan = await deps.scanRepository.findById(scanRunId);
		if (!scan) throw new HttpError(404, "Scan run not found");
		const project = await deps.projectRepository.findById(scan.projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
		return { scan, project };
	}

	return new Hono()
		.get("/projects/intelligence-summaries", async (c) => {
			const authUser = getAuthContextUser(c);
			return c.json({
				summaries: await resolver.listSummaries(authUser.userId),
			});
		})
		.get(
			"/projects/:projectId/intelligence",
			zValidator("query", viewQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const projectId = c.req.param("projectId");
				const project = await assertProjectOwner(projectId, authUser.userId);
				try {
					return c.json(
						await resolver.resolveView({
							project,
							requestedScanRunId: c.req.valid("query").scanRunId,
						}),
					);
				} catch (error) {
					if (error instanceof StaticIntelligenceSelectionNotFoundError) {
						throw new HttpError(404, "Scan run not found");
					}
					throw error;
				}
			},
		)
		.get(
			"/projects/:projectId/intelligence/structure",
			zValidator("query", structureQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const project = await assertProjectOwner(
					c.req.param("projectId"),
					authUser.userId,
				);
				const query = c.req.valid("query");
				const scan = await deps.scanRepository.findById(query.scanRunId);
				if (!scan || scan.projectId !== project.id)
					throw new HttpError(404, "Scan run not found");
				const generation = await resolver.resolveGeneration(
					scan.id,
					query.generationId,
				);
				if (!generation) {
					return c.json({
						status: "missing",
						items: [],
						modules: [],
						nextCursor: null,
					});
				}
				const risks = new Map(
					generation.export.payload.fileRiskIndex.map((entry) => [
						entry.path,
						entry,
					]),
				);
				const filtered = generation.structure.snapshot.files.filter((file) => {
					if (
						query.query &&
						!file.path.toLowerCase().includes(query.query.toLowerCase())
					)
						return false;
					if (query.tag && !file.tags.includes(query.tag)) return false;
					if (query.status && file.parseStatus !== query.status) return false;
					return true;
				});
				const items = filtered
					.slice(query.cursor, query.cursor + query.limit)
					.map((file) => ({
						path: file.path,
						language: file.language,
						moduleKind: file.moduleKind,
						tags: file.tags,
						parseStatus: file.parseStatus,
						importCount: file.imports.length,
						exportCount: file.exportedSymbols.length,
						packageCount: file.packageImports.length,
						risk: risks.get(file.path) ?? null,
					}));
				const readiness = await resolver.resolveReadiness(project, generation);
				return c.json({
					status: readiness.codeStructure.status,
					generationId: generation.generationId,
					items,
					modules: buildStaticIntelligenceModuleCandidates({
						snapshot: generation.structure.snapshot,
						exportPayload: generation.export.payload,
						projectStructureSnapshot: shouldPreferProjectStructureV2(
							projectStructureRolloutMode(),
						)
							? generation.projectStructure?.snapshot
							: undefined,
					}),
					nextCursor:
						query.cursor + items.length < filtered.length
							? query.cursor + items.length
							: null,
					total: filtered.length,
				});
			},
		)
		.get(
			"/projects/:projectId/intelligence/project-structure",
			zValidator("query", projectStructureQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const project = await assertProjectOwner(
					c.req.param("projectId"),
					authUser.userId,
				);
				const query = c.req.valid("query");
				const scan = await deps.scanRepository.findById(query.scanRunId);
				if (!scan || scan.projectId !== project.id)
					throw new HttpError(404, "Scan run not found");
				const generation = await resolver.resolveGeneration(
					scan.id,
					query.generationId,
				);
				const snapshot = generation?.projectStructure?.snapshot;
				if (!generation || !snapshot) {
					return c.json({
						status: "missing",
						generationId: generation?.generationId,
						items: [],
						nextCursor: null,
					});
				}
				if (query.view === "summary") {
					return c.json({
						status: snapshot.readiness.analysis.status,
						generationId: generation.generationId,
						summary: snapshot.summary,
						coverage: snapshot.inventory.coverage,
						readiness: snapshot.readiness,
						diagnostics: snapshot.diagnostics,
						modules: snapshot.modules,
					});
				}
				const normalizedQuery = query.query?.toLowerCase();
				const filtered =
					query.view === "files"
						? snapshot.files.filter((item) => {
								if (
									normalizedQuery &&
									!JSON.stringify(item).toLowerCase().includes(normalizedQuery)
								)
									return false;
								if (query.analyzerId && item.analyzerId !== query.analyzerId)
									return false;
								if (query.kind) {
									const inventoryEntry = snapshot.inventory.entries.find(
										(entry) => entry.path === item.path,
									);
									if (inventoryEntry?.kind !== query.kind) return false;
								}
								return true;
							})
						: snapshot.references.filter((item) => {
								if (
									normalizedQuery &&
									!JSON.stringify(item).toLowerCase().includes(normalizedQuery)
								)
									return false;
								if (query.status && item.status !== query.status) return false;
								return true;
							});
				const items = filtered.slice(query.cursor, query.cursor + query.limit);
				return c.json({
					status: snapshot.readiness.analysis.status,
					generationId: generation.generationId,
					items,
					nextCursor:
						query.cursor + items.length < filtered.length
							? query.cursor + items.length
							: null,
					total: filtered.length,
				});
			},
		)
		.get(
			"/projects/:projectId/intelligence/structure/file",
			zValidator("query", structureFileQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const project = await assertProjectOwner(
					c.req.param("projectId"),
					authUser.userId,
				);
				const query = c.req.valid("query");
				const scan = await deps.scanRepository.findById(query.scanRunId);
				if (!scan || scan.projectId !== project.id)
					throw new HttpError(404, "Scan run not found");
				const relative = toProjectRelativePath(project.repoPath, query.path);
				if (!relative.ok) throw new HttpError(404, "Structure file not found");
				const generation = await resolver.resolveGeneration(
					scan.id,
					query.generationId,
				);
				const file = generation?.structure.snapshot.files.find(
					(item) => item.path === relative.path,
				);
				if (!generation || !file)
					throw new HttpError(404, "Structure file not found");
				const importedBy = generation.structure.snapshot.edges
					.filter((edge) => edge.kind === "imports" && edge.to === file.path)
					.map((edge) => edge.from)
					.sort();
				return c.json({
					generationId: generation.generationId,
					file: {
						...file,
						contentHash: undefined,
						importedBy,
						risk:
							generation.export.payload.fileRiskIndex.find(
								(entry) => entry.path === file.path,
							) ?? null,
					},
				});
			},
		)
		.get(
			"/projects/:projectId/intelligence/ontology-handoff",
			zValidator("query", ontologyHandoffQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const project = await assertProjectOwner(
					c.req.param("projectId"),
					authUser.userId,
				);
				const query = c.req.valid("query");
				const scanRunId = query.scanRunId;
				const scan = await deps.scanRepository.findById(scanRunId);
				if (!scan || scan.projectId !== project.id)
					throw new HttpError(404, "Scan run not found");
				const generation = await resolver.resolveGeneration(
					scanRunId,
					query.generationId,
				);
				if (!generation) return c.json({ handoff: null, status: "missing" });
				const readiness = await resolver.resolveReadiness(project, generation);
				const handoff = await resolver.ontologyHandoff({
					scanRunId,
					generationId: generation.generationId,
					status: readiness.ontologyHandoff.status,
				});
				return handoff
					? c.json({ handoff })
					: c.json({ handoff: null, status: "missing" });
			},
		)
		.post(
			"/projects/:projectId/intelligence/refresh",
			zValidator("json", refreshBodySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const project = await assertProjectOwner(
					c.req.param("projectId"),
					authUser.userId,
				);
				const input = c.req.valid("json");
				const scan = await deps.scanRepository.findById(input.scanRunId);
				if (!scan || scan.projectId !== project.id)
					throw new HttpError(404, "Scan run not found");
				if (activeRefreshes.has(scan.id))
					throw new HttpError(409, "analysis_refresh_in_progress");
				activeRefreshes.add(scan.id);
				try {
					return c.json(
						await buildGeneration({
							db: deps.db,
							scanRunId: scan.id,
							includeSemantic: input.includeSemantic,
							emitTelemetry: true,
						}),
					);
				} finally {
					activeRefreshes.delete(scan.id);
				}
			},
		)
		.get("/scans/:scanRunId/intelligence/export", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await assertScanOwner(scanRunId, authUser.userId);
			const persisted = await resolver.resolveGeneration(
				scanRunId,
				c.req.query("generationId"),
			);
			if (!persisted) {
				throw new HttpError(404, "Static Intelligence generation not found");
			}
			return c.json({ export: persisted.export.payload });
		})
		.get(
			"/scans/:scanRunId/intelligence/agent-query",
			zValidator("query", agentModeSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const scanRunId = c.req.param("scanRunId");
				await assertScanOwner(scanRunId, authUser.userId);
				const query = c.req.valid("query");
				const input = agentInputForMode(scanRunId, query);
				const persisted = await resolver.resolveGeneration(
					scanRunId,
					query.generationId,
				);
				if (!persisted) {
					throw new HttpError(404, "Static Intelligence generation not found");
				}
				const result = await runAgentQuery({
					db: deps.db,
					input,
					exportPayload: persisted.export.payload,
				});
				return c.json({ result });
			},
		)
		.get("/scans/:scanRunId/intelligence/code-structure", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await assertScanOwner(scanRunId, authUser.userId);
			const persisted = await resolver.resolveGeneration(
				scanRunId,
				c.req.query("generationId"),
			);
			if (persisted) {
				return c.json({
					scanRunId,
					generationId: persisted.generationId,
					status: persisted.status,
					snapshot: persisted.structure.snapshot,
					degradedReasons: persisted.structure.metadata.degradedReasons,
				});
			}
			return c.json({
				scanRunId,
				status: "missing",
				snapshot: null,
				degradedReasons: ["generation_missing"],
			});
		});
}

function agentInputForMode(
	scanRunId: string,
	query: z.infer<typeof agentModeSchema>,
): Parameters<typeof runStaticIntelligenceAgentQuery>[0]["input"] {
	switch (query.mode) {
		case "overview":
			return { scanRunId, queryKind: "project_overview" };
		case "risk":
			return {
				scanRunId,
				queryKind: "risk_context",
				query: query.query ?? "project risk context",
				file: query.file,
				ruleId: query.ruleId,
				scanner: query.scanner,
				findingId: query.findingId,
			};
		case "evidence":
			if (!query.findingId) {
				throw new HttpError(
					400,
					"findingId is required for evidence agent-query mode.",
				);
			}
			return {
				scanRunId,
				queryKind: "evidence_bundle",
				findingId: query.findingId,
			};
		case "verification":
			return { scanRunId, queryKind: "verification_commands" };
		case "export":
			return { scanRunId, queryKind: "export_static_intelligence" };
	}
}
