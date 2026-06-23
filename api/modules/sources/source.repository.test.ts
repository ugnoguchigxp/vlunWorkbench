import { describe, expect, it } from "vitest";
import { normalizeSearchTerms } from "./source.repository";

describe("normalizeSearchTerms", () => {
	it("keeps code-like tokens and removes filler words", () => {
		expect(
			normalizeSearchTerms(
				"Biome の package.json scripts について --write と tsc --noEmit",
			),
		).toEqual([
			"biome",
			"package.json",
			"scripts",
			"--write",
			"tsc",
			"--noemit",
		]);
	});

	it("splits mixed Japanese and latin text without spaces", () => {
		expect(normalizeSearchTerms("Biomeのpackage.json設定方法")).toEqual([
			"biome",
			"package.json",
			"設定方法",
		]);
	});

	it("deduplicates terms and caps the number of terms", () => {
		expect(
			normalizeSearchTerms(
				"one two three four five six seven eight nine ten eleven twelve thirteen one",
			),
		).toEqual([
			"one",
			"two",
			"three",
			"four",
			"five",
			"six",
			"seven",
			"eight",
			"nine",
			"ten",
			"eleven",
			"twelve",
		]);
	});
});
