import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppDatabase } from "../../db";
import type { AppEnv } from "../../app/env";
import { HttpError } from "./errors";
import {
	generateAccessToken,
	generateRefreshToken,
	verifyAccessToken,
	consumeRefreshToken,
	revokeRefreshToken,
} from "./token.service";

describe("token.service", () => {
	let mockDb: any;
	let mockEnv: AppEnv;
	const testPayload = {
		userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
		email: "test@example.com",
		role: "member" as const,
	};

	beforeEach(() => {
		mockEnv = {
			jwtSecret: "x".repeat(32), // Min 256 bit key for HS256
			jwtAccessExpiresIn: "15m",
			jwtRefreshExpiresIn: "7d",
		} as unknown as AppEnv;

		mockDb = {
			insert: vi.fn().mockReturnThis(),
			values: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			returning: vi.fn(),
		};
	});

	describe("AccessToken", () => {
		it("should generate and verify access token", async () => {
			const token = await generateAccessToken(testPayload, mockEnv);
			expect(token).toBeDefined();

			const verified = await verifyAccessToken(token, mockEnv);
			expect(verified.userId).toBe(testPayload.userId);
			expect(verified.email).toBe(testPayload.email);
			expect(verified.role).toBe(testPayload.role);
			expect(verified.type).toBe("access");
		});

		it("should throw error when verifying an invalid access token", async () => {
			await expect(
				verifyAccessToken("invalid-token", mockEnv),
			).rejects.toThrow();
		});

		it("should throw error when verifying a refresh token as an access token", async () => {
			const refreshToken = await generateRefreshToken(
				testPayload,
				mockDb as unknown as AppDatabase,
				mockEnv,
			);
			await expect(verifyAccessToken(refreshToken, mockEnv)).rejects.toThrow(
				"Invalid token.",
			);
		});
	});

	describe("RefreshToken", () => {
		it("should generate refresh token and insert hash to database", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockDb as unknown as AppDatabase,
				mockEnv,
			);
			expect(token).toBeDefined();
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.values).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: testPayload.userId,
					token: expect.any(String),
					expiresAt: expect.any(Date),
				}),
			);
		});

		it("should consume a valid refresh token", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockDb as unknown as AppDatabase,
				mockEnv,
			);

			const oneHourInFuture = new Date(Date.now() + 60 * 60 * 1000);
			mockDb.returning.mockResolvedValue([
				{
					userId: testPayload.userId,
					expiresAt: oneHourInFuture,
				},
			]);

			const payload = await consumeRefreshToken(
				token,
				mockDb as unknown as AppDatabase,
				mockEnv,
			);

			expect(payload.userId).toBe(testPayload.userId);
			expect(payload.type).toBe("refresh");
			expect(mockDb.delete).toHaveBeenCalled();
		});

		it("should throw HttpError 401 when refresh token is missing in database", async () => {
			mockDb.returning.mockResolvedValue([]); // not found

			await expect(
				consumeRefreshToken(
					"some-token",
					mockDb as unknown as AppDatabase,
					mockEnv,
				),
			).rejects.toThrowError(new HttpError(401, "Invalid refresh token."));
		});

		it("should throw HttpError 401 when refresh token is expired", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockDb as unknown as AppDatabase,
				mockEnv,
			);

			const oneHourInPast = new Date(Date.now() - 60 * 60 * 1000);
			mockDb.returning.mockResolvedValue([
				{
					userId: testPayload.userId,
					expiresAt: oneHourInPast,
				},
			]);

			await expect(
				consumeRefreshToken(
					token,
					mockDb as unknown as AppDatabase,
					mockEnv,
				),
			).rejects.toThrowError(new HttpError(401, "Refresh token expired."));
		});

		it("should throw HttpError 401 when refresh token userId does not match", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockDb as unknown as AppDatabase,
				mockEnv,
			);

			const oneHourInFuture = new Date(Date.now() + 60 * 60 * 1000);
			mockDb.returning.mockResolvedValue([
				{
					userId: "different-user-id",
					expiresAt: oneHourInFuture,
				},
			]);

			await expect(
				consumeRefreshToken(
					token,
					mockDb as unknown as AppDatabase,
					mockEnv,
				),
			).rejects.toThrowError(new HttpError(401, "Invalid refresh token."));
		});

		it("should revoke refresh token by deleting it from database", async () => {
			await revokeRefreshToken(
				"revoke-me",
				mockDb as unknown as AppDatabase,
			);
			expect(mockDb.delete).toHaveBeenCalled();
		});
	});
});
