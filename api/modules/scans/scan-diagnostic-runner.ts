import type {
	AutomatedDiagnosticReadiness,
	AutomatedDiagnosticStatus,
} from "../../../shared/schemas/automated-diagnostic.schema";
import type { AppDatabase } from "../../db";
import { ensureScanCoverageResults } from "../assessments/coverage-builder";
import type { ScanReportRunner } from "../reports/scan-report-runner";
import {
	buildDiagnosticSnapshotHashes,
	classifyReviewLimitation,
	collectBundleLimitations,
	type DiagnosticJobResult,
	diagnosticResultFromRow,
	isTerminalDiagnosticStatus,
	logDiagnosticFailure,
} from "./scan-diagnostic-helpers";
import { produceDiagnosticReport } from "./scan-diagnostic-report";
import { ScanDiagnosticRepository } from "./scan-diagnostic-repository";
import { ScanReportRepository } from "./report-repository";
import { ScanRepository } from "./repositories";
import {
	buildScanReviewBundle,
	type ScanReviewBundle,
} from "./scan-review-bundle";
import { ScanReviewRepository } from "./scan-review-repository";
import type { ScanReviewRunner } from "./scan-review-runner";

export const AUTOMATED_DIAGNOSTIC_PIPELINE_VERSION =
	"automated-scan-diagnostic-v1";

export { buildDiagnosticSnapshotHashes } from "./scan-diagnostic-helpers";

export type DiagnosticStartResult = {
	diagnosticRunId: string;
	status: AutomatedDiagnosticStatus;
	completion: Promise<DiagnosticJobResult>;
};

type ScanDiagnosticRunnerDeps = {
	scanRepository?: ScanRepository;
	diagnosticRepository?: ScanDiagnosticRepository;
	reviewRepository?: ScanReviewRepository;
	reportRepository?: ScanReportRepository;
	reviewRunner: Pick<ScanReviewRunner, "start">;
	reportRunner: Pick<ScanReportRunner, "start">;
	pipelineVersion?: string;
};

export class ScanDiagnosticRunner {
	private readonly active = new Map<string, Promise<DiagnosticJobResult>>();
	private readonly scanRepository: ScanRepository;
	private readonly diagnosticRepository: ScanDiagnosticRepository;
	private readonly reviewRepository: ScanReviewRepository;
	private readonly reportRepository: ScanReportRepository;
	private readonly pipelineVersion: string;
	private shuttingDown = false;

	constructor(
		private readonly db: AppDatabase,
		private readonly deps: ScanDiagnosticRunnerDeps,
	) {
		this.scanRepository = deps.scanRepository ?? new ScanRepository(db);
		this.diagnosticRepository =
			deps.diagnosticRepository ?? new ScanDiagnosticRepository(db);
		this.reviewRepository =
			deps.reviewRepository ?? new ScanReviewRepository(db);
		this.reportRepository =
			deps.reportRepository ?? new ScanReportRepository(db);
		this.pipelineVersion =
			deps.pipelineVersion ?? AUTOMATED_DIAGNOSTIC_PIPELINE_VERSION;
	}

	async start(scanRunId: string): Promise<DiagnosticStartResult> {
		if (this.shuttingDown) {
			throw new Error("Automated diagnostic runner is shutting down.");
		}
		const scan = await this.scanRepository.findById(scanRunId);
		if (!scan) throw new Error(`Scan run not found: ${scanRunId}`);
		if (scan.status !== "completed") {
			throw new Error(
				`Automated diagnosis requires a completed scan: ${scanRunId}`,
			);
		}
		await ensureScanCoverageResults(this.db, scanRunId);

		const bundle = await buildScanReviewBundle(this.db, scanRunId, {
			findingFilter: "all",
		});
		const { inputSnapshotHash, scannerProvenanceHash } =
			buildDiagnosticSnapshotHashes(bundle);
		const diagnostic = await this.diagnosticRepository.createOrFind({
			scanRunId,
			inputSnapshotHash,
			scannerProvenanceHash,
			pipelineVersion: this.pipelineVersion,
		});
		if (!diagnostic) {
			throw new Error("Automated diagnostic run could not be persisted.");
		}

		if (isTerminalDiagnosticStatus(diagnostic.status)) {
			return {
				diagnosticRunId: diagnostic.id,
				status: diagnostic.status as AutomatedDiagnosticStatus,
				completion: Promise.resolve(diagnosticResultFromRow(diagnostic)),
			};
		}

		const active = this.active.get(diagnostic.id);
		if (active) {
			return {
				diagnosticRunId: diagnostic.id,
				status: diagnostic.status as AutomatedDiagnosticStatus,
				completion: active,
			};
		}
		if (diagnostic.status === "running") {
			return {
				diagnosticRunId: diagnostic.id,
				status: "running",
				completion: this.waitForTerminal(diagnostic.id),
			};
		}

		const completion = this.execute({
			diagnosticRunId: diagnostic.id,
			scanRunId,
			generatedByUserId: scan.createdByUserId,
			bundle,
			inputSnapshotHash,
			scannerProvenanceHash,
		}).finally(() => {
			this.active.delete(diagnostic.id);
		});
		this.active.set(diagnostic.id, completion);
		return {
			diagnosticRunId: diagnostic.id,
			status: "queued",
			completion,
		};
	}

	async run(scanRunId: string): Promise<DiagnosticJobResult> {
		return await (await this.start(scanRunId)).completion;
	}

	async retry(scanRunId: string): Promise<DiagnosticStartResult> {
		const bundle = await buildScanReviewBundle(this.db, scanRunId, {
			findingFilter: "all",
		});
		const { inputSnapshotHash } = buildDiagnosticSnapshotHashes(bundle);
		const current = await this.diagnosticRepository.findBySnapshot({
			scanRunId,
			inputSnapshotHash,
			pipelineVersion: this.pipelineVersion,
		});
		if (
			current &&
			(current.status === "failed" ||
				(current.status === "completed_with_limitations" &&
					current.limitationCodes.some(
						(code) =>
							code.startsWith("llm_") ||
							code === "pipeline_failed" ||
							code === "report_failed",
					)))
		) {
			await this.diagnosticRepository.requeueForRetry(current.id);
		}
		return await this.start(scanRunId);
	}

	async recover(): Promise<{ requeued: number; scheduled: number }> {
		const active = await this.diagnosticRepository.listActive();
		let requeued = 0;
		for (const diagnostic of active) {
			if (diagnostic.status === "running") {
				if (diagnostic.scanReviewId) {
					await this.reviewRepository.updateReview(
						diagnostic.scanReviewId,
						"failed",
						{
							errorMessage:
								"Automated diagnostic execution was interrupted by a server restart.",
						},
					);
				}
				if (await this.diagnosticRepository.requeueInterrupted(diagnostic.id)) {
					requeued += 1;
				}
			}
		}

		const completedScans =
			await this.diagnosticRepository.listCompletedScanRuns();
		const eligible = completedScans.filter((scan) => {
			const metadata = scan.metadata as Record<string, unknown>;
			return metadata.automaticDiagnosticRequested === true;
		});
		const scanRunIds = new Set([
			...active.map((diagnostic) => diagnostic.scanRunId),
			...eligible.map((scan) => scan.id),
		]);
		for (const scanRunId of scanRunIds) {
			void this.start(scanRunId).catch((error) => {
				logDiagnosticFailure("recovery_schedule_failed", error, scanRunId);
			});
		}
		return { requeued, scheduled: scanRunIds.size };
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		await Promise.allSettled(this.active.values());
	}

	private async execute(params: {
		diagnosticRunId: string;
		scanRunId: string;
		generatedByUserId: string | null;
		bundle: ScanReviewBundle;
		inputSnapshotHash: string;
		scannerProvenanceHash: string;
	}): Promise<DiagnosticJobResult> {
		const claimed = await this.diagnosticRepository.claimQueued(
			params.diagnosticRunId,
		);
		if (!claimed) {
			const current = await this.diagnosticRepository.findById(
				params.diagnosticRunId,
			);
			if (current && isTerminalDiagnosticStatus(current.status)) {
				return diagnosticResultFromRow(current);
			}
			return await this.waitForTerminal(params.diagnosticRunId);
		}

		const limitations = collectBundleLimitations(params.bundle);
		await this.recordEvent(params.scanRunId, {
			level: "info",
			eventType: "diagnostic.started",
			message: "Automated evidence-constrained diagnosis started.",
			data: {
				diagnosticRunId: params.diagnosticRunId,
				inputSnapshotHash: params.inputSnapshotHash,
				pipelineVersion: this.pipelineVersion,
			},
		});

		try {
			const reviewStart = await this.deps.reviewRunner.start(params.scanRunId, {
				task: "scan_review",
				findingFilter: "all",
				createdByUserId: params.generatedByUserId,
				preparedBundle: params.bundle,
				diagnosticContext: {
					inputSnapshotHash: params.inputSnapshotHash,
					scannerProvenanceHash: params.scannerProvenanceHash,
					pipelineVersion: this.pipelineVersion,
					diagnosticRunId: params.diagnosticRunId,
				},
			});
			await this.diagnosticRepository.update(
				params.diagnosticRunId,
				"running",
				{ scanReviewId: reviewStart.reviewId },
			);
			const reviewResult = await reviewStart.completion;
			if (!reviewResult.ok) {
				limitations.push(classifyReviewLimitation(reviewResult.error));
			}
			const completedReview = reviewResult.ok
				? await this.reviewRepository.findById(reviewStart.reviewId)
				: null;
			const reviewOutput =
				completedReview?.output &&
				typeof completedReview.output === "object" &&
				!Array.isArray(completedReview.output)
					? (completedReview.output as Record<string, unknown>)
					: {};

			const report = await produceDiagnosticReport({
				params: {
					...params,
					...(completedReview
						? {
								reviewProvenance: {
									scanReviewId: completedReview.id,
									provider: completedReview.provider,
									model: completedReview.model,
									promptSequenceHash:
										typeof reviewOutput.promptSequenceHash === "string"
											? reviewOutput.promptSequenceHash
											: null,
									responseContentSha256:
										typeof reviewOutput.responseContentSha256 === "string"
											? reviewOutput.responseContentSha256
											: null,
								},
							}
						: {}),
				},
				limitations,
				pipelineVersion: this.pipelineVersion,
				reportRepository: this.reportRepository,
				reportRunner: this.deps.reportRunner,
				reuseCompletedReport: !reviewResult.ok,
			});
			if (!report || report.status !== "completed") {
				const error =
					"Deterministic diagnostic report generation did not complete.";
				await this.diagnosticRepository.update(
					params.diagnosticRunId,
					"failed",
					{
						readiness: "failed",
						scanReviewId: reviewStart.reviewId,
						scanReportId: report?.reportId ?? null,
						limitationCodes: [...limitations, "report_failed"],
						errorMessage: error,
					},
				);
				await this.persistScanDiagnosticMetadata(params.scanRunId, {
					diagnosticRunId: params.diagnosticRunId,
					status: "failed",
					readiness: "failed",
					reviewId: reviewStart.reviewId,
					reportId: report?.reportId ?? null,
					inputSnapshotHash: params.inputSnapshotHash,
					limitations: [...limitations, "report_failed"],
				});
				await this.recordEvent(params.scanRunId, {
					level: "error",
					eventType: "diagnostic.failed",
					message: error,
					data: { diagnosticRunId: params.diagnosticRunId },
				});
				return {
					diagnosticRunId: params.diagnosticRunId,
					status: "failed",
					readiness: "failed",
					reviewId: reviewStart.reviewId,
					reportId: report?.reportId ?? null,
					limitations: [...limitations, "report_failed"],
					error,
				};
			}

			const status =
				limitations.length > 0 ? "completed_with_limitations" : "completed";
			const readiness =
				limitations.length > 0 ? "ready_with_limitations" : "ready";
			await this.diagnosticRepository.update(params.diagnosticRunId, status, {
				readiness,
				scanReviewId: reviewStart.reviewId,
				scanReportId: report.reportId,
				limitationCodes: limitations,
				errorMessage: reviewResult.error ?? null,
			});
			await this.persistScanDiagnosticMetadata(params.scanRunId, {
				diagnosticRunId: params.diagnosticRunId,
				status,
				readiness,
				reviewId: reviewStart.reviewId,
				reportId: report.reportId,
				inputSnapshotHash: params.inputSnapshotHash,
				limitations,
			});
			await this.recordEvent(params.scanRunId, {
				level: limitations.length > 0 ? "warn" : "info",
				eventType:
					limitations.length > 0
						? "diagnostic.completed_with_limitations"
						: "diagnostic.completed",
				message:
					limitations.length > 0
						? "Automated diagnosis completed with a deterministic report and recorded limitations."
						: "Automated evidence-constrained diagnosis and report completed.",
				data: {
					diagnosticRunId: params.diagnosticRunId,
					reviewId: reviewStart.reviewId,
					reportId: report.reportId,
					readiness,
					limitations,
				},
			});
			return {
				diagnosticRunId: params.diagnosticRunId,
				status,
				readiness,
				reviewId: reviewStart.reviewId,
				reportId: report.reportId,
				limitations,
				...(reviewResult.error ? { error: reviewResult.error } : {}),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.diagnosticRepository.update(params.diagnosticRunId, "failed", {
				readiness: "failed",
				limitationCodes: [...limitations, "pipeline_failed"],
				errorMessage: message,
			});
			await this.recordEvent(params.scanRunId, {
				level: "error",
				eventType: "diagnostic.failed",
				message: "Automated diagnostic pipeline failed.",
				data: {
					diagnosticRunId: params.diagnosticRunId,
					error: message,
				},
			});
			return {
				diagnosticRunId: params.diagnosticRunId,
				status: "failed",
				readiness: "failed",
				reviewId: null,
				reportId: null,
				limitations: [...limitations, "pipeline_failed"],
				error: message,
			};
		}
	}

	private async persistScanDiagnosticMetadata(
		scanRunId: string,
		diagnostic: {
			diagnosticRunId: string;
			status: AutomatedDiagnosticStatus;
			readiness: AutomatedDiagnosticReadiness;
			reviewId: string | null;
			reportId: string | null;
			inputSnapshotHash: string;
			limitations: string[];
		},
	) {
		await this.scanRepository.mergeScanRunMetadata(scanRunId, {
			automatedDiagnostic: {
				...diagnostic,
				pipelineVersion: this.pipelineVersion,
				completedAt: new Date().toISOString(),
			},
		});
	}

	private async recordEvent(
		scanRunId: string,
		event: {
			level: "debug" | "info" | "warn" | "error";
			eventType: string;
			message: string;
			data?: Record<string, unknown>;
		},
	): Promise<void> {
		await this.scanRepository
			.createScanEvent({ scanRunId, ...event })
			.catch((error) => {
				logDiagnosticFailure("event_persistence_failed", error, scanRunId);
			});
	}

	private async waitForTerminal(
		diagnosticRunId: string,
	): Promise<DiagnosticJobResult> {
		for (let attempt = 0; attempt < 2_520; attempt += 1) {
			const row = await this.diagnosticRepository.findById(diagnosticRunId);
			if (!row) throw new Error("Automated diagnostic run disappeared.");
			if (isTerminalDiagnosticStatus(row.status)) {
				return diagnosticResultFromRow(row);
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 250));
		}
		throw new Error("Timed out waiting for automated diagnostic completion.");
	}
}
