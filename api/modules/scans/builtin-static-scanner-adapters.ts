import { normalizeGitleaks } from "./normalizers/gitleaks";
import { normalizeOsv } from "./normalizers/osv";
import { normalizeTrivy } from "./normalizers/trivy";
import type { StaticScannerAdapter } from "./static-scanner-adapter";
import { GitleaksRunner } from "./tools/gitleaks-runner";
import { OsvRunner } from "./tools/osv-runner";
import { TrivyRunner } from "./tools/trivy-runner";

export const gitleaksScannerAdapter: StaticScannerAdapter = {
	manifest: {
		id: "gitleaks",
		displayName: "Gitleaks Secret Detection",
		binaryName: "gitleaks",
		upstreamLicense: "MIT",
		distribution: "core",
		dockerAllowedFirstArgs: ["version", "detect"],
		diffInput: "changed_workspace",
	},
	createRunner: ({ artifactStorage, execution }) => {
		const runner = new GitleaksRunner(artifactStorage, execution);
		return {
			checkVersion: () => runner.checkVersion(),
			run: (input) =>
				runner.run(input.scanRunId, input.repoPath, {
					timeoutSec: input.timeoutSec,
					scope: input.scope,
					preScoped: input.diffContext?.inputKind === "changed_workspace",
					normalizePathsRelativeTo: input.diffContext
						? input.repoPath
						: undefined,
					onLifecycleEvent: input.onLifecycleEvent,
				}),
		};
	},
	normalize: normalizeGitleaks,
	defaultCommand: () => "gitleaks detect",
};

export const osvScannerAdapter: StaticScannerAdapter = {
	manifest: {
		id: "osv",
		displayName: "OSV Dependency Scanner",
		binaryName: "osv-scanner",
		upstreamLicense: "Apache-2.0",
		distribution: "core",
		dockerAllowedFirstArgs: ["--version", "--format", "scan"],
		diffInput: "full_snapshot",
	},
	createRunner: ({ artifactStorage, execution }) => {
		const runner = new OsvRunner(artifactStorage, execution);
		return {
			checkVersion: () => runner.checkVersion(),
			run: (input) =>
				runner.run(input.scanRunId, input.repoPath, {
					timeoutSec: input.timeoutSec,
					scope: input.scope,
					dependencyMode: input.options.dependencyMode as
						| "manifest"
						| "installed_tree"
						| undefined,
					normalizePathsRelativeTo: input.diffContext
						? input.repoPath
						: undefined,
					onLifecycleEvent: input.onLifecycleEvent,
				}),
		};
	},
	normalize: normalizeOsv,
	defaultCommand: () => "osv-scanner",
};

export const trivyScannerAdapter: StaticScannerAdapter = {
	manifest: {
		id: "trivy",
		displayName: "Trivy Filesystem Scanner",
		binaryName: "trivy",
		upstreamLicense: "Apache-2.0",
		distribution: "core",
		dockerAllowedFirstArgs: ["--version", "fs", "image"],
		diffInput: "changed_workspace",
		diffWorkspace: "trivy",
	},
	validateOptions: (options) => {
		if (options.mode === "image" && !options.imageRef && !options.imageTar) {
			throw new Error("image_input_not_provided");
		}
	},
	createRunner: ({ artifactStorage, execution }) => {
		const runner = new TrivyRunner(artifactStorage, execution);
		return {
			checkVersion: () => runner.checkVersion(),
			run: (input) =>
				runner.run(input.scanRunId, input.repoPath, {
					timeoutSec: input.timeoutSec,
					scope: input.scope,
					scanners: Array.isArray(input.options.scanners)
						? (input.options.scanners as string[])
						: undefined,
					mode: input.options.mode as
						| "fs-vulnerability"
						| "fs-sbom"
						| "image"
						| undefined,
					imageRef: input.options.imageRef as string | undefined,
					imageTar: input.options.imageTar as string | undefined,
					normalizePathsRelativeTo: input.diffContext
						? input.repoPath
						: undefined,
					onLifecycleEvent: input.onLifecycleEvent,
				}),
		};
	},
	normalize: normalizeTrivy,
	defaultCommand: () => "trivy fs",
};

export const BUILTIN_STATIC_SCANNER_ADAPTERS = [
	gitleaksScannerAdapter,
	osvScannerAdapter,
	trivyScannerAdapter,
] as const;
