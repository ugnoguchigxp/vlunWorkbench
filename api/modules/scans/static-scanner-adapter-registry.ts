import {
	CORE_SCANNER_LICENSES,
	type StaticScannerAdapter,
} from "./static-scanner-adapter";
import { registerDockerToolInvocationPolicy } from "./tools/docker-tool-process-runner";

const CORE_LICENSE_SET = new Set<string>(CORE_SCANNER_LICENSES);

export class StaticScannerAdapterRegistry {
	private readonly adapters = new Map<string, StaticScannerAdapter>();

	register(adapter: StaticScannerAdapter): this {
		const { manifest } = adapter;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
			throw new Error(`scanner_adapter_id_invalid:${manifest.id}`);
		}
		if (this.adapters.has(manifest.id)) {
			throw new Error(`scanner_adapter_duplicate:${manifest.id}`);
		}
		if (
			manifest.distribution === "core" &&
			!CORE_LICENSE_SET.has(manifest.upstreamLicense)
		) {
			throw new Error(
				`scanner_adapter_core_license_rejected:${manifest.id}:${manifest.upstreamLicense}`,
			);
		}
		registerDockerToolInvocationPolicy(
			manifest.binaryName,
			manifest.dockerAllowedFirstArgs,
		);
		const registeredAdapter = Object.freeze({
			...adapter,
			manifest: Object.freeze({
				...manifest,
				dockerAllowedFirstArgs: Object.freeze([
					...manifest.dockerAllowedFirstArgs,
				]),
			}),
		});
		this.adapters.set(manifest.id, registeredAdapter);
		return this;
	}

	get(id: string): StaticScannerAdapter | undefined {
		return this.adapters.get(id);
	}

	require(id: string): StaticScannerAdapter {
		const adapter = this.get(id);
		if (!adapter) throw new Error(`Unsupported tool ID: ${id}`);
		return adapter;
	}

	has(id: string): boolean {
		return this.adapters.has(id);
	}

	list(): StaticScannerAdapter[] {
		return [...this.adapters.values()];
	}
}
