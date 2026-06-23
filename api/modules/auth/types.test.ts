import { describe, expect, it } from "vitest";
import { jwtPayloadSchema, userRoleSchema } from "./types";

describe("userRoleSchema", () => {
	it("should accept valid roles", () => {
		expect(userRoleSchema.parse("admin")).toBe("admin");
		expect(userRoleSchema.parse("member")).toBe("member");
	});

	it("should reject invalid roles", () => {
		expect(() => userRoleSchema.parse("guest")).toThrow();
		expect(() => userRoleSchema.parse(null)).toThrow();
	});
});

describe("jwtPayloadSchema", () => {
	it("should accept valid payload", () => {
		const validPayload = {
			userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
			email: "test@example.com",
			role: "member",
			type: "access",
			jti: "token-id-123",
		};
		const parsed = jwtPayloadSchema.parse(validPayload);
		expect(parsed).toEqual(validPayload);
	});

	it("should reject invalid payload structures", () => {
		// Missing fields
		expect(() =>
			jwtPayloadSchema.parse({
				userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
			}),
		).toThrow();

		// Invalid email
		expect(() =>
			jwtPayloadSchema.parse({
				userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
				email: "not-an-email",
				role: "member",
				type: "access",
			}),
		).toThrow();

		// Invalid userId (not uuid)
		expect(() =>
			jwtPayloadSchema.parse({
				userId: "not-a-uuid",
				email: "test@example.com",
				role: "member",
				type: "access",
			}),
		).toThrow();

		// Invalid type
		expect(() =>
			jwtPayloadSchema.parse({
				userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
				email: "test@example.com",
				role: "member",
				type: "invalid-type",
			}),
		).toThrow();
	});
});
