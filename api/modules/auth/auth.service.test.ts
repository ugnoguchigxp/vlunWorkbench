import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppDatabase } from "../../db";
import type { AppEnv } from "../../app/env";
import { AuthService } from "./auth.service";
import { HttpError } from "./errors";
import { hashPassword } from "./password";

describe("AuthService", () => {
	let mockDb: any;
	let mockEnv: AppEnv;
	let authService: AuthService;

	const testUserRow = {
		id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
		email: "test@example.com",
		passwordHash: "", // Will be filled dynamically in tests
		displayName: "Test User",
		role: "member",
		isActive: true,
		lastLoginAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	beforeEach(async () => {
		mockEnv = {
			jwtSecret: "x".repeat(32),
			jwtAccessExpiresIn: "15m",
			jwtRefreshExpiresIn: "7d",
		} as unknown as AppEnv;

		mockDb = {
			query: {
				users: {
					findFirst: vi.fn(),
				},
				refreshTokens: {
					findFirst: vi.fn(),
				},
			},
			update: vi.fn().mockReturnThis(),
			set: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			insert: vi.fn().mockReturnThis(),
			values: vi.fn().mockReturnThis(),
			returning: vi.fn(),
			delete: vi.fn().mockReturnThis(),
		};

		authService = new AuthService(
			mockDb as unknown as AppDatabase,
			mockEnv,
		);

		const passwordHash = await hashPassword("password123");
		testUserRow.passwordHash = passwordHash;
	});

	describe("findUserById", () => {
		it("should return mapped user when found", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(testUserRow);

			const user = await authService.findUserById(testUserRow.id);
			expect(mockDb.query.users.findFirst).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.any(Object),
				}),
			);
			expect(user).toBeDefined();
			expect(user?.id).toBe(testUserRow.id);
			expect(user?.role).toBe("member");
		});

		it("should return null when not found", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(null);

			const user = await authService.findUserById("non-existent");
			expect(user).toBeNull();
		});
	});

	describe("findUserByEmail", () => {
		it("should query user by lowercase email", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(testUserRow);

			const user = await authService.findUserByEmail("TEST@example.com");
			expect(user).toBeDefined();
			expect(user?.email).toBe(testUserRow.email);
		});
	});

	describe("login", () => {
		it("should login successfully and return tokens", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(testUserRow);

			// Mock db.update for lastLoginAt
			mockDb.returning.mockResolvedValue(undefined);

			// mock generateRefreshToken (db.insert)
			mockDb.insert.mockReturnThis();
			mockDb.values.mockResolvedValue(undefined);

			const result = await authService.login({
				email: testUserRow.email,
				password: "password123",
			});

			expect(result.accessToken).toBeDefined();
			expect(result.refreshToken).toBeDefined();
			expect(result.user.email).toBe(testUserRow.email);
			expect(mockDb.update).toHaveBeenCalled();
		});

		it("should throw HttpError 401 for invalid credentials", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(testUserRow);

			await expect(
				authService.login({
					email: testUserRow.email,
					password: "wrong-password",
				}),
			).rejects.toThrowError(new HttpError(401, "Invalid email or password."));
		});

		it("should throw HttpError 401 when user is inactive", async () => {
			const inactiveUser = { ...testUserRow, isActive: false };
			mockDb.query.users.findFirst.mockResolvedValue(inactiveUser);

			await expect(
				authService.login({
					email: testUserRow.email,
					password: "password123",
				}),
			).rejects.toThrowError(new HttpError(401, "Invalid email or password."));
		});

		it("should throw HttpError 404 if user cannot be retrieved after update", async () => {
			// First call for findUserByEmail returns user, second call for findUserById returns null
			mockDb.query.users.findFirst
				.mockResolvedValueOnce(testUserRow)
				.mockResolvedValueOnce(null);

			await expect(
				authService.login({
					email: testUserRow.email,
					password: "password123",
				}),
			).rejects.toThrowError(new HttpError(404, "User not found."));
		});
	});

	describe("refresh", () => {
		it("should consume and rotate a valid refresh token", async () => {
			// First we need a real refresh token
			// We can generate one using token.service or we can just mock consumeRefreshToken.
			// Let's import token.service and mock the db response so we can call authService.refresh.
			const mockInsertDb = {
				insert: vi.fn().mockReturnThis(),
				values: vi.fn().mockResolvedValue(undefined),
			};

			const { generateRefreshToken } = await import("./token.service");
			const token = await generateRefreshToken(
				{
					userId: testUserRow.id,
					email: testUserRow.email,
					role: "member",
				},
				mockInsertDb as any,
				mockEnv,
			);

			mockDb.returning.mockResolvedValueOnce([{
				userId: testUserRow.id,
				expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			}]);

			// Mock findUserById
			mockDb.query.users.findFirst.mockResolvedValue(testUserRow);

			const result = await authService.refresh(token);
			expect(result.accessToken).toBeDefined();
			expect(result.refreshToken).not.toBe(token);
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.insert).toHaveBeenCalled();
		});

		it("should throw HttpError 401 when refreshed user is inactive", async () => {
			const { generateRefreshToken } = await import("./token.service");
			const token = await generateRefreshToken(
				{
					userId: testUserRow.id,
					email: testUserRow.email,
					role: "member",
				},
				{
					insert: vi.fn().mockReturnThis(),
					values: vi.fn().mockResolvedValue(undefined),
				} as any,
				mockEnv,
			);

			mockDb.returning.mockResolvedValueOnce([{
				userId: testUserRow.id,
				expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			}]);

			// Inactive user
			const inactiveUser = { ...testUserRow, isActive: false };
			mockDb.query.users.findFirst.mockResolvedValue(inactiveUser);

			await expect(authService.refresh(token)).rejects.toThrowError(
				new HttpError(401, "User account is inactive or deleted."),
			);
		});
	});

	describe("logout", () => {
		it("should revoke refresh token if provided", async () => {
			await authService.logout("refresh-token");
			expect(mockDb.delete).toHaveBeenCalled();
		});

		it("should do nothing when token is not provided", async () => {
			await authService.logout(undefined);
			expect(mockDb.delete).not.toHaveBeenCalled();
		});
	});

	describe("createAdmin", () => {
		it("should create new admin user successfully", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(null); // No existing email

			const newAdminRow = {
				...testUserRow,
				email: "admin@example.com",
				role: "admin",
			};
			mockDb.returning.mockResolvedValue([newAdminRow]);

			const admin = await authService.createAdmin({
				email: "admin@example.com",
				displayName: "Admin",
				password: "password123456",
			});

			expect(admin.email).toBe("admin@example.com");
			expect(admin.role).toBe("admin");
			expect(mockDb.insert).toHaveBeenCalled();
		});

		it("should throw HttpError 409 when email is already in use", async () => {
			mockDb.query.users.findFirst.mockResolvedValue(testUserRow); // Email already in use

			await expect(
				authService.createAdmin({
					email: testUserRow.email,
					displayName: "Admin",
					password: "password123456",
				}),
			).rejects.toThrowError(new HttpError(409, "Email already in use."));
		});
	});
});
