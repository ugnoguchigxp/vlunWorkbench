import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readProjectSupplementalModelEvidence } from "./project-model-evidence-reader";

let root: string | null = null;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = null;
});

describe("project supplemental model evidence reader", () => {
	test("reads JSON/YAML OpenAPI operations and SQL tables with evidence refs", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "model-evidence-"));
		await writeFile(
			path.join(root, "openapi.json"),
			JSON.stringify({
				openapi: "3.1.0",
				paths: { "/users/{id}": { get: {}, delete: {} } },
			}),
		);
		await writeFile(
			path.join(root, "swagger.yaml"),
			"openapi: 3.0.0\npaths:\n  /orders:\n    post:\n      responses: {}\n",
		);
		await writeFile(
			path.join(root, "schema.sql"),
			'CREATE TABLE IF NOT EXISTS "orders" (id text);',
		);
		const result = await readProjectSupplementalModelEvidence(root);
		expect(
			result.openApiOperations?.map((item) => `${item.method} ${item.path}`),
		).toEqual(["DELETE /users/{id}", "GET /users/{id}", "POST /orders"]);
		expect(result.databaseTables).toEqual([
			expect.objectContaining({ name: "orders", ref: "schema.sql:1" }),
		]);
	});
});
