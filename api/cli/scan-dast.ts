import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { DastRunner } from "../modules/dast/dast-runner";
import { DastRepository } from "../modules/dast/dast-repository";
import { prepareDastTargetWorkspace } from "../modules/dast/target-preparer";
import { ProjectRepository } from "../modules/scans/repositories";

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
};

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
		values.runner !== "docker" &&
		values.runner !== "mock"
	) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: "--runner must be host, docker, or mock.",
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
	const connection = createDbConnection(env.databaseUrl);
	let preparedAutoTarget: Awaited<
		ReturnType<typeof prepareDastTargetWorkspace>
	> | null = null;
	const dastRepo = new DastRepository(connection.db);
	try {
		if (autoTarget) {
			const project = await new ProjectRepository(connection.db).findById(
				projectId,
			);
			if (!project) {
				writeResult({
					ok: false,
					dastRunId: null,
					scanRunId: values["scan-run-id"] ?? null,
					status: "failed",
					outcome: "error",
					failureKind: "dast_target_rejected",
					message: "Project not found.",
				});
				process.exitCode = 1;
				return;
			}
			preparedAutoTarget = await prepareDastTargetWorkspace({
				repoPath: project.repoPath,
			});
			const target = await dastRepo.createTargetConfig({
				projectId,
				...preparedAutoTarget.targetConfig,
			});
			targetConfigId = target.id;
		}
		const runner = new DastRunner(connection.db);
		const runOptions = {
			projectId,
			targetConfigId: targetConfigId as string,
			profileId,
			profileConfigId: values["profile-config-id"] ?? null,
			scanRunId: values["scan-run-id"] ?? null,
			runner: values.runner as "host" | "docker" | "mock",
			dockerImage: values["docker-image"],
			timeoutSec,
			maxRequests,
			dryRun: values["dry-run"] === "true",
		};
		const result = runOptions.dryRun
			? await runner.dryRun(runOptions)
			: await runner.run(runOptions);
		if (preparedAutoTarget) {
			await dastRepo.updateTargetConfig(targetConfigId as string, {
				enabled: false,
				metadata: {
					...preparedAutoTarget.targetConfig.metadata,
					autoPreparedCompletedAt: new Date().toISOString(),
				},
			});
		}
		writeResult(
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
				: result,
		);
		process.exitCode = result.ok || result.dastRunId ? 0 : 1;
		return;
	} catch (error) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "unknown_error",
			message:
				error instanceof Error ? error.message : "DAST execution failed.",
		});
		process.exitCode = 1;
		return;
	} finally {
		await preparedAutoTarget?.stop().catch(() => undefined);
		connection.sqlite.close(false);
	}
}

main();
