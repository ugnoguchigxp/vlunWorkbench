import fs from "node:fs/promises";

type CommandResult = {
	exitCode: number;
};

type CleanupCommand = (argv: string[]) => Promise<CommandResult>;
type RemoveRoot = (root: string) => Promise<void>;

async function runCommand(argv: string[]): Promise<CommandResult> {
	const child = Bun.spawn(argv, {
		stdout: "ignore",
		stderr: "ignore",
	});
	return { exitCode: await child.exited };
}

async function removeRoot(root: string): Promise<void> {
	await fs.rm(root, { recursive: true, force: true });
}

function isRecoverablePermissionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as NodeJS.ErrnoException).code;
	return code === "EACCES" || code === "EPERM";
}

/**
 * Fixed-UID scanner containers can leave cache entries that the CI runner cannot
 * remove. Re-open only that disposable cache with the same unprivileged UID,
 * relax its own entries, and let the host retry removal of the whole temp root.
 */
export async function cleanupScannerE2ETemporaryRoot(params: {
	root: string;
	toolCacheDir: string;
	toolboxImage: string;
	command?: CleanupCommand;
	removeRoot?: RemoveRoot;
}): Promise<void> {
	const remove = params.removeRoot ?? removeRoot;
	try {
		await remove(params.root);
		return;
	} catch (error) {
		if (!isRecoverablePermissionError(error)) throw error;
	}

	const command = params.command ?? runCommand;
	await command([
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--user",
		"65532:65532",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--read-only",
		"--volume",
		`${params.toolCacheDir}:/workspace/cache:rw`,
		"--entrypoint",
		"/bin/chmod",
		params.toolboxImage,
		"-R",
		"a+rwX",
		"/workspace/cache",
	]);

	// chmod can report a partial failure for the host-owned mount root while still
	// fixing every scanner-owned descendant. The authoritative check is removal.
	await remove(params.root);
}
