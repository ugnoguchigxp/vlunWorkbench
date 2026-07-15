import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCodeStructureSnapshot } from "./extractor";

const GENERATED_AT = new Date("2026-07-06T12:00:00.000Z");
const SECRET_MARKER = "SECRET_SOURCE_LITERAL_SHOULD_NOT_LEAK";

describe("Code Structure extractor", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-structure-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("discovers supported source files and excludes ignored or secret paths", async () => {
		await writeProjectFile("src/app.ts", "export const app = true;\n");
		await writeProjectFile("src/view.tsx", "export function View() { return null; }\n");
		await writeProjectFile("node_modules/pkg/index.ts", "export const leak = true;\n");
		await writeProjectFile("dist/out.js", "export const leak = true;\n");
		await writeProjectFile(".git/hooks/pre-commit.js", "export const leak = true;\n");
		await writeProjectFile(".env.ts", "export const leak = true;\n");
		await writeProjectFile("private.key", "secret\n");

		const snapshot = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});

		expect(snapshot.status).toBe("completed");
		expect(snapshot.files.map((file) => file.path)).toEqual([
			"src/app.ts",
			"src/view.tsx",
		]);
		expect(snapshot.project.rootPath).toBeUndefined();
		expect(snapshot.project.rootPathIncluded).toBe(false);
	});

	it("includes root path only when explicitly requested", async () => {
		await writeProjectFile("src/app.ts", "export const app = true;\n");

		const snapshot = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
			includeRootPath: true,
		});

		expect(snapshot.project.rootPath).toBe(await fs.realpath(tempDir));
		expect(snapshot.project.rootPathIncluded).toBe(true);
	});

	it("does not follow symlinks outside the project root", async () => {
		const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "outside-src-"));
		try {
			await fs.writeFile(path.join(outsideDir, "secret.ts"), "export const secret = true;\n");
			await fs.symlink(
				path.join(outsideDir, "secret.ts"),
				path.join(tempDir, "linked.ts"),
			);

			const snapshot = await buildCodeStructureSnapshot({
				projectPath: tempDir,
				generatedAt: GENERATED_AT,
			});

			expect(snapshot.files).toEqual([]);
			expect(snapshot.status).toBe("partial");
			expect(snapshot.degradedReasons).toContain(
				"skipped file outside project root: linked.ts",
			);
		} finally {
			await fs.rm(outsideDir, { recursive: true, force: true });
		}
	});

	it("extracts imports, exports, package dependencies, tags, and edges", async () => {
		await writeProjectFile(
			"src/routes/index.ts",
			[
				'import { Hono } from "hono";',
				'import { z } from "zod";',
				'import { helper } from "../lib";',
				'import("@scope/pkg/runtime");',
				`const secret = "${SECRET_MARKER}";`,
				"export function routeHandler() { return helper(z.string()); }",
			].join("\n"),
		);
		await writeProjectFile(
			"src/lib/index.ts",
			[
				'const path = require("node:path");',
				"module.exports = {};",
				"export const helper = (value: unknown) => value;",
			].join("\n"),
		);
		await writeProjectFile("workers/task-runner.ts", "export class TaskRunner {}\n");
		await writeProjectFile("src/app.test.ts", "export const testValue = true;\n");
		await writeProjectFile("vite.config.ts", "export default {};\n");

		const snapshot = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			projectId: "project-1",
			generatedAt: GENERATED_AT,
		});
		const routeFile = snapshot.files.find(
			(file) => file.path === "src/routes/index.ts",
		);
		const libFile = snapshot.files.find((file) => file.path === "src/lib/index.ts");

		expect(snapshot.project.id).toBe("project-1");
		expect(routeFile?.tags).toEqual(["route", "handler", "schema", "source"]);
		expect(routeFile?.imports).toEqual([
			"../lib",
			"@scope/pkg/runtime",
			"hono",
			"zod",
		]);
		expect(routeFile?.packageImports).toEqual(["@scope/pkg", "hono", "zod"]);
		expect(routeFile?.exportedSymbols).toContain("routeHandler");
		expect(routeFile?.identifiers).toEqual(
			expect.arrayContaining(["routeHandler", "secret"]),
		);
		expect(libFile?.moduleKind).toBe("mixed");
		expect(snapshot.edges).toEqual(
			expect.arrayContaining([
				{
					from: "src/routes/index.ts",
					to: "src/lib/index.ts",
					kind: "imports",
					confidence: 0.9,
				},
				{
					from: "src/routes/index.ts",
					to: "@scope/pkg",
					kind: "depends_on_package",
					confidence: 0.8,
				},
			]),
		);
		expect(snapshot.packages.find((item) => item.name === "hono")).toEqual({
			name: "hono",
			importedBy: ["src/routes/index.ts"],
		});
		expect(snapshot.summary).toMatchObject({
			fileCount: 5,
			importEdgeCount: 1,
			packageDependencyCount: 4,
			routeFileCount: 1,
			handlerFileCount: 1,
			schemaFileCount: 1,
			workerFileCount: 1,
			testFileCount: 1,
			configFileCount: 1,
		});
		expect(JSON.stringify(snapshot)).not.toContain(SECRET_MARKER);
	});

	it("indexes declaration and property identifiers without retaining literal values", async () => {
		await writeProjectFile(
			"src/review.ts",
			[
				"interface ReviewResult { remediation?: string; suppressions: string[] }",
				"const internalValidationState = { remediation: 'safe', suppressions: [] };",
				`const literalValue = "${SECRET_MARKER}";`,
				`const literalKey = { "${SECRET_MARKER}": true };`,
			].join("\n"),
		);

		const snapshot = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});

		expect(snapshot.files[0].identifiers).toEqual(
			expect.arrayContaining([
				"ReviewResult",
				"internalValidationState",
				"literalKey",
				"literalValue",
				"remediation",
				"suppressions",
			]),
		);
		expect(snapshot.files[0].identifiers).not.toContain(SECRET_MARKER);
		expect(JSON.stringify(snapshot)).not.toContain(SECRET_MARKER);
	});

	it("extracts default exports, import-equals require, and CommonJS named exports", async () => {
		await writeProjectFile(
			"src/common.ts",
			[
				'import legacy = require("legacy-package");',
				"export default function NamedDefault() { return legacy; }",
				"exports.namedHandler = () => true;",
				"module.exports.extra = true;",
			].join("\n"),
		);

		const snapshot = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});
		const file = snapshot.files[0];

		expect(file.moduleKind).toBe("mixed");
		expect(file.imports).toEqual(["legacy-package"]);
		expect(file.packageImports).toEqual(["legacy-package"]);
		expect(file.exportedSymbols).toEqual(
			expect.arrayContaining([
				"NamedDefault",
				"default",
				"extra",
				"namedHandler",
			]),
		);
		expect(file.exportedSymbols).toHaveLength(4);
		expect(file.tags).toEqual(["handler", "source"]);
	});

	it("returns partial output for parser diagnostics and max file limits", async () => {
		await writeProjectFile("a.ts", 'import "./missing";\nexport function broken( {\n');
		await writeProjectFile("b.ts", "export const b = true;\n");

		const snapshot = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
			maxFiles: 1,
		});

		expect(snapshot.status).toBe("partial");
		expect(snapshot.files).toHaveLength(1);
		expect(snapshot.files[0].parseStatus).toBe("degraded");
		expect(snapshot.degradedReasons.join("\n")).toContain("max file limit reached");
		expect(snapshot.degradedReasons.join("\n")).toContain(
			"typescript parser reported syntax diagnostics",
		);
	});

	it("returns partial output when a directory cannot be traversed", async () => {
		await writeProjectFile("src/app.ts", "export const app = true;\n");
		const blockedDir = path.join(tempDir, "blocked");
		await fs.mkdir(blockedDir);
		await fs.chmod(blockedDir, 0);

		try {
			const snapshot = await buildCodeStructureSnapshot({
				projectPath: tempDir,
				generatedAt: GENERATED_AT,
			});

			expect(snapshot.status).toBe("partial");
			expect(snapshot.files.map((file) => file.path)).toEqual(["src/app.ts"]);
			expect(snapshot.degradedReasons.join("\n")).toContain(
				"failed to read directory: blocked",
			);
		} finally {
			await fs.chmod(blockedDir, 0o700).catch(() => undefined);
		}
	});

	it("is deterministic when generatedAt is fixed and content hashes change with bytes", async () => {
		await writeProjectFile("src/app.ts", "export const value = 1;\n");
		const first = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});
		const second = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});
		expect(first).toEqual(second);

		await writeProjectFile("src/app.ts", "export const value = 2;\n");
		const changed = await buildCodeStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});
		expect(changed.files[0].contentHash).not.toBe(first.files[0].contentHash);
	});

	it("rejects a missing project path", async () => {
		await expect(
			buildCodeStructureSnapshot({
				projectPath: path.join(tempDir, "missing"),
				generatedAt: GENERATED_AT,
			}),
		).rejects.toThrow("Project path not found");
	});

	async function writeProjectFile(relativePath: string, content: string) {
		const absolutePath = path.join(tempDir, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content, "utf8");
	}
});
