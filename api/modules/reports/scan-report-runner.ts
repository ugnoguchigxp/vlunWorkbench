import type { AppDatabase } from "../../db";
import type { LlmRouter } from "../../providers/llmRouter";
import { ArtifactStorage } from "../scans/artifact-storage";
import { buildMarkdownReport } from "../scans/report-builder";
import { ScanReportRepository } from "../scans/report-repository";
import { buildMarkdownReportWithLlmSummary } from "../scans/report-summary-runner";
import { ArtifactRepository } from "../scans/repositories";

const FULL_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};

type ReportJobResult = { reportId: string; status: "completed" | "failed" };

export class ScanReportRunner {
	private readonly queued: string[] = [];
	private readonly queuedSet = new Set<string>();
	private readonly active = new Map<string, Promise<void>>();
	private readonly completions = new Map<
		string,
		{
			resolve: (result: ReportJobResult) => void;
			promise: Promise<ReportJobResult>;
		}
	>();
	private shuttingDown = false;

	constructor(
		private readonly db: AppDatabase,
		private readonly deps: {
			reportRepository?: ScanReportRepository;
			artifactRepository?: ArtifactRepository;
			artifactStorage?: ArtifactStorage;
			llmRouter?: LlmRouter;
			concurrency?: number;
			maxReportBytes?: number;
		} = {},
	) {}

	private get reportRepository() {
		return this.deps.reportRepository ?? new ScanReportRepository(this.db);
	}

	private get artifactRepository() {
		return this.deps.artifactRepository ?? new ArtifactRepository(this.db);
	}

	private get artifactStorage() {
		return this.deps.artifactStorage ?? new ArtifactStorage();
	}

	async start(params: {
		scanRunId: string;
		title: string;
		summaryMode: "deterministic" | "deterministic_with_llm_summary";
		generatedByUserId?: string | null;
		options?: Record<string, unknown>;
	}) {
		if (this.shuttingDown) {
			throw new Error("Report runner is shutting down.");
		}
		const report = await this.reportRepository.createReport({
			scanRunId: params.scanRunId,
			format: "markdown",
			title: params.title,
			options: {
				...FULL_REPORT_OPTIONS,
				summaryMode: params.summaryMode,
				...(params.options ?? {}),
			},
			status: "queued",
			generatedByUserId: params.generatedByUserId,
		});
		const completion = this.enqueue(report.id);
		return { reportId: report.id, status: "queued" as const, completion };
	}

	enqueue(reportId: string): Promise<ReportJobResult> {
		if (this.shuttingDown) {
			return this.failBeforeExecution(reportId);
		}
		const completion = this.completionFor(reportId);
		if (!this.queuedSet.has(reportId) && !this.active.has(reportId)) {
			this.queued.push(reportId);
			this.queuedSet.add(reportId);
			this.drain();
		}
		return completion;
	}

	async recover(): Promise<{ queued: number; interrupted: number }> {
		const active = await this.reportRepository.listActiveReports();
		let queued = 0;
		let interrupted = 0;
		for (const report of active) {
			if (report.status === "queued") {
				this.enqueue(report.id);
				queued += 1;
				continue;
			}
			await this.reportRepository.updateReportStatus(report.id, "failed", {
				errorCode: "report_interrupted",
				errorMessage:
					"Report execution was interrupted before completion and was not retried to avoid duplicating an uncertain LLM request.",
				retryable: true,
			});
			interrupted += 1;
		}
		return { queued, interrupted };
	}

	async shutdown(graceMs = 5_000): Promise<void> {
		this.shuttingDown = true;
		const queuedReportIds = this.queued.splice(0);
		this.queued.length = 0;
		this.queuedSet.clear();
		await Promise.all(
			queuedReportIds.map((reportId) => this.failBeforeExecution(reportId)),
		);
		const running = Promise.allSettled(this.active.values());
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				running,
				new Promise<void>((resolve) => {
					timeout = setTimeout(resolve, graceMs);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private drain(): void {
		const concurrency = Math.max(1, Math.min(this.deps.concurrency ?? 2, 16));
		while (
			!this.shuttingDown &&
			this.active.size < concurrency &&
			this.queued.length > 0
		) {
			const reportId = this.queued.shift();
			if (!reportId) break;
			this.queuedSet.delete(reportId);
			const job = this.execute(reportId)
				.catch((error) => {
					logReportRunnerFailure("unexpected_failure", error, reportId);
				})
				.finally(() => {
					this.active.delete(reportId);
					this.completions.delete(reportId);
					this.drain();
				});
			this.active.set(reportId, job);
		}
	}

	private async execute(reportId: string): Promise<void> {
		const completion = this.completions.get(reportId);
		try {
			const report = await this.reportRepository.claimQueuedReport(reportId);
			if (!report) {
				const current = await this.reportRepository.findById(reportId);
				completion?.resolve({
					reportId,
					status:
						current?.status === "completed" || current?.status === "failed"
							? current.status
							: "failed",
				});
				return;
			}

			const options = report.options as Record<string, unknown>;
			const summaryMode =
				options.summaryMode === "deterministic_with_llm_summary"
					? "deterministic_with_llm_summary"
					: "deterministic";
			const reportBuild =
				summaryMode === "deterministic_with_llm_summary"
					? await buildMarkdownReportWithLlmSummary(this.db, report.scanRunId, {
							...FULL_REPORT_OPTIONS,
							title: report.title,
							llmRouter: this.deps.llmRouter,
						})
					: {
							markdown: await buildMarkdownReport(this.db, report.scanRunId, {
								...FULL_REPORT_OPTIONS,
								title: report.title,
							}),
							providerRouting: undefined,
							systemContext: undefined,
							promptMessages: undefined,
							promptSequenceHash: undefined,
						};
			const sizeBytes = Buffer.byteLength(reportBuild.markdown, "utf8");
			if (
				this.deps.maxReportBytes !== undefined &&
				sizeBytes > this.deps.maxReportBytes
			) {
				throw new ReportRunnerError(
					"report_too_large",
					"Generated report exceeds the configured maximum size.",
					false,
				);
			}
			const saved = await this.artifactStorage
				.forOwner({
					scanRunId: report.scanRunId,
					kind: "report",
					id: report.id,
				})
				.saveTextArtifact(
					report.scanRunId,
					"reports",
					reportBuild.markdown,
					`report-${report.id}.md`,
				);
			const artifact = await this.artifactRepository.createArtifact({
				scanRunId: report.scanRunId,
				toolRunId: null,
				kind: "report",
				format: "markdown",
				path: saved.path,
				sha256: saved.sha256,
				sizeBytes: saved.sizeBytes,
				metadata: {
					reportId: report.id,
					summaryMode,
					...(reportBuild.providerRouting
						? { providerRouting: reportBuild.providerRouting }
						: {}),
					...(reportBuild.systemContext
						? { systemContext: reportBuild.systemContext }
						: {}),
					...(reportBuild.promptMessages
						? {
								promptMessages: reportBuild.promptMessages,
								promptSequenceHash: reportBuild.promptSequenceHash,
							}
						: {}),
				},
			});
			await this.reportRepository.updateReportStatus(report.id, "completed", {
				artifactId: artifact.id,
				summary: reportBuild.markdown.slice(0, 500),
				errorCode: null,
				errorMessage: null,
				retryable: null,
				options: {
					...options,
					...(reportBuild.providerRouting
						? { providerRouting: reportBuild.providerRouting }
						: {}),
					...(reportBuild.systemContext
						? { systemContext: reportBuild.systemContext }
						: {}),
					...(reportBuild.promptMessages
						? {
								promptMessages: reportBuild.promptMessages,
								promptSequenceHash: reportBuild.promptSequenceHash,
							}
						: {}),
				},
			});
			completion?.resolve({ reportId, status: "completed" });
		} catch (error) {
			const known =
				error instanceof ReportRunnerError
					? error
					: new ReportRunnerError(
							"report_generation_failed",
							"Report generation failed.",
							isRetryableError(error),
						);
			await this.reportRepository
				.updateReportStatus(reportId, "failed", {
					errorCode: known.code,
					errorMessage: known.message,
					retryable: known.retryable,
				})
				.catch((statusError) => {
					logReportRunnerFailure(
						"failure_persistence_failed",
						statusError,
						reportId,
					);
				});
			completion?.resolve({ reportId, status: "failed" });
		}
	}

	private async failBeforeExecution(
		reportId: string,
	): Promise<ReportJobResult> {
		await this.reportRepository
			.updateReportStatus(reportId, "failed", {
				errorCode: "report_runner_shutting_down",
				errorMessage:
					"Report execution could not start because the runner is shutting down.",
				retryable: true,
			})
			.catch((error) => {
				logReportRunnerFailure(
					"shutdown_failure_persistence_failed",
					error,
					reportId,
				);
			});
		const result = { reportId, status: "failed" as const };
		this.completions.get(reportId)?.resolve(result);
		this.completions.delete(reportId);
		return result;
	}

	private completionFor(reportId: string): Promise<ReportJobResult> {
		const existing = this.completions.get(reportId);
		if (existing) return existing.promise;
		let resolvePromise!: (result: ReportJobResult) => void;
		const promise = new Promise<ReportJobResult>((resolve) => {
			resolvePromise = resolve;
		});
		this.completions.set(reportId, { resolve: resolvePromise, promise });
		return promise;
	}
}

class ReportRunnerError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
	}
}

function isRetryableError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"retryable" in error &&
			(error as { retryable?: unknown }).retryable === true,
	);
}

function logReportRunnerFailure(
	event: string,
	error: unknown,
	reportId: string,
): void {
	console.error(
		JSON.stringify({
			version: 1,
			level: "error",
			event: `report_runner_${event}`,
			reportId,
			errorName: error instanceof Error ? error.name : "UnknownError",
		}),
	);
}
