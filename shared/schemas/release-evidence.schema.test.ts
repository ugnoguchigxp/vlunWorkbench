import { describe, expect, test } from "vitest";
import {
	phase55BaselineEvidenceSchema,
	phase55BaselineInputSnapshotSchema,
	phase55EntryReportSchema,
} from "./phase-55-evidence.schema";
import {
	currentReleaseEvidenceSchema,
	phase54BaselineEvidenceSchema,
	phase54CloseoutReportSchema,
	phase54CloseoutSnapshotSchema,
} from "./release-evidence.schema";

const digest = `sha256:${"a".repeat(64)}`;
const commit = "a".repeat(40);

function baseline() {
	return {
		schemaVersion: 1,
		phase: "54",
		evidenceKind: "baseline",
		snapshotKind: "planning_baseline",
		generatedAt: "2026-08-05T00:00:00.000Z",
		owner: "vulnWorkbench maintainers",
		planningBaselineCommit: commit,
		workingTree: {
			clean: false,
			changedPaths: ["spec/phase-54-plan.md"],
			phase54ScopePaths: ["spec/phase-54-plan.md"],
			concurrentPathsExcludedFromScope: [],
		},
		toolchain: { bun: "1.3.14", platform: "darwin", architecture: "arm64" },
		inventory: {
			testFiles: 1,
			ownedSemgrepRules: 1,
			osvEcosystems: ["npm"],
			builtInPlugins: 1,
			humanContributors: 1,
			automatedContributors: 0,
			gitTags: 0,
		},
		metrics: {
			owaspBenchmark: {
				recall: 0.7,
				precision: 0.6,
				falsePositiveRate: 0.2,
				score: 0.5,
			},
			juiceShop: {
				eligibleScenarios: 20,
				categories: 8,
				executedScenarios: 0,
				recall: 0,
				precision: null,
				falsePositiveRate: 0,
				score: 0,
			},
		},
		documentation: {
			manifestIsSourceOfTruth: true,
			staleClaims: ["rule count is stale"],
		},
		gates: [
			{
				id: "format",
				command: "bun run format:check",
				state: "failed",
				durationMs: null,
				attempts: [
					{
						attempt: 1,
						state: "failed",
						exitCode: 1,
						summary: "command_failed",
					},
				],
				evidenceRefs: ["working-tree"],
				summary: "Formatter detected a difference",
			},
		],
		evaluationAxes: [
			{
				id: "release_trust",
				assessment: "weak",
				evidence: ["gate failed"],
				limitations: ["release is not reproducible"],
			},
			{
				id: "security_effectiveness",
				assessment: "partial",
				evidence: ["benchmark exists"],
				limitations: ["precision is below policy"],
			},
			{
				id: "product_correctness",
				assessment: "strong",
				evidence: ["evidence is constrained"],
				limitations: [],
			},
			{
				id: "interoperability_adoption",
				assessment: "partial",
				evidence: ["CLI exists"],
				limitations: ["SARIF is absent"],
			},
			{
				id: "sustainability",
				assessment: "weak",
				evidence: ["tests exist"],
				limitations: ["bus factor is one"],
			},
		],
		hashes: {
			benchmarkPolicy: digest,
			scannerDataManifestFile: digest,
			externalBenchmark: digest,
			phase50ReleaseReport: digest,
			phase53Baseline: digest,
		},
		privacy: {
			absoluteHomePathsIncluded: false,
			sourceSnippetsIncluded: false,
			credentialsIncluded: false,
		},
		residualRisk: "Known gates remain failed or blocked",
	};
}

describe("Phase 54 baseline evidence", () => {
	test("accepts explicit dirty, failed, and privacy states", () => {
		expect(phase54BaselineEvidenceSchema.parse(baseline()).phase).toBe("54");
	});

	test("rejects absolute paths and duplicate evaluation axes", () => {
		const absolutePath = baseline();
		absolutePath.workingTree.changedPaths = ["/Users/example/private.ts"];
		expect(() => phase54BaselineEvidenceSchema.parse(absolutePath)).toThrow();

		const duplicateAxis = baseline();
		duplicateAxis.evaluationAxes[4] = duplicateAxis.evaluationAxes[0];
		expect(() => phase54BaselineEvidenceSchema.parse(duplicateAxis)).toThrow();
	});

	test("rejects a clean tree that lists changed paths", () => {
		const value = baseline();
		value.workingTree.clean = true;
		expect(() => phase54BaselineEvidenceSchema.parse(value)).toThrow();
	});

	test("rejects inconsistent gate state and working-tree partitions", () => {
		const inconsistentGate = baseline();
		inconsistentGate.gates[0].state = "passed";
		expect(() =>
			phase54BaselineEvidenceSchema.parse(inconsistentGate),
		).toThrow("derived from all recorded attempts");

		const unclassifiedPath = baseline();
		unclassifiedPath.workingTree.changedPaths.push("unclassified.ts");
		expect(() =>
			phase54BaselineEvidenceSchema.parse(unclassifiedPath),
		).toThrow("disjoint partition");

		const unsortedPartition = baseline();
		unsortedPartition.workingTree.changedPaths = ["a.ts", "z.ts"];
		unsortedPartition.workingTree.phase54ScopePaths = ["z.ts", "a.ts"];
		expect(() =>
			phase54BaselineEvidenceSchema.parse(unsortedPartition),
		).toThrow("canonically sorted");
	});

	test("rejects credential-like evidence and non-contiguous attempts", () => {
		const credential = baseline();
		credential.gates[0].summary = "apiKey: do-not-store-this";
		expect(() => phase54BaselineEvidenceSchema.parse(credential)).toThrow(
			"Credential-like values",
		);

		const skippedAttempt = baseline();
		skippedAttempt.gates[0].attempts[0].attempt = 2;
		expect(() =>
			phase54BaselineEvidenceSchema.parse(skippedAttempt),
		).toThrow("ordered contiguously");

		const excessiveRetries = baseline();
		excessiveRetries.gates[0].attempts = Array.from(
			{ length: 101 },
			(_, index) => ({
				attempt: index + 1,
				state: "failed",
				exitCode: 1,
				summary: "command_failed",
			}),
		);
		expect(() =>
			phase54BaselineEvidenceSchema.parse(excessiveRetries),
		).toThrow();
	});
});

describe("current release evidence", () => {
	test("requires a passing run and reviewer approval for met claims", () => {
		const value = {
			schemaVersion: 1,
			evidenceKind: "current_release",
			generatedAt: "2026-08-05T00:00:00.000Z",
			release: { version: "1.0.0", commit, cleanCheckout: true },
			toolchain: {
				bun: "1.3.14",
				platform: "linux",
				architecture: "x64",
			},
			inputHashes: { policy: digest },
			gates: [
				{
					id: "strict",
					command: "bun run verify:strict",
					state: "passed",
					durationMs: 1,
					attempts: [
						{
							attempt: 1,
							state: "passed",
							exitCode: 0,
							summary: "command_completed",
						},
					],
					evidenceRefs: ["ci:strict"],
					summary: "Strict verification passed",
				},
			],
			claims: [
				{
					id: "professional-capability",
					status: "met",
					passingRunId: "00000000-0000-4000-8000-000000000001",
					evidenceRefs: ["benchmark:run"],
				},
			],
			limitations: [],
			approvals: [] as Array<{
				kind: "owner" | "reviewer" | "security";
				approvedBy: string;
				approvedAt: string;
			}>,
			privacy: {
				absoluteHomePathsIncluded: false,
				sourceSnippetsIncluded: false,
				credentialsIncluded: false,
			},
		};

		expect(() => currentReleaseEvidenceSchema.parse(value)).toThrow(
			"reviewer approval",
		);
		value.approvals.push({
			kind: "reviewer",
			approvedBy: "reviewer-1",
			approvedAt: "2026-08-05T00:01:00.000Z",
	});
		expect(currentReleaseEvidenceSchema.parse(value).claims[0]?.status).toBe(
			"met",
		);
		value.release.cleanCheckout = false;
		expect(() => currentReleaseEvidenceSchema.parse(value)).toThrow(
			"clean release checkout",
		);
		});

	test("rejects duplicate claim ids", () => {
		const claim = {
			id: "professional-capability",
			status: "not_met" as const,
			passingRunId: null,
			evidenceRefs: ["benchmark:run"],
		};
		const value = {
			schemaVersion: 1,
			evidenceKind: "current_release",
			generatedAt: "2026-08-05T00:00:00.000Z",
			release: { version: "1.0.0", commit, cleanCheckout: true },
			toolchain: {
				bun: "1.3.14",
				platform: "linux",
				architecture: "x64",
			},
			inputHashes: { policy: digest },
			gates: [
				{
					id: "strict",
					command: "bun run verify:strict",
					state: "passed",
					durationMs: 1,
					attempts: [
						{
							attempt: 1,
							state: "passed",
							exitCode: 0,
							summary: "command_completed",
						},
					],
					evidenceRefs: ["ci:strict"],
					summary: "Strict verification passed",
				},
			],
			claims: [claim, claim],
			limitations: [],
			approvals: [],
			privacy: {
				absoluteHomePathsIncluded: false,
				sourceSnippetsIncluded: false,
				credentialsIncluded: false,
			},
		};
		expect(() => currentReleaseEvidenceSchema.parse(value)).toThrow(
			"claim ids must be unique",
		);
	});
});

describe("Phase 54 same-commit closeout evidence", () => {
	const inputHashes = {
		benchmarkPolicy: digest,
		corpusLock: digest,
		scannerManifestFile: digest,
		owaspImplementation: digest,
		juiceShopImplementation: digest,
	};

	test("accepts a Linux clean-checkout snapshot", () => {
		expect(
			phase54CloseoutSnapshotSchema.parse({
				schemaVersion: 1,
				evidenceKind: "phase_54_same_commit_input_snapshot",
				capturedAt: "2026-08-16T00:00:00.000Z",
				releaseCommit: commit,
				cleanCheckout: true,
				platform: "linux",
				architecture: "x64",
				sourceTreeHash: digest,
				inputHashes,
			}).releaseCommit,
		).toBe(commit);
	});

	test("requires verified evidence and excludes claim changes", () => {
		const report = {
			schemaVersion: 1,
			evidenceKind: "phase_54_same_commit_closeout",
			generatedAt: "2026-08-16T00:00:00.000Z",
			releaseCommit: commit,
			cleanCheckout: true,
			platform: "linux",
			architecture: "x64",
			sourceTreeHash: digest,
			inputHashes,
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
		};

		expect(phase54CloseoutReportSchema.parse(report).claimChangeIncluded).toBe(
			false,
		);
		expect(() =>
			phase54CloseoutReportSchema.parse({
				...report,
				claimChangeIncluded: true,
			}),
		).toThrow();
		expect(() =>
			phase54CloseoutReportSchema.parse({
				...report,
				verification: {
					...report.verification,
					regressionVerifiedCommit: "b".repeat(40),
				},
			}),
		).toThrow("phase_54_regression_commit_mismatch");
	});
});

describe("Phase 55 planning baseline evidence", () => {
	function phase55Baseline() {
		return {
			schemaVersion: 1,
			phase: "55",
			evidenceKind: "planning_baseline",
			capturedAt: "2026-08-16T00:00:00.000Z",
			owner: "vulnWorkbench maintainers",
			planningBaselineCommit: commit,
			phase54Closeout: {
				evidenceRef: ".artifacts/phase-54-closeout/report.json",
				availability: "missing",
				gateState: "blocked",
				reasonCode: "phase_54_authoritative_closeout_missing",
				reportHash: null,
				releaseCommit: null,
				inputHashes: null,
				professionalReportHash: null,
			},
			productionSliceEntry: {
				state: "blocked",
				allowed: false,
				reasonCode: "phase_54_authoritative_closeout_missing",
			},
			inventory: {
				testFiles: 1,
				ownedSemgrepRules: 45,
				semgrepLanguages: ["go", "java"],
				osvEcosystems: ["Go", "npm"],
				profileIds: ["baseline", "full-security-scan"],
				optionalSemgrepEnabledByDefault: false,
			},
			professionalCapability: {
				source: "diagnostic",
				artifactHash: digest,
				releaseCommit: "b".repeat(40),
				claimStatus: "not_met",
				unsupportedCapabilities: ["production-active-attack"],
				gates: {
					semgrep: true,
					osv: false,
					owasp: true,
					juiceShop: false,
					businessLogic: true,
					endpointDiscovery: true,
				},
				metrics: {
					owasp: null,
					juiceShop: null,
					businessLogic: null,
					endpointDiscovery: null,
				},
			},
			hashes: {
				benchmarkPolicy: digest,
				scopeCatalog: digest,
				corpusLock: digest,
				scannerManifestFile: digest,
				scannerManifest: digest,
				semgrepCatalog: digest,
				profileDefinitions: digest,
				baselineInputSnapshot: digest,
			},
			privacy: {
				absoluteHomePathsIncluded: false,
				sourceSnippetsIncluded: false,
				credentialsIncluded: false,
			},
			residualRisk: "Authoritative Phase 54 closeout is unavailable",
		};
	}

	test("keeps diagnostic metrics separate from a blocked entry gate", () => {
		const value = phase55BaselineEvidenceSchema.parse(phase55Baseline());
		expect(value.productionSliceEntry.allowed).toBe(false);
		expect(value.professionalCapability.source).toBe("diagnostic");
	});

	test("rejects start permission without verified Phase 54 closeout", () => {
		const value = phase55Baseline();
		value.productionSliceEntry.allowed = true;
		expect(() => phase55BaselineEvidenceSchema.parse(value)).toThrow(
			"phase_55_entry_state_must_follow_phase_54_closeout",
		);
	});

	test("rejects authoritative metrics without closeout binding", () => {
		const value = phase55Baseline();
		value.professionalCapability.source = "authoritative";
		expect(() => phase55BaselineEvidenceSchema.parse(value)).toThrow(
			"phase_55_authoritative_metrics_require_closeout_binding",
		);
	});

	test("requires canonical inventory ordering", () => {
		const value = phase55Baseline();
		value.inventory.semgrepLanguages = ["java", "go"];
		expect(() => phase55BaselineEvidenceSchema.parse(value)).toThrow(
			"phase_55_baseline_array_must_be_sorted_and_unique",
		);
	});

	test("accepts a tracked diagnostic and profile input snapshot", () => {
		const baseline = phase55Baseline();
		expect(
			phase55BaselineInputSnapshotSchema.parse({
				schemaVersion: 1,
				evidenceKind: "phase_55_planning_input_snapshot",
				capturedAt: "2026-08-16T00:00:00.000Z",
				planningBaselineCommit: commit,
				profileInventory: {
					profileIds: baseline.inventory.profileIds,
					optionalSemgrepEnabledByDefault: false,
					profileDefinitionsHash: digest,
				},
				professionalCapabilitySource: {
					evidenceRef:
						"spec/evidence/phase-55-diagnostic-professional-capability.json",
					artifactHash: digest,
				},
				professionalCapability: baseline.professionalCapability,
				privacy: baseline.privacy,
			}).professionalCapability.source,
		).toBe("diagnostic");
	});

	test("rejects incomplete or non-canonical tracked input snapshots", () => {
		const baseline = phase55Baseline();
		expect(() =>
			phase55BaselineInputSnapshotSchema.parse({
				schemaVersion: 1,
				evidenceKind: "phase_55_planning_input_snapshot",
				capturedAt: "2026-08-16T00:00:00.000Z",
				planningBaselineCommit: commit,
				profileInventory: {
					profileIds: ["full-security-scan", "baseline"],
					optionalSemgrepEnabledByDefault: false,
					profileDefinitionsHash: digest,
				},
				professionalCapabilitySource: {
					evidenceRef:
						"spec/evidence/phase-55-diagnostic-professional-capability.json",
					artifactHash: digest,
				},
				professionalCapability: {
					...baseline.professionalCapability,
					gates: {
						...baseline.professionalCapability.gates,
						osv: null,
					},
				},
				privacy: baseline.privacy,
			}),
		).toThrow();
	});

	test("requires every strict entry verification flag", () => {
		const report = {
			schemaVersion: 1,
			evidenceKind: "phase_55_strict_entry",
			generatedAt: "2026-08-16T00:00:00.000Z",
			releaseCommit: commit,
			planningBaselineCommit: "b".repeat(40),
			phase54CloseoutReportHash: digest,
			phase54ProfessionalReportHash: digest,
			phase55BaselineHash: digest,
			phase55BaselineInputSnapshotHash: digest,
			phase55DiagnosticProfessionalEvidenceHash: digest,
			phase54InputHashes: {
				benchmarkPolicy: digest,
				corpusLock: digest,
				scannerManifestFile: digest,
				owaspImplementation: digest,
				juiceShopImplementation: digest,
			},
			verification: {
				phase54FullCloseoutCompleted: true,
				baselineVerified: true,
				planningBaselineAncestor: true,
				sameCommitCloseout: true,
			},
			privacy: {
				absoluteHomePathsIncluded: false,
				sourceSnippetsIncluded: false,
				credentialsIncluded: false,
			},
		};
		expect(phase55EntryReportSchema.parse(report).releaseCommit).toBe(commit);
		expect(() =>
			phase55EntryReportSchema.parse({
				...report,
				verification: {
					...report.verification,
					phase54FullCloseoutCompleted: false,
				},
			}),
		).toThrow();
	});
});
