import { Hono } from "hono";
import type { Context } from "hono";
import {
	createDiagnosticReportRequestSchema,
	runAttackSurfaceInventoryRequestSchema,
	runSecurityChecksRequestSchema,
} from "../../shared/schemas/diagnostics.schema";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { AttackSurfaceInventoryRunner } from "../modules/diagnostics/attack-surface/inventory-runner";
import { SecurityCheckRunner } from "../modules/diagnostics/checks/check-runner";
import {
	AttackSurfaceRepository,
	DiagnosticReportRepository,
	SecurityCheckRepository,
} from "../modules/diagnostics/repository";
import { buildZeroFindingDiagnosticReport } from "../modules/diagnostics/reports/zero-finding-report-builder";
import type { ArtifactStorage } from "../modules/scans/artifact-storage";
import type {
	ArtifactRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";

type DiagnosticsRouteDeps = {
	db: AppDatabase;
	projectRepository: ProjectRepository;
	scanRepository: ScanRepository;
	artifactRepository: ArtifactRepository;
	artifactStorage: ArtifactStorage;
};

export function createDiagnosticsRoute(deps: DiagnosticsRouteDeps) {
	const attackSurfaceRepo = new AttackSurfaceRepository(deps.db);
	const checkRepo = new SecurityCheckRepository(deps.db);
	const reportRepo = new DiagnosticReportRepository(deps.db);

	async function assertScanOwner(scanRunId: string, userId: string) {
		const scan = await deps.scanRepository.findById(scanRunId);
		if (!scan) throw new HttpError(404, "Scan run not found");
		const project = await deps.projectRepository.findById(scan.projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
		return { scan, project };
	}

	async function readJsonBody(c: Context) {
		const body = await c.req.text();
		if (body.trim().length === 0) return {};
		try {
			return JSON.parse(body) as unknown;
		} catch {
			throw new HttpError(400, "Invalid JSON request body");
		}
	}

	return new Hono()
		.get("/scans/:scanRunId/attack-surface", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const { project } = await assertScanOwner(scanRunId, authUser.userId);
			const items = await attackSurfaceRepo.listForScan(project.id, scanRunId);
			return c.json({ items });
		})
		.post("/scans/:scanRunId/attack-surface/run", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const { project } = await assertScanOwner(scanRunId, authUser.userId);
			const body = await readJsonBody(c);
			const parsed = runAttackSurfaceInventoryRequestSchema.safeParse(body);
			if (!parsed.success) {
				throw new HttpError(400, parsed.error.message);
			}
			const result = await new AttackSurfaceInventoryRunner(deps.db).run({
				projectId: project.id,
				scanRunId,
				repoPath: project.repoPath,
				dryRun: parsed.data.dryRun,
			});
			return c.json({
				ok: result.ok,
				inventoryCount: result.inventoryCount,
				categories: result.categories,
			});
		})
		.get("/scans/:scanRunId/security-checks", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const { project } = await assertScanOwner(scanRunId, authUser.userId);
			const results = await checkRepo.listResultsForScan(project.id, scanRunId);
			return c.json({ results });
		})
		.post("/scans/:scanRunId/security-checks/run", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const { project } = await assertScanOwner(scanRunId, authUser.userId);
			const body = await readJsonBody(c);
			const parsed = runSecurityChecksRequestSchema.safeParse(body);
			if (!parsed.success) {
				throw new HttpError(400, parsed.error.message);
			}
			const result = await new SecurityCheckRunner(deps.db).run({
				projectId: project.id,
				scanRunId,
				category: parsed.data.category,
				checkId: parsed.data.checkId,
				dryRun: parsed.data.dryRun,
			});
			return c.json({
				ok: result.ok,
				resultCount: result.resultCount,
				statusCounts: result.statusCounts,
			});
		})
		.get("/scans/:scanRunId/diagnostic-reports", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const { project } = await assertScanOwner(scanRunId, authUser.userId);
			const reports = await reportRepo.listForScan(project.id, scanRunId);
			return c.json({ reports });
		})
		.post("/scans/:scanRunId/diagnostic-reports", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const { project } = await assertScanOwner(scanRunId, authUser.userId);
			const body = await readJsonBody(c);
			const parsed = createDiagnosticReportRequestSchema.safeParse(body);
			if (!parsed.success) {
				throw new HttpError(400, parsed.error.message);
			}
			const result = await buildZeroFindingDiagnosticReport({
				db: deps.db,
				projectId: project.id,
				scanRunId,
				artifactStorage: deps.artifactStorage,
			});
			return c.json(result, result.ok ? 201 : 500);
		})
		.get("/diagnostic-reports/:reportId", async (c) => {
			const authUser = getAuthContextUser(c);
			const report = await reportRepo.findById(c.req.param("reportId"));
			if (!report) throw new HttpError(404, "Diagnostic report not found");
			await assertScanOwner(report.scanRunId, authUser.userId);
			return c.json({ report });
		})
		.get("/diagnostic-reports/:reportId/download", async (c) => {
			const authUser = getAuthContextUser(c);
			const report = await reportRepo.findById(c.req.param("reportId"));
			if (!report) throw new HttpError(404, "Diagnostic report not found");
			await assertScanOwner(report.scanRunId, authUser.userId);
			if (report.status !== "completed" || !report.artifactId) {
				throw new HttpError(
					400,
					"Only completed diagnostic reports can be downloaded",
				);
			}
			const artifacts = await deps.artifactRepository.listArtifacts(
				report.scanRunId,
			);
			const artifact = artifacts.find((item) => item.id === report.artifactId);
			if (!artifact)
				throw new HttpError(404, "Diagnostic report artifact not found");
			const metadata =
				artifact.metadata && typeof artifact.metadata === "object"
					? (artifact.metadata as Record<string, unknown>)
					: {};
			if (
				artifact.kind !== "diagnostic_report" ||
				artifact.format !== "markdown" ||
				metadata.diagnosticReportId !== report.id
			) {
				throw new HttpError(
					404,
					"Diagnostic report artifact metadata mismatch",
				);
			}
			const content = await deps.artifactStorage.readTextArtifact(
				artifact.path,
			);
			return c.body(content, 200, {
				"Content-Type": "text/markdown; charset=utf-8",
				"Content-Disposition": `attachment; filename="diagnostic-${report.id.slice(0, 8)}.md"`,
			});
		});
}
