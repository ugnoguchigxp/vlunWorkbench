import { resolveScannerProvenance } from "./tools/scanner-provenance";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";

export async function prepareToolProvenance(params: {
	toolId: string;
	execution: ToolExecutionConfig;
	options: Record<string, unknown>;
}) {
	const options = { ...params.options };
	const provenance = await resolveScannerProvenance({
		toolId: params.toolId,
		execution: params.execution,
		config: typeof options.config === "string" ? options.config : undefined,
	});
	if (
		params.toolId === "semgrep" &&
		(options.config === undefined ||
			options.config === "owned" ||
			options.config === "curated-sast-v1")
	) {
		options.config =
			params.execution.runner === "docker"
				? provenance.runtimePath
				: new URL(
						"../../../docker/toolbox/scanner-data/semgrep-rules",
						import.meta.url,
					).pathname;
	}
	return { options, provenance };
}
