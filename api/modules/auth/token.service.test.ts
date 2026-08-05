import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppDatabase, DatabaseWriter } from "../../db";
import { createSingleWriterClient } from "../../db/client";
import type { AppEnv } from "../../app/env";
import { SignJWT } from "jose";
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
	let mockWriter: DatabaseWriter<AppDatabase>;
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
		mockWriter = createSingleWriterClient(
			mockDb as unknown as AppDatabase,
		);
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
				mockWriter,
				mockEnv,
			);
			await expect(verifyAccessToken(refreshToken, mockEnv)).rejects.toThrow(
				"Invalid token.",
			);
		});

		it("rejects an access token with an invalid payload", async () => {
			const token = await new SignJWT({ type: "access" })
				.setProtectedHeader({ alg: "HS256" })
				.setExpirationTime("15m")
				.sign(new TextEncoder().encode(mockEnv.jwtSecret));

			await expect(verifyAccessToken(token, mockEnv)).rejects.toThrow(
				"Invalid token.",
			);
		});
	});

	describe("RefreshToken", () => {
		it("should generate refresh token and insert hash to database", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockWriter,
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
				mockWriter,
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
				mockWriter,
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
					mockWriter,
					mockEnv,
				),
			).rejects.toThrowError(new HttpError(401, "Invalid refresh token."));
		});

		it("should throw HttpError 401 when refresh token is expired", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockWriter,
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
					mockWriter,
					mockEnv,
				),
			).rejects.toThrowError(new HttpError(401, "Refresh token expired."));
		});

		it("should throw HttpError 401 when refresh token userId does not match", async () => {
			const token = await generateRefreshToken(
				testPayload,
				mockWriter,
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
					mockWriter,
					mockEnv,
				),
			).rejects.toThrowError(new HttpError(401, "Invalid refresh token."));
		});

		it("rejects non-refresh and malformed refresh payloads", async () => {
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
			const secret = new TextEncoder().encode(mockEnv.jwtSecret);
			const accessToken = await new SignJWT({ ...testPayload, type: "access" })
				.setProtectedHeader({ alg: "HS256" })
				.setExpirationTime("15m")
				.sign(secret);
			mockDb.returning.mockResolvedValue([
				{ userId: testPayload.userId, expiresAt },
			]);
			await expect(
				consumeRefreshToken(accessToken, mockWriter, mockEnv),
			).rejects.toThrow("Invalid refresh token.");

			const malformedToken = await new SignJWT({ type: "refresh" })
				.setProtectedHeader({ alg: "HS256" })
				.setExpirationTime("15m")
				.sign(secret);
			mockDb.returning.mockResolvedValue([
				{ userId: testPayload.userId, expiresAt },
			]);
			await expect(
				consumeRefreshToken(malformedToken, mockWriter, mockEnv),
			).rejects.toThrow("Invalid refresh token.");
		});

		it("should revoke refresh token by deleting it from database", async () => {
			await revokeRefreshToken(
				"revoke-me",
				mockWriter,
			);
			expect(mockDb.delete).toHaveBeenCalled();
		});
	});
});
