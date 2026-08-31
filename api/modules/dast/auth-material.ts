import type {
	DastAuthSecretPayload,
	DastLoginAction,
} from "../../../shared/schemas/dast-auth.schema";
import { redactSecrets } from "../scans/normalizers/redaction";

export type DastAuthMaterial = {
	secret: DastAuthSecretPayload;
	loginFlow: DastLoginAction[];
	identityRole: string;
};

export function authHeadersFor(
	secret: DastAuthSecretPayload | undefined,
): Record<string, string> {
	if (!secret) return {};
	switch (secret.kind) {
		case "bearer_token":
			return { Authorization: `Bearer ${secret.token}` };
		case "named_header":
			return { [secret.name]: secret.value };
		case "basic_auth":
			return {
				Authorization: `Basic ${Buffer.from(
					`${secret.username}:${secret.password}`,
				).toString("base64")}`,
			};
		case "cookie_set":
			return {
				Cookie: secret.cookies
					.map((cookie) => `${cookie.name}=${cookie.value}`)
					.join("; "),
			};
		case "playwright_storage_state":
			return {};
	}
}

export function apiAuthHeadersFor(
	secret: DastAuthSecretPayload | undefined,
): Record<string, string> {
	if (
		secret?.kind === "cookie_set" ||
		secret?.kind === "playwright_storage_state"
	)
		throw new Error("api_auth_kind_not_supported");
	return authHeadersFor(secret);
}

export function secretFieldValue(
	secret: DastAuthSecretPayload,
	field: "token" | "username" | "password",
): string {
	if (field === "token") {
		if (secret.kind === "bearer_token") return secret.token;
		if (secret.kind === "named_header") return secret.value;
	}
	if (secret.kind === "basic_auth") {
		if (field === "username") return secret.username;
		if (field === "password") return secret.password;
	}
	throw new Error("login_flow_secret_field_unavailable");
}

export function redactSecretText(
	value: string,
	secret: DastAuthSecretPayload | undefined,
): string {
	if (!secret) return value;
	let redacted = value;
	for (const candidate of secretValues(secret)) {
		if (candidate.length === 0) continue;
		const variants = new Set([candidate]);
		for (const encode of [encodeURIComponent, encodeURI]) {
			try {
				variants.add(encode(candidate));
			} catch {
				// Raw and JSON-escaped variants still redact malformed Unicode input.
			}
		}
		let escaped = candidate;
		for (let depth = 0; depth < 4; depth += 1) {
			escaped = JSON.stringify(escaped).slice(1, -1);
			variants.add(escaped);
		}
		for (const variant of variants) {
			redacted = redacted.split(variant).join("[REDACTED]");
		}
	}
	return redacted;
}

export function redactDastEvidenceUrl(
	value: string,
	secret: DastAuthSecretPayload | undefined,
): string {
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			url.searchParams.set(key, "");
		}
		return redactSecrets(redactSecretText(url.toString(), secret));
	} catch {
		return redactSecrets(redactSecretText(value, secret));
	}
}

export function redactDastEvidenceText(
	value: string,
	secret: DastAuthSecretPayload | undefined,
): string {
	const knownRedacted = redactSecretText(value, secret);
	const urlRedacted = knownRedacted.replace(
		/https?:\/\/[^\s"'<>]+/gi,
		(candidate) => redactDastEvidenceUrl(candidate, secret),
	);
	return redactSecrets(urlRedacted);
}

function secretValues(secret: DastAuthSecretPayload): string[] {
	let values: string[];
	switch (secret.kind) {
		case "bearer_token":
			values = [secret.token];
			break;
		case "named_header":
			values = [secret.value];
			break;
		case "basic_auth":
			values = [secret.username, secret.password];
			break;
		case "cookie_set":
			values = secret.cookies.map((cookie) => cookie.value);
			break;
		case "playwright_storage_state":
			values = [
				...secret.storageState.cookies.map((cookie) => cookie.value),
				...secret.storageState.origins.flatMap((origin) =>
					origin.localStorage.map((item) => item.value),
				),
			];
			break;
	}
	return [...new Set([...values, ...Object.values(authHeadersFor(secret))])];
}
