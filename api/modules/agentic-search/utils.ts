const PRIVATE_HOST_PATTERNS = [
	/^localhost$/i,
	/^127\./,
	/^10\./,
	/^192\.168\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[0-1])\./,
	/^\[?::1\]?$/i,
	/^0\.0\.0\.0$/,
];

export function clampText(input: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	return input.length <= maxChars ? input : input.slice(0, maxChars);
}

export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}

export function isSafeHttpUrl(rawUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return false;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return false;
	}
	const host = url.hostname.trim().toLowerCase();
	if (!host) return false;
	return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}
