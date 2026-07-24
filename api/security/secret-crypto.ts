import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";

export type EncryptedSecret = {
	ciphertext: string;
	nonce: string;
	authTag: string;
	keyId: string;
};

type SecretIdentity = {
	endpointId: string;
	providerKind: string;
};

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

function aad(identity: SecretIdentity): Buffer {
	return Buffer.from(
		JSON.stringify({
			endpointId: identity.endpointId,
			providerKind: identity.providerKind,
		}),
		"utf8",
	);
}

export class SecretCrypto {
	private readonly currentKey: Buffer;
	private readonly keys: Map<string, Buffer>;
	readonly currentKeyId: string;

	constructor(currentKey: string, previousKeys: readonly string[] = []) {
		this.currentKey = parseKey(currentKey, "LLM_SETTINGS_ENCRYPTION_KEY");
		this.currentKeyId = keyId(this.currentKey);
		this.keys = new Map([[this.currentKeyId, this.currentKey]]);
		for (const [index, value] of previousKeys.entries()) {
			const key = parseKey(
				value,
				`LLM_SETTINGS_PREVIOUS_ENCRYPTION_KEYS[${index}]`,
			);
			this.keys.set(keyId(key), key);
		}
	}

	encrypt(secret: string, identity: SecretIdentity): EncryptedSecret {
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.currentKey, nonce);
		cipher.setAAD(aad(identity));
		const ciphertext = Buffer.concat([
			cipher.update(secret, "utf8"),
			cipher.final(),
		]);
		return {
			ciphertext: ciphertext.toString("base64"),
			nonce: nonce.toString("base64"),
			authTag: cipher.getAuthTag().toString("base64"),
			keyId: this.currentKeyId,
		};
	}

	decrypt(secret: EncryptedSecret, identity: SecretIdentity): string {
		const key = this.keys.get(secret.keyId);
		if (!key) throw new Error("Stored LLM secret key is unavailable.");
		try {
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				Buffer.from(secret.nonce, "base64"),
			);
			decipher.setAAD(aad(identity));
			decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
			return Buffer.concat([
				decipher.update(Buffer.from(secret.ciphertext, "base64")),
				decipher.final(),
			]).toString("utf8");
		} catch {
			throw new Error("Stored LLM secret could not be decrypted.");
		}
	}
}
