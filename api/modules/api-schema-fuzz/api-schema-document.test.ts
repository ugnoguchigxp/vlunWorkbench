import { describe, expect, test } from "bun:test";
import { parseApiSchemaDocument } from "./api-schema-document";

describe("API schema document parser", () => {
	test("parses a bounded YAML OpenAPI document", () => {
		expect(
			parseApiSchemaDocument(
				"openapi: 3.1.0\npaths:\n  /health:\n    get: {}\n",
				"yaml",
			),
		).toMatchObject({ openapi: "3.1.0", paths: { "/health": { get: {} } } });
	});

	test("rejects YAML aliases and prototype keys", () => {
		expect(() =>
			parseApiSchemaDocument("base: &base {get: {}}\npaths: {/: *base}", "yaml"),
		).toThrow("api_schema_yaml_alias_rejected");
		expect(() =>
			parseApiSchemaDocument("__proto__: {polluted: true}", "yaml"),
		).toThrow("api_schema_yaml_prototype_key");
	});
});
