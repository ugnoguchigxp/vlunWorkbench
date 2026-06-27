const JAPANESE_TEXT_RE =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

export function assertJapaneseTextFields(
	output: Record<string, unknown>,
	paths: string[],
): void {
	const missing = paths.filter((path) => {
		const value = getPath(output, path);
		if (Array.isArray(value)) {
			return value.some(
				(item) => typeof item === "string" && !JAPANESE_TEXT_RE.test(item),
			);
		}
		return typeof value === "string" && !JAPANESE_TEXT_RE.test(value);
	});
	if (missing.length > 0) {
		throw new Error(
			`Japanese review text is required for fields: ${missing.join(", ")}`,
		);
	}
}

function getPath(value: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce<unknown>((current, key) => {
		if (!current || typeof current !== "object") return undefined;
		return (current as Record<string, unknown>)[key];
	}, value);
}
