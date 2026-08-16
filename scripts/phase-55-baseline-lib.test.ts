import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	phase55BaselineEvidenceSchema,
	phase55BaselineInputSnapshotSchema,
} from "../shared/schemas/phase-55-evidence.schema";
import { phase54CloseoutReportSchema } from "../shared/schemas/release-evidence.schema";
import {
	PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
	assertPhase55DiagnosticSourceBindings,
	assertPhase55StrictEntryBindings,
	assertPhase55TrackedInputBindings,
	phase55FileSetHash,
	phase55ProfessionalReportSchema,
	phase55ProfessionalSnapshot,
} from "./phase-55-baseline-lib";

const digest = `sha256:${"a".repeat(64)}` as const;
const commit = "a".repeat(40);

function closeoutReport() {
	return phase54CloseoutReportSchema.parse({
		schemaVersion: 1,
		evidenceKind: "phase_54_same_commit_closeout",
		generatedAt: "2026-08-16T00:00:00.000Z",
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
		toolboxImageDigest: digest,
		owasp: {
			runId: "00000000-0000-4000-8000-000000000001",
			inputHash: digest,
			outputHash: digest,
			metricsArtifactHash: digest,
			runReceiptHash: digest,
		},
		juiceShop: {
			metricsArtifactHash: digest,
			runReportHash: digest,
			evidenceBundleHash: digest,
		},
		professionalReportHash: digest,
		benchmarkDatabaseBackupHash: digest,
		verification: {
			sourceInputsStable: true,
			owaspArtifactIntegrity: true,
			owaspPolicyPassed: true,
			owaspRunPersisted: true,
			databaseBackupIsolated: true,
			juiceShopArtifactIntegrity: true,
			juiceShopAuthoritativeLinux: true,
			regressionContractsPassed: true,
			regressionVerifiedCommit: commit,
		},
		professionalClaimStatus: "not_met",
		claimChangeIncluded: false,
		privacy: {
			absoluteHomePathsIncluded: false,
			sourceSnippetsIncluded: false,
			credentialsIncluded: false,
		},
	});
}

describe("Phase 55 baseline entry helpers", () => {
	test("accepts only a full closeout bound to the current commit", () => {
		const report = closeoutReport();
		expect(() =>
			assertPhase55StrictEntryBindings({
				currentCommit: commit,
				planningBaselineCommit: commit,
				planningBaselineAncestor: true,
				currentSourceTreeHash: digest,
				closeoutReport: report,
				professionalReportHash: digest,
			}),
		).not.toThrow();
		expect(() =>
			assertPhase55StrictEntryBindings({
				currentCommit: "b".repeat(40),
				planningBaselineCommit: commit,
				planningBaselineAncestor: true,
				currentSourceTreeHash: digest,
				closeoutReport: report,
				professionalReportHash: digest,
			}),
		).toThrow("phase_55_entry_closeout_commit_mismatch");
	});

	test("rejects an unbound baseline or professional report", () => {
		const report = closeoutReport();
		expect(() =>
			assertPhase55StrictEntryBindings({
				currentCommit: commit,
				planningBaselineCommit: commit,
				planningBaselineAncestor: false,
				currentSourceTreeHash: digest,
				closeoutReport: report,
				professionalReportHash: digest,
			}),
		).toThrow("phase_55_entry_baseline_not_ancestor");
		expect(() =>
			assertPhase55StrictEntryBindings({
				currentCommit: commit,
				planningBaselineCommit: commit,
				planningBaselineAncestor: true,
				currentSourceTreeHash: digest,
				closeoutReport: report,
				professionalReportHash: `sha256:${"b".repeat(64)}`,
			}),
		).toThrow("phase_55_entry_professional_report_hash_mismatch");
	});

	test("hashes profile inputs independent of traversal order", () => {
		const left = new TextEncoder().encode("left");
		const right = new TextEncoder().encode("right");
		expect(
			phase55FileSetHash([
				["a.ts", left],
				["b.ts", right],
			]),
		).toBe(
			phase55FileSetHash([
				["b.ts", right],
				["a.ts", left],
			]),
		);
	});

	test("normalizes professional metrics without copying category labels", () => {
		const metric = {
			category: "overall" as const,
			truePositive: 1,
			falseNegative: 0,
			trueNegative: 1,
			falsePositive: 0,
			recall: 1,
			precision: 1,
			falsePositiveRate: 0,
			score: 1,
		};
		const report = phase55ProfessionalReportSchema.parse({
			releaseCommit: commit,
			claim: {
				status: "not_met",
				unsupportedCapabilities: ["production-active-attack"],
			},
			gates: {
				semgrep: true,
				osv: false,
				owasp: true,
				juiceShop: false,
				businessLogic: true,
				endpointDiscovery: true,
			},
			metrics: {
				owasp: metric,
				juiceShop: metric,
				businessLogic: metric,
				endpointDiscovery: null,
			},
		});
		expect(phase55ProfessionalSnapshot(report).metrics.owasp).toEqual({
			truePositive: 1,
			falseNegative: 0,
			trueNegative: 1,
			falsePositive: 0,
			recall: 1,
			precision: 1,
			falsePositiveRate: 0,
			score: 1,
		});
	});

	test("rejects tampered diagnostic metrics and profile inventory", () => {
		const baseline = phase55BaselineEvidenceSchema.parse(
			JSON.parse(readFileSync("spec/evidence/phase-55-baseline.json", "utf8")),
		);
		const inputBytes = readFileSync(
			"spec/evidence/phase-55-baseline-inputs.json",
		);
		const inputSnapshot = phase55BaselineInputSnapshotSchema.parse(
			JSON.parse(inputBytes.toString("utf8")),
		);
		const sourceBytes = readFileSync(
			PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
		);
		const sourceArtifactHash = `sha256:${new Bun.CryptoHasher("sha256")
			.update(sourceBytes)
			.digest("hex")}` as const;
		const sourceReport = phase55ProfessionalReportSchema.parse(
			JSON.parse(sourceBytes.toString("utf8")),
		);
		expect(() =>
			assertPhase55DiagnosticSourceBindings({
				inputSnapshot,
				sourceReport,
				sourceArtifactHash,
			}),
		).not.toThrow();
		const sourceTampered = structuredClone(sourceReport);
		sourceTampered.gates.osv = true;
		expect(() =>
			assertPhase55DiagnosticSourceBindings({
				inputSnapshot,
				sourceReport: sourceTampered,
				sourceArtifactHash,
			}),
		).toThrow("phase_55_diagnostic_source_projection_mismatch");
		const inputSnapshotHash = `sha256:${new Bun.CryptoHasher("sha256")
			.update(inputBytes)
			.digest("hex")}` as const;
		expect(() =>
			assertPhase55TrackedInputBindings({
				baseline,
				inputSnapshot,
				inputSnapshotHash,
			}),
		).not.toThrow();

		const metricTampered = structuredClone(baseline);
		if (!metricTampered.professionalCapability.metrics.owasp) {
			throw new Error("phase_55_test_metric_missing");
		}
		metricTampered.professionalCapability.metrics.owasp.recall = 1;
		expect(() =>
			assertPhase55TrackedInputBindings({
				baseline: metricTampered,
				inputSnapshot,
				inputSnapshotHash,
			}),
		).toThrow("phase_55_baseline_professional_snapshot_mismatch");

		const profileTampered = structuredClone(baseline);
		profileTampered.inventory.profileIds.pop();
		expect(() =>
			assertPhase55TrackedInputBindings({
				baseline: profileTampered,
				inputSnapshot,
				inputSnapshotHash,
			}),
		).toThrow("phase_55_baseline_profile_inventory_mismatch");
	});
});
