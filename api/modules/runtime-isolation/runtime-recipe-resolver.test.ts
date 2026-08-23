import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRuntimeTargetRecipe } from "./runtime-recipe-resolver";

describe("resolveRuntimeTargetRecipe", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-recipe-test-"));
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
	});
	afterEach(async () => fs.rm(root, { recursive: true, force: true }));

	const inferTargetPlan = async () => ({
		pluginId: "build.npm",
		repoPath: root,
		scriptName: "start",
		script: "node server.js",
		packageManager: "npm" as const,
		command: ["npm", "run", "start"],
		env: {},
		requiresProjectCodeConsent: false,
		port: 18080,
		origin: "http://127.0.0.1:18080",
		readinessPaths: ["/"],
		warnings: [],
	});

	it("uses an implicit none recipe only when database indicators are absent", async () => {
		const result = await resolveRuntimeTargetRecipe({ projectionPath: root, inferTargetPlan });
		expect(result).toMatchObject({ status: "ready", recipe: { database: { mode: "none" } } });
	});

	it("selects the Bun lock adapter for a Bun start plan", async () => {
		const result = await resolveRuntimeTargetRecipe({
			projectionPath: root,
			inferTargetPlan: async () => ({
				...(await inferTargetPlan()),
				packageManager: "bun" as const,
				command: ["bun", "run", "start"],
			}),
		});
		expect(result).toMatchObject({
			status: "ready",
			recipe: { dependencyAdapterId: "bun-lock-v1" },
		});
	});

	it("requires an explicit recipe for a detected database", async () => {
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { pg: "1.0.0" } }));
		await expect(resolveRuntimeTargetRecipe({ projectionPath: root, inferTargetPlan })).resolves.toEqual({
			status: "blocked",
			reasonCode: "runtime_database_recipe_required",
		});
	});

	it("uses a strict repository recipe without allowing a project command", async () => {
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		await fs.writeFile(
			path.join(root, ".vuln-workbench", "runtime-target.v1.json"),
			JSON.stringify({
				schemaVersion: 1,
				startPlannerId: "build.npm",
				dependencyAdapterId: "npm-package-lock-v1",
				database: { mode: "postgres_ephemeral", environmentBindings: [{ key: "DATABASE_URL", valueKind: "url" }] },
			}),
		);
		const result = await resolveRuntimeTargetRecipe({ projectionPath: root, inferTargetPlan });
		expect(result).toMatchObject({ status: "ready", recipe: { database: { mode: "postgres_ephemeral" } } });
	});

	it("rejects an explicit recipe for a different package manager", async () => {
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		await fs.writeFile(
			path.join(root, ".vuln-workbench", "runtime-target.v1.json"),
			JSON.stringify({
				schemaVersion: 1,
				startPlannerId: "build.npm",
				dependencyAdapterId: "npm-package-lock-v1",
				database: { mode: "none", environmentBindings: [] },
			}),
		);
		await expect(
			resolveRuntimeTargetRecipe({
				projectionPath: root,
				inferTargetPlan: async () => ({
					...(await inferTargetPlan()),
					packageManager: "bun" as const,
					command: ["bun", "run", "start"],
				}),
			}),
		).resolves.toEqual({
			status: "blocked",
			reasonCode: "runtime_dependency_adapter_unqualified",
		});
	});
});
