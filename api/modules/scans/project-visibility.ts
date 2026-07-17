const TEMPORARY_PROJECT_ROOTS = ["/tmp", "/private/tmp"] as const;

export function isTemporaryProjectPath(repoPath: string): boolean {
	const normalized = repoPath.replaceAll("\\", "/").replace(/\/+$/, "");
	return TEMPORARY_PROJECT_ROOTS.some(
		(root) => normalized === root || normalized.startsWith(`${root}/`),
	);
}
