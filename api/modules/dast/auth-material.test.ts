import { describe, expect, it } from "vitest";
import {
	apiAuthHeadersFor,
	redactDastEvidenceText,
	redactDastEvidenceUrl,
	redactSecretText,
} from "./auth-material";

describe("DAST evidence redaction", () => {
	it("limits API auth to header-compatible contexts", () => {
		expect(
			apiAuthHeadersFor({ kind: "bearer_token", token: "secret" }),
		).toEqual({ Authorization: "Bearer secret" });
		expect(() =>
			apiAuthHeadersFor({
				kind: "cookie_set",
				cookies: [{ name: "session", value: "secret", path: "/admin" }],
			}),
		).toThrow("api_auth_kind_not_supported");
	});

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

	it("redacts encoded Basic auth and JSON-escaped header values", () => {
		const basic = {
			kind: "basic_auth" as const,
			username: "review-user",
			password: "review-pass",
		};
		expect(
			redactSecretText(
				`Basic ${Buffer.from("review-user:review-pass").toString("base64")}`,
				basic,
			),
		).not.toContain("Basic ");
		const named = {
			kind: "named_header" as const,
			name: "X-Api-Key",
			value: 'canary-"quoted"',
		};
		expect(
			redactSecretText(JSON.stringify({ reflected: named.value }), named),
		).not.toContain("canary-");
		expect(
			redactSecretText(
				`reflected=${encodeURIComponent(named.value)}`,
				named,
			),
		).not.toContain(encodeURIComponent(named.value));
	});
});
