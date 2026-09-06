import { HttpError } from "../modules/auth/errors";
import { DYNAMIC_PROFILE_TEMPLATES } from "../modules/dynamic/dynamic-profiles";
import type { DynamicRepository } from "../modules/dynamic/dynamic-repository";
import type { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import { parseCliJsonObject, runBoundedCliProcess } from "./cli-process-bridge";

const DYNAMIC_CLI_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DYNAMIC_CLI_TIMEOUT_MS = 12 * 60 * 1000;

type DynamicCliBridgeResult = Record<string, unknown> & {
	ok?: boolean;
	dynamicRunId?: string;
	status?: string;
	outcome?: string;
	message?: string;
};

export async function executeDynamicRunCli(params: {
	projectId: string;
	scanRunId?: string;
	findingId?: string | null;
	profileId: string;
	runner: string;
	dockerImage?: string;
	network?: string;
	timeoutSec?: number;
	memory?: string;
	cpus?: string;
	executionConsent: true;
	processCapacity?: WebProcessCapacity;
}) {
	const args = [
		"run",
		"api/cli/dynamic-run.ts",
		"--",
		"--project-id",
		params.projectId,
		"--profile",
		params.profileId,
		"--runner",
		params.runner,
		"--consent-project-code-execution",
		String(params.executionConsent),
	];
	if (params.scanRunId) args.push("--scan-run-id", params.scanRunId);
	if (params.findingId) args.push("--finding-id", params.findingId);
	if (params.dockerImage) args.push("--docker-image", params.dockerImage);
	if (params.network) args.push("--network", params.network);
	if (params.timeoutSec !== undefined)
		args.push("--timeout-sec", String(params.timeoutSec));
	if (params.memory) args.push("--memory", params.memory);
	if (params.cpus) args.push("--cpus", params.cpus);

	const processResult = await runBoundedCliProcess({
		argv: ["bun", ...args],
		processCapacity: params.processCapacity,
		timeoutMs: DYNAMIC_CLI_TIMEOUT_MS,
		outputLimitBytes: DYNAMIC_CLI_OUTPUT_LIMIT_BYTES,
		label: "Dynamic CLI",
	});
	const cliResult = parseCliJsonObject(
		processResult,
		"Dynamic CLI",
	) as DynamicCliBridgeResult;
	if (!cliResult.ok && !cliResult.dynamicRunId) {
		throw new HttpError(
			400,
			cliResult.message || "Failed to start dynamic run",
		);
	}
	return cliResult;
}

export async function ensureBuiltinProfileConfig(params: {
	repository: DynamicRepository;
	projectId: string;
	repoPath: string;
	profileId: string;
	createdByUserId: string;
}) {
	const existing = await params.repository.getConfigByProfileId(
		params.projectId,
		params.profileId,
	);
	if (existing) return existing;
	const template = DYNAMIC_PROFILE_TEMPLATES.find(
		(candidate) => candidate.id === params.profileId,
	);
	if (!template || !(await template.isApplicable(params.repoPath))) {
		throw new HttpError(
			400,
			`Dynamic profile is not applicable: ${params.profileId}`,
		);
	}
	return await params.repository.createConfig({
		projectId: params.projectId,
		profileId: template.id,
		dynamicKind: template.dynamicKind,
		displayName: template.displayName,
		enabled: true,
		commandJson: template.commandJson,
		workingDirectory: "",
		timeoutSec: template.timeoutSec,
		network: template.network,
		memory: null,
		cpus: null,
		writableWorkdir: template.writableWorkdir,
		allowProjectScripts: template.allowProjectScripts,
		expectedArtifactsJson: template.expectedArtifactsJson ?? [],
		createdByUserId: params.createdByUserId,
	});
}
