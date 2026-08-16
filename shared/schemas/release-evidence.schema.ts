import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const releaseEvidenceGateStateSchema = z.enum([
	"passed",
	"failed",
	"blocked",
	"not_applicable",
]);

const possibleCredentialAssignmentPattern =
	/["']?(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|password|private[_-]?key|refresh[_-]?token|secret|token)["']?\s*[:=]\s*["']?(?!false\b|null\b|none\b)[^\s,"'}]+/i;

export const repositoryRelativePathSchema = z
	.string()
	.min(1)
	.max(500)
	.refine((value) => {
		const segments = value.split("/");
		return (
			!value.startsWith("/") &&
			!value.startsWith("\\\\") &&
			!/^[a-z]:[\\/]/i.test(value) &&
			!value.includes("\\") &&
			!value.includes("\0") &&
			segments.every(
				(segment) => segment !== "" && segment !== "." && segment !== "..",
			)
		);
	}, "Expected a normalized repository-relative path");

const evidenceTextSchema = z
	.string()
	.min(1)
	.max(4_000)
	.refine(
		(value) => !/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/i.test(value),
		"Absolute home paths are not allowed in release evidence",
	)
	.refine(
		(value) => !possibleCredentialAssignmentPattern.test(value),
		"Credential-like values are not allowed in release evidence",
	);

export const releaseEvidenceGateAttemptSchema = z
	.object({
		attempt: z.number().int().positive(),
		state: releaseEvidenceGateStateSchema,
		exitCode: z.number().int().nullable(),
		summary: evidenceTextSchema,
	})
	.superRefine((value, ctx) => {
		if (value.state === "passed" && value.exitCode !== 0) {
			ctx.addIssue({
				code: "custom",
				path: ["exitCode"],
				message: "A passed attempt must have exit code zero",
			});
		}
		if (value.state === "failed" && value.exitCode === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["exitCode"],
				message: "A failed attempt cannot have exit code zero",
			});
		}
		if (
			(value.state === "blocked" || value.state === "not_applicable") &&
			value.exitCode !== null
		) {
			ctx.addIssue({
				code: "custom",
				path: ["exitCode"],
				message: "A non-executed attempt cannot have an exit code",
			});
		}
	});

export const releaseEvidenceGateSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
		command: evidenceTextSchema.nullable(),
		state: releaseEvidenceGateStateSchema,
		durationMs: z.number().int().nonnegative().nullable(),
		attempts: z.array(releaseEvidenceGateAttemptSchema).min(1).max(100),
		evidenceRefs: z.array(evidenceTextSchema).max(20),
		summary: evidenceTextSchema,
	})
	.superRefine((value, ctx) => {
		const attemptNumbers = new Set(
			value.attempts.map((attempt) => attempt.attempt),
		);
		if (attemptNumbers.size !== value.attempts.length) {
			ctx.addIssue({
				code: "custom",
				path: ["attempts"],
				message: "Gate attempt numbers must be unique",
			});
		}
		if (
			value.attempts.some((attempt, index) => attempt.attempt !== index + 1)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["attempts"],
				message: "Gate attempts must be ordered contiguously from one",
			});
		}
		const expectedState = value.attempts.some(
			(attempt) => attempt.state === "failed",
		)
			? "failed"
			: value.attempts.some((attempt) => attempt.state === "blocked")
				? "blocked"
				: value.attempts.every((attempt) => attempt.state === "not_applicable")
					? "not_applicable"
					: "passed";
		if (value.state !== expectedState) {
			ctx.addIssue({
				code: "custom",
				path: ["state"],
				message: "Gate state must be derived from all recorded attempts",
			});
		}
	});

export const releaseEvidencePrivacySchema = z.object({
	absoluteHomePathsIncluded: z.literal(false),
	sourceSnippetsIncluded: z.literal(false),
	credentialsIncluded: z.literal(false),
});

const releaseEvidenceToolchainSchema = z.object({
	bun: z.string().min(1).max(100),
	platform: z.string().min(1).max(100),
	architecture: z.string().min(1).max(100),
});

const phase54AxisIdSchema = z.enum([
	"release_trust",
	"security_effectiveness",
	"product_correctness",
	"interoperability_adoption",
	"sustainability",
]);

const phase54EvaluationAxesSchema = z
	.array(
		z.object({
			id: phase54AxisIdSchema,
			assessment: z.enum(["strong", "partial", "weak"]),
			evidence: z.array(evidenceTextSchema).min(1).max(20),
			limitations: z.array(evidenceTextSchema).max(20),
		}),
	)
	.length(5)
	.superRefine((axes, ctx) => {
		const ids = new Set(axes.map((axis) => axis.id));
		if (ids.size !== phase54AxisIdSchema.options.length) {
			ctx.addIssue({
				code: "custom",
				message: "Phase 54 baseline must contain each evaluation axis once",
			});
		}
		if (
			axes.some((axis, index) => axis.id !== phase54AxisIdSchema.options[index])
		) {
			ctx.addIssue({
				code: "custom",
				message: "Phase 54 evaluation axes must use canonical order",
			});
		}
	});

export const phase54BaselineEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		phase: z.literal("54"),
		evidenceKind: z.literal("baseline"),
		snapshotKind: z.enum(["planning_baseline", "working_snapshot"]),
		generatedAt: z.string().datetime(),
		owner: evidenceTextSchema,
		planningBaselineCommit: gitCommitSchema,
		workingTree: z.object({
			clean: z.boolean(),
			changedPaths: z.array(repositoryRelativePathSchema).max(1_000),
			phase54ScopePaths: z.array(repositoryRelativePathSchema).max(100),
			concurrentPathsExcludedFromScope: z
				.array(repositoryRelativePathSchema)
				.max(100),
		}),
		toolchain: releaseEvidenceToolchainSchema,
		inventory: z.object({
			testFiles: z.number().int().nonnegative(),
			ownedSemgrepRules: z.number().int().nonnegative(),
			osvEcosystems: z.array(z.string().min(1).max(100)).max(100),
			builtInPlugins: z.number().int().nonnegative(),
			humanContributors: z.number().int().nonnegative(),
			automatedContributors: z.number().int().nonnegative(),
			gitTags: z.number().int().nonnegative(),
		}),
		metrics: z.object({
			owaspBenchmark: z.object({
				recall: z.number().min(0).max(1),
				precision: z.number().min(0).max(1),
				falsePositiveRate: z.number().min(0).max(1),
				score: z.number().min(-1).max(1),
			}),
			juiceShop: z.object({
				eligibleScenarios: z.number().int().nonnegative(),
				categories: z.number().int().nonnegative(),
				executedScenarios: z.number().int().nonnegative(),
				recall: z.number().min(0).max(1).nullable(),
				precision: z.number().min(0).max(1).nullable(),
				falsePositiveRate: z.number().min(0).max(1).nullable(),
				score: z.number().min(-1).max(1).nullable(),
			}),
		}),
		documentation: z.object({
			manifestIsSourceOfTruth: z.literal(true),
			staleClaims: z.array(evidenceTextSchema).max(100),
		}),
		gates: z.array(releaseEvidenceGateSchema).min(1).max(100),
		evaluationAxes: phase54EvaluationAxesSchema,
		hashes: z.object({
			benchmarkPolicy: sha256DigestSchema,
			scannerDataManifestFile: sha256DigestSchema,
			externalBenchmark: sha256DigestSchema,
			phase50ReleaseReport: sha256DigestSchema,
			phase53Baseline: sha256DigestSchema,
		}),
		privacy: releaseEvidencePrivacySchema,
		residualRisk: evidenceTextSchema,
	})
	.superRefine((value, ctx) => {
		const gateIds = new Set(value.gates.map((gate) => gate.id));
		if (gateIds.size !== value.gates.length) {
			ctx.addIssue({
				code: "custom",
				path: ["gates"],
				message: "Release evidence gate ids must be unique",
			});
		}
		if (
			value.workingTree.clean !==
			(value.workingTree.changedPaths.length === 0)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["workingTree", "changedPaths"],
				message: "Working-tree clean state must match changed paths",
			});
		}
		const changedPaths = new Set(value.workingTree.changedPaths);
		const scopedPaths = new Set(value.workingTree.phase54ScopePaths);
		const concurrentPaths = new Set(
			value.workingTree.concurrentPathsExcludedFromScope,
		);
		if (changedPaths.size !== value.workingTree.changedPaths.length) {
			ctx.addIssue({
				code: "custom",
				path: ["workingTree", "changedPaths"],
				message: "Changed paths must be unique",
			});
		}
		if (
			JSON.stringify(value.workingTree.changedPaths) !==
				JSON.stringify([...value.workingTree.changedPaths].sort()) ||
			JSON.stringify(value.workingTree.phase54ScopePaths) !==
				JSON.stringify([...value.workingTree.phase54ScopePaths].sort()) ||
			JSON.stringify(value.workingTree.concurrentPathsExcludedFromScope) !==
				JSON.stringify(
					[...value.workingTree.concurrentPathsExcludedFromScope].sort(),
				) ||
			JSON.stringify(value.inventory.osvEcosystems) !==
				JSON.stringify([...new Set(value.inventory.osvEcosystems)].sort())
		) {
			ctx.addIssue({
				code: "custom",
				message: "Baseline inventories must be unique and canonically sorted",
			});
		}
		if (
			scopedPaths.size !== value.workingTree.phase54ScopePaths.length ||
			concurrentPaths.size !==
				value.workingTree.concurrentPathsExcludedFromScope.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["workingTree"],
				message: "Working-tree path partitions must not contain duplicates",
			});
		}
		if (
			[...scopedPaths].some(
				(path) => !changedPaths.has(path) || concurrentPaths.has(path),
			) ||
			[...concurrentPaths].some((path) => !changedPaths.has(path)) ||
			new Set([...scopedPaths, ...concurrentPaths]).size !== changedPaths.size
		) {
			ctx.addIssue({
				code: "custom",
				path: ["workingTree"],
				message:
					"Phase 54 and concurrent paths must form a disjoint partition of changed paths",
			});
		}
	});

const releaseClaimSchema = z
	.object({
		id: z.string().min(1).max(200),
		status: z.enum(["met", "not_met", "unvalidated"]),
		passingRunId: z.string().uuid().nullable(),
		evidenceRefs: z.array(evidenceTextSchema).max(20),
	})
	.superRefine((value, ctx) => {
		if (value.status === "met" && value.passingRunId === null) {
			ctx.addIssue({
				code: "custom",
				path: ["passingRunId"],
				message: "A met claim must reference a passing run",
			});
		}
		if (value.status !== "met" && value.passingRunId !== null) {
			ctx.addIssue({
				code: "custom",
				path: ["passingRunId"],
				message: "Only a met claim can reference a passing run",
			});
		}
	});

export const currentReleaseEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		evidenceKind: z.literal("current_release"),
		generatedAt: z.string().datetime(),
		release: z.object({
			version: z.string().min(1).max(100),
			commit: gitCommitSchema,
			cleanCheckout: z.boolean(),
		}),
		toolchain: releaseEvidenceToolchainSchema,
		inputHashes: z
			.record(z.string().min(1).max(200), sha256DigestSchema)
			.refine(
				(value) => Object.keys(value).length > 0,
				"Input hashes are required",
			)
			.refine(
				(value) => Object.keys(value).length <= 100,
				"Input hashes must be bounded",
			),
		gates: z.array(releaseEvidenceGateSchema).min(1).max(100),
		claims: z.array(releaseClaimSchema).max(100),
		limitations: z.array(evidenceTextSchema).max(100),
		approvals: z
			.array(
				z.object({
					kind: z.enum(["owner", "reviewer", "security"]),
					approvedBy: z.string().min(1).max(200),
					approvedAt: z.string().datetime(),
				}),
			)
			.max(100),
		privacy: releaseEvidencePrivacySchema,
	})
	.superRefine((value, ctx) => {
		const gateIds = new Set(value.gates.map((gate) => gate.id));
		if (gateIds.size !== value.gates.length) {
			ctx.addIssue({
				code: "custom",
				path: ["gates"],
				message: "Release evidence gate ids must be unique",
			});
		}
		const claimIds = new Set(value.claims.map((claim) => claim.id));
		if (claimIds.size !== value.claims.length) {
			ctx.addIssue({
				code: "custom",
				path: ["claims"],
				message: "Release claim ids must be unique",
			});
		}
		if (
			value.claims.some((claim) => claim.status === "met") &&
			!value.approvals.some((approval) => approval.kind === "reviewer")
		) {
			ctx.addIssue({
				code: "custom",
				path: ["approvals"],
				message: "A met claim requires reviewer approval",
			});
		}
		if (
			value.claims.some((claim) => claim.status === "met") &&
			!value.release.cleanCheckout
		) {
			ctx.addIssue({
				code: "custom",
				path: ["release", "cleanCheckout"],
				message: "A met claim requires a clean release checkout",
			});
		}
	});

const phase54CloseoutInputHashesSchema = z.object({
	benchmarkPolicy: sha256DigestSchema,
	corpusLock: sha256DigestSchema,
	scannerManifestFile: sha256DigestSchema,
	owaspImplementation: sha256DigestSchema,
	juiceShopImplementation: sha256DigestSchema,
});

export const phase54CloseoutSnapshotSchema = z.object({
	schemaVersion: z.literal(1),
	evidenceKind: z.literal("phase_54_same_commit_input_snapshot"),
	capturedAt: z.string().datetime(),
	releaseCommit: gitCommitSchema,
	cleanCheckout: z.literal(true),
	platform: z.literal("linux"),
	architecture: z.enum(["x64", "arm64"]),
	sourceTreeHash: sha256DigestSchema,
	inputHashes: phase54CloseoutInputHashesSchema,
});

export const phase54CloseoutReportSchema = z
	.object({
		schemaVersion: z.literal(1),
		evidenceKind: z.literal("phase_54_same_commit_closeout"),
		generatedAt: z.string().datetime(),
		releaseCommit: gitCommitSchema,
		cleanCheckout: z.literal(true),
		platform: z.literal("linux"),
		architecture: z.enum(["x64", "arm64"]),
		sourceTreeHash: sha256DigestSchema,
		inputHashes: phase54CloseoutInputHashesSchema,
		toolboxImageDigest: sha256DigestSchema,
		owasp: z.object({
			runId: z.string().uuid(),
			inputHash: sha256DigestSchema,
			outputHash: sha256DigestSchema,
			metricsArtifactHash: sha256DigestSchema,
			runReceiptHash: sha256DigestSchema,
		}),
		juiceShop: z.object({
			metricsArtifactHash: sha256DigestSchema,
			runReportHash: sha256DigestSchema,
			evidenceBundleHash: sha256DigestSchema,
		}),
		professionalReportHash: sha256DigestSchema,
		benchmarkDatabaseBackupHash: sha256DigestSchema,
		verification: z.object({
			sourceInputsStable: z.literal(true),
			owaspArtifactIntegrity: z.literal(true),
			owaspPolicyPassed: z.literal(true),
			owaspRunPersisted: z.literal(true),
			databaseBackupIsolated: z.literal(true),
			juiceShopArtifactIntegrity: z.literal(true),
			juiceShopAuthoritativeLinux: z.literal(true),
			regressionContractsPassed: z.literal(true),
			regressionVerifiedCommit: gitCommitSchema,
		}),
		professionalClaimStatus: z.literal("not_met"),
		claimChangeIncluded: z.literal(false),
		privacy: releaseEvidencePrivacySchema,
	})
	.superRefine((report, context) => {
		if (report.verification.regressionVerifiedCommit !== report.releaseCommit) {
			context.addIssue({
				code: "custom",
				message: "phase_54_regression_commit_mismatch",
				path: ["verification", "regressionVerifiedCommit"],
			});
		}
	});

export type ReleaseEvidenceGateState = z.infer<
	typeof releaseEvidenceGateStateSchema
>;
export type ReleaseEvidenceGate = z.infer<typeof releaseEvidenceGateSchema>;
export type Phase54BaselineEvidence = z.infer<
	typeof phase54BaselineEvidenceSchema
>;
export type CurrentReleaseEvidence = z.infer<
	typeof currentReleaseEvidenceSchema
>;
export type Phase54CloseoutSnapshot = z.infer<
	typeof phase54CloseoutSnapshotSchema
>;
export type Phase54CloseoutReport = z.infer<typeof phase54CloseoutReportSchema>;
