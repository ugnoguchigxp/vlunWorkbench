import { describe, expect, it } from "vitest";
import { bindObservedToolProvenance } from "./profile-tool-provenance";

describe("tool provenance observation", () => {
	it("withdraws reproducibility when the observed scanner version differs", () => {
		expect(
			bindObservedToolProvenance(
				{ toolVersion: "0.72.0", reproducible: true },
				"Version: 0.71.2",
			),
		).toMatchObject({
			identityCompatibility: "mismatch",
			reproducible: false,
		});
	});

	it("accepts compatible observed versions with surrounding output", () => {
		expect(
			bindObservedToolProvenance(
				{ toolVersion: "3.11.1", reproducible: true },
				"\u001b[34mINF\u001b[0m Nuclei Engine Version: v3.11.1",
			),
		).toMatchObject({
			identityCompatibility: "compatible",
			reproducible: true,
		});
	});

	it("marks an adapter without an expected identity as unverified", () => {
		expect(
			bindObservedToolProvenance(
				{ toolVersion: null, reproducible: false },
				"custom scanner 1.2.3",
			),
		).toMatchObject({
			identityCompatibility: "unverified",
			reproducible: false,
		});
	});
});
