import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBuiltinSecurityRecipes } from "./builtin-security-recipes";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("built-in security recipes", () => {
	it("requires explicit fuzz enablement and never guesses a harness", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-recipes-"));
		roots.push(root);
		await fs.writeFile(path.join(root, "go.mod"), "module example\n");
		expect((await resolveBuiltinSecurityRecipes(root)).map((recipe) => recipe.id)).toEqual(["go-race"]);
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		await fs.writeFile(path.join(root, ".vuln-workbench", "enable-go-fuzz"), "approved\n");
		expect((await resolveBuiltinSecurityRecipes(root)).map((recipe) => recipe.id)).toEqual(["go-race", "go-fuzz-bounded"]);
	});

	it("does not advertise Cargo ASan without an approved sanitizer configuration", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-recipes-"));
		roots.push(root);
		await fs.writeFile(path.join(root, "Cargo.toml"), "[package]\nname = \"example\"\n");
		await fs.writeFile(path.join(root, "rust-toolchain.toml"), "[toolchain]\nchannel = \"nightly\"\n");
		expect((await resolveBuiltinSecurityRecipes(root)).map((recipe) => recipe.id)).not.toContain("cargo-asan");
		await fs.mkdir(path.join(root, ".cargo"));
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		await fs.writeFile(path.join(root, ".cargo", "config.toml"), "[build]\nrustflags = [\"-Zsanitizer=address\"]\n");
		await fs.writeFile(path.join(root, ".vuln-workbench", "enable-cargo-asan"), "approved\n");
		expect((await resolveBuiltinSecurityRecipes(root)).map((recipe) => recipe.id)).toContain("cargo-asan");
	});
});
