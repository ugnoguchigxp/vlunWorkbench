import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createAuthRoute } from "./auth.route";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../app/env";
import type { AuthService } from "../modules/auth/auth.service";
import { HttpError } from "../modules/auth/errors";
import {
	ACCESS_TOKEN_COOKIE_NAME,
	REFRESH_TOKEN_COOKIE_NAME,
} from "../modules/auth/auth-cookies";

describe("auth route", () => {
	let app: Hono;
	let mockAuthService: any;
	let mockEnv: AppEnv;

	const testUser = {
		id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
		email: "test@example.com",
		displayName: "Test User",
		role: "member" as const,
		isActive: true,
	};

	beforeEach(() => {
		mockEnv = {
			jwtSecret: "x".repeat(32),
			jwtAccessExpiresIn: "15m",
			jwtRefreshExpiresIn: "7d",
			secureCookie: true,
			cookieSameSite: "lax",
		} as unknown as AppEnv;

		mockAuthService = {
			login: vi.fn(),
			refresh: vi.fn(),
			logout: vi.fn(),
			findUserById: vi.fn(),
		};

		app = new Hono();
		// Set error handler to prevent throwing unhandled exceptions in tests
		app.onError((err, c) => {
			const status = (err as HttpError).status || 500;
			return c.json({ message: err.message }, status as any);
		});

		app.use(
			"/auth/me",
			requireAuth({
				env: mockEnv,
				authService: mockAuthService as unknown as AuthService,
			}),
		);
		app.route(
			"/auth",
			createAuthRoute({
				authService: mockAuthService as unknown as AuthService,
				env: mockEnv,
			}),
		);
	});

	describe("POST /login", () => {
		it("should login user with valid credentials and set cookies", async () => {
			mockAuthService.login.mockResolvedValue({
				accessToken: "access-token-123",
				refreshToken: "refresh-token-456",
				user: {
					id: testUser.id,
					email: testUser.email,
					displayName: testUser.displayName,
					role: testUser.role,
				},
			});

			const res = await app.request("/auth/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: "test@example.com",
					password: "password123",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user.email).toBe(testUser.email);
			expect(mockAuthService.login).toHaveBeenCalledWith({
				email: "test@example.com",
				password: "password123",
			});

			// Check set-cookie headers
			const cookies = res.headers.getSetCookie();
			expect(cookies.some((c) => c.includes(ACCESS_TOKEN_COOKIE_NAME))).toBe(
				true,
			);
			expect(cookies.some((c) => c.includes(REFRESH_TOKEN_COOKIE_NAME))).toBe(
				true,
			);
		});

		it("should return validation error for invalid email format", async () => {
			const res = await app.request("/auth/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: "invalid-email",
					password: "pwd",
				}),
			});

			expect(res.status).toBe(400); // Validation error
		});
	});

	describe("POST /refresh", () => {
		it("should refresh tokens using refresh cookie", async () => {
			mockAuthService.refresh.mockResolvedValue({
				accessToken: "new-access-token",
				refreshToken: "new-refresh-token",
				user: {
					id: testUser.id,
					email: testUser.email,
					displayName: testUser.displayName,
					role: testUser.role,
				},
			});

			const res = await app.request("/auth/refresh", {
				method: "POST",
				headers: {
					Cookie: `${REFRESH_TOKEN_COOKIE_NAME}=old-refresh-token`,
				},
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user.id).toBe(testUser.id);
			expect(mockAuthService.refresh).toHaveBeenCalledWith("old-refresh-token");

			// New cookies should be set
			const cookies = res.headers.getSetCookie();
			expect(cookies.some((c) => c.includes("new-access-token"))).toBe(true);
		});

		it("should throw HttpError 401 when no refresh token cookie is present", async () => {
			const res = await app.request("/auth/refresh", {
				method: "POST",
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Unauthorized");
		});
	});

	describe("POST /logout", () => {
		it("should call logout service and clear cookies", async () => {
			const res = await app.request("/auth/logout", {
				method: "POST",
				headers: {
					Cookie: `${REFRESH_TOKEN_COOKIE_NAME}=my-refresh-token`,
				},
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(mockAuthService.logout).toHaveBeenCalledWith("my-refresh-token");

			// Cookies should be cleared (max-age=0 or expires in past)
			const cookies = res.headers.getSetCookie();
			expect(cookies.some((c) => c.includes("Max-Age=0") || c.includes("1970"))).toBe(true);
		});
	});

	describe("GET /me", () => {
		it("should return user details when authenticated", async () => {
			// Pre-calculate a valid JWT access token
			const { generateAccessToken } = await import(
				"../modules/auth/token.service"
			);
			const token = await generateAccessToken(
				{
					userId: testUser.id,
					email: testUser.email,
					role: testUser.role,
				},
				mockEnv,
			);

			mockAuthService.findUserById.mockResolvedValue(testUser);

			const res = await app.request("/auth/me", {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user.email).toBe(testUser.email);
			expect(body.user.displayName).toBe(testUser.displayName);
		});

		it("should throw 401 when user in token is inactive in db", async () => {
			const { generateAccessToken } = await import(
				"../modules/auth/token.service"
			);
			const token = await generateAccessToken(
				{
					userId: testUser.id,
					email: testUser.email,
					role: testUser.role,
				},
				mockEnv,
			);

			// User is inactive in database
			mockAuthService.findUserById.mockResolvedValue({
				...testUser,
				isActive: false,
			});

			const res = await app.request("/auth/me", {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			expect(res.status).toBe(401);
		});
	});
});
