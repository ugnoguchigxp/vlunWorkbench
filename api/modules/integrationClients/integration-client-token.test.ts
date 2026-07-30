import { describe, expect, it } from "bun:test";
import {
	generateIntegrationToken,
	hashIntegrationToken,
	parseIntegrationTokenPrefix,
	verifyIntegrationTokenHash,
} from "./integration-client-token";

describe("integration client token", () => {
	it("generates a parseable high-entropy token and stores only its hash", () => {
		const generated = generateIntegrationToken();
		expect(parseIntegrationTokenPrefix(generated.token)).toBe(
			generated.tokenPrefix,
		);
		expect(generated.tokenHash).toBe(hashIntegrationToken(generated.token));
		expect(generated.tokenHash).not.toContain(generated.token);
		expect(verifyIntegrationTokenHash(generated.token, generated.tokenHash)).toBe(
			true,
		);
	});

	it("rejects malformed and mismatched tokens", () => {
		const generated = generateIntegrationToken();
		expect(parseIntegrationTokenPrefix("not-a-token")).toBeNull();
		expect(
			verifyIntegrationTokenHash(
				generateIntegrationToken().token,
				generated.tokenHash,
			),
		).toBe(false);
	});
});
