import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";

describe("read-only API method contract", () => {
	it("does not silently enable state-changing methods", async () => {
		const contract = JSON.parse(
			await fs.readFile(
				"tests/security-capability/fixtures/api/read-only-methods.json",
				"utf8",
			),
		);
		expect(contract.allowed).toEqual(["GET", "HEAD", "OPTIONS"]);
		expect(contract.rejected).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
		expect(contract.allowed.some((method: string) => contract.rejected.includes(method))).toBe(
			false,
		);
	});
});
