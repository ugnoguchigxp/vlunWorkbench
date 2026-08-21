import fs from "node:fs/promises";
import path from "node:path";
import type { DynamicProfileTemplate } from "./dynamic-profiles";

/**
 * Security recipes are fixed argv contracts. Fuzz recipes require an explicit
 * project-owned marker so the system never guesses a harness or package.
 */
export const BUILTIN_SECURITY_RECIPES: DynamicProfileTemplate[] = [
	{
		id: "go-race",
		displayName: "Go Race Detector",
		dynamicKind: "sanitizer",
		commandJson: ["go", "test", "-race", "./..."],
		timeoutSec: 300,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			return exists(path.join(repoPath, "go.mod"));
		},
	},
	{
		id: "cargo-asan",
		displayName: "Cargo AddressSanitizer",
		dynamicKind: "sanitizer",
		commandJson: ["cargo", "test", "-Zbuild-std"],
		timeoutSec: 300,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			const [cargo, toolchain, cargoConfig, approved] = await Promise.all([
				exists(path.join(repoPath, "Cargo.toml")),
				fs
					.readFile(path.join(repoPath, "rust-toolchain.toml"), "utf8")
					.catch(() => ""),
				fs
					.readFile(path.join(repoPath, ".cargo", "config.toml"), "utf8")
					.catch(() => ""),
				exists(path.join(repoPath, ".vuln-workbench", "enable-cargo-asan")),
			]);
			return (
				cargo &&
				approved &&
				toolchain.includes("nightly") &&
				cargoConfig.includes("-Zsanitizer=address")
			);
		},
	},
	{
		id: "go-fuzz-bounded",
		displayName: "Go Bounded Fuzz",
		dynamicKind: "fuzz",
		commandJson: ["go", "test", "-fuzz", ".", "-fuzztime=30s", "./..."],
		timeoutSec: 90,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			return (
				(await exists(path.join(repoPath, "go.mod"))) &&
				(await exists(path.join(repoPath, ".vuln-workbench", "enable-go-fuzz")))
			);
		},
	},
	{
		id: "cargo-fuzz-bounded",
		displayName: "Cargo Bounded Fuzz",
		dynamicKind: "fuzz",
		commandJson: ["cargo", "fuzz", "run", "--", "-max_total_time=30"],
		timeoutSec: 90,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			return (
				(await exists(path.join(repoPath, "Cargo.toml"))) &&
				(await exists(path.join(repoPath, "fuzz", "Cargo.toml"))) &&
				(await exists(
					path.join(repoPath, ".vuln-workbench", "enable-cargo-fuzz"),
				))
			);
		},
	},
];

export async function resolveBuiltinSecurityRecipes(repoPath: string) {
	const applicability = await Promise.all(
		BUILTIN_SECURITY_RECIPES.map(async (recipe) => ({
			recipe,
			applicable: await recipe.isApplicable(repoPath),
		})),
	);
	return applicability
		.filter((item) => item.applicable)
		.map((item) => item.recipe);
}

async function exists(filePath: string): Promise<boolean> {
	return await fs
		.access(filePath)
		.then(() => true)
		.catch(() => false);
}
