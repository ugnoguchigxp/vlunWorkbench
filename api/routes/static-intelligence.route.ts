import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type {
	StaticIntelligenceCodeStructureEnrichment,
	StaticIntelligenceExportV1,
} from "../../shared/schemas/static-intelligence.schema";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { runStaticIntelligenceAgentQuery } from "../modules/static-intelligence/agent-query";
import {
	buildStaticIntelligenceExport,
	StaticIntelligenceScanRunNotFoundError,
} from "../modules/static-intelligence/export-builder";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";

type IntelligenceAvailability = {
	export: "available" | "missing" | "failed";
	fileRiskIndex: "available" | "missing";
	evidenceGraph: "available" | "missing";
	codeStructure: "available" | "missing" | "degraded";
	agentBundle: "available" | "missing" | "degraded";
};

type StaticIntelligenceRouteDeps = {
	db: AppDatabase;
	projectRepository: ProjectRepository;
	scanRepository: ScanRepository;
	buildExport?: typeof buildStaticIntelligenceExport;
	runAgentQuery?: typeof runStaticIntelligenceAgentQuery;
};

const agentModeSchema = z.object({
	mode: z
		.enum(["overview", "risk", "evidence", "verification", "export"])
		.default("overview"),
	query: z.string().trim().min(1).optional(),
	findingId: z.string().trim().min(1).optional(),
	file: z.string().trim().min(1).optional(),
	ruleId: z.string().trim().min(1).optional(),
	scanner: z.string().trim().min(1).optional(),
});

export function createStaticIntelligenceRoute(
	deps: StaticIntelligenceRouteDeps,
) {
	const buildExport = deps.buildExport ?? buildStaticIntelligenceExport;
	const runAgentQuery = deps.runAgentQuery ?? runStaticIntelligenceAgentQuery;

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

	async function latestScanForProject(projectId: string) {
		const scans = await deps.scanRepository.listScanRunsByProject(projectId);
		return [...scans].sort(compareScansNewestFirst)[0] ?? null;
	}

	return new Hono()
		.get("/projects/:projectId/intelligence", async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			const project = await assertProjectOwner(projectId, authUser.userId);
			const latestScan = await latestScanForProject(projectId);
			const degradedReasons: string[] = [];

			if (!latestScan) {
				degradedReasons.push("project has no scan runs");
				return c.json({
					project,
					latestScan: null,
					latestExport: null,
					availability: missingAvailability(),
					degradedReasons,
				});
			}

			const exportResult = await safeBuildExport(
				buildExport,
				deps.db,
				latestScan.id,
			);
			if (!exportResult.ok) {
				degradedReasons.push(exportResult.message);
				return c.json({
					project,
					latestScan,
					latestExport: null,
					availability: {
						...missingAvailability(),
						export: "failed" as const,
					},
					degradedReasons,
				});
			}

			const latestExport = exportResult.exportPayload;
			degradedReasons.push(...latestExport.scanSummary.degradedReasons);
			return c.json({
				project,
				latestScan,
				latestExport,
				availability: availabilityForExport(latestExport),
				degradedReasons: sortedUnique(degradedReasons),
			});
		})
		.get("/scans/:scanRunId/intelligence/export", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await assertScanOwner(scanRunId, authUser.userId);
			const exportPayload = await buildExport(deps.db, scanRunId);
			return c.json({ export: exportPayload });
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
				const result = await runAgentQuery({ db: deps.db, input });
				return c.json({ result });
			},
		)
		.get("/scans/:scanRunId/intelligence/code-structure", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await assertScanOwner(scanRunId, authUser.userId);
			const exportPayload = await buildExport(deps.db, scanRunId);
			const codeStructure = exportPayload.codeStructure ?? null;
			const degradedReasons =
				codeStructure && codeStructure.degradedReasons.length > 0
					? codeStructure.degradedReasons
					: codeStructure
						? []
						: [
								"code structure snapshot missing from static intelligence export",
							];
			return c.json({
				scanRunId,
				status: codeStructureStatus(codeStructure),
				codeStructure,
				degradedReasons,
			});
		});
}

function missingAvailability(): IntelligenceAvailability {
	return {
		export: "missing",
		fileRiskIndex: "missing",
		evidenceGraph: "missing",
		codeStructure: "missing",
		agentBundle: "missing",
	};
}

function availabilityForExport(
	exportPayload: StaticIntelligenceExportV1,
): IntelligenceAvailability {
	const codeStructure = codeStructureStatus(exportPayload.codeStructure);
	return {
		export: "available",
		fileRiskIndex:
			exportPayload.fileRiskIndex.length > 0 ? "available" : "missing",
		evidenceGraph:
			exportPayload.graph.nodes.length > 0 ||
			exportPayload.graph.edges.length > 0
				? "available"
				: "missing",
		codeStructure,
		agentBundle:
			exportPayload.scanSummary.degradedReasons.length > 0
				? "degraded"
				: "available",
	};
}

function codeStructureStatus(
	codeStructure: StaticIntelligenceCodeStructureEnrichment | null | undefined,
): "available" | "missing" | "degraded" {
	if (!codeStructure) return "missing";
	if (codeStructure.status === "degraded") return "degraded";
	return "available";
}

async function safeBuildExport(
	buildExport: typeof buildStaticIntelligenceExport,
	db: AppDatabase,
	scanRunId: string,
): Promise<
	| { ok: true; exportPayload: StaticIntelligenceExportV1 }
	| { ok: false; message: string }
> {
	try {
		return {
			ok: true,
			exportPayload: await buildExport(db, scanRunId),
		};
	} catch (error) {
		if (error instanceof StaticIntelligenceScanRunNotFoundError) {
			return { ok: false, message: "static intelligence scan source missing" };
		}
		return {
			ok: false,
			message:
				error instanceof Error
					? `static intelligence export failed: ${error.message}`
					: "static intelligence export failed",
		};
	}
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

function compareScansNewestFirst(
	a: { completedAt?: Date | string | null; createdAt?: Date | string | null },
	b: { completedAt?: Date | string | null; createdAt?: Date | string | null },
): number {
	return scanTime(b) - scanTime(a);
}

function scanTime(scan: {
	completedAt?: Date | string | null;
	createdAt?: Date | string | null;
}): number {
	const value = scan.completedAt ?? scan.createdAt;
	if (!value) return 0;
	return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
