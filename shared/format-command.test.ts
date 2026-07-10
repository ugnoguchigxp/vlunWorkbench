import { describe, expect, it } from "vitest";
import { formatCommandTokens } from "./format-command";

describe("formatCommandTokens", () => {
	it("keeps safe argv tokens readable", () => {
		expect(
			formatCommandTokens(["bun", "run", "tool", "--", "--scan-run-id", "scan-1"]),
		).toBe("bun run tool -- --scan-run-id scan-1");
	});

	it("quotes whitespace, shell substitutions, empty values, and apostrophes", () => {
		expect(
			formatCommandTokens(["a b", "$(unsafe)", "", "it's"]),
		).toBe(`'a b' '$(unsafe)' '' 'it'"'"'s'`);
	});
});
