import { describe, expect, it } from "vitest";
import { DastAuthContextCrypto } from "./auth-context-crypto";

describe("DastAuthContextCrypto", () => {
	const crypto = new DastAuthContextCrypto(
		Buffer.alloc(32, 7).toString("base64"),
	);
	const identity = {
		contextId: "context-1",
		projectId: "project-1",
		targetConfigId: "target-1",
		identityRole: "user-a",
		authKind: "bearer_token",
	};

	it("round-trips an encrypted payload without plaintext ciphertext", () => {
		const encrypted = crypto.encrypt(
			{ kind: "bearer_token", token: "credential-canary" },
			identity,
		);
		expect(encrypted.ciphertext).not.toContain("credential-canary");
		expect(crypto.decrypt(encrypted, identity)).toEqual({
			kind: "bearer_token",
			token: "credential-canary",
		});
	});

	it("binds ciphertext to project, target, identity, and auth kind", () => {
		const encrypted = crypto.encrypt(
			{ kind: "bearer_token", token: "credential-canary" },
			identity,
		);
		expect(() =>
			crypto.decrypt(encrypted, { ...identity, identityRole: "user-b" }),
		).toThrow("could not be decrypted");
	});
});
