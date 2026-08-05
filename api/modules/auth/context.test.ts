import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { getAuthContextUser } from "./context";
import { HttpError } from "./errors";

describe("getAuthContextUser", () => {
	it("should return authUser when context has a valid authUser", () => {
		const mockUser = {
			userId: "user-123",
			email: "user@example.com",
			role: "member",
		};
		const mockContext = {
			get: vi.fn().mockReturnValue(mockUser),
		} as unknown as Context;

		const result = getAuthContextUser(mockContext);
		expect(mockContext.get).toHaveBeenCalledWith("authUser");
		expect(result).toEqual(mockUser);
	});

	it("should throw HttpError 401 when authUser is missing or not an object", () => {
		const mockContext = {
			get: vi.fn().mockReturnValue(null),
		} as unknown as Context;

		expect(() => getAuthContextUser(mockContext)).toThrow(HttpError);
		expect(() => getAuthContextUser(mockContext)).toThrow("Unauthorized");

		const mockContextWithString = {
			get: vi.fn().mockReturnValue("not-an-object"),
		} as unknown as Context;
		expect(() => getAuthContextUser(mockContextWithString)).toThrow(HttpError);
	});

	it("should throw HttpError 401 when authUser properties are missing", () => {
		const incompleteUser = {
			userId: "user-123",
			// email and role are missing
		};
		const mockContext = {
			get: vi.fn().mockReturnValue(incompleteUser),
		} as unknown as Context;

		expect(() => getAuthContextUser(mockContext)).toThrow(HttpError);
	});
});
