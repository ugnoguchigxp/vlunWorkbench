import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
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
import { ScanDiagnosticRepository } from "../modules/scans/scan-diagnostic-repository";
import type { ScanDiagnosticRunner } from "../modules/scans/scan-diagnostic-runner";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import { ScanReviewRepository } from "../modules/scans/scan-review-repository";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import { buildScanRunSummary } from "../modules/scans/summary-builder";
import { AssessmentRepository } from "../modules/assessments/assessment-repository";
import { buildCoverageResults } from "../modules/assessments/coverage-builder";
import { coverageControlById } from "../modules/assessments/coverage-catalog";
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
	scanDiagnosticRepository?: ScanDiagnosticRepository;
	assessmentRepository?: AssessmentRepository;
	artifactStorage: ArtifactStorage;
	db: AppDatabase;
	llmRouter?: LlmRouter;
	scanSupervisor?: ScanProcessSupervisor;
	scanReviewRunner?: Pick<ScanReviewRunner, "start">;
	scanReportRunner?: Pick<ScanReportRunner, "start">;
	scanDiagnosticRunner?: Pick<ScanDiagnosticRunner, "retry">;
};

const FindingsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(100),
	cursor: z.string().trim().min(1).max(128).optional(),
});

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
	const scanDiagnosticRepository =
		deps.scanDiagnosticRepository ?? new ScanDiagnosticRepository(db);
	const assessmentRepository =
		deps.assessmentRepository ?? new AssessmentRepository(db);
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
			return c.body(content, 200, {
				"Content-Type": `${contentType}; charset=utf-8`,
				"Content-Disposition": `attachment; filename="${filename}"`,
			});
		})
		.get(
			"/:scanRunId/findings",
			zValidator("query", FindingsQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const scanRunId = c.req.param("scanRunId");
				const query = c.req.valid("query");
				await checkScanOwnership(scanRunId, authUser.userId);
				const page = await findingRepository
					.listFindingsPage(scanRunId, query)
					.catch((error) => {
						if (
							error instanceof Error &&
							error.message === "FINDING_CURSOR_INVALID"
						) {
							throw new HttpError(400, "Invalid finding cursor");
						}
						throw error;
					});
				const findingIds = page.items.map((finding) => finding.id);
				const [decisionsByFinding, reviewsByFinding] = await Promise.all([
					decisionRepository.findLatestDecisionsForFindings(findingIds),
					findingReviewRepository.findLatestReviewsForFindings(findingIds),
				]);
				return c.json({
					findings: page.items.map((finding) => ({
						...finding,
						latestDecision: decisionsByFinding.get(finding.id) ?? null,
						latestReview: reviewsByFinding.get(finding.id) ?? null,
					})),
					nextCursor: page.nextCursor,
				});
			},
		)
		.get("/:scanRunId/summary", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const summary = await buildScanRunSummary(db, scanRunId);
			const persistedCoverage =
				await assessmentRepository.listCoverageResults(scanRunId);
			const coverageResults = (
				persistedCoverage.length > 0
					? persistedCoverage
					: buildCoverageResults(summary)
			).map((result) => ({
				...result,
				control: coverageControlById(result.controlId),
			}));
			return c.json({ summary: { ...summary, coverageResults } });
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
		.get("/:scanRunId/diagnostics", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const diagnostics = await scanDiagnosticRepository.listForScan(scanRunId);
			return c.json({ diagnostics });
		})
		.post("/:scanRunId/diagnostics/retry", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			if (!deps.scanDiagnosticRunner) {
				throw new HttpError(
					409,
					"Automated diagnostic runner is not available.",
				);
			}
			const started = await deps.scanDiagnosticRunner.retry(scanRunId);
			void started.completion.catch((error) => {
				console.error(
					`Automated diagnostic ${started.diagnosticRunId} retry failed:`,
					error,
				);
			});
			const diagnostic = await scanDiagnosticRepository.findById(
				started.diagnosticRunId,
			);
			const status =
				started.status === "queued" || started.status === "running" ? 202 : 200;
			return c.json({ diagnostic }, status);
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
