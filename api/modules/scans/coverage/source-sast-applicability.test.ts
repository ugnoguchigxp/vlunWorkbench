import { describe, expect, it } from "vitest";
import { resolveSourceSastApplicability } from "./source-sast-applicability";

describe("source SAST applicability", () => {
	it("requires source, language, ruleset, and adapter evidence", () => {
		expect(
			resolveSourceSastApplicability({
				hasSourceFiles: false,
				hasSupportedLanguage: true,
				rulesetAvailable: true,
				adapterAvailable: true,
			}),
		).toEqual({
			applicability: "not_applicable",
			reasonCodes: ["source_sast_no_supported_files"],
		});
		expect(
			resolveSourceSastApplicability({
				hasSourceFiles: true,
				hasSupportedLanguage: true,
				rulesetAvailable: false,
				adapterAvailable: true,
			}),
		).toEqual({
			applicability: "applicable",
			reasonCodes: ["source_sast_ruleset_unavailable"],
		});
		expect(
			resolveSourceSastApplicability({
				hasSourceFiles: true,
				hasSupportedLanguage: true,
				rulesetAvailable: true,
				adapterAvailable: true,
			}),
		).toEqual({ applicability: "applicable", reasonCodes: [] });
	});
});
