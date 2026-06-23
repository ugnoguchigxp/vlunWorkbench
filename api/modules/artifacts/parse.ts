export function parseLooseStructuredText(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw.trim();
	}
}
