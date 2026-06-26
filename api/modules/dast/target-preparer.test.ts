import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferDastTargetStartPlan } from "./target-preparer";

describe("inferDastTargetStartPlan", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dast-target-plan-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("infers a Bun/Vite dev command with an assigned local port", async () => {
		await fs.writeFile(path.join(tempDir, "bun.lock"), "", "utf8");
		await fs.writeFile(
			path.join(tempDir, "package.json"),
			JSON.stringify({
				scripts: {
					dev: "bunx --bun vite",
					start: "bun run api/app/server.ts",
				},
			}),
			"utf8",
		);

		const plan = await inferDastTargetStartPlan({
			repoPath: tempDir,
			port: 32123,
		});

		expect(plan.packageManager).toBe("bun");
		expect(plan.scriptName).toBe("dev");
		expect(plan.origin).toBe("http://127.0.0.1:32123");
		expect(plan.command).toEqual([
			"bun",
			"run",
			"dev",
			"--",
			"--host",
			"127.0.0.1",
			"--port",
			"32123",
			"--strictPort",
		]);
	});

	it("fails with an actionable message when no start script exists", async () => {
		await fs.writeFile(
			path.join(tempDir, "package.json"),
			JSON.stringify({ scripts: { test: "vitest" } }),
			"utf8",
		);

		await expect(
			inferDastTargetStartPlan({ repoPath: tempDir, port: 32123 }),
		).rejects.toThrow("Could not infer how to start the project");
	});
});
