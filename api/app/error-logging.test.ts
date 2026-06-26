import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { HttpError } from "../modules/auth/errors";
import { shouldLogAppError } from "./error-logging";

describe("shouldLogAppError", () => {
	it("does not log expected client errors", () => {
		expect(shouldLogAppError(new HttpError(401, "Unauthorized"))).toBe(false);
		expect(shouldLogAppError(new HTTPException(403))).toBe(false);
	});

	it("logs server and unexpected errors", () => {
		expect(shouldLogAppError(new HttpError(500, "Internal"))).toBe(true);
		expect(shouldLogAppError(new HTTPException(500))).toBe(true);
		expect(shouldLogAppError(new Error("boom"))).toBe(true);
	});
});
