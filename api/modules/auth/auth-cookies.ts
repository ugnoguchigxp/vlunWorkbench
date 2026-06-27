import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../../app/env";

export const ACCESS_TOKEN_COOKIE_NAME = "access_token";
export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

const parseDurationToSeconds = (duration: string): number | undefined => {
	const match = duration.match(/^(\d+)([smhd])$/i);
	if (!match) return undefined;
	const value = Number.parseInt(match[1], 10);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	const unit = match[2]?.toLowerCase();
	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 60 * 60;
		case "d":
			return value * 60 * 60 * 24;
		default:
			return undefined;
	}
};

export const setAuthCookies = (
	c: Context,
	env: AppEnv,
	tokens: { accessToken: string; refreshToken: string },
) => {
	setAccessTokenCookie(c, env, tokens.accessToken);
	setRefreshTokenCookie(c, env, tokens.refreshToken);
};

export const setAccessTokenCookie = (
	c: Context,
	env: AppEnv,
	accessToken: string,
) => {
	const accessMaxAge = parseDurationToSeconds(env.jwtAccessExpiresIn);
	setCookie(c, ACCESS_TOKEN_COOKIE_NAME, accessToken, {
		httpOnly: true,
		secure: env.secureCookie,
		sameSite: env.cookieSameSite,
		path: "/",
		...(accessMaxAge ? { maxAge: accessMaxAge } : {}),
	});
};

export const setRefreshTokenCookie = (
	c: Context,
	env: AppEnv,
	refreshToken: string,
) => {
	const refreshMaxAge = parseDurationToSeconds(env.jwtRefreshExpiresIn);
	setCookie(c, REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
		httpOnly: true,
		secure: env.secureCookie,
		sameSite: env.cookieSameSite,
		path: "/api/auth",
		...(refreshMaxAge ? { maxAge: refreshMaxAge } : {}),
	});
};

export const clearAuthCookies = (c: Context) => {
	deleteCookie(c, ACCESS_TOKEN_COOKIE_NAME, { path: "/" });
	deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, { path: "/api/auth" });
};
