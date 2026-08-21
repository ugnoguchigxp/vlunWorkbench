import type { DastProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import type { AppDatabase } from "../../../db";
import { DastRepository } from "../../dast/dast-repository";
import { DastRunner } from "../../dast/dast-runner";
import type { PreparedRuntimeTarget } from "../../dast/runtime-target-provider";
import type { ArtifactStorage } from "./lifecycle/artifact-storage";
import type { DastStepResult } from "./profile-runner";
import { ScanRepository } from "../repositories";

export function scanScopedAutoTargetName(
	baseName: string,
	scanRunId: string,
): string {
	return `${baseName} [scan:${scanRunId}]`;
}

export async function runDastStepIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	step: DastProfileStep;
	repoPath: string;
	timeoutSec?: number;
	createdByUserId?: string | null;
	preparedAutoTarget?: PreparedRuntimeTarget;
	consentProjectCodeExecution?: boolean;
	artifactStorage?: ArtifactStorage;
}): Promise<DastStepResult> {
	const scanRepo = new ScanRepository(params.db);
	const dastRepo = new DastRepository(params.db);
	const preparedAutoTarget = params.preparedAutoTarget ?? null;
	let targetConfigId: string | null = null;

	const stepResult = await (async (): Promise<DastStepResult> => {
		try {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "info",
				eventType: "dast.started",
				message: `${params.step.profileId} DAST step started.`,
				data: { profileId: params.step.profileId },
			});

			if (!preparedAutoTarget) {
				throw new Error("runtime_isolation_provider_unavailable");
			}
			if (
				preparedAutoTarget.runtimeNamespaceOwnerId &&
				!preparedAutoTarget.runtimeDastFetch
			)
				throw new Error("runtime_namespace_dast_executor_unavailable");
			const target = await dastRepo.createTargetConfig({
				projectId: params.projectId,
				...preparedAutoTarget.targetConfig,
				name: scanScopedAutoTargetName(
					preparedAutoTarget.targetConfig.name,
					params.scanRunId,
				),
				createdByUserId: params.createdByUserId ?? null,
				metadata: {
					...preparedAutoTarget.targetConfig.metadata,
					source: "scan-profile-dast-step",
					scanRunId: params.scanRunId,
					dastProfileId: params.step.profileId,
				},
			});
			targetConfigId = target.id;

			const runner = new DastRunner(params.db, {
				scanStorage: params.artifactStorage,
				fetchImpl: preparedAutoTarget.runtimeDastFetch,
			});
			const result = await runner.run({
				projectId: params.projectId,
				targetConfigId,
				profileId: params.step.profileId,
				scanRunId: params.scanRunId,
				runner: "host",
				timeoutSec: params.timeoutSec,
				maxRequests: params.step.options?.maxRequests,
				checkOptions: {
					...(params.step.options ?? {}),
					totalTimeoutSec: Math.min(params.timeoutSec ?? 600, 600),
				},
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
					verdict: result.verdict,
					coverageStatus: result.coverageStatus,
					coverageSummary: null,
					limitationCodes: [],
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
				verdict: result.verdict,
				coverageStatus: result.coverageStatus,
				coverageSummary: result.coverageSummary,
				limitationCodes: result.limitationCodes,
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
				verdict: "not_tested",
				coverageStatus: "gap",
				coverageSummary: null,
				limitationCodes: ["runner_failed"],
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
		}
	})();

	const cleanupTasks: Promise<unknown>[] = [];
	if (targetConfigId && preparedAutoTarget) {
		cleanupTasks.push(
			dastRepo.updateTargetConfig(targetConfigId, {
				enabled: false,
				metadata: {
					...preparedAutoTarget.targetConfig.metadata,
					source: "scan-profile-dast-step",
					scanRunId: params.scanRunId,
					dastProfileId: params.step.profileId,
					autoPreparedCompletedAt: new Date().toISOString(),
				},
			}),
		);
	}
	const cleanupResults = await Promise.allSettled(cleanupTasks);
	if (cleanupResults.some((result) => result.status === "rejected")) {
		try {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "error",
				eventType: "dast.cleanup_failed",
				message:
					"DAST target cleanup failed; the step cannot be considered successful.",
				data: { profileId: params.step.profileId, targetConfigId },
			});
		} catch {
			// The returned failed step remains authoritative if persistence also fails.
		}
		return {
			...stepResult,
			status: "failed",
			outcome: "error",
			verdict: "not_tested",
			coverageStatus: "gap",
			coverageSummary: null,
			limitationCodes: [
				...new Set([
					...(stepResult.limitationCodes ?? []),
					"dast_target_cleanup_failed",
				]),
			],
			error: "dast_target_cleanup_failed",
		};
	}
	return stepResult;
}
