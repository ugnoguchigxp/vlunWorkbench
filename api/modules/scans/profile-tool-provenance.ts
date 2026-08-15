import type { StaticScannerAdapter } from "./static-scanner-adapter";
import {
	resolveScannerProvenance,
	ScannerProvenanceError,
} from "./tools/scanner-provenance";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";

export async function prepareToolProvenance(params: {
	toolId: string;
	execution: ToolExecutionConfig;
	options: Record<string, unknown>;
	adapter: StaticScannerAdapter;
}) {
	let options = { ...params.options };
	let provenance: Record<string, unknown>;
	try {
		provenance = await resolveScannerProvenance({
			toolId: params.toolId,
			execution: params.execution,
			config: typeof options.config === "string" ? options.config : undefined,
		});
	} catch (error) {
		if (
			params.adapter.manifest.distribution !== "optional" ||
			!(error instanceof ScannerProvenanceError) ||
			error.reason !== "entry_missing"
		) {
			throw error;
		}
		provenance = {
			manifestVersion: null,
			manifestHash: null,
			dataState: "external",
			dataDigest: null,
			runtimePath: null,
			reproducible: false,
			configSource: "optional-external-adapter",
			upstreamLicense: params.adapter.manifest.upstreamLicense,
		};
	}
	if (params.adapter.prepareOptions) {
		options = await params.adapter.prepareOptions({
			options,
			execution: params.execution,
			provenance,
		});
	}
	return { options, provenance };
}
