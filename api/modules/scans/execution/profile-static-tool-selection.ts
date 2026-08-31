import type { ArtifactStorage } from "./lifecycle/artifact-storage";
import type { StaticScannerAdapterRegistry } from "../static-scanner-adapter-registry";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";

export function selectStaticTool(params: {
	toolId: string;
	artifactStorage: ArtifactStorage;
	execution: ToolExecutionConfig;
	options: Record<string, unknown>;
	registry?: StaticScannerAdapterRegistry;
}) {
	const adapter = (params.registry ?? staticScannerAdapterRegistry).require(
		params.toolId,
	);
	return {
		runner: adapter.createRunner({
			artifactStorage: params.artifactStorage,
			execution: params.execution,
		}),
		normalizer: adapter.normalize,
		toolName: adapter.manifest.id,
		defaultCommand: adapter.defaultCommand(params.options),
		adapter,
	};
}
