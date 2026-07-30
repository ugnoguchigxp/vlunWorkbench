import { describe, expect, it } from "vitest";
import { createDastAuthContextSchema } from "./dast-auth.schema";

describe("DAST auth context schema", () => {
	it("accepts declarative basic-auth login actions", () => {
		const parsed = createDastAuthContextSchema.parse({
			targetConfigId: "11111111-1111-4111-8111-111111111111",
			identityRole: "user-a",
			label: "User A",
			secret: {
				kind: "basic_auth",
				username: "user-a",
				password: "canary",
			},
			loginFlow: [
				{ action: "navigate", path: "/login" },
				{
					action: "fill_secret",
					selector: "#password",
					secretField: "password",
				},
				{ action: "click", selector: "button[type=submit]" },
				{ action: "wait_for_url", pathPattern: "/account" },
			],
			expiresAt: "2026-07-31T00:00:00.000Z",
		});
		expect(parsed.loginFlow).toHaveLength(4);
	});

	it("rejects arbitrary login scripts and credential URLs", () => {
		const result = createDastAuthContextSchema.safeParse({
			targetConfigId: "11111111-1111-4111-8111-111111111111",
			identityRole: "user-a",
			label: "User A",
			secret: { kind: "bearer_token", token: "canary" },
			loginFlow: [
				{ action: "script", body: "fetch('https://evil.test')" },
				{ action: "navigate", path: "https://evil.test/canary" },
			],
			expiresAt: "2026-07-31T00:00:00.000Z",
		});
		expect(result.success).toBe(false);
	});

	it("rejects secret fields unavailable to the selected auth kind", () => {
		const result = createDastAuthContextSchema.safeParse({
			targetConfigId: "11111111-1111-4111-8111-111111111111",
			identityRole: "user-a",
			label: "User A",
			secret: { kind: "bearer_token", token: "canary" },
			loginFlow: [
				{
					action: "fill_secret",
					selector: "#password",
					secretField: "password",
				},
			],
			expiresAt: "2026-07-31T00:00:00.000Z",
		});
		expect(result.success).toBe(false);
	});
});
