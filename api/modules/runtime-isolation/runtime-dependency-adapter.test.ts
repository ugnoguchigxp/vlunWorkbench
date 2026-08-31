import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateAndDigestRuntimeDependencyLock } from "./runtime-dependency-adapter";

const integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;

describe("runtime dependency adapters", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "bun-lock-adapter-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("accepts the bounded Bun v1 JSONC registry format", async () => {
		await writeLock(`{
			// Bun text locks permit comments and trailing commas.
			"lockfileVersion": 1,
			"workspaces": {
				"": { "dependencies": { "example": "1.0.0", }, }, // comment after a trailing comma
			},
			"packages": {
				"example": ["example@1.0.0", "", {}, "${integrity}",],
				"example/@scope/nested": ["@scope/nested@2.0.0", "", { "bundled": true }, "${integrity}",],
			},
		}`);

		await expect(validate()).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("accepts an npm v3 lock with canonical SHA-512 integrity", async () => {
		await fs.writeFile(
			path.join(root, "package-lock.json"),
			JSON.stringify({
				lockfileVersion: 3,
				packages: {
					"": { name: "fixture" },
					"node_modules/example": {
						resolved:
							"https://registry.npmjs.org/example/-/example-1.0.0.tgz",
						integrity,
					},
				},
			}),
		);

		await expect(
			validateAndDigestRuntimeDependencyLock({
				root,
				adapterId: "npm-package-lock-v1",
			}),
		).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it.each([
		["a missing package map", undefined],
		[
			"non-canonical integrity",
			{
				"node_modules/example": {
					resolved:
						"https://registry.npmjs.org/example/-/example-1.0.0.tgz",
					integrity: `${integrity.slice(0, -3)}B==`,
				},
			},
		],
	])("rejects npm locks with %s", async (_label, packages) => {
		await fs.writeFile(
			path.join(root, "package-lock.json"),
			JSON.stringify({ lockfileVersion: 3, packages }),
		);

		await expect(
			validateAndDigestRuntimeDependencyLock({
				root,
				adapterId: "npm-package-lock-v1",
			}),
		).resolves.toBeNull();
	});

	it.each([
		["git resolution", ["example@git+https://evil.example/repo", {}, "tag"]],
		["remote tarball", ["example@https://evil.example/a.tgz", {}]],
		["custom registry", ["example@1.0.0", "https://evil.example", {}, integrity]],
		["missing integrity", ["example@1.0.0", "", {}]],
		["non-canonical integrity", ["example@1.0.0", "", {}, `${integrity.slice(0, -3)}B==`]],
	])("rejects %s packages", async (_label, packageEntry) => {
		await writeLock(
			JSON.stringify({
				lockfileVersion: 1,
				workspaces: { "": { dependencies: { example: "1.0.0" } } },
				packages: { example: packageEntry },
			}),
		);

		await expect(validate()).resolves.toBeNull();
	});

	it.each([
		["traversing package key", "../example", ["example@1.0.0", "", {}, integrity]],
		["traversing resolution", "example", ["../example@1.0.0", "", {}, integrity]],
	])("rejects %s", async (_label, packageKey, packageEntry) => {
		await writeLock(
			JSON.stringify({
				lockfileVersion: 1,
				workspaces: { "": {} },
				packages: { [packageKey]: packageEntry },
			}),
		);

		await expect(validate()).resolves.toBeNull();
	});

	it("accepts an empty dependency graph", async () => {
		await writeLock(
			JSON.stringify({
				lockfileVersion: 1,
				workspaces: { "": {} },
				packages: {},
			}),
		);

		await expect(validate()).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("rejects trusted dependency scripts and multi-workspace locks", async () => {
		await writeLock(
			JSON.stringify({
				lockfileVersion: 1,
				trustedDependencies: ["example"],
				workspaces: { "": {}, "packages/app": {} },
				packages: {
					example: ["example@1.0.0", "", {}, integrity],
				},
			}),
		);

		await expect(validate()).resolves.toBeNull();
	});

	it.each([
		["unknown top-level fields", { futureInstallerHook: "enabled" }],
		["malformed trusted dependencies", { trustedDependencies: "example" }],
		["malformed patched dependencies", { patchedDependencies: [] }],
	])("rejects %s", async (_label, extra) => {
		await writeLock(
			JSON.stringify({
				lockfileVersion: 1,
				workspaces: { "": {} },
				packages: {},
				...extra,
			}),
		);

		await expect(validate()).resolves.toBeNull();
	});

	it("rejects unknown root-workspace installer fields", async () => {
		await writeLock(
			JSON.stringify({
				lockfileVersion: 1,
				workspaces: { "": { futureInstallerHook: "enabled" } },
				packages: {},
			}),
		);

		await expect(validate()).resolves.toBeNull();
	});

	async function writeLock(contents: string): Promise<void> {
		await fs.writeFile(path.join(root, "bun.lock"), contents);
	}

	async function validate(): Promise<string | null> {
		return await validateAndDigestRuntimeDependencyLock({
			root,
			adapterId: "bun-lock-v1",
		});
	}
});
