import path from "node:path";

export type RelativePathResult =
	| { ok: true; path: string }
	| {
			ok: false;
			path: "unknown";
			reason: "empty_path" | "outside_project" | "invalid_path";
	  };

/**
 * Converts scanner supplied paths to stable, project-relative POSIX paths.
 * This is deliberately lexical: deleted files can still be classified and no
 * filesystem read is required on a read path.
 */
export function toProjectRelativePath(
	projectRoot: string,
	candidate: unknown,
): RelativePathResult {
	if (typeof candidate !== "string" || !candidate.trim()) {
		return { ok: false, path: "unknown", reason: "empty_path" };
	}
	if (
		!projectRoot.trim() ||
		hasControlCharacter(projectRoot) ||
		hasControlCharacter(candidate) ||
		hasUriScheme(projectRoot.trim()) ||
		hasUriScheme(candidate.trim()) ||
		/^[A-Za-z]:[^\\/]/.test(candidate.trim())
	) {
		return { ok: false, path: "unknown", reason: "invalid_path" };
	}

	const raw = candidate.trim();
	const windows =
		looksLikeWindowsPath(projectRoot) || looksLikeWindowsPath(raw);
	const pathApi = windows ? path.win32 : path.posix;
	const normalizedRoot = pathApi.resolve(
		normalizeSeparators(projectRoot, windows),
	);
	const normalizedCandidate = normalizeSeparators(raw, windows);

	if (windows && /^[A-Za-z]:/.test(normalizedCandidate)) {
		const rootDrive = pathApi.parse(normalizedRoot).root.toLowerCase();
		const candidateDrive = pathApi
			.parse(normalizedCandidate)
			.root.toLowerCase();
		if (rootDrive !== candidateDrive) {
			return { ok: false, path: "unknown", reason: "outside_project" };
		}
	}

	const absoluteCandidate = pathApi.isAbsolute(normalizedCandidate)
		? pathApi.resolve(normalizedCandidate)
		: pathApi.resolve(normalizedRoot, normalizedCandidate);
	const relative = pathApi.relative(normalizedRoot, absoluteCandidate);
	if (
		relative === "" ||
		relative === "." ||
		relative === ".." ||
		relative.startsWith(`..${pathApi.sep}`) ||
		pathApi.isAbsolute(relative)
	) {
		return relative === "" || relative === "."
			? { ok: false, path: "unknown", reason: "invalid_path" }
			: { ok: false, path: "unknown", reason: "outside_project" };
	}

	const posix = relative.replaceAll("\\", "/").replace(/^\.\//, "");
	if (!posix || posix.split("/").some((part) => part === ".." || !part)) {
		return { ok: false, path: "unknown", reason: "invalid_path" };
	}
	return { ok: true, path: posix };
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127;
	});
}

function hasUriScheme(value: string): boolean {
	return (
		/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !isWindowsAbsolutePath(value)
	);
}

function isWindowsAbsolutePath(value: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(value);
}

function looksLikeWindowsPath(value: string): boolean {
	return isWindowsAbsolutePath(value) || value.includes("\\");
}

function normalizeSeparators(value: string, windows: boolean): string {
	return windows ? value.replaceAll("/", "\\") : value.replaceAll("\\", "/");
}
