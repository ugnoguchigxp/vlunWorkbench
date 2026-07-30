import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	createScanReportSchema,
	createScanReviewSchema,
} from "../../shared/schemas/scan.schema";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import { ScanReportRunner } from "../modules/reports/scan-report-runner";
import type { ArtifactStorage } from "../modules/scans/artifact-storage";
import { buildGroupedFindings } from "../modules/scans/grouping-builder";
import type { ScanReportRepository } from "../modules/scans/report-repository";
import type {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import { ScanReviewRepository } from "../modules/scans/scan-review-repository";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import { buildScanRunSummary } from "../modules/scans/summary-builder";
import type { LlmRouter } from "../providers/llmRouter";

type ScansRouteDeps = {
	scanRepository: ScanRepository;
	projectRepository: ProjectRepository;
	artifactRepository: ArtifactRepository;
	findingRepository: FindingRepository;
	decisionRepository: FindingDecisionRepository;
	findingReviewRepository?: FindingReviewRepository;
	scanReportRepository: ScanReportRepository;
	scanReviewRepository?: ScanReviewRepository;
	artifactStorage: ArtifactStorage;
	db: AppDatabase;
	llmRouter?: LlmRouter;
	scanSupervisor?: ScanProcessSupervisor;
	scanReviewRunner?: Pick<ScanReviewRunner, "start">;
	scanReportRunner?: Pick<ScanReportRunner, "start">;
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
		llmRouter,
	} = deps;
	const findingReviewRepository =
		deps.findingReviewRepository ?? new FindingReviewRepository(db);
	const scanReviewRepository =
		deps.scanReviewRepository ?? new ScanReviewRepository(db);
	const scanReviewRunner =
		deps.scanReviewRunner ??
		new ScanReviewRunner(db, {
			llmRouter,
			reviewRepository: scanReviewRepository,
		});
	const scanReportRunner =
		deps.scanReportRunner ??
		new ScanReportRunner(db, {
			reportRepository: scanReportRepository,
			artifactRepository,
			artifactStorage,
			llmRouter,
		});

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
		.post("/:scanRunId/cancel", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			if (!deps.scanSupervisor) {
				throw new HttpError(409, "Scan process is not owned by this runtime.");
			}
			const result = await deps.scanSupervisor.cancel(scanRunId);
			if (!result.cancelled) {
				throw new HttpError(
					409,
					`Scan could not be cancelled: ${result.reason}`,
				);
			}
			const scan = await scanRepository.findById(scanRunId);
			return c.json({ scan });
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
					const [latestDecision, latestReview] = await Promise.all([
						decisionRepository.findLatestDecisionForFinding(f.id),
						findingReviewRepository.findLatestReview(f.id),
					]);
					return {
						...f,
						latestDecision,
						latestReview,
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
		.get("/:scanRunId/reviews", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const reviews = await scanReviewRepository.listReviews(scanRunId);
			return c.json({ reviews });
		})
		.post("/:scanRunId/reviews", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const rawInput = await c.req.json().catch(() => ({}));
			const parsedInput = createScanReviewSchema.safeParse(rawInput);
			if (!parsedInput.success) {
				throw new HttpError(400, "Invalid scan review request.");
			}
			const started = await scanReviewRunner.start(scanRunId, {
				task: "scan_review",
				createdByUserId: authUser.userId,
				findingFilter: parsedInput.data.findingFilter,
			});
			if (started.status === "running") {
				void started.completion.catch((error) => {
					console.error(
						`Scan review ${started.reviewId} background execution failed:`,
						error,
					);
				});
			}
			const review = await scanReviewRepository.findById(started.reviewId);
			return c.json(
				{
					review,
					result: {
						ok: started.status === "running",
						reviewId: started.reviewId,
						status: started.status,
						error: started.error,
					},
				},
				started.status === "running" ? 202 : 200,
			);
		})
		.post(
			"/:scanRunId/reports",
			zValidator("json", createScanReportSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const scanRunId = c.req.param("scanRunId");
				const input = c.req.valid("json");

				await checkScanOwnership(scanRunId, authUser.userId);
				const started = await scanReportRunner.start({
					scanRunId,
					title: input.title,
					summaryMode: input.summaryMode,
					generatedByUserId: authUser.userId,
				});
				void started.completion.catch((error) => {
					console.error(
						`Scan report ${started.reportId} background execution failed:`,
						error,
					);
				});
				const report = await scanReportRepository.findById(started.reportId);
				return c.json({ report }, 202);
			},
		);
}
