import path from "node:path";

const PATH_KEYS = new Set([
	"path",
	"file",
	"target",
	"sourcepath",
	"manifestpath",
]);

export function normalizeStructuredOutputPaths(
	value: unknown,
	rootPath: string,
): unknown {
	return visit(value, path.resolve(rootPath));
}

export function normalizeScannerOutputText(
	value: string,
	rootPath: string,
): string {
	let normalized = value;
	const resolvedRoot = path.resolve(rootPath);
	const rootForms = new Set([
		rootPath,
		resolvedRoot,
		rootPath.replaceAll("\\", "/"),
		resolvedRoot.replaceAll("\\", "/"),
	]);
	for (const rootForm of [...rootForms].sort(
		(left, right) => right.length - left.length,
	)) {
		if (rootForm) {
			normalized = normalized.replace(
				new RegExp(`${escapeRegExp(rootForm)}(?=$|[\\\\/])`, "g"),
				".",
			);
		}
	}
	return normalized.replace(/\/workspace\/repo(?=$|[\\/])/g, ".");
}

function visit(value: unknown, rootPath: string, key = ""): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => visit(item, rootPath));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(
				([childKey, childValue]) => [
					childKey,
					visit(childValue, rootPath, childKey),
				],
			),
		);
	}
	if (typeof value !== "string" || !PATH_KEYS.has(key.toLowerCase())) {
		return value;
	}
	return normalizePathValue(value, rootPath);
}

function normalizePathValue(value: string, rootPath: string): string {
	const normalizedValue = value.replaceAll("\\", "/");
	if (
		normalizedValue === "/workspace/repo" ||
		normalizedValue === "/workspace/repo/"
	) {
		return ".";
	}
	if (normalizedValue.startsWith("/workspace/repo/")) {
		return normalizeScannerRelativePath(
			normalizedValue.slice("/workspace/repo/".length),
		);
	}
	if (path.isAbsolute(value)) {
		const absolute = path.resolve(value);
		const relative = path.relative(rootPath, absolute);
		if (isInsideRelativePath(relative)) {
			return relative ? normalizeRelative(relative) : ".";
		}
		return externalPath(normalizedValue);
	}
	if (path.win32.isAbsolute(value)) return externalPath(normalizedValue);
	return normalizeScannerRelativePath(normalizedValue);
}

function normalizeRelative(value: string): string {
	return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeScannerRelativePath(value: string): string {
	const normalized = path.posix.normalize(normalizeRelative(value));
	if (
		normalized === ".." ||
		normalized.startsWith("../") ||
		path.posix.isAbsolute(normalized)
	) {
		return externalPath(normalized);
	}
	return normalized;
}

function externalPath(value: string): string {
	const basename =
		path.posix.basename(value) || path.win32.basename(value) || "unknown";
	return `__external__/${basename === "." || basename === ".." ? "unknown" : basename}`;
}

function isInsideRelativePath(relative: string): boolean {
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
