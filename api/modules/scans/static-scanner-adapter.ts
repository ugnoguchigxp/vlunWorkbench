import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import type { ArtifactStorage } from "./execution/lifecycle/artifact-storage";
import type { NormalizedFinding } from "./findings/normalizers/fixture";
import type {
	CommonToolRunResult,
	DiffToolExecutionContext,
} from "./execution/profile-runner";
import type {
	ToolExecutionConfig,
	ToolLifecycleEvent,
} from "./tools/tool-process-runner";

export const CORE_SCANNER_LICENSES = ["MIT", "Apache-2.0"] as const;
export type CoreScannerLicense = (typeof CORE_SCANNER_LICENSES)[number];

type StaticScannerAdapterManifestBase = {
	readonly id: string;
	readonly displayName: string;
	readonly binaryName: string;
	readonly dockerAllowedFirstArgs: readonly string[];
	readonly diffInput: "full_snapshot" | "changed_workspace";
	readonly diffWorkspace?: "default" | "trivy";
};

export type StaticScannerAdapterManifest =
	| (StaticScannerAdapterManifestBase & {
			readonly distribution: "core";
			readonly upstreamLicense: CoreScannerLicense;
	  })
	| (StaticScannerAdapterManifestBase & {
			readonly distribution: "optional";
			readonly upstreamLicense: string;
	  });

export type StaticScannerDiffExecution = {
	inputKind: "full_snapshot" | "changed_workspace";
	workspace?: "default" | "trivy";
	targetPaths?: string[];
};

export type StaticScannerRunInput = {
	scanRunId: string;
	repoPath: string;
	options: Record<string, unknown>;
	timeoutSec?: number;
	scope?: ScanScopePolicy;
	diffContext?: DiffToolExecutionContext;
	onLifecycleEvent: (event: ToolLifecycleEvent) => Promise<void> | void;
};

export type StaticScannerRunner = {
	checkVersion(): Promise<string | null>;
	run(input: StaticScannerRunInput): Promise<CommonToolRunResult>;
};

export type StaticScannerAdapter = {
	readonly manifest: StaticScannerAdapterManifest;
	resolveDiffExecution?(params: {
		scanPaths: readonly string[];
	}): StaticScannerDiffExecution;
	extendProfileOptions?(params: {
		options: Record<string, unknown>;
		activeTechnologyPluginIds: readonly string[];
	}): Promise<Record<string, unknown>> | Record<string, unknown>;
	validateOptions?(options: Record<string, unknown>): Promise<void> | void;
	prepareOptions?(params: {
		options: Record<string, unknown>;
		execution: ToolExecutionConfig;
		provenance: Record<string, unknown>;
	}): Promise<Record<string, unknown>> | Record<string, unknown>;
	createRunner(params: {
		artifactStorage: ArtifactStorage;
		execution: ToolExecutionConfig;
	}): StaticScannerRunner;
	normalize(
		rawJson: unknown,
		options?: { stderr?: string },
	): NormalizedFinding[];
	defaultCommand(options: Record<string, unknown>): string;
};

export function resolveStaticScannerDiffExecution(
	adapter: StaticScannerAdapter,
	scanPaths: readonly string[],
): StaticScannerDiffExecution {
	const execution = adapter.resolveDiffExecution?.({ scanPaths }) ?? {
		inputKind: adapter.manifest.diffInput,
		workspace: adapter.manifest.diffWorkspace,
	};
	if (execution.targetPaths && execution.inputKind !== "full_snapshot") {
		throw new Error(
			`scanner_adapter_diff_target_paths_require_full_snapshot:${adapter.manifest.id}`,
		);
	}
	return {
		...execution,
		workspace: execution.workspace ?? adapter.manifest.diffWorkspace,
		targetPaths: execution.targetPaths ? [...execution.targetPaths] : undefined,
	};
}
