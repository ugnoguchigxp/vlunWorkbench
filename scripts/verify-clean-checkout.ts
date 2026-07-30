import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ref = process.argv[2] ?? "HEAD";
if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) || ref.includes("..")) {
	throw new Error(
		"Clean-checkout ref must be a bounded Git ref or commit hash.",
	);
}

const repositoryRoot = process.cwd();
const checkoutPath = await fs.mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-clean-checkout-"),
);
let worktreeAdded = false;

try {
	await run(["git", "worktree", "add", "--detach", checkoutPath, ref], {
		cwd: repositoryRoot,
	});
	worktreeAdded = true;
	await run(["bun", "install", "--frozen-lockfile"], { cwd: checkoutPath });
	await run(["bun", "run", "verify:strict"], { cwd: checkoutPath });
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			ref,
			checks: ["frozen_install", "verify_strict"],
		})}\n`,
	);
} finally {
	if (worktreeAdded) {
		await run(["git", "worktree", "remove", "--force", checkoutPath], {
			cwd: repositoryRoot,
			allowFailure: true,
		});
	}
	await fs.rm(checkoutPath, { recursive: true, force: true });
}

async function run(
	command: string[],
	options: { cwd: string; allowFailure?: boolean },
): Promise<void> {
	const childProcess = Bun.spawn(command, {
		cwd: options.cwd,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...globalThis.process.env, CI: "true" },
	});
	const exitCode = await childProcess.exited;
	if (exitCode !== 0 && !options.allowFailure) {
		throw new Error(`${command[0]} failed with exit code ${exitCode}`);
	}
}
