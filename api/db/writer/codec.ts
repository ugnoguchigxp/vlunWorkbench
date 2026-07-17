import type { EncodedValue } from "./protocol";

const hasBuffer = typeof Buffer !== "undefined";

function bytesToBase64(value: Uint8Array): string {
	if (hasBuffer) return Buffer.from(value).toString("base64");
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	if (hasBuffer) return Uint8Array.from(Buffer.from(value, "base64"));
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeValue(value: unknown, ancestors: WeakSet<object>): EncodedValue {
	if (value === null) return null;
	if (
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		if (typeof value === "number" && !Number.isFinite(value)) {
			throw new TypeError(
				"Writer protocol does not support non-finite numbers.",
			);
		}
		return value;
	}
	if (typeof value === "bigint") {
		return { $type: "bigint", value: value.toString() };
	}
	if (value instanceof Uint8Array) {
		return { $type: "bytes", value: bytesToBase64(value) };
	}
	if (Array.isArray(value)) {
		if (ancestors.has(value)) {
			throw new TypeError("Writer protocol cannot encode cyclic values.");
		}
		ancestors.add(value);
		try {
			return Array.from({ length: value.length }, (_, index) => {
				if (!(index in value)) {
					throw new TypeError("Writer protocol cannot encode sparse arrays.");
				}
				return encodeValue(value[index], ancestors);
			});
		} finally {
			ancestors.delete(value);
		}
	}
	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(
				`Writer protocol cannot encode ${prototype?.constructor?.name ?? "non-plain object"}.`,
			);
		}
		if (ancestors.has(value)) {
			throw new TypeError("Writer protocol cannot encode cyclic values.");
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			throw new TypeError(
				"Writer protocol cannot encode symbol-keyed properties.",
			);
		}
		ancestors.add(value);
		const output: Record<string, EncodedValue> = {};
		try {
			for (const [key, entry] of Object.entries(value)) {
				if (entry === undefined) continue;
				output[key] = encodeValue(entry, ancestors);
			}
		} finally {
			ancestors.delete(value);
		}
		return { $type: "object", value: output };
	}
	throw new TypeError(`Writer protocol cannot encode ${typeof value}.`);
}

export function encodeWriterValue(value: unknown): EncodedValue {
	return encodeValue(value, new WeakSet());
}

export function decodeWriterValue(value: EncodedValue): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return value;
	}
	if (Array.isArray(value)) return value.map(decodeWriterValue);
	if (value.$type === "bigint" && typeof value.value === "string") {
		return BigInt(value.value);
	}
	if (value.$type === "bytes" && typeof value.value === "string") {
		return base64ToBytes(value.value);
	}
	if (
		value.$type === "object" &&
		value.value !== null &&
		typeof value.value === "object" &&
		!Array.isArray(value.value)
	) {
		return Object.fromEntries(
			Object.entries(value.value).map(([key, entry]) => [
				key,
				decodeWriterValue(entry),
			]),
		);
	}
	throw new TypeError("Writer protocol received an invalid encoded object.");
}
