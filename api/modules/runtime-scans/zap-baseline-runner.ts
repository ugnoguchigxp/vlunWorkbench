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

function outputText(stream?: ReadableStream<Uint8Array>): Promise<string> {
	return stream ? new Response(stream).text() : Promise.resolve("");
}

function baseDockerArgs(dockerBin: string, containerName?: string): string[] {
	return [
		dockerBin,
		"run",
		"--rm",
		...(containerName ? ["--name", containerName] : []),
		"--network",
		"default",
		...(process.platform === "linux"
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
		...baseDockerArgs(params.dockerBin ?? "docker", params.containerName),
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
): string[] {
	return [
		...baseDockerArgs(dockerBin),
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
	const stdoutPromise = outputText(proc.stdout);
	const stderrPromise = outputText(proc.stderr);
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
		return {
			exitCode: null,
			stdout: await stdoutPromise,
			stderr: await stderrPromise,
			timedOut: true,
		};
	}
	return {
		exitCode: result.code,
		stdout: await stdoutPromise,
		stderr: await stderrPromise,
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
		const dockerBin = docker.dockerBin ?? "docker";
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "zap-baseline-run-"),
		);
		await fs.chmod(tempDir, 0o777);
		const containerName = `vuln-workbench-zap-${cryptoSafeName()}`;
		let gateway: PreparedContainerTargetGateway | undefined = params.gateway;
		let stdout = "";
		let stderr = "";
		let exitCode: number | null = null;
		let timeout = false;
		let rawJson: ZapReport | undefined;
		let rawArtifact: ArtifactSaveResult | undefined;
		let preflightFailure: ZapBaselineRunResult["reasonCode"] | undefined;
		try {
			if (!gateway) {
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
			if (!preflightFailure && gateway) {
				const preflight = await runProcess(
					this.spawn,
					buildPreflightCommand(dockerBin, gateway.containerOrigin),
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
			if (!preflightFailure && gateway) {
				const scan = await runProcess(
					this.spawn,
					buildZapBaselineDockerCommand({
						dockerBin,
						containerName,
						outputDir: tempDir,
						targetOrigin: gateway.containerOrigin,
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
					image: ZAP_STABLE_IMAGE,
					imageDigest: ZAP_STABLE_IMAGE.split("@", 2)[1],
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
		} finally {
			await gateway?.stop().catch(() => undefined);
			await fs
				.rm(tempDir, { recursive: true, force: true })
				.catch(() => undefined);
		}
	}

	private async cleanupContainer(
		dockerBin: string,
		name: string,
	): Promise<void> {
		await runProcess(this.spawn, [dockerBin, "rm", "-f", name], 10).catch(
			() => undefined,
		);
	}
}

function cryptoSafeName(): string {
	return Math.random().toString(36).slice(2, 12);
}
