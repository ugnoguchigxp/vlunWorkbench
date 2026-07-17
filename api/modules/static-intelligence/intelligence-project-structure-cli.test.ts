import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Project Structure CLI", () => {
	let tempDir: string;
	let projectDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-structure-cli-"));
		projectDir = path.join(tempDir, "project");
		await fs.mkdir(path.join(projectDir, "web", "src"), { recursive: true });
		await fs.writeFile(path.join(projectDir, "web", "src", "main.tsx"), 'import "./styles.css";\nexport const app = true;\n');
		await fs.writeFile(path.join(projectDir, "web", "src", "styles.css"), ".app { color: red; }\n");
		await fs.writeFile(path.join(projectDir, ".env"), "TOKEN=secret\n");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns a v2 snapshot and resolves CSS without exposing the root", () => {
		const result = runCli(["--project-path", projectDir, "--project-id", "p1"]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({ ok: true, status: "completed", version: "v2" });
		expect(payload.snapshot.project.id).toBe("p1");
		expect(payload.snapshot.project.rootPath).toBeUndefined();
		expect(payload.snapshot.inventory.entries.map((entry: { path: string }) => entry.path)).toEqual(["web/src/main.tsx", "web/src/styles.css"]);
		expect(payload.snapshot.references).toEqual(expect.arrayContaining([
			expect.objectContaining({ specifier: "./styles.css", status: "resolved", target: "web/src/styles.css" }),
		]));
		expect(result.stdout).not.toContain(projectDir);
		expect(result.stdout).not.toContain("TOKEN=secret");
	});

	it("returns failure JSON for invalid input", () => {
		const result = runCli(["--project-path", path.join(tempDir, "missing")]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: "failed" });
	});

	function runCli(args: string[]) {
		return spawnSync(process.execPath, ["api/cli/intelligence-project-structure.ts", ...args], {
			cwd: process.cwd(),
			env: { ...process.env },
			encoding: "utf8",
		});
	}
});
