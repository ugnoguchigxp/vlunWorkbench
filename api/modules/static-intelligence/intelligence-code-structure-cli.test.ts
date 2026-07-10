import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SECRET_MARKER = "SECRET_CLI_SOURCE_SHOULD_NOT_LEAK";

describe("Code Structure CLI", () => {
	let tempDir: string;
	let projectDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-structure-cli-"));
		projectDir = path.join(tempDir, "project");
		await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			[
				'import { helper } from "./helper";',
				`const secret = "${SECRET_MARKER}";`,
				"export const app = helper;",
			].join("\n"),
			"utf8",
		);
		await fs.writeFile(
			path.join(projectDir, "src", "helper.ts"),
			"export const helper = true;\n",
			"utf8",
		);
		await fs.writeFile(path.join(projectDir, ".env"), "TOKEN=secret\n", "utf8");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns snapshot JSON with exit code 0", () => {
		const result = runCli(["--project-path", projectDir, "--project-id", "p1"]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout.trim().startsWith("{")).toBe(true);
		expect(result.stdout.trim().endsWith("}")).toBe(true);
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			version: "v1",
		});
		expect(payload.snapshot.project.id).toBe("p1");
		expect(payload.snapshot.project.rootPath).toBeUndefined();
		expect(payload.snapshot.files.map((file: { path: string }) => file.path)).toEqual([
			"src/app.ts",
			"src/helper.ts",
		]);
		expect(result.stdout).not.toContain(projectDir);
		expect(result.stdout).not.toContain(SECRET_MARKER);
		expect(result.stdout).not.toContain("TOKEN=secret");
	});

	it("writes snapshot only to output file", async () => {
		const outputPath = path.join(tempDir, "snapshot.json");
		const result = runCli([
			"--project-path",
			projectDir,
			"--output",
			outputPath,
			"--pretty",
			"true",
		]);

		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.output.path).toBe(outputPath);
		expect(payload.output.sha256).toMatch(/^[a-f0-9]{64}$/);
		const filePayload = JSON.parse(await fs.readFile(outputPath, "utf8"));
		expect(filePayload.version).toBe("v1");
		expect(filePayload.files).toBeDefined();
		expect(filePayload.snapshot).toBeUndefined();
	});

	it("returns exit code 2 for invalid arguments", () => {
		const missingProject = runCli(["--project-path", path.join(tempDir, "missing")]);
		expect(missingProject.status).toBe(2);
		expect(JSON.parse(missingProject.stdout).message).toContain(
			"Project path not found",
		);

		const invalidBoolean = runCli([
			"--project-path",
			projectDir,
			"--include-root-path",
			"maybe",
		]);
		expect(invalidBoolean.status).toBe(2);
		expect(JSON.parse(invalidBoolean.stdout).message).toContain(
			"--include-root-path must be true or false",
		);

		const incompatiblePersistedOption = runCli([
			"--scan-run-id",
			"scan-1",
			"--max-files",
			"10",
		]);
		expect(incompatiblePersistedOption.status).toBe(2);
		expect(JSON.parse(incompatiblePersistedOption.stdout).message).toContain(
			"only valid with --project-path",
		);
	});

	it("includes root path only when requested", async () => {
		const result = runCli([
			"--project-path",
			projectDir,
			"--include-root-path",
			"true",
		]);

		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.snapshot.project.rootPath).toBe(await fs.realpath(projectDir));
		expect(payload.snapshot.project.rootPathIncluded).toBe(true);
	});

	it("produces stable snapshots except generatedAt", () => {
		const first = JSON.parse(runCli(["--project-path", projectDir]).stdout);
		const second = JSON.parse(runCli(["--project-path", projectDir]).stdout);
		first.generatedAt = "<generatedAt>";
		second.generatedAt = "<generatedAt>";
		first.snapshot.generatedAt = "<generatedAt>";
		second.snapshot.generatedAt = "<generatedAt>";

		expect(first).toEqual(second);
	});

	function runCli(args: string[]) {
		return spawnSync(
			process.execPath,
			["api/cli/intelligence-code-structure.ts", ...args],
			{
				cwd: process.cwd(),
				env: { ...process.env },
				encoding: "utf8",
			},
		);
	}
});
