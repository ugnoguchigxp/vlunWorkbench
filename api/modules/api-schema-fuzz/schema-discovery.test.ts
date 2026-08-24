import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	discoverApiSchema,
	discoverRepositoryApiSchema,
	readBoundedSchemaResponse,
} from "./schema-discovery";

describe("bounded API schema discovery", () => {
	test("finds only known repository candidates", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-discovery-test-"));
		await fs.writeFile(path.join(root, "openapi.json"), JSON.stringify({ openapi: "3.1.0", paths: { "/health": { get: {} } } }), "utf8");
		const result = await discoverApiSchema({ repoPath: root });
		expect(result).toMatchObject({ applicable: true, source: "repository", schemaDigest: expect.stringMatching(/^sha256:/) });
	});

	test("accepts a Query-only GraphQL SDL and rejects active roots", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-discovery-test-"));
		await fs.writeFile(
			path.join(root, "schema.graphql"),
			"type Query { health: String! }\n",
			"utf8",
		);
		expect(await discoverRepositoryApiSchema(root)).toMatchObject({
			applicable: true,
			schemaKind: "graphql",
			schemaPath: path.join(root, "schema.graphql"),
		});
		await fs.writeFile(
			path.join(root, "schema.graphql"),
			"type Query { health: String } type Mutation { reset: Boolean }\n",
			"utf8",
		);
		expect(await discoverRepositoryApiSchema(root)).toMatchObject({
			applicable: false,
			schemaKind: null,
			reasonCode: "graphql_mutation_not_readonly",
		});
	});

	test("accepts bounded YAML and still rejects symlink candidates", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-discovery-test-"));
		await fs.writeFile(
			path.join(root, "openapi.yaml"),
			"openapi: 3.1.0\npaths:\n  /health:\n    get: {}\n",
			"utf8",
		);
		expect(await discoverRepositoryApiSchema(root)).toMatchObject({
			applicable: true,
			source: "repository",
			schemaPath: path.join(root, "openapi.yaml"),
		});
		await fs.rm(path.join(root, "openapi.yaml"));
		const outside = path.join(os.tmpdir(), `outside-${Date.now()}.json`);
		await fs.writeFile(outside, JSON.stringify({ openapi: "3.1.0", paths: { "/": { get: {} } } }));
		await fs.symlink(outside, path.join(root, "openapi.json"));
		expect(await discoverRepositoryApiSchema(root)).toMatchObject({ applicable: false, reasonCode: "strict_json_regular_file_required" });
		await fs.rm(outside);
	});

	test("classifies auth-only schema probes separately", async () => {
		const result = await discoverApiSchema({ repoPath: "/tmp/no-schema", targetOrigin: "http://127.0.0.1:1", fetchImpl: async () => new Response("", { status: 401 }) });
		expect(result.reasonCode).toBe("authentication_required");
	});

	test("continues past a protected candidate and accepts a later public schema", async () => {
		const result = await discoverApiSchema({
			repoPath: "/tmp/no-schema",
			targetOrigin: "http://127.0.0.1:1",
			fetchImpl: async (url) =>
				url.pathname === "/openapi.json"
					? new Response("", { status: 401 })
					: new Response(
							JSON.stringify({
								openapi: "3.1.0",
								paths: { "/health": { get: {} } },
							}),
							{ status: 200 },
						),
		});
		expect(result).toMatchObject({
			applicable: true,
			source: "target",
			apiEvidencePaths: ["/swagger.json"],
		});
	});

	test("stops reading a target schema response at the byte limit", async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2, 3]));
					controller.enqueue(new Uint8Array([4, 5, 6]));
				},
				cancel() {
					cancelled = true;
				},
			}),
		);
		await expect(readBoundedSchemaResponse(response, 4)).rejects.toThrow(
			"api_schema_response_size_exceeded",
		);
		expect(cancelled).toBe(true);
	});

	test("selects authenticated safe operations only when auth is bound", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-auth-test-"));
		await fs.writeFile(
			path.join(root, "openapi.json"),
			JSON.stringify({
				openapi: "3.1.0",
				security: [{ bearer: [] }],
				paths: { "/me": { get: {} } },
			}),
			"utf8",
		);
		expect(await discoverRepositoryApiSchema(root)).toMatchObject({
			applicable: false,
			reasonCode: "no_unauthenticated_readonly_operations",
		});
		expect(
			await discoverRepositoryApiSchema(root, {
				includeAuthenticatedOperations: true,
			}),
		).toMatchObject({
			applicable: true,
			schemaKind: "openapi",
		});
	});

	test("selects authenticated target operations only when auth is bound", async () => {
		const targetSchema = JSON.stringify({
			openapi: "3.1.0",
			security: [{ bearer: [] }],
			paths: { "/me": { get: {} } },
		});
		const fetchImpl = async () => new Response(targetSchema, { status: 200 });
		const anonymous = await discoverApiSchema({
			repoPath: "/tmp/no-schema",
			targetOrigin: "http://127.0.0.1:1",
			fetchImpl,
		});
		expect(anonymous).toMatchObject({
			applicable: false,
			reasonCode: "schema_not_found",
		});
		const authenticated = await discoverApiSchema({
			repoPath: "/tmp/no-schema",
			targetOrigin: "http://127.0.0.1:1",
			fetchImpl,
			includeAuthenticatedOperations: true,
		});
		expect(authenticated).toMatchObject({
			applicable: true,
			source: "target",
			schemaKind: "openapi",
		});
		await fs.rm(authenticated.cleanupPath as string, {
			recursive: true,
			force: true,
		});
	});

	test("records bounded first-party route evidence when an API lacks a schema", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-api-evidence-"));
		await fs.mkdir(path.join(root, "src"));
		await fs.writeFile(
			path.join(root, "src", "server.ts"),
			'const app = express(); app.get("/health", () => undefined);',
			"utf8",
		);
		const result = await discoverRepositoryApiSchema(root);
		expect(result).toMatchObject({
			applicable: false,
			apiDetected: true,
			apiEvidencePaths: ["src/server.ts"],
			reasonCode: "schema_not_found",
		});
	});
});
