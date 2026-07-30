import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "vwi";
const TOKEN_ID_BYTES = 8;
const TOKEN_SECRET_BYTES = 32;

export type GeneratedIntegrationToken = {
	token: string;
	tokenPrefix: string;
	tokenHash: string;
};

export function hashIntegrationToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateIntegrationToken(): GeneratedIntegrationToken {
	const tokenPrefix = randomBytes(TOKEN_ID_BYTES).toString("hex");
	const secret = randomBytes(TOKEN_SECRET_BYTES).toString("base64url");
	const token = `${TOKEN_PREFIX}_${tokenPrefix}_${secret}`;
	return {
		token,
		tokenPrefix,
		tokenHash: hashIntegrationToken(token),
	};
}

export function parseIntegrationTokenPrefix(token: string): string | null {
	const match = /^vwi_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/.exec(token);
	return match?.[1] ?? null;
}

export function verifyIntegrationTokenHash(
	token: string,
	expectedHash: string,
): boolean {
	const actual = Buffer.from(hashIntegrationToken(token), "hex");
	const expected = Buffer.from(expectedHash, "hex");
	return (
		actual.length === expected.length &&
		actual.length > 0 &&
		timingSafeEqual(actual, expected)
	);
}
