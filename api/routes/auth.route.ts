import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { loginSchema } from "../../shared/schemas/auth.schema";
import type { AppEnv } from "../app/env";
import type { AuthService } from "../modules/auth/auth.service";
import {
	REFRESH_TOKEN_COOKIE_NAME,
	clearAuthCookies,
	setAuthCookies,
} from "../modules/auth/auth-cookies";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";

type AuthRouteDeps = {
	authService: AuthService;
	env: AppEnv;
};

export function createAuthRoute(deps: AuthRouteDeps) {
	return new Hono()
		.post("/login", zValidator("json", loginSchema), async (c) => {
			const body = c.req.valid("json");
			const result = await deps.authService.login({
				email: body.email,
				password: body.password,
			});
			setAuthCookies(c, deps.env, result);
			return c.json({ user: result.user });
		})
		.post("/refresh", async (c) => {
			const refreshToken = getCookie(c, REFRESH_TOKEN_COOKIE_NAME);
			if (!refreshToken) {
				throw new HttpError(401, "Unauthorized");
			}
			const result = await deps.authService.refresh(refreshToken);
			setAuthCookies(c, deps.env, result);
			return c.json({ user: result.user });
		})
		.post("/logout", async (c) => {
			const refreshToken = getCookie(c, REFRESH_TOKEN_COOKIE_NAME);
			await deps.authService.logout(refreshToken);
			clearAuthCookies(c);
			return c.json({ ok: true });
		})
		.get("/me", async (c) => {
			const authUser = getAuthContextUser(c);
			const user = await deps.authService.findUserById(authUser.userId);
			if (!user?.isActive) {
				throw new HttpError(401, "Unauthorized");
			}
			return c.json({
				user: {
					id: user.id,
					email: user.email,
					displayName: user.displayName,
					role: user.role,
				},
			});
		});
}
