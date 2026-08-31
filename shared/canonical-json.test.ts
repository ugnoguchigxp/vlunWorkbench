import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
	it("sorts object keys recursively without changing array order", () => {
		expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true })).toBe(
			'{"a":true,"z":[{"a":1,"b":2}]}',
		);
	});

	it("rejects values that cannot be represented in an immutable receipt", () => {
		expect(() => canonicalJson({ value: Number.NaN })).toThrow(
			"canonical_json_non_finite_number",
		);
		expect(() => canonicalJson({ value: "\ud800" })).toThrow(
			"canonical_json_lone_surrogate",
		);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(() => canonicalJson(cycle)).toThrow("canonical_json_cycle");
	});
});
