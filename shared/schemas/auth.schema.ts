import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const authSessionUserSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	displayName: z.string().min(1),
	role: userRoleSchema,
});
export type AuthSessionUser = z.infer<typeof authSessionUserSchema>;

export const loginSchema = z.object({
	email: z.string().trim().email(),
	password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const authResponseSchema = z.object({
	user: authSessionUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const logoutResponseSchema = z.object({
	ok: z.literal(true),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
