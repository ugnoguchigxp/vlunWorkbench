import type { DastProfileStep } from "../../../shared/schemas/scan-profile.schema";
import type { AppDatabase } from "../../db";
import { DastRepository } from "../dast/dast-repository";
import { DastRunner } from "../dast/dast-runner";
import { prepareDastTargetWorkspace } from "../dast/target-preparer";
import type { DastStepResult } from "./profile-runner";
import { ScanRepository } from "./repositories";

export async function runDastStepIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	step: DastProfileStep;
	repoPath: string;
	timeoutSec?: number;
	createdByUserId?: string | null;
	preparedAutoTarget?: Awaited<ReturnType<typeof prepareDastTargetWorkspace>>;
}): Promise<DastStepResult> {
	const scanRepo = new ScanRepository(params.db);
	const dastRepo = new DastRepository(params.db);
	let preparedAutoTarget = params.preparedAutoTarget ?? null;
	const ownsPreparedTarget = !params.preparedAutoTarget;
	let targetConfigId: string | null = null;

	try {
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "dast.started",
			message: `${params.step.profileId} DAST step started.`,
			data: { profileId: params.step.profileId },
		});

		if (!preparedAutoTarget) {
			preparedAutoTarget = await prepareDastTargetWorkspace({
				repoPath: params.repoPath,
				readinessTimeoutMs: params.step.options?.readinessTimeoutMs,
			});
		}
		const target = await dastRepo.createTargetConfig({
			projectId: params.projectId,
			...preparedAutoTarget.targetConfig,
			createdByUserId: params.createdByUserId ?? null,
			metadata: {
				...preparedAutoTarget.targetConfig.metadata,
				source: "scan-profile-dast-step",
				scanRunId: params.scanRunId,
				dastProfileId: params.step.profileId,
			},
		});
		targetConfigId = target.id;

		const runner = new DastRunner(params.db);
		const result = await runner.run({
			projectId: params.projectId,
			targetConfigId,
			profileId: params.step.profileId,
			scanRunId: params.scanRunId,
			runner: "host",
			timeoutSec: params.timeoutSec,
			maxRequests: params.step.options?.maxRequests,
			createdByUserId: params.createdByUserId ?? null,
			manageScanRunStatus: false,
			useStoredProfileConfig: false,
		});

		const autoTarget = {
			scriptName: preparedAutoTarget.plan.scriptName,
			command: preparedAutoTarget.plan.command,
			port: preparedAutoTarget.plan.port,
			origin: preparedAutoTarget.origin,
			warnings: preparedAutoTarget.plan.warnings,
		};

		if (!result.ok) {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "error",
				eventType: "dast.failed",
				message: `${params.step.profileId} DAST step failed: ${result.message}`,
				data: {
					profileId: params.step.profileId,
					dastRunId: result.dastRunId,
					failureKind: result.failureKind,
					autoTarget,
				},
			});
			return {
				kind: "dast",
				profileId: params.step.profileId,
				required: params.step.required,
				status: "failed",
				outcome: result.outcome,
				findingCount: 0,
				dastRunId: result.dastRunId,
				targetOrigin: preparedAutoTarget.origin,
				error: result.message,
				autoTarget,
			};
		}

		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "dast.completed",
			message: `${params.step.profileId} DAST step completed with outcome: ${result.outcome}.`,
			data: {
				profileId: params.step.profileId,
				dastRunId: result.dastRunId,
				autoTarget,
			},
		});
		return {
			kind: "dast",
			profileId: params.step.profileId,
			required: params.step.required,
			status: "completed",
			outcome: result.outcome,
			findingCount: result.findingIds.length,
			dastRunId: result.dastRunId,
			targetOrigin: preparedAutoTarget.origin,
			error: null,
			autoTarget,
		};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "DAST step failed.";
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "error",
			eventType: "dast.failed",
			message: `${params.step.profileId} DAST step failed: ${message}`,
			data: { profileId: params.step.profileId, targetConfigId },
		});
		return {
			kind: "dast",
			profileId: params.step.profileId,
			required: params.step.required,
			status: "failed",
			outcome: "error",
			findingCount: 0,
			dastRunId: null,
			targetOrigin: preparedAutoTarget?.origin ?? null,
			error: message,
			autoTarget: preparedAutoTarget
				? {
						scriptName: preparedAutoTarget.plan.scriptName,
						command: preparedAutoTarget.plan.command,
						port: preparedAutoTarget.plan.port,
						origin: preparedAutoTarget.origin,
						warnings: preparedAutoTarget.plan.warnings,
					}
				: undefined,
		};
	} finally {
		if (targetConfigId && preparedAutoTarget) {
			await dastRepo
				.updateTargetConfig(targetConfigId, {
					enabled: false,
					metadata: {
						...preparedAutoTarget.targetConfig.metadata,
						source: "scan-profile-dast-step",
						scanRunId: params.scanRunId,
						dastProfileId: params.step.profileId,
						autoPreparedCompletedAt: new Date().toISOString(),
					},
				})
				.catch(() => undefined);
		}
		if (ownsPreparedTarget) {
			await preparedAutoTarget?.stop().catch(() => undefined);
		}
	}
}
