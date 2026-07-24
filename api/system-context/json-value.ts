import type { JsonValue } from "s11tnext";

function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function convertJsonValue(
	value: unknown,
	path: readonly (string | number)[],
	ancestors: Set<object>,
): JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			throw new TypeError(`Invalid Date at ${path.join(".") || "<root>"}`);
		}
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		if (ancestors.has(value)) {
			throw new TypeError(`Cyclic value at ${path.join(".") || "<root>"}`);
		}
		ancestors.add(value);
		try {
			return value.map((item, index) =>
				convertJsonValue(item, [...path, index], ancestors),
			);
		} finally {
			ancestors.delete(value);
		}
	}
	if (typeof value === "object" && isPlainObject(value)) {
		if (ancestors.has(value)) {
			throw new TypeError(`Cyclic value at ${path.join(".") || "<root>"}`);
		}
		ancestors.add(value);
		try {
			const result: Record<string, JsonValue> = {};
			for (const [key, item] of Object.entries(value)) {
				result[key] = convertJsonValue(item, [...path, key], ancestors);
			}
			return result;
		} finally {
			ancestors.delete(value);
		}
	}
	throw new TypeError(
		`Expected a JSON-compatible value at ${path.join(".") || "<root>"}`,
	);
}

/**
 * Converts application data to S11tnext's JSON value contract without a
 * stringify/parse round trip. Dates are serialized explicitly as ISO strings.
 */
export function toJsonValue(value: unknown): JsonValue {
	return convertJsonValue(value, [], new Set<object>());
}
