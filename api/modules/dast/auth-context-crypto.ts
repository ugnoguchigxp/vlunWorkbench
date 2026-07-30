import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";

export type DastAuthIdentity = {
	contextId: string;
	projectId: string;
	targetConfigId: string;
	identityRole: string;
	authKind: string;
};

export type EncryptedDastAuthSecret = {
	ciphertext: string;
	nonce: string;
	authTag: string;
	keyId: string;
};

export class DastAuthContextCrypto {
	private readonly currentKey: Buffer;
	private readonly keys = new Map<string, Buffer>();
	readonly currentKeyId: string;

	constructor(currentKey: string, previousKeys: readonly string[] = []) {
		this.currentKey = parseKey(currentKey, "DAST_AUTH_ENCRYPTION_KEY");
		this.currentKeyId = keyId(this.currentKey);
		this.keys.set(this.currentKeyId, this.currentKey);
		for (const [index, value] of previousKeys.entries()) {
			const key = parseKey(
				value,
				`DAST_AUTH_PREVIOUS_ENCRYPTION_KEYS[${index}]`,
			);
			this.keys.set(keyId(key), key);
		}
	}

	encrypt(
		payload: DastAuthSecretPayload,
		identity: DastAuthIdentity,
	): EncryptedDastAuthSecret {
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.currentKey, nonce);
		cipher.setAAD(aad(identity));
		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(payload), "utf8"),
			cipher.final(),
		]);
		return {
			ciphertext: ciphertext.toString("base64"),
			nonce: nonce.toString("base64"),
			authTag: cipher.getAuthTag().toString("base64"),
			keyId: this.currentKeyId,
		};
	}

	decrypt(
		secret: EncryptedDastAuthSecret,
		identity: DastAuthIdentity,
	): unknown {
		const key = this.keys.get(secret.keyId);
		if (!key) throw new Error("Stored DAST auth secret key is unavailable.");
		try {
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				Buffer.from(secret.nonce, "base64"),
			);
			decipher.setAAD(aad(identity));
			decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
			return JSON.parse(
				Buffer.concat([
					decipher.update(Buffer.from(secret.ciphertext, "base64")),
					decipher.final(),
				]).toString("utf8"),
			);
		} catch {
			throw new Error("Stored DAST auth secret could not be decrypted.");
		}
	}
}

function aad(identity: DastAuthIdentity): Buffer {
	return Buffer.from(
		JSON.stringify({
			version: 1,
			purpose: "dast-auth-context",
			...identity,
		}),
	);
}

function parseKey(value: string, label: string): Buffer {
	const key = Buffer.from(value, "base64");
	if (key.length !== 32) {
		throw new Error(`${label} must be a base64-encoded 32-byte key.`);
	}
	return key;
}

function keyId(key: Buffer): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
