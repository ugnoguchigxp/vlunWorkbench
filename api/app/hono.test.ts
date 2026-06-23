import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { HttpError } from "../modules/auth/errors";
import { HTTPException } from "hono/http-exception";

// Mock environment and DB connection before importing app
vi.mock("../db", () => ({
	createDbConnection: vi.fn().mockReturnValue({
		db: {
			query: {
				users: {
					findFirst: vi.fn(),
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
		port: 5173,
		databaseUrl: "file:./data/test.sqlite",
		jwtSecret: "x".repeat(32),
		jwtAccessExpiresIn: "15m",
		jwtRefreshExpiresIn: "7d",
		appUrl: "http://localhost:5173",
		corsOrigins: ["http://localhost:5173"],
		trustProxy: true,
		secureCookie: false,
		cookieSameSite: "lax",
		securityHeadersMode: "auto",
	}),
}));

// Mock Bun global variable before importing hono/bun dependent code
(globalThis as any).Bun = {
	file: (path: string) => ({
		exists: () => Promise.resolve(true),
	}),
};

// Dynamically import app so globalThis.Bun is defined first
const { default: app } = await import("./hono");

// Add test routes before any request is processed (Hono routers lock after first request)
app.post("/api/test-http-error", () => {
	throw new HttpError(400, "Bad Parameters");
});

app.post("/api/test-hono-http-exception", () => {
	throw new HTTPException(403, { message: "Access Forbidden" });
});

app.post("/api/test-generic-error", () => {
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
				Origin: "http://localhost:5173",
			},
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");

		const resInvalid = await app.request("/api/health", {
			headers: {
				Origin: "http://unauthorized.com",
			},
		});
		expect(resInvalid.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("should handle not found on api endpoints", async () => {
		const res = await app.request("/api/not-a-valid-route");
		expect(res.status).toBe(404);
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
			const res = await app.request("http://localhost:5173/api/test-http-error", {
				method: "POST",
				headers: {
					Origin: "http://localhost:5173",
				},
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.message).toBe("Bad Parameters");
		});

		it("should handle HTTPException and return custom status and message", async () => {
			const res = await app.request("http://localhost:5173/api/test-hono-http-exception", {
				method: "POST",
				headers: {
					Origin: "http://localhost:5173",
				},
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Access Forbidden");
		});

		it("should handle generic errors as 500 Internal Server Error", async () => {
			const res = await app.request("http://localhost:5173/api/test-generic-error", {
				method: "POST",
				headers: {
					Origin: "http://localhost:5173",
				},
			});
			expect(res.status).toBe(500);
			const body = await res.json();
			expect(body.message).toBe("Something blew up");
		});
	});
});
