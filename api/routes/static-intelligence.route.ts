import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDatabase } from "../db";
import { buildStaticIntelligenceGeneration } from "../modules/static-intelligence/build-service";
import {
	projectStructureInventoryKindSchema,
	projectStructureReferenceSchema,
} from "../../shared/schemas/project-structure.schema";
import { buildStaticIntelligenceModuleCandidates } from "../modules/static-intelligence/module-candidates";
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

const projectStructureQuerySchema = z
	.object({
		scanRunId: z.string().trim().min(1),
		generationId: z.string().uuid().optional(),
		view: z.enum(["summary", "files", "references"]).default("summary"),
		moduleId: z.string().trim().min(1).max(256).optional(),
		direction: z.enum(["inbound", "outbound", "both"]).optional(),
		query: z.string().trim().max(1024).optional(),
		kind: projectStructureInventoryKindSchema.optional(),
		analyzerId: z.string().trim().min(1).max(128).optional(),
		status: projectStructureReferenceSchema.shape.status.optional(),
		cursor: z.coerce.number().int().nonnegative().default(0),
		limit: z.coerce.number().int().min(1).max(500).default(100),
	})
	.superRefine((query, ctx) => {
		if (query.direction && !query.moduleId) {
			ctx.addIssue({
				code: "custom",
				message: "direction requires moduleId",
				path: ["direction"],
			});
		}
		if (query.direction && query.view !== "references") {
			ctx.addIssue({
				code: "custom",
				message: "direction is only valid for references view",
				path: ["direction"],
			});
		}
		if (query.status && query.view !== "references") {
			ctx.addIssue({
				code: "custom",
				message: "status is only valid for references view",
				path: ["status"],
			});
		}
		if ((query.kind || query.analyzerId) && query.view !== "files") {
			ctx.addIssue({
				code: "custom",
				message: "kind and analyzerId are only valid for files view",
				path: [query.kind ? "kind" : "analyzerId"],
			});
		}
		if (query.view === "summary" && (query.moduleId || query.direction)) {
			ctx.addIssue({
				code: "custom",
				message: "summary view does not accept module filters",
				path: [query.moduleId ? "moduleId" : "direction"],
			});
		}
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
				const snapshot = generation?.projectStructure.snapshot;
				if (!generation || !snapshot) {
					const missing = {
						status: "missing" as const,
						generationId: generation?.generationId,
						modules: [],
					};
					return query.view === "summary"
						? c.json({ ...missing, view: "summary" as const })
						: c.json({
								...missing,
								view: query.view,
								items: [],
								nextCursor: null,
								total: 0,
							});
				}
				const modules = buildStaticIntelligenceModuleCandidates({
					snapshot: generation.structure.snapshot,
					projectStructureSnapshot: snapshot,
					exportPayload: generation.export.payload,
				});
				const selectedModule = query.moduleId
					? snapshot.modules.find((module) => module.id === query.moduleId)
					: null;
				if (query.moduleId && !selectedModule) {
					throw new HttpError(404, "Module candidate not found");
				}
				const moduleFiles = selectedModule
					? new Set(selectedModule.files)
					: null;
				if (query.view === "summary") {
					return c.json({
						view: "summary",
						status: snapshot.readiness.analysis.status,
						generationId: generation.generationId,
						summary: snapshot.summary,
						coverage: snapshot.inventory.coverage,
						readiness: snapshot.readiness,
						diagnostics: snapshot.diagnostics,
						modules,
					});
				}
				const normalizedQuery = query.query?.toLowerCase();
				const filtered =
					query.view === "files"
						? snapshot.files.filter((item) => {
								if (moduleFiles && !moduleFiles.has(item.path)) return false;
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
								if (moduleFiles) {
									const outbound = moduleFiles.has(item.from);
									const inbound = item.target
										? moduleFiles.has(item.target)
										: false;
									if (
										(query.direction === "outbound" && !outbound) ||
										(query.direction === "inbound" && !inbound) ||
										((!query.direction || query.direction === "both") &&
											!outbound &&
											!inbound)
									)
										return false;
								}
								if (
									normalizedQuery &&
									!JSON.stringify(item).toLowerCase().includes(normalizedQuery)
								)
									return false;
								if (query.status && item.status !== query.status) return false;
								return true;
							});
				const page = filtered.slice(query.cursor, query.cursor + query.limit);
				const risks = new Map(
					generation.export.payload.fileRiskIndex.map((entry) => [
						entry.path,
						entry,
					]),
				);
				const items =
					query.view === "files"
						? page.map((item) => {
								const file = item as (typeof snapshot.files)[number];
								const references = snapshot.references.filter(
									(reference) => reference.from === file.path,
								);
								return {
									path: file.path,
									language: file.language,
									moduleKind: file.moduleKind,
									tags: file.tags,
									analysisStatus: file.status,
									referenceCount: references.length,
									exportCount: file.exportedSymbols.length,
									externalDependencyCount: references.filter(
										(reference) =>
											reference.kind === "external_package" ||
											reference.kind === "runtime_builtin",
									).length,
									risk: risks.get(file.path) ?? null,
								};
							})
						: page;
				return c.json({
					view: query.view,
					status: snapshot.readiness.analysis.status,
					generationId: generation.generationId,
					items,
					summary: snapshot.summary,
					coverage: snapshot.inventory.coverage,
					readiness: snapshot.readiness,
					diagnostics: snapshot.diagnostics,
					modules,
					nextCursor:
						query.cursor + items.length < filtered.length
							? query.cursor + items.length
							: null,
					total: filtered.length,
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
		);
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
