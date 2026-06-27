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
import { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import type { ScanReportRepository } from "../modules/scans/report-repository";
import { ScanReviewRepository } from "../modules/scans/scan-review-repository";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import type { ArtifactStorage } from "../modules/scans/artifact-storage";
import type { AppDatabase } from "../db";
import {
	createScanReportSchema,
	createScanReviewSchema,
} from "../../shared/schemas/scan.schema";
import { buildMarkdownReport } from "../modules/scans/report-builder";
import { buildMarkdownReportWithLlmSummary } from "../modules/scans/report-summary-runner";
import { buildScanRunSummary } from "../modules/scans/summary-builder";
import { buildGroupedFindings } from "../modules/scans/grouping-builder";
import type { LlmRouter } from "../providers/llmRouter";

const FULL_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};

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
			const runner = new ScanReviewRunner(db, {
				llmRouter,
				reviewRepository: scanReviewRepository,
			});
			const result = await runner.run(scanRunId, {
				task: "scan_review",
				createdByUserId: authUser.userId,
				findingFilter: parsedInput.data.findingFilter,
			});
			const review = await scanReviewRepository.findById(result.reviewId);
			return c.json({ review, result });
		})
		.post(
			"/:scanRunId/reports",
			zValidator("json", createScanReportSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const scanRunId = c.req.param("scanRunId");
				const input = c.req.valid("json");

				await checkScanOwnership(scanRunId, authUser.userId);
				const reportOptions = {
					...FULL_REPORT_OPTIONS,
					summaryMode: input.summaryMode,
				};

				const report = await scanReportRepository.createReport({
					scanRunId,
					format: input.format,
					title: input.title,
					options: reportOptions,
					status: "running",
					generatedByUserId: authUser.userId,
				});

				try {
					const builderOptions = {
						...FULL_REPORT_OPTIONS,
						title: input.title,
					};
					const reportBuild =
						input.summaryMode === "deterministic_with_llm_summary"
							? await buildMarkdownReportWithLlmSummary(db, scanRunId, {
									...builderOptions,
									llmRouter,
								})
							: {
									markdown: await buildMarkdownReport(
										db,
										scanRunId,
										builderOptions,
									),
									providerRouting: undefined,
									output: undefined,
								};
					const markdown = reportBuild.markdown;

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
						metadata: {
							reportId: report.id,
							summaryMode: input.summaryMode,
							...(reportBuild.providerRouting
								? { providerRouting: reportBuild.providerRouting }
								: {}),
						},
					});

					const updated = await scanReportRepository.updateReportStatus(
						report.id,
						"completed",
						{
							artifactId: artifact.id,
							summary: markdown.slice(0, 500),
							options: {
								...reportOptions,
								...(reportBuild.providerRouting
									? { providerRouting: reportBuild.providerRouting }
									: {}),
							},
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
