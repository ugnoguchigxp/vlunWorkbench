import { describe, expect, it } from "vitest";
import { generateSeedPassword, parseSeedArgs } from "./seed-options";

describe("seed cli helpers", () => {
	it("uses the local admin defaults", () => {
		expect(parseSeedArgs([])).toEqual({
			adminEmail: "admin@example.com",
			adminName: "Admin User",
			passwordFromStdin: false,
			keepExistingPassword: false,
		});
	});

	it("parses admin seed options", () => {
		expect(
			parseSeedArgs([
				"--email",
				"owner@example.com",
				"--name",
				"Owner",
				"--password",
				"custom-password",
				"--keep-existing-password",
			]),
		).toEqual({
			adminEmail: "owner@example.com",
			adminName: "Owner",
			password: "custom-password",
			passwordFromStdin: false,
			keepExistingPassword: true,
		});
	});

	it("generates a 12 character password with mixed character classes", () => {
		const password = generateSeedPassword();

		expect(password).toHaveLength(12);
		expect(password).toMatch(/[A-Z]/);
		expect(password).toMatch(/[a-z]/);
		expect(password).toMatch(/[0-9]/);
	});
});
