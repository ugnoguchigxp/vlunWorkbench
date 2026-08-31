/**
 * RFC 8785-compatible canonical JSON for the JSON values used in signed
 * security receipts. JavaScript's number and string serialization matches the
 * RFC's ECMAScript serialization requirements; object keys are sorted by their
 * UTF-16 code units before serialization.
 */
export function canonicalJson(value: unknown): string {
	return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
	if (value === null) return "null";
	switch (typeof value) {
		case "boolean":
			return value ? "true" : "false";
		case "number":
			if (!Number.isFinite(value)) {
				throw new TypeError("canonical_json_non_finite_number");
			}
			return JSON.stringify(value);
		case "string":
			assertNoLoneSurrogate(value);
			return JSON.stringify(value);
		case "object":
			if (ancestors.has(value)) throw new TypeError("canonical_json_cycle");
			ancestors.add(value);
			try {
				if (Array.isArray(value)) {
					return `[${value.map((entry) => serialize(entry, ancestors)).join(",")}]`;
				}
				if (Object.getPrototypeOf(value) !== Object.prototype) {
					throw new TypeError("canonical_json_non_plain_object");
				}
				const record = value as Record<string, unknown>;
				return `{${Object.keys(record)
					.sort()
					.map((key) => {
						assertNoLoneSurrogate(key);
						const entry = record[key];
						if (entry === undefined || typeof entry === "function") {
							throw new TypeError("canonical_json_unsupported_value");
						}
						return `${JSON.stringify(key)}:${serialize(entry, ancestors)}`;
					})
					.join(",")}}`;
			} finally {
				ancestors.delete(value);
			}
		default:
			throw new TypeError("canonical_json_unsupported_value");
	}
}

function assertNoLoneSurrogate(value: string) {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit < 0xd800 || unit > 0xdfff) continue;
		const isHigh = unit <= 0xdbff;
		const next = value.charCodeAt(index + 1);
		if (!isHigh || !Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
			throw new TypeError("canonical_json_lone_surrogate");
		}
		index += 1;
	}
}
