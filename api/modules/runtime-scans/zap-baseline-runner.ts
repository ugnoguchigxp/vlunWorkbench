import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import {
	redactJsonSecrets,
	redactSecrets,
} from "../scans/normalizers/redaction";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import type { ToolExecutionConfig } from "../scans/tools/tool-process-runner";
import {
	prepareContainerTargetGateway,
	type PreparedContainerTargetGateway,
} from "../dast/container-target-gateway";
import { buildZapBaselineCommand } from "./command-contracts";
import {
	isPinnedZapImage,
	ZAP_REPORT_FILENAME,
	ZAP_STABLE_IMAGE,
} from "./zap-image-policy";
import { parseZapReport, type ZapReport } from "./zap-report-schema";
import { normalizeZap } from "./zap-normalizer";

const MAX_ZAP_REPORT_BYTES = 20 * 1024 * 1024;

export type ZapBaselineRunResult = {
	ok: boolean;
	exitCode: number | null;
	elapsedMs: number;
	stdout: string;
	stderr: string;
	rawJson: ZapReport | undefined;
	findings: ReturnType<typeof normalizeZap>;
	rawArtifact?: ArtifactSaveResult;
	stdoutArtifact?: ArtifactSaveResult;
	stderrArtifact?: ArtifactSaveResult;
	reasonCode?:
		| "target_unreachable_from_container"
		| "authentication_required"
		| "invalid_structured_output"
		| "timed_out"
		| "execution_failed"
		| "policy_rejected";
	error?: string;
	executionMetadata?: Record<string, unknown>;
};

type Spawned = {
	exited: Promise<number>;
	stdout?: ReadableStream<Uint8Array>;
	stderr?: ReadableStream<Uint8Array>;
	kill?: (signal?: string) => void;
};
type SpawnFn = (args: string[], options: Record<string, unknown>) => Spawned;

type OutputCapture = {
	promise: Promise<void>;
	cancel: () => Promise<void>;
	text: () => string;
};

function captureOutput(
	stream?: ReadableStream<Uint8Array>,
	maxBytes = 2 * 1024 * 1024,
): OutputCapture {
	if (!stream) {
		return {
			promise: Promise.resolve(),
			cancel: async () => {},
			text: () => "",
		};
	}
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let output = "";
	let bytesRead = 0;
	const promise = (async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				const remaining = maxBytes - bytesRead;
				if (remaining <= 0) {
					output += "\n[output truncated]\n";
					await reader.cancel().catch(() => undefined);
					break;
				}
				const retained =
					value.byteLength <= remaining ? value : value.slice(0, remaining);
				bytesRead += retained.byteLength;
				output += decoder.decode(retained, { stream: true });
				if (retained.byteLength < value.byteLength) {
					output += "\n[output truncated]\n";
					await reader.cancel().catch(() => undefined);
					break;
				}
			}
			output += decoder.decode();
		} finally {
			reader.releaseLock();
		}
	})().catch((error) => {
		output += `\n[output capture failed: ${String(error)}]\n`;
	});
	return {
		promise,
		cancel: async () => {
			await reader.cancel().catch(() => undefined);
		},
		text: () => output,
	};
}

async function finishOutput(
	stdout: OutputCapture,
	stderr: OutputCapture,
	waitMs: number,
): Promise<{ stdout: string; stderr: string }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const settled = await Promise.race([
		Promise.all([stdout.promise, stderr.promise]).then(() => true),
		new Promise<false>((resolve) => {
			timer = setTimeout(() => resolve(false), waitMs);
		}),
	]);
	if (timer) clearTimeout(timer);
	if (!settled) {
		await Promise.all([stdout.cancel(), stderr.cancel()]);
	}
	return { stdout: stdout.text(), stderr: stderr.text() };
}

function baseDockerArgs(
	dockerBin: string,
	containerName?: string,
	runtimeNamespaceOwnerId?: string,
): string[] {
	return [
		dockerBin,
		"run",
		"--rm",
		...(containerName ? ["--name", containerName] : []),
		"--network",
		runtimeNamespaceOwnerId
			? `container:${runtimeNamespaceOwnerId}`
			: "default",
		...(!runtimeNamespaceOwnerId && process.platform === "linux"
			? ["--add-host", "host.docker.internal:host-gateway"]
			: []),
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
	];
}

export function buildZapBaselineDockerCommand(params: {
	dockerBin?: string;
	image?: string;
	runtimeNamespaceOwnerId?: string;
	containerName: string;
	outputDir: string;
	targetOrigin: string;
	memory?: string;
	cpus?: string;
}): string[] {
	const image = params.image ?? ZAP_STABLE_IMAGE;
	if (!isPinnedZapImage(image))
		throw new Error("ZAP requires a pinned official image index.");
	return [
		...baseDockerArgs(
			params.dockerBin ?? "docker",
			params.containerName,
			params.runtimeNamespaceOwnerId,
		),
		"--memory",
		params.memory ?? "2g",
		"--cpus",
		params.cpus ?? "2",
		"--pids-limit",
		"512",
		"--shm-size",
		"512m",
		"-v",
		`${params.outputDir}:/zap/wrk:rw`,
		"--entrypoint",
		"/zap/zap-baseline.py",
		image,
		...buildZapBaselineCommand(params.targetOrigin, ZAP_REPORT_FILENAME).slice(
			1,
		),
	];
}

function buildPreflightCommand(
	dockerBin: string,
	targetOrigin: string,
	runtimeNamespaceOwnerId?: string,
): string[] {
	return [
		...baseDockerArgs(dockerBin, undefined, runtimeNamespaceOwnerId),
		"--entrypoint",
		"python3",
		ZAP_STABLE_IMAGE,
		"-c",
		"import sys,urllib.request,urllib.error; u=sys.argv[1];\ntry:\n r=urllib.request.urlopen(u, timeout=10); print(r.status)\nexcept urllib.error.HTTPError as e:\n print(e.code)\nexcept Exception as e:\n print('ERROR:'+str(e)); sys.exit(7)",
		targetOrigin,
	];
}

async function runProcess(
	spawn: SpawnFn,
	args: string[],
	timeoutSec: number,
): Promise<{
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}> {
	let proc: Spawned;
	try {
		proc = spawn(args, { stdout: "pipe", stderr: "pipe" });
	} catch (error) {
		return {
			exitCode: null,
			stdout: "",
			stderr: String(error),
			timedOut: false,
		};
	}
	const stdoutCapture = captureOutput(proc.stdout);
	const stderrCapture = captureOutput(proc.stderr);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutSec * 1000);
	});
	const exit = proc.exited.then((code) => ({ code }));
	const result = await Promise.race([exit, timeout]);
	if (timer) clearTimeout(timer);
	if (result === "timeout") {
		proc.kill?.("SIGKILL");
		await Promise.race([
			proc.exited.catch(() => undefined),
			new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
		]);
		const output = await finishOutput(stdoutCapture, stderrCapture, 1_000);
		return {
			exitCode: null,
			...output,
			timedOut: true,
		};
	}
	const output = await finishOutput(stdoutCapture, stderrCapture, 2_000);
	return {
		exitCode: result.code,
		...output,
		timedOut: false,
	};
}

export class ZapBaselineRunner {
	private readonly spawn: SpawnFn;

	constructor(
		private readonly storage: ArtifactStorage,
		private readonly execution: ToolExecutionConfig | undefined,
		options: {
			spawn?: SpawnFn;
			gatewayFactory?: typeof prepareContainerTargetGateway;
		} = {},
	) {
		if (execution?.runner !== "docker")
			throw new Error("policy_rejected: ZAP Baseline is Docker-only");
		this.spawn =
			options.spawn ??
			((args, spawnOptions) =>
				Bun.spawn(
					args,
					spawnOptions as Parameters<typeof Bun.spawn>[1],
				) as unknown as Spawned);
		this.gatewayFactory =
			options.gatewayFactory ?? prepareContainerTargetGateway;
	}

	private readonly gatewayFactory: typeof prepareContainerTargetGateway;

	async run(params: {
		scanRunId: string;
		upstreamOrigin: string;
		allowedPaths: string[];
		excludedPaths: string[];
		maxRequests: number;
		rateLimitPerSec: number;
		timeoutSec?: number;
		gateway?: PreparedContainerTargetGateway;
	}): Promise<ZapBaselineRunResult> {
		const startedAt = Date.now();
		const docker = this.execution?.docker ?? {};
		const runtimeNamespaceOwnerId = docker.runtimeNamespaceOwnerId;
		const dockerBin = docker.dockerBin ?? "docker";
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "zap-baseline-run-"),
		);
		try {
			await fs.chmod(tempDir, 0o777);
		} catch (error) {
			await cleanupTemporaryPaths(
				[tempDir],
				"zap_baseline_temp_cleanup_failed",
			);
			throw error;
		}
		const containerName = `vuln-workbench-zap-${cryptoSafeName()}`;
		let gateway: PreparedContainerTargetGateway | undefined = params.gateway;
		let stdout = "";
		let stderr = "";
		let exitCode: number | null = null;
		let timeout = false;
		let rawJson: ZapReport | undefined;
		let rawArtifact: ArtifactSaveResult | undefined;
		let preflightFailure: ZapBaselineRunResult["reasonCode"] | undefined;
		let runResult: ZapBaselineRunResult | undefined;
		let runError: unknown;
		try {
			runResult = await (async (): Promise<ZapBaselineRunResult> => {
				if (!gateway && !runtimeNamespaceOwnerId) {
					try {
						gateway = await this.gatewayFactory({
							upstreamOrigin: params.upstreamOrigin,
							allowedPaths: params.allowedPaths,
							excludedPaths: params.excludedPaths,
							maxRequests: params.maxRequests,
							rateLimitPerSec: params.rateLimitPerSec,
							dockerBin,
						});
					} catch (error) {
						preflightFailure = "target_unreachable_from_container";
						stderr = String(error);
					}
				}
				const scannerOrigin = runtimeNamespaceOwnerId
					? params.upstreamOrigin
					: gateway?.containerOrigin;
				if (!preflightFailure && scannerOrigin) {
					const preflight = await runProcess(
						this.spawn,
						buildPreflightCommand(
							dockerBin,
							scannerOrigin,
							runtimeNamespaceOwnerId,
						),
						Math.min(params.timeoutSec ?? 120, 30),
					);
					stdout += preflight.stdout;
					if (preflight.timedOut)
						preflightFailure = "target_unreachable_from_container";
					else if (/ENOENT|docker process error/i.test(preflight.stderr))
						preflightFailure = "execution_failed";
					else if (
						preflight.exitCode !== 0 ||
						preflight.stdout.includes("ERROR:")
					)
						preflightFailure = "target_unreachable_from_container";
					else if (/(^|\D)(401|403)(\D|$)/.test(preflight.stdout))
						preflightFailure = "authentication_required";
					stderr += preflight.stderr;
				}
				if (!preflightFailure && scannerOrigin) {
					const scan = await runProcess(
						this.spawn,
						buildZapBaselineDockerCommand({
							dockerBin,
							containerName,
							outputDir: tempDir,
							targetOrigin: scannerOrigin,
							image: docker.image,
							runtimeNamespaceOwnerId,
							memory: docker.memory,
							cpus: docker.cpus,
						}),
						params.timeoutSec ?? 300,
					);
					exitCode = scan.exitCode;
					stdout += scan.stdout;
					stderr += scan.stderr;
					timeout = scan.timedOut;
					if (timeout) await this.cleanupContainer(dockerBin, containerName);
				}
				const reportPath = path.join(tempDir, ZAP_REPORT_FILENAME);
				if (!preflightFailure && !timeout) {
					try {
						const reportStats = await fs.stat(reportPath);
						if (reportStats.size > MAX_ZAP_REPORT_BYTES) {
							throw new Error(
								`ZAP report exceeds ${MAX_ZAP_REPORT_BYTES} bytes`,
							);
						}
						const parsed = JSON.parse(await fs.readFile(reportPath, "utf8"));
						rawJson = parseZapReport(parsed);
						const redacted = redactJsonSecrets(rawJson);
						rawJson = redacted as ZapReport;
						rawArtifact = await this.storage.saveTextArtifact(
							params.scanRunId,
							"raw",
							JSON.stringify(redacted, null, 2),
							ZAP_REPORT_FILENAME,
							{ mode: 0o600 },
						);
					} catch (error) {
						stderr += `Invalid ZAP report: ${String(error)}`;
					}
				}
				const common = {
					elapsedMs: Date.now() - startedAt,
					stdout: redactSecrets(stdout),
					stderr: redactSecrets(stderr),
					executionMetadata: {
						runner: "docker",
						image: docker.image ?? ZAP_STABLE_IMAGE,
						imageDigest: (docker.image ?? ZAP_STABLE_IMAGE).split("@", 2)[1],
						containerName,
						gatewayMetrics: gateway?.metrics() ?? null,
						reportVersion: rawJson?.["@version"] ?? null,
					},
				};
				const stdoutArtifact = stdout
					? await this.storage.saveTextArtifact(
							params.scanRunId,
							"logs",
							redactSecrets(stdout),
							"zap-stdout.log",
							{ mode: 0o600 },
						)
					: undefined;
				const stderrArtifact = stderr
					? await this.storage.saveTextArtifact(
							params.scanRunId,
							"logs",
							redactSecrets(stderr),
							"zap-stderr.log",
							{ mode: 0o600 },
						)
					: undefined;
				if (preflightFailure)
					return {
						...common,
						ok: false,
						exitCode: null,
						rawJson: undefined,
						findings: [],
						stdoutArtifact,
						stderrArtifact,
						reasonCode: preflightFailure,
						error: stderr || preflightFailure,
					};
				if (timeout)
					return {
						...common,
						ok: false,
						exitCode: null,
						rawJson: undefined,
						findings: [],
						stdoutArtifact,
						stderrArtifact,
						reasonCode: "timed_out",
						error: "ZAP Baseline timed out",
					};
				if (!rawJson)
					return {
						...common,
						ok: false,
						exitCode,
						rawJson: undefined,
						findings: [],
						rawArtifact,
						stdoutArtifact,
						stderrArtifact,
						reasonCode: "invalid_structured_output",
						error: "ZAP report is missing or structurally invalid",
					};
				if (![0, 1, 2].includes(exitCode ?? -1))
					return {
						...common,
						ok: false,
						exitCode,
						rawJson,
						findings: [],
						rawArtifact,
						stdoutArtifact,
						stderrArtifact,
						reasonCode: "execution_failed",
						error: `ZAP exited with code ${exitCode}`,
					};
				return {
					...common,
					ok: true,
					exitCode,
					rawJson,
					findings: normalizeZap(rawJson, {
						upstreamOrigin: params.upstreamOrigin,
						gatewayOrigin: gateway?.containerOrigin ?? "",
					}),
					rawArtifact,
					stdoutArtifact,
					stderrArtifact,
				};
			})();
		} catch (error) {
			runError = error;
		}
		const cleanupResults = await Promise.allSettled([
			...(gateway ? [gateway.stop()] : []),
			fs.rm(tempDir, { recursive: true, force: true }),
		]);
		if (cleanupResults.some((result) => result.status === "rejected")) {
			throw new Error("zap_baseline_cleanup_failed");
		}
		if (runError) throw runError;
		if (!runResult) throw new Error("zap_baseline_result_missing");
		return runResult;
	}

	private async cleanupContainer(
		dockerBin: string,
		name: string,
	): Promise<void> {
		const result = await runProcess(
			this.spawn,
			[dockerBin, "rm", "-f", name],
			10,
		);
		if (result.timedOut || result.exitCode !== 0) {
			throw new Error("zap_baseline_container_cleanup_failed");
		}
	}
}

function cryptoSafeName(): string {
	return Math.random().toString(36).slice(2, 12);
}
