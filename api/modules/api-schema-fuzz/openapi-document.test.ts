import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseOpenApiDocument } from "./openapi-document";
import { buildOpenApiReadonlyOperationPolicy } from "./openapi-readonly-operation-policy";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("strict OpenAPI document", () => {
	it.each(["3.0.0", "3.0.4", "3.1.0", "3.1.2"])("selects exact unauthenticated safe operations for OpenAPI %s", (openapi) => {
		const parsed = parseOpenApiDocument({ openapi, servers: [{ url: "/api" }], security: [{ bearer: [] }], paths: { "/users/{id}": { parameters: [{ in: "path", name: "id", required: true }], get: { operationId: "getUser", security: [] }, head: { security: [{ bearer: [] }] }, post: {} } } });
		expect(parsed.operations).toEqual([{ method: "GET", pathTemplate: "/users/{id}", operationId: "getUser" }]);
		const first = buildOpenApiReadonlyOperationPolicy(parsed, sha("schema"));
		expect(buildOpenApiReadonlyOperationPolicy(parsed, sha("schema"))).toEqual(first);
		expect(
			parseOpenApiDocument(
				{ openapi, servers: [{ url: "/api" }], security: [{ bearer: [] }], paths: { "/users/{id}": { parameters: [{ in: "path", name: "id", required: true }], get: { operationId: "getUser", security: [] }, head: { security: [{ bearer: [] }] }, post: {} } } },
				{ includeAuthenticatedOperations: true },
			).operations,
		).toEqual([
			{ method: "GET", pathTemplate: "/users/{id}", operationId: "getUser" },
			{ method: "HEAD", pathTemplate: "/users/{id}", operationId: "HEAD /users/{id}" },
		]);
	});

	it("supports Swagger 2 and internal parameter references", () => {
		const parsed = parseOpenApiDocument({ swagger: "2.0", basePath: "/v1", parameters: { id: { in: "path", name: "id", required: true } }, paths: { "/items/{id}": { get: { parameters: [{ $ref: "#/parameters/id" }] } } } });
		expect(parsed).toMatchObject({ format: "swagger-2.0", basePath: "/v1" });
	});

	it("rejects external/cyclic refs, callbacks, invalid servers, and parameter mismatch", () => {
		for (const document of [
			{ openapi: "3.1.0", paths: {}, components: { schemas: { x: { $ref: "file.json#/x" } } } },
			{ openapi: "3.1.0", paths: {}, components: { schemas: { x: { $ref: "#/components/schemas/x" } } } },
			{ openapi: "3.1.0", webhooks: {}, paths: {} },
			{ openapi: "3.1.0", servers: [{ url: "/a" }, { url: "/b" }], paths: {} },
			{ openapi: "3.1.0", paths: { "/x/{id}": { get: {} } } },
		]) expect(() => parseOpenApiDocument(document)).toThrow(/openapi_/);
	});
});
