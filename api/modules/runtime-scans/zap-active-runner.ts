import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ActiveResetStrategy } from "../../../shared/schemas/active-assessment.schema";
import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import {
	type ActiveGatewayEvidence,
	type PreparedActiveContainerTargetGateway,
	prepareActiveContainerTargetGateway,
} from "../dast/active-container-target-gateway";
import { redactSecretText } from "../dast/auth-material";
import { runBoundedProcess } from "../processes/bounded-process-runner";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import {
	redactJsonSecrets,
	redactSecrets,
} from "../scans/normalizers/redaction";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import {
	ZAP_ACTIVE_MAX_REPORT_BYTES,
	ZAP_ACTIVE_POLICY_ID,
} from "./zap-active-policy";
import { buildZapAutomationPlan } from "./zap-automation-plan";
import { isPinnedZapImage, ZAP_STABLE_IMAGE } from "./zap-image-policy";
import { normalizeZap } from "./zap-normalizer";
import { parseZapReport, type ZapReport } from "./zap-report-schema";

const ZAP_ACTIVE_PROCESS_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

type SpawnResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

export type ActiveResetExecutor = {
	prepare: (
		strategy: ActiveResetStrategy,
	) => Promise<{ baselineHash: string | null }>;
	reset: (strategy: ActiveResetStrategy) => Promise<{
		ok: boolean;
		baselineHash: string | null;
		errorCode?: string;
	}>;
};

export type ZapActiveRunResult = {
	status: "completed" | "inconclusive" | "failed_cleanup" | "failed";
	findings: ReturnType<typeof normalizeZap>;
	exitCode: number | null;
	requestCount: number;
	cleanupSucceeded: boolean;
	credentialLeakage: boolean;
	rawArtifact?: ArtifactSaveResult;
	stdoutArtifact?: ArtifactSaveResult;
	stderrArtifact?: ArtifactSaveResult;
	errorCode?: string;
	metadata: Record<string, unknown>;
};

export function buildZapActiveDockerCommand(params: {
	dockerBin: string;
	networkName: string;
	containerName: string;
	outputDir: string;
	image?: string;
}): string[] {
	const image = params.image ?? ZAP_STABLE_IMAGE;
	if (!isPinnedZapImage(image)) throw new Error("zap_active_image_not_pinned");
	return [
		params.dockerBin,
		"run",
		"--rm",
		"--name",
		params.containerName,
		"--network",
		params.networkName,
		"--memory",
		"2g",
		"--memory-swap",
		"2g",
		"--cpus",
		"1.5",
		"--pids-limit",
		"256",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--read-only",
		"--tmpfs",
		"/tmp:rw,noexec,nosuid,size=256m",
		"-v",
		`${params.outputDir}:/zap/wrk:rw`,
		"--entrypoint",
		"/zap/zap.sh",
		image,
		"-cmd",
		"-autorun",
		"/zap/wrk/zap-active.yaml",
	];
}

export class ZapActiveRunner {
	constructor(
		private readonly storage: ArtifactStorage,
		private readonly resetExecutor: ActiveResetExecutor,
		private readonly options: {
			dockerBin?: string;
			spawn?: (args: string[], timeoutSec: number) => Promise<SpawnResult>;
			networkFactory?: () => Promise<{
				name: string;
				gatewayAddress: string;
				stop: () => Promise<void>;
			}>;
			gatewayFactory?: typeof prepareActiveContainerTargetGateway;
		} = {},
	) {}

	async run(params: {
		scanRunId: string;
		upstreamOrigin: string;
		allowedMethods: string[];
		allowedPaths: string[];
		excludedPaths?: string[];
		requestBudget: number;
		rateLimitPerSec: number;
		durationSec: number;
		rules: Array<{ id: number; threshold?: "Medium"; strength?: "Low" }>;
		resetStrategy: ActiveResetStrategy;
		authSecret?: DastAuthSecretPayload;
		openApiPath?: string;
		onGatewayEvidence?: (
			evidence: ActiveGatewayEvidence,
		) => void | Promise<void>;
	}): Promise<ZapActiveRunResult> {
		const dockerBin = this.options.dockerBin ?? "docker";
		const reportFilename = "zap-active-report.json";
		const plan = buildZapAutomationPlan({
			contextName: "vuln-workbench-active",
			targetOrigin: "http://gateway.invalid",
			allowedPaths: params.allowedPaths,
			rules: params.rules,
			maxDurationMinutes: Math.ceil(params.durationSec / 60),
			reportFilename,
		});
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "zap-active-run-"));
		try {
			await chmod(tempDir, 0o700);
		} catch (error) {
			await cleanupTemporaryPaths([tempDir], "zap_active_temp_cleanup_failed");
			throw error;
		}
		let network:
			| { name: string; gatewayAddress: string; stop: () => Promise<void> }
			| undefined;
		let gateway: PreparedActiveContainerTargetGateway | undefined;
		let processResult: SpawnResult = {
			exitCode: null,
			stdout: "",
			stderr: "",
			timedOut: false,
		};
		let rawReport: string | null = null;
		let parsedReport: ZapReport | null = null;
		let prepareBaselineHash: string | null = null;
		let cleanup = { ok: false, baselineHash: null as string | null };
		let isolationCleanupSucceeded = true;
		let errorCode: string | undefined;
		try {
			prepareBaselineHash = (
				await this.resetExecutor.prepare(params.resetStrategy)
			).baselineHash;
			network = await (
				this.options.networkFactory ?? (() => createInternalNetwork(dockerBin))
			)();
			gateway = await (
				this.options.gatewayFactory ?? prepareActiveContainerTargetGateway
			)({
				upstreamOrigin: params.upstreamOrigin,
				allowedMethods: params.allowedMethods,
				allowedPaths: params.allowedPaths,
				excludedPaths: params.excludedPaths,
				maxRequests: params.requestBudget,
				rateLimitPerSec: params.rateLimitPerSec,
				authSecret: params.authSecret,
				bindAddress: network.gatewayAddress,
				containerHost: network.gatewayAddress,
				onEvidence: params.onGatewayEvidence,
			});
			const runtimePlan = buildZapAutomationPlan({
				contextName: "vuln-workbench-active",
				targetOrigin: gateway.containerOrigin,
				allowedPaths: params.allowedPaths,
				openApiUrl: params.openApiPath
					? new URL(params.openApiPath, gateway.containerOrigin).toString()
					: undefined,
				rules: params.rules,
				maxDurationMinutes: Math.ceil(params.durationSec / 60),
				reportFilename,
			});
			await writeFile(path.join(tempDir, "zap-active.yaml"), runtimePlan.yaml, {
				mode: 0o600,
			});
			const command = buildZapActiveDockerCommand({
				dockerBin,
				networkName: network.name,
				containerName: `vuln-workbench-zap-active-${crypto.randomUUID().slice(0, 12)}`,
				outputDir: tempDir,
			});
			processResult = await (
				this.options.spawn ??
				((args, timeoutSec) => spawnBounded(args, timeoutSec))
			)(command, params.durationSec);
			const reportPath = path.join(tempDir, reportFilename);
			if ((await stat(reportPath)).size > ZAP_ACTIVE_MAX_REPORT_BYTES)
				throw new Error("zap_active_report_too_large");
			rawReport = await readFile(reportPath, "utf8");
			parsedReport = parseZapReport(JSON.parse(rawReport));
			if (processResult.timedOut) errorCode = "timed_out";
			else if (![0, 1].includes(processResult.exitCode ?? -1))
				errorCode = "execution_failed";
		} catch (error) {
			errorCode =
				error instanceof Error ? error.message : "zap_active_execution_failed";
		} finally {
			await gateway?.stop().catch(() => {
				isolationCleanupSucceeded = false;
			});
			await network?.stop().catch(() => {
				isolationCleanupSucceeded = false;
			});
			cleanup = await this.resetExecutor
				.reset(params.resetStrategy)
				.catch(() => ({
					ok: false,
					baselineHash: null,
					errorCode: "reset_failed",
				}));
		}
		const credentialLeakage = secretLeaked(
			[processResult.stdout, processResult.stderr, rawReport ?? ""].join("\n"),
			params.authSecret,
		);
		if (credentialLeakage) errorCode = "credential_canary_leaked";
		const gatewayMetrics = gateway?.metrics() ?? null;
		if ((gatewayMetrics?.evidencePersistenceFailures ?? 0) > 0)
			errorCode = "gateway_evidence_persistence_failed";
		const resetExpected =
			params.resetStrategy.kind === "container_recreate"
				? params.resetStrategy.expectedBaselineHash
				: prepareBaselineHash;
		let cleanupSucceeded =
			cleanup.ok &&
			isolationCleanupSucceeded &&
			(resetExpected === null || cleanup.baselineHash === resetExpected);
		const redactedReport = parsedReport
			? (JSON.parse(
					redactSecretText(
						JSON.stringify(redactJsonSecrets(parsedReport)),
						params.authSecret,
					),
				) as ZapReport)
			: null;
		let rawArtifact: ArtifactSaveResult | undefined;
		let stdoutArtifact: ArtifactSaveResult | undefined;
		let stderrArtifact: ArtifactSaveResult | undefined;
		let tempCleanupSucceeded = true;
		try {
			rawArtifact = redactedReport
				? await this.storage.saveTextArtifact(
						params.scanRunId,
						"raw",
						JSON.stringify(redactedReport, null, 2),
						reportFilename,
						{ mode: 0o600 },
					)
				: undefined;
			stdoutArtifact = processResult.stdout
				? await this.storage.saveLog(
						params.scanRunId,
						"stdout",
						redactSecretText(
							redactSecrets(processResult.stdout),
							params.authSecret,
						),
						"zap-active-stdout.log",
						{ mode: 0o600 },
					)
				: undefined;
			stderrArtifact = processResult.stderr
				? await this.storage.saveLog(
						params.scanRunId,
						"stderr",
						redactSecretText(
							redactSecrets(processResult.stderr),
							params.authSecret,
						),
						"zap-active-stderr.log",
						{ mode: 0o600 },
					)
				: undefined;
		} finally {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {
				tempCleanupSucceeded = false;
			});
		}
		if (!tempCleanupSucceeded) {
			cleanupSucceeded = false;
			errorCode = "zap_active_temp_cleanup_failed";
		}
		const status = !cleanupSucceeded
			? "failed_cleanup"
			: errorCode
				? errorCode === "timed_out"
					? "inconclusive"
					: "failed"
				: "completed";
		return {
			status,
			findings:
				status === "completed" && redactedReport && gateway
					? normalizeZap(redactedReport, {
							upstreamOrigin: params.upstreamOrigin,
							gatewayOrigin: gateway.containerOrigin,
						})
					: [],
			exitCode: processResult.exitCode,
			requestCount: gatewayMetrics?.forwardedRequests ?? 0,
			cleanupSucceeded,
			credentialLeakage,
			rawArtifact,
			stdoutArtifact,
			stderrArtifact,
			errorCode,
			metadata: {
				policyId: ZAP_ACTIVE_POLICY_ID,
				planPolicyId: plan.policyId,
				enabledRuleIds: plan.enabledRuleIds,
				networkMode: "internal",
				gatewayMetrics,
				prepareBaselineHash,
				cleanupBaselineHash: cleanup.baselineHash,
				isolationCleanupSucceeded,
				tempCleanupSucceeded,
			},
		};
	}
}

async function createInternalNetwork(dockerBin: string): Promise<{
	name: string;
	gatewayAddress: string;
	stop: () => Promise<void>;
}> {
	if (process.platform !== "linux")
		throw new Error("zap_active_network_isolation_unavailable");
	const name = `vuln-workbench-zap-${crypto.randomUUID().slice(0, 12)}`;
	const created = await spawnBounded(
		[dockerBin, "network", "create", "--internal", name],
		30,
	);
	if (created.timedOut || created.exitCode !== 0)
		throw new Error("zap_active_network_create_failed");
	const inspect = await spawnBounded(
		[
			dockerBin,
			"network",
			"inspect",
			name,
			"--format",
			"{{(index .IPAM.Config 0).Gateway}}",
		],
		30,
	);
	if (inspect.timedOut || inspect.exitCode !== 0) {
		await spawnBounded([dockerBin, "network", "rm", name], 30);
		throw new Error("zap_active_network_inspect_failed");
	}
	const gatewayAddress = inspect.stdout.trim();
	if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(gatewayAddress)) {
		await spawnBounded([dockerBin, "network", "rm", name], 30);
		throw new Error("zap_active_network_gateway_unavailable");
	}
	return {
		name,
		gatewayAddress,
		stop: async () => {
			const removed = await spawnBounded(
				[dockerBin, "network", "rm", name],
				30,
			);
			if (removed.timedOut || removed.exitCode !== 0)
				throw new Error("zap_active_network_cleanup_failed");
		},
	};
}

async function spawnBounded(
	args: string[],
	timeoutSec: number,
): Promise<SpawnResult> {
	const result = await runBoundedProcess({
		argv: args,
		timeoutMs: timeoutSec * 1_000,
		outputLimitBytes: ZAP_ACTIVE_PROCESS_OUTPUT_LIMIT_BYTES,
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		timedOut: result.terminationReason === "timeout",
	};
}

function secretLeaked(
	value: string,
	secret: DastAuthSecretPayload | undefined,
): boolean {
	return secret ? redactSecretText(value, secret) !== value : false;
}
