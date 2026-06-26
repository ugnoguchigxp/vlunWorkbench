import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ARTIFACT_SCOPE,
	DEPENDENCY_MANIFEST_SCOPE,
	FULL_DEEP_SCOPE,
	SOURCE_BASELINE_SCOPE,
} from "./profiles";
import {
	createScopedWorkspace,
	getScopeSkipDirs,
	matchesScopePath,
	resolveScanScope,
} from "./target-scope";

describe("scan target scope", () => {
	let tempDir: string;
	let repoPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "target-scope-test-"));
		repoPath = path.join(tempDir, "repo");
		await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
		await fs.mkdir(path.join(repoPath, "dist"), { recursive: true });
		await fs.mkdir(path.join(repoPath, "node_modules", "pkg"), {
			recursive: true,
		});
		await fs.mkdir(path.join(repoPath, "artifacts", "scans"), {
			recursive: true,
		});
		await fs.writeFile(path.join(repoPath, "src", "app.ts"), "export {};\n");
		await fs.writeFile(path.join(repoPath, "dist", "bundle.js"), "bundle();\n");
		await fs.writeFile(path.join(repoPath, "package.json"), "{}\n");
		await fs.writeFile(path.join(repoPath, "bun.lock"), "\n");
		await fs.writeFile(
			path.join(repoPath, "node_modules", "pkg", "package.json"),
			"{}\n",
		);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("excludes installed dependencies and generated output from source baseline", async () => {
		const resolved = await resolveScanScope({
			repoPath,
			scope: SOURCE_BASELINE_SCOPE,
		});

		expect(resolved.scope.intent).toBe("source");
		expect(resolved.excludedRoots).toContain("node_modules");
		expect(resolved.excludedRoots).toContain("dist");
		expect(getScopeSkipDirs(SOURCE_BASELINE_SCOPE)).toEqual(
			expect.arrayContaining(["node_modules", "dist", "dist-web", "build"]),
		);
		expect(matchesScopePath("src/app.ts", SOURCE_BASELINE_SCOPE)).toBe(true);
		expect(matchesScopePath("dist/bundle.js", SOURCE_BASELINE_SCOPE)).toBe(
			false,
		);
		expect(
			matchesScopePath(
				"node_modules/pkg/package.json",
				SOURCE_BASELINE_SCOPE,
			),
		).toBe(false);
	});

	it("includes build artifacts without installed dependency trees", async () => {
		const resolved = await resolveScanScope({ repoPath, scope: ARTIFACT_SCOPE });

		expect(resolved.scope.intent).toBe("artifact");
		expect(resolved.includedRoots).toContain("dist");
		expect(resolved.excludedRoots).toContain("node_modules");
		expect(matchesScopePath("dist/bundle.js", ARTIFACT_SCOPE)).toBe(true);
		expect(matchesScopePath("src/app.ts", ARTIFACT_SCOPE)).toBe(false);
	});

	it("keeps dependency manifest scope focused on manifests and lockfiles", () => {
		expect(matchesScopePath("package.json", DEPENDENCY_MANIFEST_SCOPE)).toBe(
			true,
		);
		expect(matchesScopePath("bun.lock", DEPENDENCY_MANIFEST_SCOPE)).toBe(true);
		expect(
			matchesScopePath("node_modules/pkg/package.json", DEPENDENCY_MANIFEST_SCOPE),
		).toBe(false);
		expect(matchesScopePath("dist/package.json", DEPENDENCY_MANIFEST_SCOPE)).toBe(
			false,
		);
	});

	it("allows installed dependencies in full deep scope", () => {
		expect(
			matchesScopePath("node_modules/pkg/package.json", FULL_DEEP_SCOPE),
		).toBe(true);
		expect(matchesScopePath("dist/bundle.js", FULL_DEEP_SCOPE)).toBe(true);
		expect(matchesScopePath("artifacts/scans/raw.json", FULL_DEEP_SCOPE)).toBe(
			false,
		);
	});

	it("rejects symlinks escaping the repository root", async () => {
		const outsideDir = path.join(tempDir, "outside");
		await fs.mkdir(outsideDir);
		await fs.writeFile(path.join(outsideDir, "secret.txt"), "secret\n");
		await fs.symlink(outsideDir, path.join(repoPath, "outside-link"));

		const resolved = await resolveScanScope({
			repoPath,
			scope: FULL_DEEP_SCOPE,
		});

		expect(resolved.symlinkEscapes).toContain("outside-link");
		expect(resolved.excludedRoots).toContain("outside-link");
	});

	it("creates scoped workspaces without excluded directories", async () => {
		const workspace = await createScopedWorkspace({
			repoPath,
			scope: ARTIFACT_SCOPE,
			prefix: path.join(os.tmpdir(), "target-scope-workspace-"),
		});

		try {
			expect(workspace.copiedFiles).toBe(1);
			await expect(
				fs.stat(path.join(workspace.path, "dist", "bundle.js")),
			).resolves.toBeDefined();
			await expect(
				fs.stat(path.join(workspace.path, "src", "app.ts")),
			).rejects.toThrow();
			await expect(
				fs.stat(path.join(workspace.path, "node_modules")),
			).rejects.toThrow();
		} finally {
			await fs.rm(workspace.path, { recursive: true, force: true });
		}
	});
});
