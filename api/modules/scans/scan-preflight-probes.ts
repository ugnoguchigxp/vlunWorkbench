import fs from "node:fs/promises";
import { chromium } from "playwright";
import { discoverApiSchema } from "../api-schema-fuzz/schema-discovery";
import { inferDastTargetStartPlan } from "../dast/target-preparer";
import { RuntimeScannerRunner } from "../runtime-scans/runtime-scanner-runner";
import { ArtifactStorage } from "./artifact-storage";
import type { ScanPreflightDependencies } from "./scan-preflight";
import { staticScannerAdapterRegistry } from "./static-scanner-adapters";
import { loadScannerDataManifest } from "./tools/scanner-provenance";
import {
	checkToolVersion,
	getCleanEnv,
	runToolProcess,
} from "./tools/tool-process-runner";

const PROBE_OUTPUT_LIMIT = 4096;

function sanitizeVersion(value: string | null | undefined): string | null {
	if (!value) return null;
	return (
		value
			.replace(/[\r\n\0]+/g, " ")
			.trim()
			.slice(0, 200) || null
	);
}

async function runLocalProbe(binary: string, args: string[]) {
	return await runToolProcess(binary, args, {
		execution: { runner: "host" },
		timeoutSec: 10,
		outputLimits: {
			stdoutBytes: PROBE_OUTPUT_LIMIT,
			stderrBytes: PROBE_OUTPUT_LIMIT,
		},
		env: getCleanEnv(),
	});
}

export const defaultScanPreflightDependencies: ScanPreflightDependencies = {
	loadManifest: () => loadScannerDataManifest(),
	probeScannerVersion: async (scannerId, execution) => {
		if (scannerId === "nuclei-safe") {
			return await new RuntimeScannerRunner(
				"nuclei-safe",
				new ArtifactStorage(),
				execution,
			).checkVersion();
		}
		if (scannerId === "schemathesis") {
			return await checkToolVersion("st", ["--version"], { execution });
		}
		const adapter = staticScannerAdapterRegistry.get(scannerId);
		return adapter
			? await adapter
					.createRunner({ artifactStorage: new ArtifactStorage(), execution })
					.checkVersion()
			: null;
	},
	probeDocker: async (dockerBin) => {
		const result = await runLocalProbe(dockerBin, [
			"version",
			"--format",
			"{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}",
		]);
		const [rawVersion, rawPlatform] = result.stdout.trim().split(/\s+/, 2);
		const version = sanitizeVersion(rawVersion || result.stderr);
		const platform = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(rawPlatform ?? "")
			? rawPlatform
			: null;
		return {
			ready:
				result.ok &&
				result.exitCode === 0 &&
				Boolean(version) &&
				Boolean(platform),
			version,
			platform,
			reasonCode:
				result.ok && result.exitCode === 0 && platform
					? null
					: "docker_daemon_unavailable",
		};
	},
	probeDockerImage: async (dockerBin, image) => {
		const result = await runLocalProbe(dockerBin, [
			"image",
			"inspect",
			"--format",
			"{{json .RepoDigests}}\t{{.Id}}\t{{.Os}}/{{.Architecture}}",
			image,
		]);
		const [rawRepoDigests, rawImageId, rawPlatform] = result.stdout
			.trim()
			.split("\t", 3);
		let repoDigests: string[] = [];
		try {
			const parsed = rawRepoDigests ? JSON.parse(rawRepoDigests) : null;
			if (Array.isArray(parsed)) {
				repoDigests = parsed.filter(
					(value): value is string => typeof value === "string",
				);
			}
		} catch {
			// The image exists but its inspect payload cannot establish a digest.
		}
		const digest = repoDigests
			.map((value) => value.match(/@(sha256:[a-f0-9]{64})$/)?.[1] ?? null)
			.find((value): value is string => value !== null);
		const validDigest =
			digest && /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null;
		return {
			ready: result.ok && result.exitCode === 0 && Boolean(rawPlatform),
			digest: validDigest,
			repoDigests,
			imageId: /^sha256:[a-f0-9]{64}$/.test(rawImageId ?? "")
				? rawImageId
				: null,
			platform: rawPlatform || null,
			reasonCode:
				result.ok && result.exitCode === 0
					? rawPlatform
						? null
						: "docker_image_platform_missing"
					: "docker_image_unavailable",
		};
	},
	probeDockerRuntimePath: async (dockerBin, image, runtimePath) => {
		if (!runtimePath.startsWith("/") || /[\r\n\0]/.test(runtimePath))
			return false;
		const result = await runLocalProbe(dockerBin, [
			"run",
			"--rm",
			"--network",
			"none",
			"--entrypoint",
			"/bin/sh",
			image,
			"-c",
			'test -r "$1"',
			"preflight",
			runtimePath,
		]);
		return result.ok && result.exitCode === 0;
	},
	inferTargetPlan: (params) => inferDastTargetStartPlan(params),
	discoverRepositorySchema: async (repoPath) =>
		(await discoverApiSchema({ repoPath })).applicable,
	probeBrowser: async () => {
		const executable = chromium.executablePath();
		return (await fs
			.access(executable)
			.then(() => true)
			.catch(() => false))
			? "chromium"
			: null;
	},
	resolveSourceRevision: async (repoPath) => {
		const result = await runLocalProbe("git", [
			"-C",
			repoPath,
			"rev-parse",
			"HEAD",
		]);
		const revision = result.stdout.trim().toLowerCase();
		return result.ok &&
			result.exitCode === 0 &&
			/^[a-f0-9]{40,64}$/.test(revision)
			? revision
			: null;
	},
	now: () => new Date(),
};
