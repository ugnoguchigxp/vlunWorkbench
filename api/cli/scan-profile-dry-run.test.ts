import { describe, expect, it } from "vitest";
import { buildScanProfiles } from "../modules/scans/profiles";
import { buildScanProfileDryRun } from "./scan-profile-dry-run";

describe("scan profile dry run", () => {
	it("returns the same explicit SAST gap as profile resolution", () => {
		const profile = buildScanProfiles({ optionalAdapterIds: [] }).find(
			(candidate) => candidate.id === "full-security-scan",
		)!;
		const result = buildScanProfileDryRun({
			profile,
			scanTarget: { kind: "full" },
			finalReportEnabled: true,
			automatedDiagnosticEnabled: true,
		});
		expect(result.coverageGaps).toEqual(["source_sast_not_executed"]);
		expect(result.resolvedProfileHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(result.stepOrder).not.toContain("semgrep");
	});

	it("lists Semgrep when the optional adapter is enabled", () => {
		const profile = buildScanProfiles({
			optionalAdapterIds: ["semgrep"],
		}).find((candidate) => candidate.id === "full-security-scan")!;
		const result = buildScanProfileDryRun({
			profile,
			scanTarget: { kind: "full" },
			finalReportEnabled: true,
			automatedDiagnosticEnabled: true,
		});
		expect(result.coverageGaps).toEqual([]);
		expect(result.stepOrder).toContain("semgrep");
	});
});
