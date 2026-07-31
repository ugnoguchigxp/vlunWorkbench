import { describe, expect, it } from "vitest";
import {
	redactDastEvidenceText,
	redactDastEvidenceUrl,
} from "./auth-material";

describe("DAST evidence redaction", () => {
	it("removes all URL query values from browser evidence", () => {
		const value = redactDastEvidenceUrl(
			"https://app.example.test/api/items?token=unrelated-canary&q=visible#fragment",
			undefined,
		);

		expect(value).toContain("token=");
		expect(value).toContain("q=");
		expect(value).not.toContain("unrelated-canary");
		expect(value).not.toContain("visible");
		expect(value).not.toContain("fragment");
	});

	it("redacts known auth material and generic secret assignments", () => {
		const value = redactDastEvidenceText(
			"request failed: https://app.test/me?debug=true token=generic-secret-value bearer-auth-canary",
			{ kind: "bearer_token", token: "bearer-auth-canary" },
		);

		expect(value).not.toContain("generic-secret-value");
		expect(value).not.toContain("bearer-auth-canary");
		expect(value).not.toContain("debug=true");
	});

	it("redacts local-storage values from Playwright storage state", () => {
		const value = redactDastEvidenceText("leaked local-token-value", {
			kind: "playwright_storage_state",
			storageState: {
				cookies: [],
				origins: [
					{
						origin: "http://127.0.0.1:3000",
						localStorage: [
							{ name: "access", value: "local-token-value" },
						],
					},
				],
			},
		});

		expect(value).not.toContain("local-token-value");
		expect(value).toContain("[REDACTED]");
	});
});
