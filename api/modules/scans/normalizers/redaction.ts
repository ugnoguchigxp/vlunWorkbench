export function redactSecrets(text: string): string {
	const patterns = [
		/ghp_[a-zA-Z0-9]{36}/gi, // GitHub PAT
		/xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}/gi, // Slack token
		/AIzaSy[a-zA-Z0-9-_]{33}/gi, // Google API Key
		/AKIA[0-9A-Z]{16}/g, // AWS access key ID
		/(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)(["']?)([^\r\n"',}]{8,})(\2)/gi,
		/(\b(?:cookie|set-cookie)\b\s*[:=]\s*)(["']?)([^\r\n"'}]{8,})(\2)/gi,
		/("?(?:key|pass|password|secret|token|api_key|apikey|private_key|x-api-key|x-auth-token|x-csrf-token)"?\s*[:=]\s*)(["']?)([^"'\s,}]{8,})(\2)/gi,
	];

	let redacted = text;
	for (const pattern of patterns) {
		redacted = redacted.replace(pattern, (match, ...args) => {
			const captures = args
				.slice(0, -2)
				.filter((arg) => typeof arg === "string");
			const secret = [...captures]
				.reverse()
				.find((capture) => capture.length >= 8 && match.includes(capture));
			if (secret) {
				return match.replace(secret, "[REDACTED]");
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
