import { describe, expect, it } from "vitest";
import {
	decryptRuntimeSettingsSecret,
	encryptRuntimeSettingsSecret,
} from "./runtime-settings-secret";

describe("runtime settings secret", () => {
	it("round-trips without retaining plaintext", () => {
		const plaintext = "runtime-secret-canary";
		const encrypted = encryptRuntimeSettingsSecret(
			{ dastAuthEncryptionKey: plaintext },
			"a-stable-jwt-secret-with-at-least-32-characters",
		);
		expect(JSON.stringify(encrypted)).not.toContain(plaintext);
		expect(
			decryptRuntimeSettingsSecret(
				encrypted,
				"a-stable-jwt-secret-with-at-least-32-characters",
			),
		).toEqual({ dastAuthEncryptionKey: plaintext });
	});

	it("rejects a different JWT secret", () => {
		const encrypted = encryptRuntimeSettingsSecret(
			{ dastAuthEncryptionKey: "secret" },
			"first-jwt-secret-with-at-least-32-characters",
		);
		expect(() =>
			decryptRuntimeSettingsSecret(
				encrypted,
				"second-jwt-secret-with-at-least-32-characters",
			),
		).toThrow(/current JWT_SECRET/);
	});
});
