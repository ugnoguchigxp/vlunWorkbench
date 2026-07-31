import { HttpError } from "../modules/auth/errors";
import { readBoundedProcessText } from "../modules/scans/tools/bounded-process-output";

const CLI_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const CLI_TIMEOUT_MS = 12 * 60 * 1000;

export async function executeDastCli(params: {
	projectId: string;
	targetConfigId?: string;
	autoTarget?: boolean;
	profileId: string;
	profileConfigId?: string;
	scanRunId?: string;
	runner?: "host" | "docker";
	dockerImage?: string;
	timeoutSec?: number;
	maxRequests?: number;
	authContextId?: string;
	identityRole?: string;
	dryRun?: boolean;
	createdByUserId?: string;
}) {
	const args = [
		"run",
		"api/cli/scan-dast.ts",
		"--",
		"--project-id",
		params.projectId,
		"--profile",
		params.profileId,
	];
	if (params.targetConfigId) {
		args.push("--target-config-id", params.targetConfigId);
	}
	if (params.autoTarget) args.push("--auto-target", "true");
	if (params.profileConfigId)
		args.push("--profile-config-id", params.profileConfigId);
	if (params.scanRunId) args.push("--scan-run-id", params.scanRunId);
	if (params.runner) args.push("--runner", params.runner);
	if (params.dockerImage) args.push("--docker-image", params.dockerImage);
	if (params.timeoutSec !== undefined)
		args.push("--timeout-sec", String(params.timeoutSec));
	if (params.maxRequests !== undefined)
		args.push("--max-requests", String(params.maxRequests));
	if (params.authContextId)
		args.push("--auth-context-id", params.authContextId);
	if (params.identityRole) args.push("--identity-role", params.identityRole);
	if (params.createdByUserId)
		args.push("--created-by-user-id", params.createdByUserId);
	if (params.dryRun) args.push("--dry-run", "true");

	const proc = Bun.spawn(["bun", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	let terminationReason: "timeout" | "stdout_limit" | "stderr_limit" | null =
		null;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	const terminate = (reason: Exclude<typeof terminationReason, null>): void => {
		if (terminationReason) return;
		terminationReason = reason;
		proc.kill("SIGTERM");
		killTimer = setTimeout(() => proc.kill("SIGKILL"), 2_000);
	};
	const timeout = setTimeout(() => terminate("timeout"), CLI_TIMEOUT_MS);
	let stdout = "";
	let stderr = "";
	try {
		const [stdoutResult, stderrResult] = await Promise.all([
			readBoundedProcessText(proc.stdout, CLI_OUTPUT_LIMIT_BYTES, () =>
				terminate("stdout_limit"),
			),
			readBoundedProcessText(proc.stderr, CLI_OUTPUT_LIMIT_BYTES, () =>
				terminate("stderr_limit"),
			),
			proc.exited,
		]);
		stdout = stdoutResult.text;
		stderr = stderrResult.text;
	} finally {
		clearTimeout(timeout);
		if (killTimer) clearTimeout(killTimer);
	}
	if (terminationReason) {
		throw new HttpError(
			500,
			terminationReason === "timeout"
				? "DAST CLI execution timed out."
				: `DAST CLI ${terminationReason === "stdout_limit" ? "stdout" : "stderr"} exceeded ${CLI_OUTPUT_LIMIT_BYTES} bytes.`,
		);
	}

	let cliResult: {
		ok?: boolean;
		dastRunId?: string;
		message?: string;
	};
	try {
		cliResult = JSON.parse(stdout.trim()) as typeof cliResult;
	} catch (error) {
		console.error(`DAST CLI bridge failed: ${stderr}`);
		throw new HttpError(
			500,
			`CLI bridge parse failure: ${stderr || (error as Error).message}`,
		);
	}
	if (!cliResult.ok && !cliResult.dastRunId) {
		throw new HttpError(400, cliResult.message || "Failed to start DAST run");
	}
	return cliResult;
}
