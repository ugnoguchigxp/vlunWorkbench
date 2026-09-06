import { describe, expect, it } from "vitest";
import { recordScannerE2EFailureObservation } from "../../../testing/scanner-e2e-failure-observation";
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
		recordScannerE2EFailureObservation("FI-02", {
			profileOutcome: "blocked",
			reasonCodes: ["scanner_binary_version_mismatch"],
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

	it("finds the scanner version after unrelated runtime warnings", () => {
		expect(
			bindObservedToolProvenance(
				{ toolVersion: "3.11.1", reproducible: true },
				"warning: supports go1.17 through go1.26\nNuclei Engine Version: v3.11.1",
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
