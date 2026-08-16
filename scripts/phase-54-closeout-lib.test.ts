import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Phase54CloseoutSnapshot } from "../shared/schemas/release-evidence.schema";
import {
	assertPhase54CloseoutBindings,
	assertPhase54CloseoutArtifactBounds,
	assertPhase54CloseoutEvidenceAbsent,
	assertPhase54CloseoutEvidenceHashesStable,
	assertPhase54CloseoutEvidencePrivacy,
	assertPhase54CloseoutGitCaptureStable,
	assertPhase54CloseoutSnapshotStable,
	assertPhase54RegressionVerifiedCommit,
	phase54ProfessionalReportSchema,
	phase54ProfessionalContractCommands,
} from "./phase-54-closeout-lib";

const digest = `sha256:${"a".repeat(64)}`;
const commit = "a".repeat(40);

function snapshot(): Phase54CloseoutSnapshot {
	return {
		schemaVersion: 1,
		evidenceKind: "phase_54_same_commit_input_snapshot",
		capturedAt: "2026-08-16T00:00:00.000Z",
		releaseCommit: commit,
		cleanCheckout: true,
		platform: "linux",
		architecture: "x64",
		sourceTreeHash: digest,
		inputHashes: {
			benchmarkPolicy: digest,
			corpusLock: digest,
			scannerManifestFile: digest,
			owaspImplementation: digest,
			juiceShopImplementation: digest,
		},
	};
}

function bindingInput() {
	return {
		snapshot: snapshot(),
		current: snapshot(),
		releaseCommit: commit,
		owaspArtifact: { gitCommit: commit, outputHash: digest },
		owaspReceipt: {
			schemaVersion: 1 as const,
			runId: "00000000-0000-4000-8000-000000000001",
			gitCommit: commit,
			inputHash: digest,
			outputHash: digest,
		},
		juiceArtifact: { gitCommit: commit, evidenceBundleHash: digest },
		juiceReport: {
			provenance: { gitCommit: commit, evidenceBundleHash: digest },
		},
		professionalReport: {
			schemaVersion: 1 as const,
			releaseCommit: commit,
			claim: { status: "not_met" as const, passingBenchmarkRunId: null },
			provenance: {
				workingTreeClean: true as const,
				juiceShopAuthoritativeLinux: true as const,
				juiceShopMeasurementStatus: "completed" as const,
			},
			gates: {
				contracts: phase54ProfessionalContractCommands.map((command) => ({
					command,
					ok: true as const,
					exitCode: 0 as const,
				})),
				semgrep: true as const,
				osv: false,
				owasp: true as const,
				juiceShop: true as const,
				businessLogic: true as const,
				endpointDiscovery: true as const,
			},
		},
	};
}

describe("Phase 54 closeout contract", () => {
	test("accepts stable, same-commit artifact bindings", () => {
		expect(() => assertPhase54CloseoutBindings(bindingInput())).not.toThrow();
	});

	test("rejects source drift and commit mismatches", () => {
		const drifted = snapshot();
		drifted.sourceTreeHash = `sha256:${"b".repeat(64)}`;
		expect(() =>
			assertPhase54CloseoutSnapshotStable(snapshot(), drifted),
		).toThrow("phase_54_closeout_source_inputs_changed");

		const mismatched = bindingInput();
		mismatched.owaspReceipt.gitCommit = "b".repeat(40);
		expect(() => assertPhase54CloseoutBindings(mismatched)).toThrow(
			"phase_54_closeout_commit_mismatch",
		);

		const rebound = bindingInput();
		rebound.owaspReceipt.outputHash = `sha256:${"c".repeat(64)}`;
		expect(() => assertPhase54CloseoutBindings(rebound)).toThrow(
			"phase_54_closeout_artifact_binding_mismatch",
		);
	});

	test("rejects dirty or racing Git snapshot capture", () => {
		const stable = {
			releaseCommit: commit,
			statusOutput: new Uint8Array(),
			sourceIndex: new TextEncoder().encode("index"),
		};
		expect(() =>
			assertPhase54CloseoutGitCaptureStable(stable, stable),
		).not.toThrow();
		expect(() =>
			assertPhase54CloseoutGitCaptureStable(stable, {
				...stable,
				statusOutput: new TextEncoder().encode("dirty"),
			}),
		).toThrow("phase_54_closeout_requires_clean_checkout");
		expect(() =>
			assertPhase54CloseoutGitCaptureStable(stable, {
				...stable,
				sourceIndex: new TextEncoder().encode("changed"),
			}),
		).toThrow("phase_54_closeout_source_changed_during_capture");
	});

	test("binds the upstream regression gate to the release commit", () => {
		expect(() =>
			assertPhase54RegressionVerifiedCommit(commit, commit),
		).not.toThrow();
		expect(() =>
			assertPhase54RegressionVerifiedCommit(undefined, commit),
		).toThrow("phase_54_closeout_regression_verified_commit_required");
		expect(() =>
			assertPhase54RegressionVerifiedCommit("b".repeat(40), commit),
		).toThrow("phase_54_closeout_regression_commit_mismatch");
	});

	test("keeps the professional claim transition outside closeout", () => {
		const input = bindingInput();
		expect(() =>
			phase54ProfessionalReportSchema.parse({
				...input.professionalReport,
				claim: {
					status: "met",
					passingBenchmarkRunId:
						"00000000-0000-4000-8000-000000000001",
				},
			}),
		).toThrow();
		expect(() =>
			phase54ProfessionalReportSchema.parse({
				...input.professionalReport,
				gates: {
					...input.professionalReport.gates,
					contracts: input.professionalReport.gates.contracts.slice(0, -1),
				},
			}),
		).toThrow();
	});

	test("rejects stale evidence before a closeout run", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "phase-54-closeout-"));
		try {
			const stale = path.join(root, "stale.json");
			await mkdir(path.dirname(stale), { recursive: true });
			await writeFile(stale, "{}\n");
			await expect(assertPhase54CloseoutEvidenceAbsent([stale])).rejects.toThrow(
				"phase_54_closeout_evidence_reuse_rejected",
			);
			await rm(stale);
			await expect(
				assertPhase54CloseoutEvidenceAbsent([stale]),
			).resolves.toBeUndefined();
			const dangling = path.join(root, "dangling.json");
			await symlink(path.join(root, "missing-target.json"), dangling);
			await expect(
				assertPhase54CloseoutEvidenceAbsent([dangling]),
			).rejects.toThrow("phase_54_closeout_evidence_reuse_rejected");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("bounds and privacy-checks the complete evidence file set", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "phase-54-evidence-"));
		try {
			const evidence = path.join(root, "evidence.json");
			await writeFile(evidence, '{"ok":true}\n');
			await expect(
				assertPhase54CloseoutArtifactBounds([evidence]),
			).resolves.toEqual([evidence]);
			await expect(
				assertPhase54CloseoutEvidencePrivacy([evidence]),
			).resolves.toBeUndefined();
			await writeFile(evidence, '{"path":"/home/runner/private"}\n');
			await expect(
				assertPhase54CloseoutEvidencePrivacy([evidence]),
			).rejects.toThrow("release_evidence_contains_absolute_home_path");
			const linked = path.join(root, "linked.json");
			await symlink(evidence, linked);
			await expect(
				assertPhase54CloseoutArtifactBounds([linked]),
			).rejects.toThrow("phase_54_closeout_evidence_symlink_rejected");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("detects evidence mutation during verification", () => {
		const before = { artifact: digest };
		expect(() =>
			assertPhase54CloseoutEvidenceHashesStable(before, before),
		).not.toThrow();
		expect(() =>
			assertPhase54CloseoutEvidenceHashesStable(before, {
				artifact: `sha256:${"b".repeat(64)}`,
			}),
		).toThrow("phase_54_closeout_evidence_changed_during_verification");
	});

});
