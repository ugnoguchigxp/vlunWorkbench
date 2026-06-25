import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DYNAMIC_PROFILE_TEMPLATES,
	validateDynamicCommand,
	validateDynamicProfilePolicy,
} from "./dynamic-profiles";

describe("Dynamic Profiles Validation & Registry", () => {
	describe("validateDynamicCommand", () => {
		it("should allow valid command binaries", () => {
			const res = validateDynamicCommand(["bun", "test"], false);
			expect(res.valid).toBe(true);

			const resPy = validateDynamicCommand(["pytest", "-q"], false);
			expect(resPy.valid).toBe(true);
		});

		it("should reject non-allowlisted binaries", () => {
			const res = validateDynamicCommand(["gcc", "main.c"], false);
			expect(res.valid).toBe(false);
			expect(res.reason).toContain("not in the allowlist");
		});

		it("should reject explicitly forbidden binaries", () => {
			const res = validateDynamicCommand(["bash", "-c", "ls"], false);
			expect(res.valid).toBe(false);
			expect(res.reason).toContain("explicitly blacklisted");
		});

		it("should reject commands containing shell operators", () => {
			const res = validateDynamicCommand(["bun", "test", "&&", "echo", "1"], false);
			expect(res.valid).toBe(false);
			expect(res.reason).toContain("contains forbidden shell control characters");

			const resPipe = validateDynamicCommand(["bun", "test", "|", "grep", "foo"], false);
			expect(resPipe.valid).toBe(false);
		});

		it("should enforce project scripts consent", () => {
			// bun test is NOT considered a project script run, it's direct bun test
			const resDirect = validateDynamicCommand(["bun", "test"], false);
			expect(resDirect.valid).toBe(true);

			// bun run test is project script run
			const resBunRun = validateDynamicCommand(["bun", "run", "test"], false);
			expect(resBunRun.valid).toBe(false);
			expect(resBunRun.reason).toContain("requires explicit allow_project_scripts consent");

			// npm test is project script run
			const resNpm = validateDynamicCommand(["npm", "test"], false);
			expect(resNpm.valid).toBe(false);
			expect(resNpm.reason).toContain("requires explicit allow_project_scripts consent");

			// npm test is allowed when allowProjectScripts is true
			const resNpmAllowed = validateDynamicCommand(["npm", "test"], true);
			expect(resNpmAllowed.valid).toBe(true);
		});

		it("should reject unsafe profile path, artifact, and timeout policy", () => {
			const unsafeWorkingDir = validateDynamicProfilePolicy({
				commandJson: ["bun", "test"],
				allowProjectScripts: false,
				workingDirectory: '"; touch /workspace/out/pwn #',
				expectedArtifactsJson: [],
				timeoutSec: 120,
				network: "none",
			});
			expect(unsafeWorkingDir.valid).toBe(false);
			expect(unsafeWorkingDir.reason).toContain("working_directory");

			const unsafeArtifact = validateDynamicProfilePolicy({
				commandJson: ["python3", "-m", "fuzz"],
				allowProjectScripts: false,
				workingDirectory: "",
				expectedArtifactsJson: ["../crashes/*"],
				timeoutSec: 120,
				network: "none",
			});
			expect(unsafeArtifact.valid).toBe(false);
			expect(unsafeArtifact.reason).toContain("expected_artifacts_json");

			const tooLong = validateDynamicProfilePolicy({
				commandJson: ["pytest", "-q"],
				allowProjectScripts: false,
				workingDirectory: "",
				expectedArtifactsJson: [],
				timeoutSec: 301,
				network: "none",
			});
			expect(tooLong.valid).toBe(false);
			expect(tooLong.reason).toContain("timeout_sec");
		});
	});

	describe("isApplicable", () => {
		let tempDir: string;

		beforeEach(async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-profiles-test-"));
		});

		afterEach(async () => {
			await fs.rm(tempDir, { recursive: true, force: true });
		});

		it("detects bun-test template applicability", async () => {
			const bunTest = DYNAMIC_PROFILE_TEMPLATES.find((t) => t.id === "bun-test")!;

			expect(await bunTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(path.join(tempDir, "package.json"), "{}");
			expect(await bunTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(path.join(tempDir, "bun.lockb"), "");
			expect(await bunTest.isApplicable(tempDir)).toBe(true);
		});

		it("detects npm-test template applicability", async () => {
			const npmTest = DYNAMIC_PROFILE_TEMPLATES.find((t) => t.id === "npm-test")!;

			expect(await npmTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({}));
			expect(await npmTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({ scripts: { test: "vitest" } }),
			);
			expect(await npmTest.isApplicable(tempDir)).toBe(true);
		});

		it("detects pytest template applicability", async () => {
			const pyTest = DYNAMIC_PROFILE_TEMPLATES.find((t) => t.id === "pytest")!;

			expect(await pyTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(path.join(tempDir, "pyproject.toml"), "");
			expect(await pyTest.isApplicable(tempDir)).toBe(true);
		});

		it("detects cargo-test template applicability", async () => {
			const cargoTest = DYNAMIC_PROFILE_TEMPLATES.find((t) => t.id === "cargo-test")!;

			expect(await cargoTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(path.join(tempDir, "Cargo.toml"), "");
			expect(await cargoTest.isApplicable(tempDir)).toBe(true);
		});

		it("detects go-test template applicability", async () => {
			const goTest = DYNAMIC_PROFILE_TEMPLATES.find((t) => t.id === "go-test")!;

			expect(await goTest.isApplicable(tempDir)).toBe(false);

			await fs.writeFile(path.join(tempDir, "go.mod"), "");
			expect(await goTest.isApplicable(tempDir)).toBe(true);
		});
	});
});
