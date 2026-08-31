import { describe, expect, test } from "vitest";
import { dastAuthSecretPayloadSchema } from "./dast-auth.schema";

describe("DAST auth secret schema", () => {
	test("rejects header injection and method override names", () => {
		expect(
			dastAuthSecretPayloadSchema.safeParse({
				kind: "bearer_token",
				token: "token\r\nX-Injected: yes",
			}).success,
		).toBe(false);
		expect(
			dastAuthSecretPayloadSchema.safeParse({
				kind: "named_header",
				name: "X-HTTP-Method-Override",
				value: "POST",
			}).success,
		).toBe(false);
	});

	test("rejects ambiguous cookie serialization", () => {
		expect(
			dastAuthSecretPayloadSchema.safeParse({
				kind: "cookie_set",
				cookies: [{ name: "session;admin", value: "secret" }],
			}).success,
		).toBe(false);
		expect(
			dastAuthSecretPayloadSchema.safeParse({
				kind: "cookie_set",
				cookies: [{ name: "session", value: "secret;admin=true" }],
			}).success,
		).toBe(false);
	});
});
