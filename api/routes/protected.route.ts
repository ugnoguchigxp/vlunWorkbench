import { Hono } from "hono";
import type { ProtectedProfileResponse } from "../../shared/schemas/protected.schema";
import { getAuthContextUser } from "../modules/auth/context";

export function createProtectedRoute() {
	return new Hono().get("/profile", (c) => {
		const authUser = getAuthContextUser(c);
		const response = {
			profile: {
				email: authUser.email,
				role: authUser.role,
			},
		} satisfies ProtectedProfileResponse;
		return c.json(response);
	});
}
