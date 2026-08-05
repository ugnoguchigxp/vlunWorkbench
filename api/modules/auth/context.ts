import type { Context } from "hono";
import { HttpError } from "./errors";
import type { UserRole } from "./types";

export type AuthContextUser = {
	userId: string;
	email: string;
	role: UserRole;
};

export function getAuthContextUser(c: Context): AuthContextUser {
	const user = c.get("authUser");
	if (!user || typeof user !== "object") {
		throw new HttpError(401, "Unauthorized");
	}
	const value = user as Partial<AuthContextUser>;
	if (!value.userId || !value.email || !value.role) {
		throw new HttpError(401, "Unauthorized");
	}
	return {
		userId: value.userId,
		email: value.email,
		role: value.role,
	};
}
