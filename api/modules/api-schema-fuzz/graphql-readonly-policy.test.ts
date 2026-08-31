import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	isGraphqlQueryOnlyPayload,
	isGraphqlQueryOnlyRequest,
	loadGraphqlReadonlyOperationPolicy,
	parseGraphqlReadonlySchema,
} from "./graphql-readonly-policy";

describe("GraphQL read-only policy", () => {
	it("qualifies a Query-only SDL snapshot", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "graphql-policy-"));
		const schemaPath = path.join(root, "schema.graphql");
		await fs.writeFile(schemaPath, "type Query { health: String! }\n", "utf8");

		await expect(
			loadGraphqlReadonlyOperationPolicy(schemaPath, root),
		).resolves.toMatchObject({
			endpointPath: "/graphql",
			allowedOperation: "query",
			policyHash: expect.stringMatching(/^sha256:/),
		});
	});

	it("rejects mutation, subscription, and executable documents", () => {
		expect(() =>
			parseGraphqlReadonlySchema(
				"type Query { health: String } type Mutation { reset: Boolean }",
			),
		).toThrow("graphql_mutation_not_readonly");
		expect(() =>
			parseGraphqlReadonlySchema(
				"type Query { health: String } type Subscription { events: String }",
			),
		).toThrow("graphql_subscription_not_readonly");
		expect(() => parseGraphqlReadonlySchema("query { health }")).toThrow(
			"graphql_schema_sdl_required",
		);
	});

	it("allows query request documents but rejects all active operations", () => {
		expect(
			isGraphqlQueryOnlyRequest(
				"query Health { health } fragment Details on Status { name }",
			),
		).toBe(true);
		expect(isGraphqlQueryOnlyRequest("mutation { reset } ")).toBe(false);
		expect(isGraphqlQueryOnlyRequest("subscription { events }")).toBe(false);
		expect(
			isGraphqlQueryOnlyRequest("query { health } mutation { reset }"),
		).toBe(false);
	});

	it("accepts only the bounded standard GraphQL transport payload", () => {
		expect(
			isGraphqlQueryOnlyPayload({
				query: "query Health { health }",
				operationName: "Health",
				variables: {},
			}),
		).toBe(true);
		expect(
			isGraphqlQueryOnlyPayload({
				query: "query { health }",
				extensions: { persistedQuery: { sha256Hash: "canary" } },
			}),
		).toBe(false);
		expect(isGraphqlQueryOnlyPayload({ query: "mutation { reset }" })).toBe(
			false,
		);
	});
});
