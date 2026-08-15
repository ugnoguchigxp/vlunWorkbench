import { semgrepScannerAdapter } from "../../plugins/scanners/semgrep";
import { BUILTIN_STATIC_SCANNER_ADAPTERS } from "./builtin-static-scanner-adapters";
import { parseOptionalScannerAdapterIds } from "./optional-scanner-adapter-config";
import { StaticScannerAdapterRegistry } from "./static-scanner-adapter-registry";

const OPTIONAL_ADAPTERS = new Map([["semgrep", semgrepScannerAdapter]]);

export function createStaticScannerAdapterRegistry(params?: {
	optionalAdapterIds?: readonly string[];
}): StaticScannerAdapterRegistry {
	const registry = new StaticScannerAdapterRegistry();
	for (const adapter of BUILTIN_STATIC_SCANNER_ADAPTERS) {
		registry.register(adapter);
	}
	for (const id of params?.optionalAdapterIds ??
		parseOptionalScannerAdapterIds()) {
		const adapter = OPTIONAL_ADAPTERS.get(id);
		if (!adapter) throw new Error(`scanner_adapter_not_available:${id}`);
		registry.register(adapter);
	}
	return registry;
}

export const staticScannerAdapterRegistry =
	createStaticScannerAdapterRegistry();
