import type { SemgrepRuleContribution } from "../../modules/project-capabilities/plugin-contract";
import { normalizeSemgrep } from "../../modules/scans/normalizers/semgrep";
import type { StaticScannerAdapter } from "../../modules/scans/static-scanner-adapter";
import { SemgrepRunner } from "../../modules/scans/tools/semgrep-runner";
import { builtInTechnologyPluginRegistry } from "../builtin";

const MAX_EXPLICIT_DIFF_TARGETS = 512;
const MAX_ESTIMATED_DIFF_ARG_BYTES = 96 * 1024;

function requiresChangedWorkspace(scanPaths: readonly string[]): boolean {
	if (scanPaths.length > MAX_EXPLICIT_DIFF_TARGETS) return true;
	const estimatedBytes = scanPaths.reduce(
		(total, scanPath) => total + Buffer.byteLength(scanPath, "utf8") + 256,
		0,
	);
	return estimatedBytes > MAX_ESTIMATED_DIFF_ARG_BYTES;
}

function semgrepRuleContributionsFrom(
	options: Record<string, unknown>,
): SemgrepRuleContribution[] | undefined {
	return Array.isArray(options.semgrepRuleContributions)
		? (options.semgrepRuleContributions as SemgrepRuleContribution[])
		: undefined;
}

/**
 * Optional adapter for the LGPL-2.1-or-later Semgrep engine.
 * The adapter glue is part of vulnWorkbench, but the engine is never registered
 * as a core scanner and is not shipped in the core toolbox image.
 */
export const semgrepScannerAdapter: StaticScannerAdapter = {
	manifest: {
		id: "semgrep",
		displayName: "Semgrep Static Analysis (optional)",
		binaryName: "semgrep",
		upstreamLicense: "LGPL-2.1-or-later",
		distribution: "optional",
		dockerAllowedFirstArgs: ["--version", "scan"],
		diffInput: "full_snapshot",
	},
	resolveDiffExecution: ({ scanPaths }) =>
		requiresChangedWorkspace(scanPaths)
			? { inputKind: "changed_workspace" }
			: { inputKind: "full_snapshot", targetPaths: [...scanPaths] },
	extendProfileOptions: ({ options, activeTechnologyPluginIds }) => ({
		...options,
		semgrepRuleContributions: builtInTechnologyPluginRegistry
			.semgrepRules()
			.filter((contribution) =>
				activeTechnologyPluginIds.includes(contribution.pluginId),
			),
	}),
	prepareOptions: ({ options, execution, provenance }) => {
		if (
			options.config !== undefined &&
			options.config !== "owned" &&
			options.config !== "curated-sast-v1"
		) {
			return options;
		}
		const dockerRuntimePath = provenance.runtimePath;
		if (
			execution.runner === "docker" &&
			(typeof dockerRuntimePath !== "string" || !dockerRuntimePath.trim())
		) {
			throw new Error("scanner_adapter_runtime_config_missing:semgrep");
		}
		return {
			...options,
			config:
				execution.runner === "docker"
					? dockerRuntimePath
					: new URL(
							"../../../docker/toolbox/scanner-data/semgrep-rules",
							import.meta.url,
						).pathname,
		};
	},
	createRunner: ({ artifactStorage, execution }) => {
		const runner = new SemgrepRunner(artifactStorage, execution);
		return {
			checkVersion: () => runner.checkVersion(),
			run: (input) =>
				runner.run(input.scanRunId, input.repoPath, {
					config: (input.options.config as string) ?? "auto",
					scope: input.scope,
					timeoutSec: input.timeoutSec,
					maxTargetBytes: input.options.maxTargetBytes
						? Number(input.options.maxTargetBytes)
						: undefined,
					targetPaths: input.diffContext?.targetPaths,
					normalizePathsRelativeTo: input.diffContext
						? input.repoPath
						: undefined,
					onLifecycleEvent: input.onLifecycleEvent,
					ruleContributions: semgrepRuleContributionsFrom(input.options),
				}),
		};
	},
	normalize: normalizeSemgrep,
	defaultCommand: (options) =>
		`semgrep scan --config ${options.config ?? "curated-sast-v1"}`,
};
