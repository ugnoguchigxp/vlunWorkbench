import { describe, expect, it } from "bun:test";
import { getProfileById, listProfiles } from "./profiles";

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

	it("keeps optional Semgrep out of every standard profile", () => {
		for (const profile of listProfiles()) {
			expect(profile.tools.some((tool) => tool.toolId === "semgrep")).toBe(
				false,
			);
		}
	});
});
