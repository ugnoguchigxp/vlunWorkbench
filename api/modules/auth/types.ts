import { z } from "zod";
import {
	userRoleSchema,
	type UserRole,
} from "../../../shared/schemas/auth.schema";

export { userRoleSchema };
export type { UserRole };

export const jwtPayloadSchema = z.object({
	userId: z.string().uuid(),
	email: z.string().email(),
	role: userRoleSchema,
	type: z.enum(["access", "refresh"]),
	jti: z.string().optional(),
});
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

export type AuthUser = {
	id: string;
	email: string;
	passwordHash: string;
	displayName: string;
	role: UserRole;
	isActive: boolean;
	lastLoginAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type AuthSessionUser = Pick<
	AuthUser,
	"id" | "email" | "displayName" | "role"
>;
