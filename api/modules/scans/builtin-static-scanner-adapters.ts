import { normalizeGitleaks } from "./normalizers/gitleaks";
import { normalizeOsv } from "./normalizers/osv";
import { normalizeTrivy } from "./normalizers/trivy";
import { normalizeZizmor } from "./normalizers/zizmor";
import type { StaticScannerAdapter } from "./static-scanner-adapter";
import { GitleaksRunner } from "./tools/gitleaks-runner";
import { OsvRunner } from "./tools/osv-runner";
import { TrivyRunner } from "./tools/trivy-runner";
import { ZizmorRunner } from "./tools/zizmor-runner";

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
					configPath: input.options.configPath as string | undefined,
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
					dependencyResolutionMode: input.options.dependencyResolutionMode as
						| "offline"
						| "registry"
						| undefined,
					mavenResolverImage: input.options.mavenResolverImage as
						| string
						| undefined,
					mavenResolverImageId: input.options.mavenResolverImageId as
						| string
						| undefined,
					mavenResolverImageDigest: input.options.mavenResolverImageDigest as
						| string
						| null
						| undefined,
					mavenResolutionConfigDigest: input.options
						.mavenResolutionConfigDigest as string | undefined,
					mavenResolutionSourceDigest: input.options
						.mavenResolutionSourceDigest as string | undefined,
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

export const zizmorScannerAdapter: StaticScannerAdapter = {
	manifest: {
		id: "zizmor",
		displayName: "zizmor GitHub Actions Security",
		binaryName: "zizmor",
		upstreamLicense: "MIT",
		distribution: "core",
		dockerAllowedFirstArgs: ["--version", "--offline"],
		diffInput: "full_snapshot",
	},
	resolveApplicability: ({ scanPaths }) => {
		const workflowPaths = scanPaths.filter(isZizmorInputPath);
		return workflowPaths.length > 0
			? {
					applicability: "applicable",
					reasonCode: null,
					evidenceRefs: workflowPaths
						.slice(0, 10)
						.map((workflowPath) => `repository-path:${workflowPath}`),
				}
			: {
					applicability: "not_applicable",
					reasonCode: "no_auditable_github_actions_inputs",
				};
	},
	resolveDiffExecution: ({ scanPaths }) => {
		const workflowPaths = scanPaths.filter(isZizmorInputPath);
		return {
			inputKind: "full_snapshot",
			targetPaths: workflowPaths.length > 0 ? workflowPaths : undefined,
		};
	},
	createRunner: ({ artifactStorage, execution }) => {
		const runner = new ZizmorRunner(artifactStorage, execution);
		return {
			checkVersion: () => runner.checkVersion(),
			run: (input) =>
				runner.run(input.scanRunId, input.repoPath, {
					timeoutSec: input.timeoutSec,
					targetPaths: input.diffContext?.targetPaths,
					normalizePathsRelativeTo: input.diffContext
						? input.repoPath
						: undefined,
					onLifecycleEvent: input.onLifecycleEvent,
				}),
		};
	},
	normalize: normalizeZizmor,
	defaultCommand: () => "zizmor --offline --format=json-v1",
};

export function isZizmorInputPath(value: string): boolean {
	const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
	return (
		/^\.github\/workflows\/.+\.ya?ml$/i.test(normalized) ||
		/^\.github\/actions\/.+\/action\.ya?ml$/i.test(normalized) ||
		/^action\.ya?ml$/i.test(normalized) ||
		/^\.pre-commit-config\.ya?ml$/i.test(normalized)
	);
}

export const BUILTIN_STATIC_SCANNER_ADAPTERS = [
	gitleaksScannerAdapter,
	osvScannerAdapter,
	trivyScannerAdapter,
	zizmorScannerAdapter,
] as const;
