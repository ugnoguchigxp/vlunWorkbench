import { HttpError } from "../modules/auth/errors";
import type { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import { parseCliJsonObject, runBoundedCliProcess } from "./cli-process-bridge";

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
	processCapacity?: WebProcessCapacity;
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

	const processResult = await runBoundedCliProcess({
		argv: ["bun", ...args],
		processCapacity: params.processCapacity,
		timeoutMs: CLI_TIMEOUT_MS,
		outputLimitBytes: CLI_OUTPUT_LIMIT_BYTES,
		label: "DAST CLI",
	});

	const cliResult = parseCliJsonObject(processResult, "DAST CLI") as {
		ok?: boolean;
		dastRunId?: string;
		message?: string;
	};
	if (!cliResult.ok && !cliResult.dastRunId) {
		throw new HttpError(400, cliResult.message || "Failed to start DAST run");
	}
	return cliResult;
}
