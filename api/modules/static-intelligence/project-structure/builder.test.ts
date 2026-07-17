import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProjectStructureSnapshot } from "./builder";

const GENERATED_AT = new Date("2026-07-16T03:00:00.000Z");

describe("Project Structure Scanner v2", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-structure-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("resolves existing stylesheet and resource imports without degrading structure", async () => {
		await writeProjectFile(
			"feature/ui/main.tsx",
			[
				'import "./screen.css";',
				'import logo from "./logo.svg";',
				"export const screen = logo;",
			].join("\n"),
		);
		await writeProjectFile(
			"feature/ui/screen.css",
			'@import "./theme.css";\n.icon { background-image: url("./logo.svg"); }\n',
		);
		await writeProjectFile("feature/ui/theme.css", ":root { color: teal; }\n");
		await writeProjectFile("feature/ui/logo.svg", "<svg></svg>\n");
		await writeProjectFile(
			"feature/ui/index.html",
			'<link rel="stylesheet" href="./screen.css"><script type="module" src="./main.tsx"></script>',
		);

		const snapshot = await buildProjectStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});

		expect(snapshot.status).toBe("completed");
		expect(snapshot.readiness.inventory.status).toBe("available");
		expect(snapshot.readiness.analysis.status).toBe("available");
		expect(snapshot.readiness.resolution.status).toBe("available");
		expect(snapshot.references).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: "feature/ui/main.tsx",
					specifier: "./screen.css",
					kind: "stylesheet",
					status: "resolved",
					target: "feature/ui/screen.css",
				}),
				expect.objectContaining({
					from: "feature/ui/main.tsx",
					specifier: "./logo.svg",
					kind: "asset",
					status: "resolved_unparsed",
					target: "feature/ui/logo.svg",
				}),
				expect.objectContaining({
					from: "feature/ui/screen.css",
					specifier: "./theme.css",
					kind: "stylesheet",
					status: "resolved",
				}),
			]),
		);
	});

	it("isolates a missing local target to resolution readiness", async () => {
		await writeProjectFile(
			"arbitrary-layout/entry.ts",
			'import "./missing.css";\nexport const entry = true;\n',
		);

		const snapshot = await buildProjectStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});

		expect(snapshot.status).toBe("partial");
		expect(snapshot.readiness.analysis.status).toBe("available");
		expect(snapshot.readiness.resolution).toEqual({
			status: "degraded",
			reasonCodes: ["resolution_target_missing"],
		});
		expect(snapshot.references).toEqual([
			expect.objectContaining({
				from: "arbitrary-layout/entry.ts",
				specifier: "./missing.css",
				status: "unresolved",
			}),
		]);
	});

	it("keeps nested source directories named artifacts while excluding secret runtime files", async () => {
		await writeProjectFile(
			"api/modules/artifacts/extract.ts",
			"export const extract = true;\n",
		);
		await writeProjectFile("vuln-workbench.sqlite", "not a database\n");
		await writeProjectFile(".env.local", "SECRET_SHOULD_NOT_BE_PERSISTED\n");

		const snapshot = await buildProjectStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});

		expect(snapshot.inventory.entries.map((entry) => entry.path)).toEqual([
			"api/modules/artifacts/extract.ts",
		]);
		expect(JSON.stringify(snapshot)).not.toContain("SECRET_SHOULD_NOT_BE_PERSISTED");
		expect(snapshot.inventory.coverage.excludedByReason).toEqual({
			secret_or_runtime_file: 2,
		});
	});

	it("resolves TypeScript files whose basename contains a dot and excluded dependency CSS", async () => {
		await writeProjectFile(
			"api/main.ts",
			'import "../shared/failure.schema";\nimport "../node_modules/example/dist/bundle.css";\n',
		);
		await writeProjectFile(
			"shared/failure.schema.ts",
			"export const failure = true;\n",
		);

		const snapshot = await buildProjectStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
		});

		expect(snapshot.readiness.resolution.status).toBe("available");
		expect(snapshot.references).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					specifier: "../shared/failure.schema",
					status: "resolved",
					target: "shared/failure.schema.ts",
				}),
				expect.objectContaining({
					specifier: "../node_modules/example/dist/bundle.css",
					status: "external",
					resolverId: "excluded-dependency",
				}),
			]),
		);
	});

	it("resolves static tsconfig paths and workspace package entrypoints", async () => {
		await writeProjectFile(
			"config/tsconfig.base.json",
			JSON.stringify({ compilerOptions: { baseUrl: "..", paths: { "@core/*": ["shared/*"] } } }),
		);
		await writeProjectFile("tsconfig.json", JSON.stringify({ extends: "./config/tsconfig.base.json" }));
		await writeProjectFile("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
		await writeProjectFile(
			"apps/web/main.ts",
			'import { value } from "@core/value";\nimport { packageValue } from "@workspace/package";\nexport { value, packageValue };\n',
		);
		await writeProjectFile("shared/value.ts", "export const value = true;\n");
		await writeProjectFile("packages/package/package.json", JSON.stringify({ name: "@workspace/package", main: "./src/index.ts" }));
		await writeProjectFile("packages/package/src/index.ts", "export const packageValue = true;\n");

		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.readiness.resolution.status).toBe("available");
		expect(snapshot.references).toEqual(expect.arrayContaining([
			expect.objectContaining({ specifier: "@core/value", resolverId: "tsconfig-paths", status: "resolved", target: "shared/value.ts" }),
			expect.objectContaining({ specifier: "@workspace/package", kind: "workspace_package", resolverId: "workspace-package", status: "resolved", target: "packages/package/src/index.ts" }),
		]));
	});

	it("honors project-local ignore patterns without exposing ignored paths", async () => {
		await writeProjectFile(".vulnworkbenchignore", "generated/**\n# comments are ignored\n");
		await writeProjectFile("generated/private.ts", "export const privateValue = true;\n");
		await writeProjectFile("kept/app.ts", "export const app = true;\n");
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.inventory.entries.map((entry) => entry.path)).not.toContain("generated/private.ts");
		expect(snapshot.inventory.coverage.excludedByReason).toMatchObject({ project_ignore: 1 });
		expect(JSON.stringify(snapshot)).not.toContain("generated/private.ts");
	});

	it("uses Git tracked and untracked non-ignored files as the canonical inventory", async () => {
		spawnSync("git", ["init", "-q"], { cwd: tempDir });
		await writeProjectFile(".gitignore", "custom-generated/**\n");
		await writeProjectFile("custom-generated/ignored.ts", "export const ignored = true;\n");
		await writeProjectFile("kept.ts", "export const kept = true;\n");
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.inventory.entries.map((entry) => entry.path)).toContain("kept.ts");
		expect(snapshot.inventory.entries.map((entry) => entry.path)).not.toContain("custom-generated/ignored.ts");
		expect(snapshot.inventory.entries.find((entry) => entry.path === "kept.ts")?.realPathRef).toMatch(/^[a-f0-9]{64}$/);
	});

	it("keeps structure hashes equal for equivalent Git and non-Git trees", async () => {
		const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), "project-structure-nongit-"));
		try {
			for (const root of [tempDir, nonGit]) {
				await fs.writeFile(path.join(root, ".gitignore"), "ignored/**\n");
				await fs.mkdir(path.join(root, "src"), { recursive: true });
				await fs.writeFile(path.join(root, "src/app.ts"), "export const app = true;\n");
			}
			spawnSync("git", ["init", "-q"], { cwd: tempDir });
			const gitSnapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
			const nonGitSnapshot = await buildProjectStructureSnapshot({ projectPath: nonGit, generatedAt: GENERATED_AT });
			expect(gitSnapshot.structureInputHash).toBe(nonGitSnapshot.structureInputHash);
		} finally {
			await fs.rm(nonGit, { recursive: true, force: true });
		}
	});

	it("uses only the nearest tsconfig alias set for each importer", async () => {
		await writeProjectFile("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@alias/*": ["root/*"] } } }));
		await writeProjectFile("apps/a/tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@alias/*": ["src/*"] } } }));
		await writeProjectFile("apps/a/main.ts", 'import { value } from "@alias/value";\n');
		await writeProjectFile("apps/a/src/value.ts", "export const value = 1;\n");
		await writeProjectFile("root/value.ts", "export const value = 2;\n");
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.references).toEqual(expect.arrayContaining([
			expect.objectContaining({ from: "apps/a/main.ts", specifier: "@alias/value", status: "resolved", target: "apps/a/src/value.ts" }),
		]));
	});

	it("infers workspace modules from package.json workspace declarations", async () => {
		await writeProjectFile("package.json", JSON.stringify({ name: "root", workspaces: ["components/*"] }));
		await writeProjectFile("components/unusual-name/package.json", JSON.stringify({ name: "@example/unusual" }));
		await writeProjectFile("components/unusual-name/lib/value.ts", "export const value = true;\n");
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.modules).toEqual(expect.arrayContaining([
			expect.objectContaining({ pathPrefix: "components/unusual-name", boundaryKind: "workspace" }),
		]));
	});

	it("applies parsed byte budgets to non-source analyzers", async () => {
		await writeProjectFile("large.css", `.large { content: "${"x".repeat(512)}"; }\n`);
		const snapshot = await buildProjectStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
			maxParsedFileBytes: 128,
		});
		expect(snapshot.files).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: "large.css", status: "partial", diagnosticCodes: ["analysis_file_too_large"] }),
		]));
	});

	it("caps persisted diagnostics and aggregates overflow by code", async () => {
		await writeProjectFile(
			"many-imports.ts",
			Array.from({ length: 1_100 }, (_, index) => `import "./missing-${index}.js";`).join("\n"),
		);
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.diagnostics.length).toBeLessThanOrEqual(1_000);
		expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "resolution_target_missing", count: expect.any(Number) }),
		]));
	});

	it("degrades analysis only when a source exceeds the parse budget", async () => {
		await writeProjectFile("large.ts", `export const source = "${"x".repeat(2048)}";\n`);
		const snapshot = await buildProjectStructureSnapshot({
			projectPath: tempDir,
			generatedAt: GENERATED_AT,
			maxParsedFileBytes: 128,
		});
		expect(snapshot.readiness.inventory.status).toBe("available");
		expect(snapshot.readiness.analysis.status).toBe("degraded");
		expect(snapshot.files).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: "large.ts", status: "partial" }),
		]));
	});

	it("distinguishes case mismatch from a missing local target", async () => {
		await writeProjectFile("Main.ts", 'import "./helper";\n');
		await writeProjectFile("Helper.ts", "export const helper = true;\n");
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.references).toEqual(expect.arrayContaining([
			expect.objectContaining({ specifier: "./helper", status: "unresolved", diagnosticCodes: ["resolution_case_mismatch"] }),
		]));
		expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "resolution_case_mismatch", scope: "resolution" }),
		]));
	});

	it("does not let a repository-root package manifest collapse graph modules", async () => {
		await writeProjectFile("feature/a.ts", 'import "./b";\nexport const a = true;\n');
		await writeProjectFile("feature/b.ts", 'import "./a";\nexport const b = true;\n');
		const graphSnapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(graphSnapshot.modules).toEqual(expect.arrayContaining([
			expect.objectContaining({ pathPrefix: "feature", boundaryKind: "graph", confidenceReasons: ["strongly connected reference component"] }),
		]));

		await writeProjectFile("package.json", JSON.stringify({ name: "root" }));
		const packageSnapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(packageSnapshot.modules).toEqual(expect.arrayContaining([
			expect.objectContaining({ pathPrefix: "feature", boundaryKind: "graph" }),
		]));
	});

	it("registers an in-root symlinked file only once", async () => {
		await writeProjectFile("source/original.ts", "export const original = true;\n");
		await fs.mkdir(path.join(tempDir, "alias"), { recursive: true });
		await fs.symlink(
			path.join(tempDir, "source", "original.ts"),
			path.join(tempDir, "alias", "duplicate.ts"),
		);
		const snapshot = await buildProjectStructureSnapshot({ projectPath: tempDir, generatedAt: GENERATED_AT });
		expect(snapshot.inventory.entries.filter((entry) => entry.path.endsWith(".ts"))).toHaveLength(1);
		expect(snapshot.inventory.coverage.excludedByReason).toMatchObject({ duplicate_symlink_target: 1 });
	});

	async function writeProjectFile(relativePath: string, content: string) {
		const absolutePath = path.join(tempDir, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content, "utf8");
	}
});
