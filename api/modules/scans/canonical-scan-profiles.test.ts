import { describe, expect, test } from "bun:test";
import { buildCanonicalScanProfiles } from "./canonical-scan-profiles";
import { SOURCE_BASELINE_SCOPE } from "./profiles";

describe("canonical scan profiles", () => {
	test("provides strict source and change contracts without changing legacy IDs", () => {
		const profiles = buildCanonicalScanProfiles({
			sourceScope: SOURCE_BASELINE_SCOPE,
		});
		expect(profiles.map((profile) => profile.id)).toEqual([
			"change-gate",
			"source-assurance",
			"dependency-supply-chain",
		]);
		for (const profile of profiles) {
			expect(profile.strictness).toBe("strict");
			expect(profile.enabled).toBe(true);
		}
		const supplyChain = profiles.find(
			(profile) => profile.id === "dependency-supply-chain",
		);
		expect(supplyChain?.steps?.map((step) => step.kind)).toEqual([
			"static_tool",
			"sbom_export",
			"attestation_verify",
		]);
		expect(
			supplyChain?.steps?.map((step) =>
				step.kind === "static_tool"
					? step.toolId
					: "adapter" in step
						? step.adapter
						: null,
			),
		).toEqual(["osv", "trivy", "cosign"]);
	});

	test("keeps Semgrep optional while assigning core source scanners", () => {
		const withoutSemgrep = buildCanonicalScanProfiles({
			sourceScope: SOURCE_BASELINE_SCOPE,
			semgrepEnabled: false,
		});
		const withSemgrep = buildCanonicalScanProfiles({
			sourceScope: SOURCE_BASELINE_SCOPE,
			semgrepEnabled: true,
		});

		for (const profileId of ["change-gate", "source-assurance"] as const) {
			const core = withoutSemgrep.find((profile) => profile.id === profileId)!;
			const optional = withSemgrep.find((profile) => profile.id === profileId)!;
			expect(core.tools.map((tool) => tool.toolId)).toEqual([
				"gitleaks",
				"osv",
				"trivy",
				"zizmor",
			]);
			expect(optional.tools.map((tool) => tool.toolId)).toEqual([
				"gitleaks",
				"osv",
				"trivy",
				"zizmor",
				"semgrep",
			]);
			expect(optional.tools.at(-1)).toMatchObject({
				toolId: "semgrep",
				required: false,
				requirement: "advisory",
				failurePolicy: "warn_and_continue",
			});
		}
	});

	test("makes Semgrep profile-failing only for an explicit must-run selection", () => {
		const profiles = buildCanonicalScanProfiles({
			sourceScope: SOURCE_BASELINE_SCOPE,
			semgrepSelection: "required",
		});
		for (const profileId of ["change-gate", "source-assurance"] as const) {
			const semgrep = profiles
				.find((profile) => profile.id === profileId)
				?.tools.find((tool) => tool.toolId === "semgrep");
			expect(semgrep).toMatchObject({
				required: true,
				requirement: "required_if_applicable",
				failurePolicy: "fail_profile",
			});
		}
	});
});
