import { describe, expect, test } from "bun:test";
import {
	assertEvidencePrivacy,
	assertStableSnapshotInputs,
	commandObservationToAttempt,
	gateStateFromAttempts,
	meetsProfessionalCapabilityPolicy,
	parseGitStatusPorcelain,
} from "./phase-54-baseline-lib";

describe("Phase 54 baseline helpers", () => {
	test("preserves passed, failed, and blocked command states", () => {
		const passed = commandObservationToAttempt(1, { exitCode: 0 });
		const failed = commandObservationToAttempt(1, { exitCode: 1 });
		const blocked = commandObservationToAttempt(1, {
			exitCode: null,
			blockedReason: "docker_unavailable",
		});

		expect(passed.state).toBe("passed");
		expect(failed.state).toBe("failed");
		expect(blocked.state).toBe("blocked");
		expect(gateStateFromAttempts([failed, passed])).toBe("failed");
		expect(() => gateStateFromAttempts([])).toThrow(
			"release_evidence_gate_attempts_required",
		);
	});

	test("rejects malformed NUL-delimited Git status", () => {
		expect(() => parseGitStatusPorcelain(" M README.md")).toThrow(
			"git_status_porcelain_missing_nul_terminator",
		);
		expect(() => parseGitStatusPorcelain("R  renamed.ts\0")).toThrow(
			"git_status_rename_source_missing",
		);
	});

	test("records dirty repository paths without status prefixes", () => {
		expect(
			parseGitStatusPorcelain(
				" M README.md\0?? spec/phase-54-plan.md\0R  new-name.ts\0old-name.ts\0",
			),
		).toEqual([
			"README.md",
			"new-name.ts",
			"old-name.ts",
			"spec/phase-54-plan.md",
		]);
	});

	test("rejects absolute home paths and credential-like values", () => {
		expect(() =>
			assertEvidencePrivacy('{"path":"/Users/example/project"}'),
		).toThrow("release_evidence_contains_absolute_home_path");
		expect(() =>
			assertEvidencePrivacy('{"password":"do-not-store-this"}'),
		).toThrow("release_evidence_contains_possible_credential");
		expect(() =>
			assertEvidencePrivacy('{"apiKey":"do-not-store-this"}'),
		).toThrow("release_evidence_contains_possible_credential");
		expect(() =>
			assertEvidencePrivacy(
				'{"credentialsIncluded":false,"path":"spec/evidence.json"}',
			),
		).not.toThrow();
	});

	test("requires complete Juice Shop execution and quality metrics", () => {
		const measurement = {
			owasp: {
				recall: 0.8,
				precision: 0.9,
				falsePositiveRate: 0.05,
				score: 0.75,
			},
			juiceShop: {
				eligibleScenarioCount: 20,
				categoryCount: 8,
				executedScenarioCount: 20,
				recall: 0.7,
				precision: 0.9,
			},
			minimums: {
				owaspOverallRecall: 0.7,
				owaspOverallPrecision: 0.8,
				owaspOverallFalsePositiveRate: 0.1,
				owaspScore: 0.6,
				juiceShopEligibleScenarios: 20,
				juiceShopCategories: 8,
				juiceShopRecall: 0.6,
				juiceShopPrecision: 0.8,
			},
		};
		expect(meetsProfessionalCapabilityPolicy(measurement)).toBe(true);
		expect(
			meetsProfessionalCapabilityPolicy({
				...measurement,
				juiceShop: { ...measurement.juiceShop, executedScenarioCount: 19 },
			}),
		).toBe(false);
		expect(
			meetsProfessionalCapabilityPolicy({
				...measurement,
				juiceShop: { ...measurement.juiceShop, precision: null },
			}),
		).toBe(false);
	});

	test("rejects source-state races during collection", () => {
		const before = { head: "a", status: "clean", manifest: "sha256:a" };
		expect(() => assertStableSnapshotInputs(before, { ...before })).not.toThrow();
		expect(() =>
			assertStableSnapshotInputs(before, { ...before, manifest: "sha256:b" }),
		).toThrow("phase_54_snapshot_source_changed_during_collection");
	});
});
