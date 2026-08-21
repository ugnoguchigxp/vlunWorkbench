import type { StaticScannerAdapter } from "../static-scanner-adapter";
import {
	resolveScannerProvenance,
	ScannerProvenanceError,
} from "../tools/scanner-provenance";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";

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

/**
 * A manifest describes the intended scanner identity; a tool-run proves what
 * actually executed.  Never retain a reproducible=true claim once those two
 * identities disagree (or the runtime identity could not be observed).
 */
export function bindObservedToolProvenance(
	provenance: Record<string, unknown>,
	observedVersion: string | null,
): Record<string, unknown> {
	const expectedVersion = readString(provenance.toolVersion);
	const expected = normalizedVersion(expectedVersion);
	const observed = normalizedVersion(observedVersion);
	const compatibility =
		expected === null || observed === null
			? "unverified"
			: expected === observed
				? "compatible"
				: "mismatch";
	return {
		...provenance,
		expectedVersion,
		observedVersion,
		identityCompatibility: compatibility,
		reproducible:
			provenance.reproducible === true && compatibility === "compatible",
	};
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedVersion(value: string | null): string | null {
	if (!value) return null;
	// biome-ignore lint/complexity/useRegexLiterals: a raw string avoids a control-character regex literal.
	const ansiEscape = new RegExp(String.raw`\x1b\[[0-?]*[ -/]*[@-~]`, "g");
	const plain = value.replace(ansiEscape, " ");
	return (
		plain.match(
			/(?:^|[^0-9a-z])v?(\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.-]+)?)(?![0-9a-z.])/i,
		)?.[1] ?? null
	);
}
