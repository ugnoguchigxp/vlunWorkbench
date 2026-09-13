import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStorage } from "../scans/execution/lifecycle/artifact-storage";
import { buildGraphqlReadonlyOperationPolicy } from "./graphql-readonly-policy";
import { parseOpenApiDocument } from "./openapi-document";
import { buildOpenApiReadonlyOperationPolicy } from "./openapi-readonly-operation-policy";
import {
	buildSchemathesisNamespaceGatewayInvocation,
	buildSchemathesisNamespaceGatewayPolicy,
	operationPoliciesMatch,
	runSchemathesisReadonly,
	sanitizeSchemathesisOutput,
} from "./schemathesis-runner";

const openApiDocument = {
	openapi: "3.1.0",
	servers: [{ url: "/api" }],
	paths: {
		"/health": {
			get: { operationId: "health", security: [] },
		},
	},
};

function spawnMock(outputWriter?: (outputPath: string) => Promise<void>) {
	return vi.spyOn(Bun, "spawn").mockImplementation((args) => {
		const argv = Array.isArray(args) ? args.map(String) : [];
		if (argv[1] === "--version") {
			return {
				exited: Promise.resolve(0),
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("3.2.0\n"));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
			} as never;
		}
		const outputIndex = argv.indexOf("--report-ndjson-path");
		const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
		let writePromise = Promise.resolve();
		if (outputPath && outputWriter) {
			writePromise = outputWriter(outputPath);
		}
		return {
			exited: writePromise.then(() => 0),
			stdout: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("st run ok"));
					controller.close();
				},
			}),
			stderr: new ReadableStream({
				start(controller) {
					controller.close();
				},
			}),
		} as never;
	});
}

describe("schemathesis runner helpers", () => {
	it("redacts secrets and matches operation policies", () => {
		expect(sanitizeSchemathesisOutput("token=secret")).toContain("token=");
		expect(
			sanitizeSchemathesisOutput("visible", (value) => value.replace("visible", "hidden")),
		).toBe("hidden");
		const openApiPolicy = buildOpenApiReadonlyOperationPolicy(
			parseOpenApiDocument(openApiDocument),
			"sha256:schema",
		);
		const graphqlPolicy = buildGraphqlReadonlyOperationPolicy("sha256:gql");
		expect(operationPoliciesMatch(openApiPolicy, openApiPolicy)).toBe(true);
		expect(operationPoliciesMatch(openApiPolicy, graphqlPolicy)).toBe(false);
	});

	it("builds OpenAPI and GraphQL namespace gateway policies", () => {
		const openApiPolicy = buildOpenApiReadonlyOperationPolicy(
			parseOpenApiDocument(openApiDocument),
			"sha256:schema",
		);
		const openApiGateway = buildSchemathesisNamespaceGatewayPolicy({
			targetOrigin: "http://127.0.0.1:9",
			operationPolicy: openApiPolicy,
			upstreamRequestHeaders: { "X-Role": "user" },
			maxRequests: 10,
			rateLimitPerSec: 2,
		});
		expect(openApiGateway).toMatchObject({
			schemaVersion: 1,
			upstreamOrigin: "http://127.0.0.1:9",
			graphqlQueryOnly: false,
			graphqlEndpointPath: null,
			authHeaders: { "X-Role": "user" },
			maxRequests: 10,
		});
		expect(openApiGateway.operations).toEqual([
			{ method: "GET", pathTemplate: "/api/health" },
		]);
		const graphqlGateway = buildSchemathesisNamespaceGatewayPolicy({
			targetOrigin: "http://127.0.0.1:9",
			operationPolicy: buildGraphqlReadonlyOperationPolicy("sha256:gql"),
			upstreamRequestHeaders: {},
			maxRequests: 4,
			rateLimitPerSec: 1,
		});
		expect(graphqlGateway).toMatchObject({
			graphqlQueryOnly: true,
			graphqlEndpointPath: "/graphql",
			operations: [{ method: "POST", pathTemplate: "/graphql" }],
		});
		expect(
			buildSchemathesisNamespaceGatewayInvocation("/tmp/policy.json", [
				"run",
				"--url",
				"http://127.0.0.1",
			]),
		).toEqual({
			binaryName: "vwb-schemathesis-readonly-gateway",
			args: ["run", "/tmp/policy.json", "--", "run", "--url", "http://127.0.0.1"],
		});
	});
});

describe("runSchemathesisReadonly", () => {
	let tempDir: string;

	afterEach(async () => {
		vi.restoreAllMocks();
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns structured failures for invalid schema and policy mismatch", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schemathesis-run-"));
		const storage = new ArtifactStorage(path.join(tempDir, "artifacts"));
		const missing = await runSchemathesisReadonly({
			scanRunId: "00000000-0000-4000-8000-000000000001",
			schemaPath: path.join(tempDir, "missing.json"),
			repoPath: tempDir,
			targetOrigin: "http://127.0.0.1:9",
			storage,
		});
		expect(missing).toMatchObject({
			ok: false,
			error: "ENOENT",
		});

		const schemaPath = path.join(tempDir, "openapi.json");
		await fs.writeFile(schemaPath, JSON.stringify(openApiDocument), "utf8");
		const mismatched = await runSchemathesisReadonly({
			scanRunId: "00000000-0000-4000-8000-000000000002",
			schemaPath,
			repoPath: tempDir,
			targetOrigin: "http://127.0.0.1:9",
			storage,
			operationPolicy: buildOpenApiReadonlyOperationPolicy(
				parseOpenApiDocument(openApiDocument),
				"sha256:other",
			),
		});
		expect(mismatched).toMatchObject({
			ok: false,
			error: "openapi_operation_policy_mismatch",
		});
	});

	it("returns tool_unavailable when the host binary is missing", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schemathesis-run-"));
		const schemaPath = path.join(tempDir, "openapi.json");
		await fs.writeFile(schemaPath, JSON.stringify(openApiDocument), "utf8");
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("ENOENT");
		});
		const result = await runSchemathesisReadonly({
			scanRunId: "00000000-0000-4000-8000-000000000003",
			schemaPath,
			repoPath: tempDir,
			targetOrigin: "http://127.0.0.1:9",
			storage: new ArtifactStorage(path.join(tempDir, "artifacts")),
		});
		expect(result).toMatchObject({
			ok: false,
			exitCode: 127,
			error: "tool_unavailable",
		});
	});

	it("persists sanitized OpenAPI findings through a namespace gateway", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schemathesis-run-"));
		const schemaPath = path.join(tempDir, "openapi.json");
		await fs.writeFile(schemaPath, JSON.stringify(openApiDocument), "utf8");
		spawnMock(async (outputPath) => {
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.writeFile(
				outputPath,
				`${JSON.stringify({
					status: "failure",
					operation: "GET /api/health",
					check: "status_code_conformance",
					message: "unexpected 500",
				})}\n`,
				"utf8",
			);
		});
		const result = await runSchemathesisReadonly({
			scanRunId: "00000000-0000-4000-8000-000000000004",
			schemaPath,
			repoPath: tempDir,
			targetOrigin: "http://127.0.0.1:9",
			storage: new ArtifactStorage(path.join(tempDir, "artifacts")),
			namespaceGateway: {
				upstreamRequestHeaders: { "X-Role": "user" },
				maxRequests: 10,
				rateLimitPerSec: 2,
			},
			sanitizeOutput: (value) => value.replace("unexpected", "redacted"),
		});
		expect(result.ok).toBe(true);
		expect(result.toolVersion).toContain("3.2.0");
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.description).toContain("redacted");
		expect(result.rawArtifact?.path).toContain("schemathesis.ndjson");
	});

	it("runs a GraphQL schema through the readonly runner", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schemathesis-run-"));
		const schemaPath = path.join(tempDir, "schema.graphql");
		await fs.writeFile(schemaPath, "type Query { health: String! }\n", "utf8");
		spawnMock(async (outputPath) => {
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.writeFile(outputPath, "\n", "utf8");
		});
		const result = await runSchemathesisReadonly({
			scanRunId: "00000000-0000-4000-8000-000000000005",
			schemaPath,
			repoPath: tempDir,
			targetOrigin: "http://127.0.0.1:9",
			schemaKind: "graphql",
			storage: new ArtifactStorage(path.join(tempDir, "artifacts")),
		});
		expect(result.ok).toBe(true);
		expect(result.findings).toEqual([]);
	});

	it("reports invalid structured output when the report file is missing", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schemathesis-run-"));
		const schemaPath = path.join(tempDir, "openapi.json");
		await fs.writeFile(schemaPath, JSON.stringify(openApiDocument), "utf8");
		spawnMock();
		const result = await runSchemathesisReadonly({
			scanRunId: "00000000-0000-4000-8000-000000000006",
			schemaPath,
			repoPath: tempDir,
			targetOrigin: "http://127.0.0.1:9",
			storage: new ArtifactStorage(path.join(tempDir, "artifacts")),
		});
		expect(result).toMatchObject({
			ok: false,
			error: "invalid_structured_output",
		});
	});
});
