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
	const secure = env.secureCookie;
	const accessMaxAge = parseDurationToSeconds(env.jwtAccessExpiresIn);
	const refreshMaxAge = parseDurationToSeconds(env.jwtRefreshExpiresIn);

	setCookie(c, ACCESS_TOKEN_COOKIE_NAME, tokens.accessToken, {
		httpOnly: true,
		secure,
		sameSite: env.cookieSameSite,
		path: "/",
		...(accessMaxAge ? { maxAge: accessMaxAge } : {}),
	});

	setCookie(c, REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
		httpOnly: true,
		secure,
		sameSite: env.cookieSameSite,
		path: "/api/auth",
		...(refreshMaxAge ? { maxAge: refreshMaxAge } : {}),
	});
};

export const clearAuthCookies = (c: Context) => {
	deleteCookie(c, ACCESS_TOKEN_COOKIE_NAME, { path: "/" });
	deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, { path: "/api/auth" });
};
