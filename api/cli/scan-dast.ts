import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { DastRunner, type DastCliResult } from "../modules/dast/dast-runner";
import { DastAuthContextCrypto } from "../modules/dast/auth-context-crypto";
import { DastAuthContextRepository } from "../modules/dast/auth-context-repository";
import { DastRepository } from "../modules/dast/dast-repository";
import { prepareDastTargetWorkspace } from "../modules/dast/target-preparer";
import {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { runCliAutomatedDiagnostic } from "./scan-profile-diagnostic";

type DastCliArgs = {
	"project-id"?: string;
	"target-config-id"?: string;
	"auto-target"?: string;
	profile?: string;
	"profile-config-id"?: string;
	"scan-run-id"?: string;
	runner?: string;
	"docker-image"?: string;
	"timeout-sec"?: string;
	"max-requests"?: string;
	"dry-run"?: string;
	"auth-context-id"?: string;
	"identity-role"?: string;
	"created-by-user-id"?: string;
};

class DastCliResultError extends Error {
	constructor(readonly result: Record<string, unknown>) {
		super(typeof result.message === "string" ? result.message : "DAST failed.");
	}
}

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parsePositiveInt(
	value: string | undefined,
	label: string,
): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return parsed;
}

async function main() {
	let values: DastCliArgs;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				"target-config-id": { type: "string" },
				"auto-target": { type: "string", default: "false" },
				profile: { type: "string" },
				"profile-config-id": { type: "string" },
				"scan-run-id": { type: "string" },
				runner: { type: "string", default: "host" },
				"docker-image": { type: "string" },
				"timeout-sec": { type: "string" },
				"max-requests": { type: "string" },
				"dry-run": { type: "string", default: "false" },
				"auth-context-id": { type: "string" },
				"identity-role": { type: "string" },
				"created-by-user-id": { type: "string" },
			},
			strict: true,
		});
		values = parsed.values as DastCliArgs;
	} catch (error) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: `Failed to parse arguments: ${(error as Error).message}`,
		});
		process.exit(1);
	}

	const projectId = values["project-id"];
	let targetConfigId = values["target-config-id"];
	const autoTarget = values["auto-target"] === "true";
	const profileId = values.profile;
	if (!projectId || !profileId || (!targetConfigId && !autoTarget)) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message:
				"Missing required arguments: --project-id and --profile are required. Provide --target-config-id or --auto-target true.",
		});
		process.exit(1);
	}
	if (
		values.runner !== undefined &&
		values.runner !== "host" &&
		values.runner !== "docker"
	) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: "--runner must be host or docker.",
		});
		process.exit(1);
	}

	let timeoutSec: number | undefined;
	let maxRequests: number | undefined;
	try {
		timeoutSec = parsePositiveInt(values["timeout-sec"], "--timeout-sec");
		maxRequests = parsePositiveInt(values["max-requests"], "--max-requests");
	} catch (error) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: (error as Error).message,
		});
		process.exit(1);
	}

	const env = readAppEnv();
	if (!env.dastStandardV2Enabled && profileId.includes("standard")) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			verdict: "not_tested",
			coverageStatus: "gap",
			failureKind: "dast_target_rejected",
			message: "DAST standard v2 is disabled.",
		});
		process.exit(1);
	}
	const connection = createDbConnection(env.databaseUrl);
	let preparedAutoTarget: Awaited<
		ReturnType<typeof prepareDastTargetWorkspace>
	> | null = null;
	const dastRepo = new DastRepository(connection.db);
	let finalResult: Record<string, unknown> | null = null;
	let finalExitCode = 1;
	let runnerResult: DastCliResult | null = null;
	let dryRun = false;
	try {
		if (autoTarget) {
			const project = await new ProjectRepository(connection.db).findById(
				projectId,
			);
			if (!project) {
				throw new DastCliResultError({
					ok: false,
					dastRunId: null,
					scanRunId: values["scan-run-id"] ?? null,
					status: "failed",
					outcome: "error",
					failureKind: "dast_target_rejected",
					message: "Project not found.",
				});
			}
			preparedAutoTarget = await prepareDastTargetWorkspace({
				repoPath: project.repoPath,
			});
			const target = await dastRepo.createTargetConfig({
				projectId,
				...preparedAutoTarget.targetConfig,
				createdByUserId: values["created-by-user-id"] ?? null,
			});
			targetConfigId = target.id;
		}
		const authContextRepository = env.dastAuthEncryptionKey
			? new DastAuthContextRepository(
					connection.db,
					new DastAuthContextCrypto(
						env.dastAuthEncryptionKey,
						env.dastAuthPreviousEncryptionKeys,
					),
				)
			: undefined;
		const runner = new DastRunner(connection.db, { authContextRepository });
		dryRun = values["dry-run"] === "true";
		const runOptions = {
			projectId,
			targetConfigId: targetConfigId as string,
			profileId,
			profileConfigId: values["profile-config-id"] ?? null,
			scanRunId: values["scan-run-id"] ?? null,
			runner: values.runner as "host" | "docker",
			dockerImage: values["docker-image"],
			timeoutSec,
			maxRequests,
			dryRun,
			authContextId: values["auth-context-id"] ?? null,
			identityRole: values["identity-role"] ?? null,
			createdByUserId: values["created-by-user-id"] ?? null,
			// An auto-prepared target remains owned by this CLI until cleanup.
			// Do not make its scan terminal before that cleanup has succeeded.
			manageScanRunStatus: !preparedAutoTarget,
		};
		const result = runOptions.dryRun
			? await runner.dryRun(runOptions)
			: await runner.run(runOptions);
		runnerResult = result;
		finalResult =
			preparedAutoTarget && result.ok
				? {
						...result,
						plan: {
							...(result.plan ?? {}),
							autoTarget: {
								origin: preparedAutoTarget.origin,
								command: preparedAutoTarget.plan.command,
								scriptName: preparedAutoTarget.plan.scriptName,
								port: preparedAutoTarget.plan.port,
								warnings: preparedAutoTarget.plan.warnings,
							},
						},
					}
				: { ...result };
		finalExitCode = result.ok || result.dastRunId ? 0 : 1;
	} catch (error) {
		finalResult =
			error instanceof DastCliResultError
				? error.result
				: {
						ok: false,
						dastRunId: null,
						scanRunId: values["scan-run-id"] ?? null,
						status: "failed",
						outcome: "error",
						failureKind: "unknown_error",
						message:
							error instanceof Error ? error.message : "DAST execution failed.",
					};
		finalExitCode = 1;
	} finally {
		if (preparedAutoTarget) {
			const cleanupTasks: Promise<unknown>[] = [preparedAutoTarget.stop()];
			if (targetConfigId) {
				cleanupTasks.push(
					dastRepo.updateTargetConfig(targetConfigId, {
						enabled: false,
						metadata: {
							...preparedAutoTarget.targetConfig.metadata,
							autoPreparedCompletedAt: new Date().toISOString(),
						},
					}),
				);
			}
			const cleanupResults = await Promise.allSettled(cleanupTasks);
			if (cleanupResults.some((result) => result.status === "rejected")) {
				finalResult = {
					ok: false,
					dastRunId:
						typeof finalResult?.dastRunId === "string"
							? finalResult.dastRunId
							: null,
					scanRunId:
						typeof finalResult?.scanRunId === "string"
							? finalResult.scanRunId
							: (values["scan-run-id"] ?? null),
					status: "failed",
					outcome: "error",
					failureKind: "dast_target_workspace_cleanup_failed",
					message: "Failed to clean up the auto-prepared DAST target.",
				};
				finalExitCode = 1;
			}
		}
	}
	if (preparedAutoTarget && runnerResult?.scanRunId && !dryRun) {
		try {
			const scanRepo = new ScanRepository(connection.db);
			const scan = await scanRepo.findById(runnerResult.scanRunId);
			const completed = finalResult?.ok === true;
			await scanRepo.updateScanRunStatus(
				runnerResult.scanRunId,
				completed ? "completed" : "failed",
				{
					summary: completed
						? runnerResult.ok
							? runnerResult.summary
							: runnerResult.message
						: typeof finalResult?.message === "string"
							? finalResult.message
							: "DAST run or target cleanup failed.",
					profileOutcome:
						scan?.profile === "authenticated-web"
							? completed && runnerResult.coverageStatus === "covered"
								? "completed"
								: completed
									? "incomplete"
									: "failed"
							: undefined,
					metadata: {
						dastRunId: runnerResult.dastRunId,
						dastOutcome: runnerResult.outcome,
						dastVerdict: runnerResult.verdict,
						dastCoverageStatus: runnerResult.coverageStatus,
						dastCoverageSummary: runnerResult.ok
							? runnerResult.coverageSummary
							: null,
						dastLimitationCodes: runnerResult.ok
							? runnerResult.limitationCodes
							: [runnerResult.failureKind],
						autoTargetCleanupSucceeded: completed,
					},
				},
			);
		} catch {
			finalResult = {
				ok: false,
				dastRunId: runnerResult.dastRunId,
				scanRunId: runnerResult.scanRunId,
				status: "failed",
				outcome: "error",
				failureKind: "dast_scan_finalization_failed",
				message: "Failed to persist the auto-target DAST terminal state.",
			};
			finalExitCode = 1;
		}
	}
	const diagnostic =
		finalResult?.ok === true && runnerResult?.scanRunId && !dryRun
			? await runCliAutomatedDiagnostic({
					db: connection.db,
					env,
					scanRunId: runnerResult.scanRunId,
				}).catch((error) => ({
					status: "failed" as const,
					readiness: "failed" as const,
					error:
						error instanceof Error
							? error.message
							: "Automated diagnostic failed.",
				}))
			: null;
	if (finalResult) finalResult = { ...finalResult, diagnostic };
	connection.sqlite.close(false);
	writeResult(
		finalResult ?? {
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "unknown_error",
			message: "DAST execution did not produce a result.",
		},
	);
	process.exitCode = finalExitCode;
}

main();
