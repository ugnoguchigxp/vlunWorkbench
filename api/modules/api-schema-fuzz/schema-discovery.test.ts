import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	discoverApiSchema,
	discoverRepositoryApiSchema,
} from "./schema-discovery";

describe("bounded API schema discovery", () => {
	test("finds only known repository candidates", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "schema-discovery-test-"));
		await fs.writeFile(path.join(root, "openapi.json"), "{}", "utf8");
		const result = await discoverApiSchema({ repoPath: root });
		expect(result).toMatchObject({ applicable: true, source: "repository" });
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
