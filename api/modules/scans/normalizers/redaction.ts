export function redactSecrets(text: string): string {
	const patterns = [
		/ghp_[a-zA-Z0-9]{36}/gi, // GitHub PAT
		/xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}/gi, // Slack token
		/AIzaSy[a-zA-Z0-9-_]{33}/gi, // Google API Key
		/AKIA[0-9A-Z]{16}/g, // AWS access key ID
		/"?(?:key|pass|password|secret|token|api_key|apikey|private_key)"?\s*[:=]\s*["']([^"']{8,})["']/gi,
	];

	let redacted = text;
	for (const pattern of patterns) {
		redacted = redacted.replace(pattern, (match, ...args) => {
			// Zod / JS Regex replace callback args:
			// If group captured, first captured group will be in args[0]
			const captured = args[0];
			if (typeof captured === "string" && match.includes(captured)) {
				return match.replace(captured, "[REDACTED]");
			}
			return "[REDACTED]";
		});
	}
	return redacted;
}

export function redactJsonSecrets<T>(value: T): T {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		return value;
	}
	return JSON.parse(redactSecrets(serialized)) as T;
}
