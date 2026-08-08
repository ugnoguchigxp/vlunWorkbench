import fs from "node:fs/promises";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../modules/auth/errors";

// Mock environment and DB connection before importing app
vi.mock("../db", () => ({
	writerClientForDatabase: vi.fn().mockReturnValue(undefined),
	runInProcessDbTransaction: vi.fn((db, callback) => callback(db)),
	createDbConnection: vi.fn().mockReturnValue({
		db: {
			query: {
				users: {
					findFirst: vi.fn(),
				},
				runtimeSettings: {
					findFirst: vi.fn().mockResolvedValue(undefined),
				},
					scanRuns: {
						findMany: vi.fn().mockResolvedValue([]),
					},
					scanReports: {
						findMany: vi.fn().mockResolvedValue([]),
					},
					scanDiagnosticRuns: {
						findMany: vi.fn().mockResolvedValue([]),
					},
					activeAssessmentRuns: {
						findMany: vi.fn().mockResolvedValue([]),
					},
					businessLogicRuns: {
						findMany: vi.fn().mockResolvedValue([]),
					},
				},
		},
		sqlite: {
			close: vi.fn(),
		},
		ownsConnection: false,
	}),
}));

vi.mock("./env", () => ({
	readAppEnv: vi.fn().mockReturnValue({
		nodeEnv: "test",
		host: "127.0.0.1",
		port: 29831,
		databaseUrl: "file:./data/test.sqlite",
		jwtSecret: "x".repeat(32),
		jwtAccessExpiresIn: "15m",
		jwtRefreshExpiresIn: "7d",
		appUrl: "http://localhost:29831",
		corsOrigins: ["http://localhost:29831"],
		trustProxy: true,
		secureCookie: false,
		cookieSameSite: "lax",
		securityHeadersMode: "auto",
		codexSdkTimeoutMs: 600_000,
	}),
}));

// Mock Bun global variable before importing hono/bun dependent code if not already in Bun runtime
if (!("Bun" in globalThis)) {
	(globalThis as any).Bun = {
		file: (path: string) => ({
			exists: () => Promise.resolve(true),
		}),
	};
}

// Dynamically import app so globalThis.Bun is defined first
const { default: app } = await import("./hono");

// Add test routes before any request is processed (Hono routers lock after first request)
app.post("/test-http-error", () => {
	throw new HttpError(400, "Bad Parameters");
});

app.post("/test-hono-http-exception", () => {
	throw new HTTPException(403, { message: "Access Forbidden" });
});

app.post("/test-generic-error", () => {
	throw new Error("Something blew up");
});

describe("hono app entry", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("should return 200 for /api/health", async () => {
		const res = await app.request("/api/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	it("should handle CORS origins", async () => {
		const res = await app.request("/api/health", {
			headers: {
				Origin: "http://localhost:29831",
			},
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:29831");
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");

		const resInvalid = await app.request("/api/health", {
			headers: {
				Origin: "http://unauthorized.com",
			},
		});
		expect(resInvalid.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("should require authentication for unknown api endpoints", async () => {
		const res = await app.request("/api/not-a-valid-route");
		expect(res.status).toBe(401);
	});

	it("protects assessment metadata endpoints by default", async () => {
		for (const path of [
			"/api/assessment-controls",
			"/api/active-assessment-container-fixtures",
		]) {
			expect((await app.request(path)).status).toBe(401);
		}
	});

	it("should return frontend fallback warning when frontend is not built", async () => {
		// Mock fs.readFile to throw error so frontend build is missing
		vi.spyOn(fs, "readFile").mockRejectedValue(new Error("File not found"));

		const res = await app.request("/some-frontend-path");
		expect(res.status).toBe(404);
		const body = await res.text();
		expect(body).toContain("Frontend is not built");
	});

	it("should return index.html content when frontend is built", async () => {
		// Mock fs.readFile to return fake HTML
		vi.spyOn(fs, "readFile").mockResolvedValue("<html>mock-frontend</html>");

		const res = await app.request("/some-frontend-path");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/html");
		const body = await res.text();
		expect(body).toBe("<html>mock-frontend</html>");
	});

	// Error Handler integration tests
	describe("Error Handler", () => {
		it("should handle HttpError and return custom status and message", async () => {
			const res = await app.request("http://localhost:29831/test-http-error", {
				method: "POST",
				headers: {
					Origin: "http://localhost:29831",
				},
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.message).toBe("Bad Parameters");
		});

		it("should handle HTTPException and return custom status and message", async () => {
			const res = await app.request("http://localhost:29831/test-hono-http-exception", {
				method: "POST",
				headers: {
					Origin: "http://localhost:29831",
				},
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Access Forbidden");
		});

		it("should handle generic errors as 500 Internal Server Error", async () => {
			const res = await app.request("http://localhost:29831/test-generic-error", {
				method: "POST",
				headers: {
					Origin: "http://localhost:29831",
				},
			});
			expect(res.status).toBe(500);
			const body = await res.json();
			expect(body.message).toBe("Something blew up");
		});
	});
});
