import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretCrypto } from "./secret-crypto";

describe("SecretCrypto", () => {
	it("round-trips a secret without retaining plaintext", () => {
		const crypto = new SecretCrypto(randomBytes(32).toString("base64"));
		const identity = { endpointId: "endpoint-1", providerKind: "openai" };
		const encrypted = crypto.encrypt("super-secret-value", identity);
		expect(JSON.stringify(encrypted)).not.toContain("super-secret-value");
		expect(crypto.decrypt(encrypted, identity)).toBe("super-secret-value");
	});

	it("binds ciphertext to endpoint identity", () => {
		const crypto = new SecretCrypto(randomBytes(32).toString("base64"));
		const encrypted = crypto.encrypt("secret", {
			endpointId: "endpoint-1",
			providerKind: "openai",
		});
		expect(() =>
			crypto.decrypt(encrypted, {
				endpointId: "endpoint-2",
				providerKind: "openai",
			}),
		).toThrow(/could not be decrypted/);
	});

	it("supports previous keys for rotation and rejects unknown keys", () => {
		const previousKey = randomBytes(32).toString("base64");
		const currentKey = randomBytes(32).toString("base64");
		const identity = { endpointId: "endpoint-1", providerKind: "azure" };
		const encrypted = new SecretCrypto(previousKey).encrypt("secret", identity);
		expect(
			new SecretCrypto(currentKey, [previousKey]).decrypt(encrypted, identity),
		).toBe("secret");
		expect(() =>
			new SecretCrypto(currentKey).decrypt(encrypted, identity),
		).toThrow(/key is unavailable/);
	});

	it("requires an exact 32-byte key", () => {
		expect(() => new SecretCrypto("not-a-valid-key")).toThrow(/32-byte/);
	});
});
