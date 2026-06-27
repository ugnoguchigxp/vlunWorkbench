import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { AppDatabase } from "../../db";
import { refreshTokens } from "../../db/schema";
import type { AppEnv } from "../../app/env";
import { HttpError } from "./errors";
import { jwtPayloadSchema, type JwtPayload } from "./types";

const hashToken = (token: string): string =>
	createHash("sha256").update(token).digest("hex");

const secretKey = (jwtSecret: string): Uint8Array =>
	new TextEncoder().encode(jwtSecret);

type JwtCorePayload = Omit<JwtPayload, "type">;
export type RefreshTokenSession = {
	payload: JwtPayload;
	expiresAt: Date;
	shouldRotate: boolean;
};

const REFRESH_TOKEN_ROTATION_WINDOW_MS = 24 * 60 * 60 * 1000;

async function verifyJwtPayload(token: string, env: AppEnv) {
	try {
		return await jwtVerify(token, secretKey(env.jwtSecret));
	} catch {
		throw new HttpError(401, "Invalid token.");
	}
}

export async function generateAccessToken(
	payload: JwtCorePayload,
	env: AppEnv,
): Promise<string> {
	return new SignJWT({ ...payload, type: "access" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setJti(randomUUID())
		.setExpirationTime(env.jwtAccessExpiresIn)
		.sign(secretKey(env.jwtSecret));
}

export async function generateRefreshToken(
	payload: JwtCorePayload,
	db: AppDatabase,
	env: AppEnv,
): Promise<string> {
	const token = await new SignJWT({ ...payload, type: "refresh" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setJti(randomUUID())
		.setExpirationTime(env.jwtRefreshExpiresIn)
		.sign(secretKey(env.jwtSecret));

	const verified = await jwtVerify(token, secretKey(env.jwtSecret));
	const exp = verified.payload.exp;
	if (typeof exp !== "number") {
		throw new HttpError(500, "Failed to parse refresh token expiration.");
	}
	await db.insert(refreshTokens).values({
		token: hashToken(token),
		userId: payload.userId,
		expiresAt: new Date(exp * 1000),
	});

	return token;
}

export async function verifyAccessToken(
	token: string,
	env: AppEnv,
): Promise<JwtPayload> {
	const verified = await verifyJwtPayload(token, env);
	if (verified.payload.type !== "access") {
		throw new HttpError(401, "Invalid token.");
	}
	const parsed = jwtPayloadSchema.safeParse(verified.payload);
	if (!parsed.success) {
		throw new HttpError(401, "Invalid token.");
	}
	return parsed.data;
}

export async function consumeRefreshToken(
	token: string,
	db: AppDatabase,
	env: AppEnv,
): Promise<JwtPayload> {
	const tokenHash = hashToken(token);
	const [deleted] = await db
		.delete(refreshTokens)
		.where(eq(refreshTokens.token, tokenHash))
		.returning({
			userId: refreshTokens.userId,
			expiresAt: refreshTokens.expiresAt,
		});

	if (!deleted) {
		throw new HttpError(401, "Invalid refresh token.");
	}
	if (new Date() > deleted.expiresAt) {
		throw new HttpError(401, "Refresh token expired.");
	}

	const verified = await verifyJwtPayload(token, env);
	if (verified.payload.type !== "refresh") {
		throw new HttpError(401, "Invalid refresh token.");
	}
	const parsed = jwtPayloadSchema.safeParse(verified.payload);
	if (!parsed.success) {
		throw new HttpError(401, "Invalid refresh token.");
	}
	const payload = parsed.data;
	if (payload.userId !== deleted.userId) {
		throw new HttpError(401, "Invalid refresh token.");
	}
	return payload;
}

export async function validateRefreshToken(
	token: string,
	db: AppDatabase,
	env: AppEnv,
	now = new Date(),
): Promise<RefreshTokenSession> {
	const tokenHash = hashToken(token);
	const stored = await db.query.refreshTokens.findFirst({
		where: eq(refreshTokens.token, tokenHash),
	});

	if (!stored) {
		throw new HttpError(401, "Invalid refresh token.");
	}
	if (now > stored.expiresAt) {
		throw new HttpError(401, "Refresh token expired.");
	}

	const verified = await verifyJwtPayload(token, env);
	if (verified.payload.type !== "refresh") {
		throw new HttpError(401, "Invalid refresh token.");
	}
	const parsed = jwtPayloadSchema.safeParse(verified.payload);
	if (!parsed.success) {
		throw new HttpError(401, "Invalid refresh token.");
	}
	const payload = parsed.data;
	if (payload.userId !== stored.userId) {
		throw new HttpError(401, "Invalid refresh token.");
	}
	return {
		payload,
		expiresAt: stored.expiresAt,
		shouldRotate:
			stored.expiresAt.getTime() - now.getTime() <=
			REFRESH_TOKEN_ROTATION_WINDOW_MS,
	};
}

export async function revokeRefreshToken(
	token: string,
	db: AppDatabase,
): Promise<void> {
	await db
		.delete(refreshTokens)
		.where(eq(refreshTokens.token, hashToken(token)));
}

export async function revokeAllRefreshTokensForUser(
	userId: string,
	db: AppDatabase,
): Promise<void> {
	await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}
