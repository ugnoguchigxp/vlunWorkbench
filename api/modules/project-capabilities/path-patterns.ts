import path from "node:path";

export function normalizePluginPath(value: string): string {
	return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isSafeRelativePluginPath(value: string): boolean {
	const normalized = normalizePluginPath(value);
	return (
		normalized.length > 0 &&
		!path.posix.isAbsolute(normalized) &&
		normalized !== ".." &&
		!normalized.startsWith("../") &&
		!normalized.includes("\0")
	);
}

export function matchesPluginGlob(value: string, glob: string): boolean {
	const candidate = normalizePluginPath(value);
	const normalizedGlob = normalizePluginPath(glob);
	let expression = "";
	for (let index = 0; index < normalizedGlob.length; index++) {
		const character = normalizedGlob[index];
		if (character === "*" && normalizedGlob[index + 1] === "*") {
			if (normalizedGlob[index + 2] === "/") {
				expression += "(?:.*/)?";
				index += 2;
			} else {
				expression += ".*";
				index += 1;
			}
			continue;
		}
		if (character === "*") {
			expression += "[^/]*";
			continue;
		}
		if (character === "?") {
			expression += "[^/]";
			continue;
		}
		expression += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${expression}$`).test(candidate);
}

export function matchesAnyPluginGlob(
	value: string,
	globs: readonly string[],
): boolean {
	return globs.some((glob) => matchesPluginGlob(value, glob));
}
