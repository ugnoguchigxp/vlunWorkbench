import type { AppDatabase } from "../../db";
import { ScanRepository } from "../scans/repositories";
import { buildStaticIntelligenceGeneration } from "./build-service";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import { StaticIntelligencePrepareRepository } from "./prepare-repository";
import { computeProjectSourceFingerprint } from "./project-source-fingerprint";

type BuildRunner = typeof buildStaticIntelligenceGeneration;

export async function processStaticIntelligencePrepareJob(params: {
	db: AppDatabase;
	jobId: string;
	buildRunner?: BuildRunner;
}) {
	const repository = new StaticIntelligencePrepareRepository(params.db);
	const job = await repository.claim(params.jobId);
	if (!job) return { ok: false as const, status: "not_claimed" as const };
	const prepareStartedAt = Date.now();
	logPrepareEvent({
		event: "claimed",
		jobId: job.id,
		stage: job.stage,
		status: "running",
		reused: job.attemptCount > 1,
	});
	if (!job.scanRunId) {
		await failJob(
			repository,
			job.id,
			"INTERNAL_ERROR",
			"The queued scan is missing.",
			true,
		);
		return { ok: false as const, status: "failed" as const };
	}
	const heartbeat = setInterval(() => {
		void repository
			.update(job.id, {
				leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
			})
			.catch(() => undefined);
	}, 60_000);
	heartbeat.unref();

	try {
		if (job.generationId) {
			const published = await new StaticIntelligenceGenerationRepository(
				params.db,
			).loadGeneration(job.scanRunId, job.generationId);
			if (published) {
				await markReady(repository, job.id, job.generationId);
				return {
					ok: true as const,
					status: "ready" as const,
					jobId: job.id,
					generationId: job.generationId,
				};
			}
		}

		const scans = new ScanRepository(params.db);
		let scanRun = await scans.findById(job.scanRunId);
		if (!scanRun) {
			await failJob(
				repository,
				job.id,
				"SCAN_FAILED",
				"The queued scan is missing.",
				true,
			);
			return { ok: false as const, status: "failed" as const };
		}
		if (scanRun.status === "failed" || scanRun.status === "cancelled") {
			await failJob(
				repository,
				job.id,
				"SCAN_FAILED",
				"Structure preparation failed.",
				true,
			);
			return { ok: false as const, status: "failed" as const };
		}
		if (scanRun.status !== "completed") {
			const scanStartedAt = Date.now();
			if (scanRun.status === "queued") {
				const claimed = await scans.claimQueuedScanRun({
					id: scanRun.id,
					projectId: job.projectId,
					profile: scanRun.profile,
					metadata: {
						preparationMode: "structure_only",
						externalSecurityScannersExecuted: false,
					},
				});
				if (!claimed) {
					await failJob(
						repository,
						job.id,
						"SCAN_FAILED",
						"Structure preparation could not claim its scan.",
						true,
					);
					return { ok: false as const, status: "failed" as const };
				}
				scanRun = claimed;
			} else if (scanRun.status !== "running") {
				await failJob(
					repository,
					job.id,
					"SCAN_FAILED",
					"Structure preparation found an invalid scan state.",
					false,
				);
				return { ok: false as const, status: "failed" as const };
			}
			await scans.updateScanRunStatus(scanRun.id, "completed", {
				completedAt: new Date(),
				metadata: {
					...scanRun.metadata,
					preparationMode: "structure_only",
					externalSecurityScannersExecuted: false,
				},
			});
			logPrepareEvent({
				event: "stage_completed",
				jobId: job.id,
				stage: "structure_scan",
				status: "running",
				durationMs: Date.now() - scanStartedAt,
				reused: false,
			});
		}

		const currentSource = await computeProjectSourceFingerprint(
			job.canonicalProjectPath,
		);
		if (currentSource.value !== job.sourceFingerprint) {
			await failJob(
				repository,
				job.id,
				"SOURCE_CHANGED",
				"Project source changed while preparation was running.",
				true,
			);
			return { ok: false as const, status: "failed" as const };
		}

		await repository.update(job.id, {
			status: "running",
			stage: "generation_build",
		});
		const buildStartedAt = Date.now();
		const build = await (
			params.buildRunner ?? buildStaticIntelligenceGeneration
		)({
			db: params.db,
			scanRunId: job.scanRunId,
			emitTelemetry: true,
		});
		const sourceAfterBuild = await computeProjectSourceFingerprint(
			job.canonicalProjectPath,
		);
		if (sourceAfterBuild.value !== job.sourceFingerprint) {
			await failJob(
				repository,
				job.id,
				"SOURCE_CHANGED",
				"Project source changed while preparation was running.",
				true,
			);
			return { ok: false as const, status: "failed" as const };
		}
		await repository.update(job.id, {
			status: "running",
			stage: "publishing",
			generationId: build.generationId,
		});
		logPrepareEvent({
			event: "stage_completed",
			jobId: job.id,
			stage: "generation_build",
			status: "running",
			durationMs: Date.now() - buildStartedAt,
			reused: false,
		});
		await markReady(repository, job.id, build.generationId);
		logPrepareEvent({
			event: "completed",
			jobId: job.id,
			stage: "complete",
			status: "ready",
			durationMs: Date.now() - prepareStartedAt,
			reused: false,
		});
		return {
			ok: true as const,
			status: "ready" as const,
			jobId: job.id,
			generationId: build.generationId,
		};
	} catch {
		const currentStage = (await repository.findById(job.id))?.stage;
		const generationStage =
			currentStage !== "security_scan" && currentStage !== "structure_scan";
		await failJob(
			repository,
			job.id,
			generationStage ? "GENERATION_FAILED" : "SCAN_FAILED",
			generationStage
				? "Static Intelligence generation failed."
				: "Structure preparation failed.",
			true,
		);
		logPrepareEvent({
			event: "failed",
			jobId: job.id,
			stage: generationStage ? "generation_build" : "structure_scan",
			status: "failed",
			durationMs: Date.now() - prepareStartedAt,
			reused: false,
			errorCode: generationStage ? "GENERATION_FAILED" : "SCAN_FAILED",
		});
		return { ok: false as const, status: "failed" as const };
	} finally {
		clearInterval(heartbeat);
	}
}

function logPrepareEvent(event: {
	event: string;
	jobId: string;
	stage: string;
	status: string;
	durationMs?: number;
	reused: boolean;
	errorCode?: string;
}) {
	console.error(
		JSON.stringify({ type: "static_intelligence_prepare", ...event }),
	);
}

async function markReady(
	repository: StaticIntelligencePrepareRepository,
	jobId: string,
	generationId: string,
) {
	await repository.update(jobId, {
		status: "ready",
		stage: "complete",
		generationId,
		leaseExpiresAt: null,
		completedAt: new Date(),
	});
}

export async function recoverStaticIntelligencePrepareJobs(params: {
	db: AppDatabase;
	buildRunner?: BuildRunner;
}) {
	const repository = new StaticIntelligencePrepareRepository(params.db);
	const jobs = await repository.listRecoverable();
	const results = [];
	for (const job of jobs) {
		results.push(
			await processStaticIntelligencePrepareJob({
				...params,
				jobId: job.id,
			}),
		);
	}
	return results;
}

async function failJob(
	repository: StaticIntelligencePrepareRepository,
	jobId: string,
	errorCode: string,
	message: string,
	retryable: boolean,
) {
	await repository.update(jobId, {
		status: "failed",
		errorCode,
		errorMessageRedacted: message,
		retryable,
		leaseExpiresAt: null,
		completedAt: new Date(),
	});
}
