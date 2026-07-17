import { describe, expect, it } from "bun:test";
import { decodeWriterValue, encodeWriterValue } from "./codec";

describe("SQLite Writer value codec", () => {
	it("round-trips nested values, bigint, and bytes", () => {
		const input = {
			id: 42n,
			bytes: Uint8Array.from([0, 1, 127, 255]),
			nested: [true, null, "value", { count: 3 }],
		};
		const decoded = decodeWriterValue(encodeWriterValue(input)) as typeof input;
		expect(decoded.id).toBe(42n);
		expect([...decoded.bytes]).toEqual([0, 1, 127, 255]);
		expect(decoded.nested).toEqual(input.nested);
	});

	it("rejects non-finite numbers", () => {
		expect(() => encodeWriterValue(Number.NaN)).toThrow("non-finite");
		expect(() => encodeWriterValue(Number.POSITIVE_INFINITY)).toThrow(
			"non-finite",
		);
	});

	it("preserves ordinary objects that resemble protocol tags", () => {
		const input = {
			bigintLike: { $type: "bigint", value: "123" },
			bytesLike: { $type: "bytes", value: "YWJj" },
			objectLike: { $type: "object", value: { nested: true } },
		};
		expect(decodeWriterValue(encodeWriterValue(input))).toEqual(input);
	});

	it("rejects values that cannot be represented without data loss", () => {
		expect(() => encodeWriterValue(new Date())).toThrow("Date");
		expect(() => encodeWriterValue(new Array(1))).toThrow("sparse arrays");
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => encodeWriterValue(cyclic)).toThrow("cyclic values");
		expect(() => encodeWriterValue({ [Symbol("hidden")]: true })).toThrow(
			"symbol-keyed",
		);
	});
});
