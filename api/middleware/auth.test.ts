import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { requireAuth } from "./auth";
import type { AppEnv } from "../app/env";
import type { AuthService } from "../modules/auth/auth.service";
import { generateAccessToken } from "../modules/auth/token.service";
import { ACCESS_TOKEN_COOKIE_NAME } from "../modules/auth/auth-cookies";

describe("requireAuth middleware", () => {
	let app: Hono;
	let mockAuthService: any;
	let mockEnv: AppEnv;

	const testUser = {
		id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
		email: "test@example.com",
		role: "member" as const,
		isActive: true,
	};

	beforeEach(() => {
		mockEnv = {
			jwtSecret: "x".repeat(32),
			jwtAccessExpiresIn: "15m",
			jwtRefreshExpiresIn: "7d",
		} as unknown as AppEnv;

		mockAuthService = {
			findUserById: vi.fn(),
		};

		app = new Hono();
		app.use(
			"/protected",
			requireAuth({
				env: mockEnv,
				authService: mockAuthService as unknown as AuthService,
			}),
		);
		app.get("/protected", (c) => {
			const authUser = c.get("authUser");
			return c.json({ ok: true, user: authUser });
		});

		// Global error handler mock to prevent vitest output pollution
		app.onError((err, c) => {
			const status = (err as any).status || 500;
			return c.json({ error: err.message }, status);
		});
	});

	it("should allow request with valid authorization bearer token", async () => {
		mockAuthService.findUserById.mockResolvedValue(testUser);

		const token = await generateAccessToken(
			{
				userId: testUser.id,
				email: testUser.email,
				role: testUser.role,
			},
			mockEnv,
		);

		const res = await app.request("/protected", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.user).toEqual({
			userId: testUser.id,
			email: testUser.email,
			role: testUser.role,
		});
	});

	it("should allow request with valid token cookie", async () => {
		mockAuthService.findUserById.mockResolvedValue(testUser);

		const token = await generateAccessToken(
			{
				userId: testUser.id,
				email: testUser.email,
				role: testUser.role,
			},
			mockEnv,
		);

		const res = await app.request("/protected", {
			headers: {
				Cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${token}`,
			},
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.user).toBeDefined();
	});

	it("should return 401 when no token is provided", async () => {
		const res = await app.request("/protected");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("Unauthorized");
	});

	it("should return 401 when token is invalid", async () => {
		const res = await app.request("/protected", {
			headers: {
				Authorization: "Bearer invalid-token-string",
			},
		});
		expect(res.status).toBe(401);
	});

	it("should return 401 when user is not found or inactive", async () => {
		mockAuthService.findUserById.mockResolvedValue(null); // Not found

		const token = await generateAccessToken(
			{
				userId: testUser.id,
				email: testUser.email,
				role: testUser.role,
			},
			mockEnv,
		);

		const res = await app.request("/protected", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		expect(res.status).toBe(401);

		// Inactive user
		mockAuthService.findUserById.mockResolvedValue({
			...testUser,
			isActive: false,
		});
		const res2 = await app.request("/protected", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		expect(res2.status).toBe(401);
	});
});
