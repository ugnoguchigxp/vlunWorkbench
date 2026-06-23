import {
	randomBytes,
	scrypt as scryptCallback,
	timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
	password: string | Buffer,
	salt: string | Buffer,
	keylen: number,
	options: typeof SCRYPT_OPTIONS,
) => Promise<Buffer>;
const SCRYPT_PREFIX = "s1";
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
	N: 16384,
	r: 8,
	p: 1,
	maxmem: 128 * 1024 * 1024,
} as const;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const derived = (await scrypt(
		password,
		salt,
		SCRYPT_KEY_LENGTH,
		SCRYPT_OPTIONS,
	)) as Buffer;
	return `${SCRYPT_PREFIX}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
	password: string,
	storedHash: string,
): Promise<boolean> {
	const [prefix, salt, storedHex] = storedHash.split("$");
	if (prefix !== SCRYPT_PREFIX || !salt || !storedHex) {
		return false;
	}

	const derived = (await scrypt(
		password,
		salt,
		SCRYPT_KEY_LENGTH,
		SCRYPT_OPTIONS,
	)) as Buffer;
	const stored = Buffer.from(storedHex, "hex");
	if (stored.length !== derived.length) {
		return false;
	}
	return timingSafeEqual(stored, derived);
}
