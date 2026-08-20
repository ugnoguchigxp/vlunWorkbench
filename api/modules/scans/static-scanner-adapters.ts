import { semgrepScannerAdapter } from "../../plugins/scanners/semgrep";
import { BUILTIN_STATIC_SCANNER_ADAPTERS } from "./builtin-static-scanner-adapters";
import { StaticScannerAdapterRegistry } from "./static-scanner-adapter-registry";

/**
 * Semgrep remains an externally installed engine because of its licence, but
 * its adapter is always registered.  A strict profile can therefore identify
 * a missing engine during preflight instead of silently removing the SAST step.
 */
export function createStaticScannerAdapterRegistry(_params?: {
	optionalAdapterIds?: readonly string[];
}): StaticScannerAdapterRegistry {
	const registry = new StaticScannerAdapterRegistry();
	for (const adapter of BUILTIN_STATIC_SCANNER_ADAPTERS) {
		registry.register(adapter);
	}
	registry.register(semgrepScannerAdapter);
	return registry;
}

export const staticScannerAdapterRegistry =
	createStaticScannerAdapterRegistry();
