import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCodexStatus } from "./codex-status";

const roots: string[] = [];

async function createCodexHome(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-test-"));
	roots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) =>
			fs.rm(root, {
				recursive: true,
				force: true,
			}),
		),
	);
});

describe("readCodexStatus", () => {
	it("distinguishes local SDK and CLI readiness from live connectivity", async () => {
		const codexHome = await createCodexHome();
		await fs.writeFile(
			path.join(codexHome, "auth.json"),
			JSON.stringify({ tokens: { access_token: "cached-token" } }),
		);
		await fs.writeFile(
			path.join(codexHome, "models_cache.json"),
			JSON.stringify({ models: [{ slug: "test-codex-model" }] }),
		);

		const status = await readCodexStatus({
			codexHome,
			env: { OPENAI_API_KEY: "environment-key" },
			codexApiKey: "settings-key",
			settingsModels: [" test-settings-model ", ""],
			sdkLoader: async () => ({ Codex: class {} }),
		});

		expect(status).toMatchObject({
			authenticated: true,
			authSource: "settings",
			modelSource: "settings",
			executableAdapterAvailable: true,
			adapterDiagnostics: {
				sdkImportable: true,
				cliBinaryResolved: true,
				processLaunchVerified: false,
				liveConnectionVerified: false,
			},
		});
		expect(status.detectedModels).toContain("test-settings-model");
		expect(status.detectedModels).not.toContain(" test-settings-model ");
		expect(status.detectedModels).toContain("test-codex-model");
	});

	it("reports a missing platform CLI separately from an import failure", async () => {
		const codexHome = await createCodexHome();
		const status = await readCodexStatus({
			codexHome,
			env: { OPENAI_API_KEY: "test-key" },
			sdkLoader: async () => ({
				Codex: class {
					constructor() {
						throw new Error("binary missing");
					}
				},
			}),
		});

		expect(status.executableAdapterAvailable).toBe(false);
		expect(status.adapterDiagnostics).toMatchObject({
			sdkImportable: true,
			cliBinaryResolved: false,
			processLaunchVerified: false,
			liveConnectionVerified: false,
		});
		expect(status.adapterDiagnostics.message).toContain("binary missing");
	});

	it("fails closed when the SDK package cannot be loaded", async () => {
		const codexHome = await createCodexHome();
		const status = await readCodexStatus({
			codexHome,
			env: {},
			sdkLoader: async () => {
				throw new Error("module missing");
			},
		});

		expect(status).toMatchObject({
			authenticated: false,
			authSource: "none",
			executableAdapterAvailable: false,
			adapterDiagnostics: {
				sdkImportable: false,
				cliBinaryResolved: false,
				processLaunchVerified: false,
				liveConnectionVerified: false,
			},
		});
		expect(status.adapterDiagnostics.message).toContain("module missing");
	});

	it("ignores whitespace-only credentials and cached model names", async () => {
		const codexHome = await createCodexHome();
		await fs.writeFile(
			path.join(codexHome, "auth.json"),
			JSON.stringify({ OPENAI_API_KEY: "   " }),
		);
		await fs.writeFile(
			path.join(codexHome, "models_cache.json"),
			JSON.stringify(["  ", " cached-model "]),
		);

		const status = await readCodexStatus({
			codexHome,
			env: { CODEX_API_KEY: "\t" },
			codexApiKey: " ",
			sdkLoader: async () => ({ Codex: class {} }),
		});

		expect(status.authenticated).toBe(false);
		expect(status.authSource).toBe("none");
		expect(status.detectedModels).toContain("cached-model");
		expect(status.detectedModels).not.toContain(" cached-model ");
	});
});
