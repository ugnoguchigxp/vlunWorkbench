import { describe, expect, it } from "bun:test";
import { encodeWriterValue } from "./codec";
import {
	encodedValueSchema,
	writerRequestSchema,
	writerResponseSchema,
} from "./protocol";

describe("SQLite Writer protocol validation", () => {
	it("accepts only canonical encoded values", () => {
		expect(encodedValueSchema.parse(encodeWriterValue({ nested: 1n }))).toEqual(
			encodeWriterValue({ nested: 1n }),
		);
		expect(() => encodedValueSchema.parse({ arbitrary: true })).toThrow();
		expect(() =>
			encodedValueSchema.parse({ $type: "bigint", value: "not-an-integer" }),
		).toThrow();
		expect(() =>
			encodedValueSchema.parse({ $type: "bytes", value: "not base64" }),
		).toThrow();
		expect(() =>
			encodedValueSchema.parse({
				$type: "object",
				value: null,
			}),
		).toThrow();
	});

	it("rejects ambiguous responses and unknown request fields", () => {
		expect(() =>
			writerResponseSchema.parse({
				protocolVersion: 3,
				requestId: "request",
				writerInstanceId: "writer",
				sequence: 1,
				ok: false,
			}),
		).toThrow();
		expect(() =>
			writerRequestSchema.parse({
				protocolVersion: 3,
				requestId: "request",
				databaseId: "a".repeat(64),
				kind: "health",
				unexpected: true,
			}),
		).toThrow();
	});
});
