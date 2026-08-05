import { z } from "zod";
import { userRoleSchema } from "./auth.schema";

export const protectedProfileResponseSchema = z.object({
	profile: z.object({
		email: z.string().email(),
		role: userRoleSchema,
	}),
});
export type ProtectedProfileResponse = z.infer<
	typeof protectedProfileResponseSchema
>;
