import { describe, expect, it } from "vitest";
import { evaluateApiReadonlyPolicy } from "./api-readonly-policy";

describe("API readonly policy", () => {
	it("allows only supported self-contained schema operations", () => {
		expect(evaluateApiReadonlyPolicy({ openapi: "3.1.0", paths: { "/health": { get: {}, post: {} } } })).toEqual({ ok: true, operations: [{ path: "/health", method: "get" }] });
	});
	it("rejects unsupported versions and external references", () => {
		expect(evaluateApiReadonlyPolicy({ openapi: "3.2.0", paths: {} })).toMatchObject({ reasonCode: "openapi_version_not_qualified" });
		expect(evaluateApiReadonlyPolicy({ swagger: "2.0", paths: { "/x": { get: { "$ref": "other.json" } } } })).toMatchObject({ reasonCode: "openapi_external_ref_rejected" });
	});
});
