import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	discoverApiSchema,
	discoverRepositoryApiSchema,
} from "./schema-discovery";

describe("bounded API schema discovery", () => {
	test("finds only known repository candidates", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-discovery-test-"));
		await fs.writeFile(path.join(root, "openapi.json"), JSON.stringify({ openapi: "3.1.0", paths: { "/health": { get: {} } } }), "utf8");
		const result = await discoverApiSchema({ repoPath: root });
		expect(result).toMatchObject({ applicable: true, source: "repository", schemaDigest: expect.stringMatching(/^sha256:/) });
	});

	test("rejects YAML and symlink candidates for the stable profile", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-discovery-test-"));
		await fs.writeFile(path.join(root, "openapi.yaml"), "openapi: 3.1.0", "utf8");
		expect(await discoverRepositoryApiSchema(root)).toMatchObject({ applicable: false, reasonCode: "openapi_yaml_not_qualified" });
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
