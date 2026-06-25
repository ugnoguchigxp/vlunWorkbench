import fs from "node:fs/promises";
import path from "node:path";

export interface DynamicProfileTemplate {
	id: string;
	displayName: string;
	dynamicKind: "test" | "sanitizer" | "fuzz";
	commandJson: string[];
	timeoutSec: number;
	network: "none" | "default";
	writableWorkdir: boolean;
	allowProjectScripts: boolean;
	expectedArtifactsJson?: string[];
	isApplicable(repoPath: string): Promise<boolean>;
}

export const DYNAMIC_PROFILE_TEMPLATES: DynamicProfileTemplate[] = [
	{
		id: "bun-test",
		displayName: "Bun Test",
		dynamicKind: "test",
		commandJson: ["bun", "test"],
		timeoutSec: 120,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			try {
				const packageJsonExists = await fileExists(
					path.join(repoPath, "package.json"),
				);
				if (!packageJsonExists) return false;
				const hasLock =
					(await fileExists(path.join(repoPath, "bun.lock"))) ||
					(await fileExists(path.join(repoPath, "bun.lockb")));
				return hasLock;
			} catch {
				return false;
			}
		},
	},
	{
		id: "npm-test",
		displayName: "NPM Test",
		dynamicKind: "test",
		commandJson: ["npm", "test"],
		timeoutSec: 120,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: true,
		async isApplicable(repoPath) {
			try {
				const packageJsonPath = path.join(repoPath, "package.json");
				const packageJsonExists = await fileExists(packageJsonPath);
				if (!packageJsonExists) return false;

				const content = await fs.readFile(packageJsonPath, "utf8");
				const pkg = JSON.parse(content);
				return (
					typeof pkg.scripts?.test === "string" && pkg.scripts.test.length > 0
				);
			} catch {
				return false;
			}
		},
	},
	{
		id: "pytest",
		displayName: "pytest",
		dynamicKind: "test",
		commandJson: ["pytest", "-q"],
		timeoutSec: 120,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			try {
				if (await fileExists(path.join(repoPath, "pyproject.toml")))
					return true;
				if (await fileExists(path.join(repoPath, "pytest.ini"))) return true;
				const testsDir = path.join(repoPath, "tests");
				const stat = await fs.stat(testsDir);
				return stat.isDirectory();
			} catch {
				return false;
			}
		},
	},
	{
		id: "cargo-test",
		displayName: "Cargo Test",
		dynamicKind: "test",
		commandJson: ["cargo", "test", "--locked"],
		timeoutSec: 180,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			return await fileExists(path.join(repoPath, "Cargo.toml"));
		},
	},
	{
		id: "go-test",
		displayName: "Go Test",
		dynamicKind: "test",
		commandJson: ["go", "test", "./..."],
		timeoutSec: 180,
		network: "none",
		writableWorkdir: true,
		allowProjectScripts: false,
		async isApplicable(repoPath) {
			return await fileExists(path.join(repoPath, "go.mod"));
		},
	},
];

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

const ALLOWED_BINARIES = new Set([
	"bun",
	"node",
	"npm",
	"pnpm",
	"yarn",
	"python",
	"python3",
	"pytest",
	"cargo",
	"go",
]);

const REJECTED_BINARIES = new Set([
	"sh",
	"bash",
	"zsh",
	"fish",
	"curl",
	"wget",
	"nc",
	"ncat",
	"ssh",
	"docker",
	"sudo",
	"chmod",
	"chown",
	"rm",
	"mv",
	"cp",
]);

const SHELL_CONTROL_CHARS = /[;&|<>`\$\(\)]/;

export interface CommandValidationResult {
	valid: boolean;
	reason?: string;
}

export function validateDynamicCommand(
	command: string[],
	allowProjectScripts: boolean,
): CommandValidationResult {
	if (!command || command.length === 0) {
		return { valid: false, reason: "Command is empty." };
	}

	const binary = command[0];

	// Check binary family rules
	if (REJECTED_BINARIES.has(binary)) {
		return {
			valid: false,
			reason: `Binary '${binary}' is explicitly blacklisted. Shell commands and network utils are rejected.`,
		};
	}

	if (!ALLOWED_BINARIES.has(binary)) {
		return {
			valid: false,
			reason: `Binary family '${binary}' is not in the allowlist. Only bun, node, npm, pnpm, yarn, python, pytest, cargo, and go are allowed.`,
		};
	}

	// Shell injection prevention (check all arguments)
	for (const arg of command) {
		if (SHELL_CONTROL_CHARS.test(arg)) {
			return {
				valid: false,
				reason: `Command contains forbidden shell control characters: ${arg}`,
			};
		}
	}

	// Project script execution consent check
	const isProjectScript =
		binary === "npm" ||
		binary === "pnpm" ||
		binary === "yarn" ||
		(binary === "bun" && command[1] === "run");

	if (isProjectScript && !allowProjectScripts) {
		return {
			valid: false,
			reason:
				"Project script execution requires explicit allow_project_scripts consent.",
		};
	}

	return { valid: true };
}
