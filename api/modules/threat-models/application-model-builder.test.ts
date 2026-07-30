import { describe, expect, test } from "bun:test";
import { buildApplicationModel } from "./application-model-builder";

const projectId = "00000000-0000-4000-8000-000000000001";
const sources = [
	{
		path: "src/routes.ts",
		content: `import { Hono } from "hono";
const app = new Hono();
app.get("/users/:userId", handler);
app.post("/orders", handler);`,
	},
	{
		path: "app/api.py",
		content: `from fastapi import FastAPI
app = FastAPI()
@app.get("/reports/{report_id}")
def report(): pass
@app.delete("/sessions/{session_id}")
def revoke(): pass`,
	},
	{
		path: "src/Controller.java",
		content: `class Controller {
@GetMapping("/health")
void health() {}
@PostMapping("/refunds")
void refund() {}
}`,
	},
	{
		path: "cmd/api/main.go",
		content: `package main
import "github.com/gin-gonic/gin"
func routes(r *gin.Engine) {
r.GET("/items/:itemId", handler)
r.PATCH("/items/:itemId", handler)
}`,
	},
];

describe("application model builder", () => {
	test("discovers supported framework endpoints with deterministic hashes", () => {
		const first = buildApplicationModel({ projectId, sources });
		const second = buildApplicationModel({
			projectId,
			sources: [...sources].reverse(),
		});
		const expected = new Set([
			"GET /users/{userId}",
			"POST /orders",
			"GET /reports/{report_id}",
			"DELETE /sessions/{session_id}",
			"GET /health",
			"POST /refunds",
			"GET /items/{itemId}",
			"PATCH /items/{itemId}",
		]);
		const actual = new Set(
			first.entrypoints.map((item) => `${item.method} ${item.path}`),
		);
		const truePositive = [...actual].filter((item) => expected.has(item)).length;
		const recall = truePositive / expected.size;
		const precision = truePositive / actual.size;
		expect({ recall, precision }).toEqual({ recall: 1, precision: 1 });
		expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
		expect(first.snapshotHash).toBe(second.snapshotHash);
		expect(first.entrypoints.every((item) => item.evidenceRefs.length > 0)).toBe(
			true,
		);
	});

	test("merges source, OpenAPI, and runtime evidence and preserves conflicts", () => {
		const model = buildApplicationModel({
			projectId,
			sources: [sources[0]],
			openApiOperations: [
				{ method: "GET", path: "/users/{userId}", ref: "getUser" },
				{ method: "PUT", path: "/orders", ref: "replaceOrder" },
			],
			runtimeRoutes: [
				{ method: "GET", path: "/users/{userId}", ref: "runtime:getUser" },
			],
		});
		const endpoint = model.entrypoints.find(
			(item) => item.method === "GET" && item.path === "/users/{userId}",
		);
		expect(endpoint?.evidenceRefs.map((item) => item.kind).sort()).toEqual([
			"openapi_operation",
			"runtime_route",
			"source",
		]);
		expect(model.assumptions).toContainEqual(
			expect.objectContaining({
				status: "conflict",
				statement: expect.stringContaining("/orders"),
			}),
		);
	});
});
