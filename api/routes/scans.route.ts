import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	ScanRepository,
	ProjectRepository,
	ArtifactRepository,
	FindingRepository,
} from "../modules/scans/repositories";
import type { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import type { ScanReportRepository } from "../modules/scans/report-repository";
import type { ArtifactStorage } from "../modules/scans/artifact-storage";
import type { AppDatabase } from "../db";
import { createScanReportSchema } from "../../shared/schemas/scan.schema";
import { buildMarkdownReport } from "../modules/scans/report-builder";
import { buildScanRunSummary } from "../modules/scans/summary-builder";
import { buildGroupedFindings } from "../modules/scans/grouping-builder";

type ScansRouteDeps = {
	scanRepository: ScanRepository;
	projectRepository: ProjectRepository;
	artifactRepository: ArtifactRepository;
	findingRepository: FindingRepository;
	decisionRepository: FindingDecisionRepository;
	scanReportRepository: ScanReportRepository;
	artifactStorage: ArtifactStorage;
	db: AppDatabase;
};

export function createScansRoute(deps: ScansRouteDeps) {
	const {
		scanRepository,
		projectRepository,
		artifactRepository,
		findingRepository,
		decisionRepository,
		scanReportRepository,
		artifactStorage,
		db,
	} = deps;

	async function checkScanOwnership(scanRunId: string, userId: string) {
		const scan = await scanRepository.findById(scanRunId);
		if (!scan) {
			throw new HttpError(404, "Scan run not found");
		}
		const project = await projectRepository.findById(scan.projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
		return scan;
	}

	return new Hono()
		.get("/", async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.query("projectId");
			if (!projectId) {
				throw new HttpError(400, "Missing projectId query parameter");
			}
			const project = await projectRepository.findById(projectId);
			if (!project || project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}
			const list = await scanRepository.listScanRunsByProject(projectId);
			return c.json({ scans: list });
		})
		.get("/:scanRunId", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const scan = await checkScanOwnership(scanRunId, authUser.userId);
			return c.json({ scan });
		})
		.get("/:scanRunId/events", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const events = await scanRepository.listScanEvents(scanRunId);
			return c.json({ events });
		})
		.get("/:scanRunId/artifacts", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const list = await artifactRepository.listArtifacts(scanRunId);
			return c.json({ artifacts: list });
		})
		.get("/:scanRunId/artifacts/:artifactId/download", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const artifactId = c.req.param("artifactId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const list = await artifactRepository.listArtifacts(scanRunId);
			const artifact = list.find((a) => a.id === artifactId);
			if (!artifact) {
				throw new HttpError(404, "Artifact not found");
			}
			const content = await artifactStorage.readTextArtifact(artifact.path);
			const filename = artifact.path.split("/").pop() || "artifact";
			const contentType =
				artifact.format === "json" ? "application/json" : "text/plain";
			return c.body(content as any, 200, {
				"Content-Type": `${contentType}; charset=utf-8`,
				"Content-Disposition": `attachment; filename="${filename}"`,
			});
		})
		.get("/:scanRunId/findings", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const list = await findingRepository.listFindings(scanRunId);

			const findingsWithDecisions = await Promise.all(
				list.map(async (f) => {
					const latestDecision =
						await decisionRepository.findLatestDecisionForFinding(f.id);
					return {
						...f,
						latestDecision,
					};
				}),
			);

			return c.json({ findings: findingsWithDecisions });
		})
		.get("/:scanRunId/summary", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const summary = await buildScanRunSummary(db, scanRunId);
			return c.json({ summary });
		})
		.get("/:scanRunId/groups", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const grouped = await buildGroupedFindings(db, scanRunId);
			return c.json(grouped);
		})
		.get("/:scanRunId/reports", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const list = await scanReportRepository.listReportsForScan(scanRunId);
			return c.json({ reports: list });
		})
		.post(
			"/:scanRunId/reports",
			zValidator("json", createScanReportSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const scanRunId = c.req.param("scanRunId");
				const input = c.req.valid("json");

				await checkScanOwnership(scanRunId, authUser.userId);

				const report = await scanReportRepository.createReport({
					scanRunId,
					format: input.format,
					title: input.title,
					options: {
						includeFalsePositives: input.includeFalsePositives,
						includeDeferred: input.includeDeferred,
						includeUndecided: input.includeUndecided,
					},
					status: "running",
					generatedByUserId: authUser.userId,
				});

				try {
					const markdown = await buildMarkdownReport(db, scanRunId, {
						includeFalsePositives: input.includeFalsePositives,
						includeDeferred: input.includeDeferred,
						includeUndecided: input.includeUndecided,
						title: input.title,
					});

					const filename = `report-${report.id}.md`;
					const saveResult = await artifactStorage.saveTextArtifact(
						scanRunId,
						"reports",
						markdown,
						filename,
					);

					const artifact = await artifactRepository.createArtifact({
						scanRunId,
						toolRunId: null,
						kind: "report",
						format: "markdown",
						path: saveResult.path,
						sha256: saveResult.sha256,
						sizeBytes: saveResult.sizeBytes,
						metadata: { reportId: report.id },
					});

					const updated = await scanReportRepository.updateReportStatus(
						report.id,
						"completed",
						{
							artifactId: artifact.id,
							summary: markdown.slice(0, 500),
						},
					);

					return c.json({ report: updated });
				} catch (err) {
					const failed = await scanReportRepository.updateReportStatus(
						report.id,
						"failed",
						{
							errorMessage: err instanceof Error ? err.message : String(err),
						},
					);
					return c.json({ report: failed });
				}
			},
		);
}
