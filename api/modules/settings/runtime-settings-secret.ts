import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";

export type RuntimeSettingsSecret = {
	ciphertext: string;
	nonce: string;
	authTag: string;
	keyId: string;
};

const PURPOSE = "vuln-workbench:runtime-settings:dast-auth:v1";

function deriveKey(jwtSecret: string): Buffer {
	return createHash("sha256")
		.update(PURPOSE, "utf8")
		.update("\0", "utf8")
		.update(jwtSecret, "utf8")
		.digest();
}

function keyId(key: Buffer): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function encryptRuntimeSettingsSecret(
	value: unknown,
	jwtSecret: string,
): RuntimeSettingsSecret {
	const key = deriveKey(jwtSecret);
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	cipher.setAAD(Buffer.from(PURPOSE, "utf8"));
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(value), "utf8"),
		cipher.final(),
	]);
	return {
		ciphertext: ciphertext.toString("base64"),
		nonce: nonce.toString("base64"),
		authTag: cipher.getAuthTag().toString("base64"),
		keyId: keyId(key),
	};
}

export function decryptRuntimeSettingsSecret(
	secret: RuntimeSettingsSecret,
	jwtSecret: string,
): unknown {
	const key = deriveKey(jwtSecret);
	if (secret.keyId !== keyId(key)) {
		throw new Error(
			"Stored runtime settings secret is unavailable with the current JWT_SECRET.",
		);
	}
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			Buffer.from(secret.nonce, "base64"),
		);
		decipher.setAAD(Buffer.from(PURPOSE, "utf8"));
		decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
		return JSON.parse(
			Buffer.concat([
				decipher.update(Buffer.from(secret.ciphertext, "base64")),
				decipher.final(),
			]).toString("utf8"),
		);
	} catch {
		throw new Error("Stored runtime settings secret could not be decrypted.");
	}
}
