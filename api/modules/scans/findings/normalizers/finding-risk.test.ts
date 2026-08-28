import { describe, expect, it } from "vitest";
import { normalizeReferenceUrls } from "./finding-risk";

describe("normalizeReferenceUrls", () => {
	it("partitions invalid references without changing valid ordering or duplicates", () => {
		const valid = "https://example.test/advisory";

		expect(
			normalizeReferenceUrls([
				valid,
				"spring-projects/spring-security",
				null,
				valid,
			]),
		).toEqual({
			urls: [valid, valid],
			invalidCount: 2,
		});
	});
});
