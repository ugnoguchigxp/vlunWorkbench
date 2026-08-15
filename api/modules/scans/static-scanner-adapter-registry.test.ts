import { describe, expect, it } from "vitest";
import { ArtifactStorage } from "./artifact-storage";
import { prepareToolProvenance } from "./profile-tool-provenance";
import { selectStaticTool } from "./profile-static-tool-selection";
import {
	resolveStaticScannerDiffExecution,
	type StaticScannerAdapter,
} from "./static-scanner-adapter";
import { StaticScannerAdapterRegistry } from "./static-scanner-adapter-registry";
import { createStaticScannerAdapterRegistry } from "./static-scanner-adapters";

function testAdapter(params: {
	id: string;
	distribution: "core" | "optional";
	license: string;
	binaryName?: string;
}): StaticScannerAdapter {
	return {
		manifest: {
			id: params.id,
			displayName: "Test scanner",
			binaryName: params.binaryName ?? params.id,
			upstreamLicense: params.license,
			distribution: params.distribution,
			dockerAllowedFirstArgs: ["scan"],
			diffInput: "changed_workspace",
		} as unknown as StaticScannerAdapter["manifest"],
		createRunner: () => ({
			checkVersion: async () => "1.0.0",
			run: async () => ({
				ok: true,
				exitCode: 0,
				stdout: "",
				stderr: "",
				elapsedMs: 1,
				rawJson: { results: [] },
			}),
		}),
		normalize: () => [],
		defaultCommand: () => `${params.id} scan`,
	};
}

describe("StaticScannerAdapterRegistry", () => {
	it("keeps non-MIT/Apache adapters out of the core registry", () => {
		const registry = createStaticScannerAdapterRegistry({
			optionalAdapterIds: [],
		});

		expect(registry.list().map((adapter) => adapter.manifest.id)).toEqual([
			"gitleaks",
			"osv",
			"trivy",
		]);
		expect(registry.has("semgrep")).toBe(false);
		expect(() =>
			new StaticScannerAdapterRegistry().register(
				testAdapter({
					id: "lgpl-core",
					distribution: "core",
					license: "LGPL-2.1-or-later",
				}),
			),
		).toThrow("scanner_adapter_core_license_rejected");
	});

	it("registers Semgrep only through the optional adapter path", () => {
		const registry = createStaticScannerAdapterRegistry({
			optionalAdapterIds: ["semgrep"],
		});

		expect(registry.require("semgrep").manifest).toMatchObject({
			distribution: "optional",
			upstreamLicense: "LGPL-2.1-or-later",
		});
		expect(Object.isFrozen(registry.require("semgrep"))).toBe(true);
		expect(Object.isFrozen(registry.require("semgrep").manifest)).toBe(true);
	});

	it("preserves Semgrep diff targeting and technology rule contributions", async () => {
		const adapter = createStaticScannerAdapterRegistry({
			optionalAdapterIds: ["semgrep"],
		}).require("semgrep");

		expect(
			resolveStaticScannerDiffExecution(adapter, ["src/app.ts"]),
		).toEqual({
			inputKind: "full_snapshot",
			targetPaths: ["src/app.ts"],
			workspace: undefined,
		});
		expect(
			resolveStaticScannerDiffExecution(
				adapter,
				Array.from({ length: 513 }, (_, index) => `src/file-${index}.ts`),
			),
		).toEqual({
			inputKind: "changed_workspace",
			targetPaths: undefined,
			workspace: undefined,
		});

		const options = await adapter.extendProfileOptions?.({
			options: { config: "curated-sast-v1" },
			activeTechnologyPluginIds: ["language.typescript"],
		});
		expect(options?.semgrepRuleContributions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					pluginId: "language.typescript",
					path: "typescript/owned-core.yml",
				}),
			]),
		);
		expect(() =>
			adapter.prepareOptions?.({
				options: { config: "owned" },
				execution: { runner: "docker" },
				provenance: { runtimePath: null },
			}),
		).toThrow("scanner_adapter_runtime_config_missing:semgrep");
	});

	it("runs a newly registered adapter without changing the core selector", async () => {
		const registry = new StaticScannerAdapterRegistry().register(
			testAdapter({
				id: "custom-sast",
				distribution: "optional",
				license: "Proprietary",
			}),
		);
		const selected = selectStaticTool({
			toolId: "custom-sast",
			artifactStorage: new ArtifactStorage(),
			execution: { runner: "host" },
			options: {},
			registry,
		});

		expect(selected.defaultCommand).toBe("custom-sast scan");
		await expect(
			selected.runner.run({
				scanRunId: "scan-test",
				repoPath: process.cwd(),
				options: {},
				onLifecycleEvent: () => {},
			}),
		).resolves.toMatchObject({ ok: true, exitCode: 0 });
	});

	it("records external provenance for optional adapters without bundled data", async () => {
		const adapter = testAdapter({
			id: "external-sast",
			distribution: "optional",
			license: "Proprietary",
		});

		await expect(
			prepareToolProvenance({
				toolId: "external-sast",
				execution: { runner: "host" },
				options: {},
				adapter,
			}),
		).resolves.toMatchObject({
			provenance: {
				dataState: "external",
				reproducible: false,
				upstreamLicense: "Proprietary",
			},
		});
	});

	it("rejects an adapter that broadens another binary invocation policy", () => {
		const adapter = testAdapter({
			id: "gitleaks-wrapper",
			distribution: "optional",
			license: "Proprietary",
			binaryName: "gitleaks",
		});

		expect(() =>
			new StaticScannerAdapterRegistry().register(adapter),
		).toThrow("Conflicting Docker scanner invocation policy: gitleaks");
	});
});
