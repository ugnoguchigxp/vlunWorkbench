export function clampText(input: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	return input.length <= maxChars ? input : input.slice(0, maxChars);
}

export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}
