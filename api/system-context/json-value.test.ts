import { describe, expect, test } from "bun:test";
import { toJsonValue } from "./json-value";

describe("toJsonValue", () => {
	test("snapshots nested values and serializes dates explicitly", () => {
		const source = {
			id: "scan-1",
			startedAt: new Date("2026-07-24T00:00:00.000Z"),
			findings: [{ severity: "high" }],
		};

		const value = toJsonValue(source);
		source.findings[0]!.severity = "low";

		expect(value).toEqual({
			id: "scan-1",
			startedAt: "2026-07-24T00:00:00.000Z",
			findings: [{ severity: "high" }],
		});
	});

	test("rejects unsupported and cyclic values with a useful path", () => {
		expect(() => toJsonValue({ nested: { value: undefined } })).toThrow(
			"nested.value",
		);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => toJsonValue(cyclic)).toThrow("self");
	});
});
