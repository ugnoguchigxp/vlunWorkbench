import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../modules/auth/auth.service";
import { getAuthContextUser } from "../modules/auth/context";
import { userRoleSchema } from "../modules/auth/types";

const createUserSchema = z.object({
	email: z.string().trim().email(),
	displayName: z.string().trim().min(1),
	role: userRoleSchema.default("member"),
	initialPassword: z.string().min(8),
});

const updateUserSchema = z.object({
	displayName: z.string().trim().min(1).optional(),
	role: userRoleSchema.optional(),
});

const resetPasswordSchema = z.object({
	newPassword: z.string().min(8),
});

type AdminUsersRouteDeps = {
	authService: AuthService;
};

const toResponseUser = (user: {
	id: string;
	email: string;
	displayName: string;
	role: "admin" | "member";
	isActive: boolean;
	lastLoginAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}) => ({
	id: user.id,
	email: user.email,
	displayName: user.displayName,
	role: user.role,
	isActive: user.isActive,
	lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
	createdAt: user.createdAt.toISOString(),
	updatedAt: user.updatedAt.toISOString(),
});

export function createAdminUsersRoute(deps: AdminUsersRouteDeps) {
	return new Hono()
		.get("/users", async (c) => {
			const items = await deps.authService.listUsers();
			return c.json({ items: items.map(toResponseUser) });
		})
		.post("/users", zValidator("json", createUserSchema), async (c) => {
			const body = c.req.valid("json");
			const created = await deps.authService.createUser({
				email: body.email,
				displayName: body.displayName,
				password: body.initialPassword,
				role: body.role,
			});
			return c.json({ user: toResponseUser(created) }, 201);
		})
		.patch(
			"/users/:userId",
			zValidator("json", updateUserSchema),
			async (c) => {
				const body = c.req.valid("json");
				const updated = await deps.authService.updateUserProfile(
					c.req.param("userId"),
					{
						displayName: body.displayName,
						role: body.role,
					},
				);
				return c.json({ user: toResponseUser(updated) });
			},
		)
		.post(
			"/users/:userId/reset-password",
			zValidator("json", resetPasswordSchema),
			async (c) => {
				const body = c.req.valid("json");
				await deps.authService.resetPassword(
					c.req.param("userId"),
					body.newPassword,
				);
				return c.json({ ok: true });
			},
		)
		.post("/users/:userId/disable", async (c) => {
			const actor = getAuthContextUser(c);
			const updated = await deps.authService.setUserActive(
				actor.userId,
				c.req.param("userId"),
				false,
			);
			return c.json({ user: toResponseUser(updated) });
		})
		.post("/users/:userId/enable", async (c) => {
			const actor = getAuthContextUser(c);
			const updated = await deps.authService.setUserActive(
				actor.userId,
				c.req.param("userId"),
				true,
			);
			return c.json({ user: toResponseUser(updated) });
		});
}
