import { describe, expect, it } from "bun:test";
import { buildScanProfiles, getProfileById, listProfiles } from "./profiles";

describe("NightWorkers scan profile contract", () => {
	it("defines the standard working-tree profile with required dependency checks", () => {
		const profile = getProfileById("diff-basic-security");
		expect(profile).toBeDefined();
		expect(profile?.defaultTimeoutSec).toBe(900);
		expect(profile?.supportedTargets).toEqual([
			"commit",
			"range",
			"working_tree",
		]);
		expect(
			profile?.tools.map((tool) => ({
				id: tool.toolId,
				required: tool.required,
				failurePolicy: tool.failurePolicy,
			})),
		).toEqual([
			{ id: "gitleaks", required: true, failurePolicy: "fail_profile" },
			{ id: "osv", required: true, failurePolicy: "fail_profile" },
			{ id: "trivy", required: true, failurePolicy: "fail_profile" },
		]);
	});

	it("keeps profile identifiers unique", () => {
		const identifiers = listProfiles().map((profile) => profile.id);
		expect(new Set(identifiers).size).toBe(identifiers.length);
	});

	it("adds preferred Semgrep without making it a core full-profile blocker", () => {
		const withoutSemgrep = buildScanProfiles({
			optionalAdapterIds: [],
		}).find((profile) => profile.id === "full-security-scan")!;
		const withSemgrep = buildScanProfiles({
			optionalAdapterIds: ["semgrep"],
		}).find((profile) => profile.id === "full-security-scan")!;

		expect(
			withoutSemgrep.tools.find((tool) => tool.toolId === "semgrep"),
		).toBeUndefined();
		expect(withoutSemgrep.coverageGaps).toContain(
			"source_sast_adapter_not_available",
		);
		expect(
			withSemgrep.tools.find((tool) => tool.toolId === "semgrep"),
		).toMatchObject({
			required: false,
			failurePolicy: "warn_and_continue",
		});
	});
});
