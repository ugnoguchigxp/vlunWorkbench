import fs from "node:fs/promises";
import { chromium } from "playwright";
import { discoverApiSchema } from "../../api-schema-fuzz/schema-discovery";
import { inferDastTargetStartPlan } from "../../dast/target-preparer";
import { RuntimeScannerRunner } from "../../runtime-scans/runtime-scanner-runner";
import {
	loadScannerE2EContractHash,
	loadScannerE2EQualification,
} from "../scanner-e2e-qualification";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import { loadScannerDataManifest } from "../tools/scanner-provenance";
import {
	checkToolVersion,
	getCleanEnv,
	runToolProcess,
} from "../tools/tool-process-runner";
import { probeDockerImageWithRecovery } from "./docker-image-preflight-probe";
import { ArtifactStorage } from "./lifecycle/artifact-storage";
import type { ScanPreflightDependencies } from "./scan-preflight";

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

async function runLocalProbe(binary: string, args: string[], timeoutSec = 10) {
	return await runToolProcess(binary, args, {
		execution: { runner: "host" },
		timeoutSec,
		outputLimits: {
			stdoutBytes: PROBE_OUTPUT_LIMIT,
			stderrBytes: PROBE_OUTPUT_LIMIT,
		},
		env: getCleanEnv(),
	});
}

export const defaultScanPreflightDependencies: ScanPreflightDependencies = {
	loadManifest: () => loadScannerDataManifest(),
	loadQualification: () => loadScannerE2EQualification(),
	loadQualificationContractHash: () => loadScannerE2EContractHash(),
	probeScannerVersion: async (scannerId, execution) => {
		if (scannerId === "cosign") {
			return await checkToolVersion("cosign", ["version"], {
				execution,
			});
		}
		if (scannerId === "slsa-verifier") {
			return await checkToolVersion("slsa-verifier", ["version"], {
				execution,
			});
		}
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
	probeDockerImage: (dockerBin, image) =>
		probeDockerImageWithRecovery(dockerBin, image, runLocalProbe),
	inferTargetPlan: (params) => inferDastTargetStartPlan(params),
	discoverRepositorySchema: async (repoPath, options) => {
		const discovery = await discoverApiSchema({
			repoPath,
			includeAuthenticatedOperations: options?.includeAuthenticatedOperations,
		});
		return {
			schemaPresent: discovery.applicable,
			apiDetected: discovery.apiDetected,
			reasonCode: discovery.reasonCode,
			evidenceRefs: discovery.apiEvidencePaths.map(
				(candidate) => `api-source:${candidate}`,
			),
		};
	},
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
	resolveSourceState: async (repoPath) => {
		const result = await runLocalProbe("git", [
			"-C",
			repoPath,
			"status",
			"--porcelain",
			"--untracked-files=all",
		]);
		if (!result.ok || result.exitCode !== 0) return "unknown";
		return result.stdout.trim() ? "dirty" : "clean";
	},
	now: () => new Date(),
};
