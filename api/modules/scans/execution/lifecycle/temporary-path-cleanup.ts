import fs from "node:fs/promises";

export async function cleanupTemporaryPaths(
	paths: Array<string | null | undefined>,
	failureCode: string,
	remove: (target: string) => Promise<unknown> = (target) =>
		fs.rm(target, { recursive: true, force: true }),
): Promise<void> {
	const uniquePaths = [
		...new Set(paths.filter((value): value is string => !!value)),
	];
	const results = await Promise.allSettled(
		uniquePaths.map((target) => remove(target)),
	);
	if (results.some((result) => result.status === "rejected")) {
		throw new Error(failureCode);
	}
}
