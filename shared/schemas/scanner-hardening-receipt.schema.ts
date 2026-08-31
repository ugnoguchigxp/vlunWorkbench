import { z } from "zod";
import { scannerHardeningCloseoutScopeReportSchema } from "./scanner-hardening-closeout.schema";
import { sha256DigestSchema } from "./security-capability.schema";

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const relativePathSchema = z
	.string()
	.min(1)
	.max(500)
	.superRefine((value, context) => {
		if (
			value.startsWith("/") ||
			value.includes("\0") ||
			value.includes("\\") ||
			value
				.split("/")
				.some(
					(segment) => segment === "" || segment === "." || segment === "..",
				)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "path must remain inside the receipt directory",
			});
		}
	});

const fileReferenceSchema = z
	.object({
		path: relativePathSchema,
		sha256: sha256DigestSchema,
		sizeBytes: z.number().int().nonnegative(),
	})
	.strict();

const targetIdentitySchema = z
	.object({
		repository: z.literal("todolist"),
		commit: commitSchema,
		snapshotSha256: sha256DigestSchema,
	})
	.strict();

export const scannerHardeningBranchProtectionEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		source: z.literal("github-api"),
		repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
		ref: z.literal("refs/heads/main"),
		branchProtected: z.literal(true),
		requiredStatusChecks: z
			.array(z.string().min(1).max(200))
			.min(2)
			.max(100)
			.refine((value) => new Set(value).size === value.length)
			.refine((value) =>
				["verify / verify", "scanner-e2e-real / scanner-e2e-real"].every(
					(required) => value.includes(required),
				),
			),
		capturedAt: z.string().datetime(),
	})
	.strict();

const closeoutResultSchema = z
	.object({
		id: z.string().min(1).max(32),
		status: z.enum(["passed", "blocked", "failed", "superseded"]),
		evidenceProviderIds: z
			.array(z.string().min(1).max(64))
			.min(1)
			.max(16)
			.refine((value) => new Set(value).size === value.length),
		supersededReason: z.string().min(1).max(200).nullable(),
		successorContract: relativePathSchema.nullable(),
	})
	.strict();

const ciPromotionSchema = z
	.object({
		status: z.enum(["passed", "blocked", "failed"]),
		reason: z.string().min(1).max(200).nullable(),
		verifiedCommit: commitSchema.nullable(),
		verifyRunId: z.string().min(1).max(100).nullable(),
		verifyConclusion: z.enum(["success", "failure", "cancelled"]).nullable(),
		scannerE2ERunId: z.string().min(1).max(100).nullable(),
		scannerE2EConclusion: z
			.enum(["success", "failure", "cancelled"])
			.nullable(),
		ciReceiptSha256: sha256DigestSchema.nullable(),
		branchProtectionConfirmed: z.boolean(),
	})
	.strict()
	.superRefine((value, context) => {
		const complete =
			value.verifiedCommit !== null &&
			value.verifyRunId !== null &&
			value.verifyConclusion === "success" &&
			value.scannerE2ERunId !== null &&
			value.scannerE2EConclusion === "success" &&
			value.ciReceiptSha256 !== null &&
			value.branchProtectionConfirmed;
		if ((value.status === "passed") !== complete) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "passed CI promotion requires complete protected-run identity",
			});
		}
		if (
			value.status === "passed" ? value.reason !== null : value.reason === null
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"CI promotion reason is required only for a non-passing status",
			});
		}
	});

export const scannerHardeningCloseoutReceiptSchema = z
	.object({
		schemaVersion: z.literal(1),
		planningBaselineCommit: commitSchema,
		changeSetBaseCommit: commitSchema,
		implementationCommit: commitSchema,
		startedAt: z.string().datetime(),
		completedAt: z.string().datetime(),
		runnerVersion: z.literal("scanner-hardening-closeout-v1"),
		scope: scannerHardeningCloseoutScopeReportSchema,
		commands: z
			.array(
				z
					.object({
						id: z.string().min(1).max(64),
						argv: z.array(z.string().min(1).max(500)).min(1).max(32),
						startedAt: z.string().datetime(),
						completedAt: z.string().datetime(),
						exitCode: z.number().int(),
						stdout: fileReferenceSchema,
						stderr: fileReferenceSchema,
					})
					.strict(),
			)
			.min(1)
			.max(32),
		evidence: z
			.object({
				applicationCommit: commitSchema,
				targetCommit: commitSchema,
				targetSnapshotSha256: sha256DigestSchema,
				toolboxImageDigest: sha256DigestSchema,
				scannerContractHash: sha256DigestSchema,
				individual: fileReferenceSchema,
				repeat: fileReferenceSchema,
				fullProfile: fileReferenceSchema,
				failure: fileReferenceSchema,
				qualification: fileReferenceSchema,
				ciReceipt: fileReferenceSchema.nullable(),
				reviewedBaselineSha256: sha256DigestSchema,
				fullProfilePlanHash: sha256DigestSchema,
				fullProfileNormalizedEvidenceHash: sha256DigestSchema,
				canonicalFinalReportHashes: z
					.record(z.string().min(1).max(100), sha256DigestSchema)
					.refine((value) => Object.keys(value).length === 14),
				scopeReport: fileReferenceSchema,
			})
			.strict(),
		dod: z.array(closeoutResultSchema).length(17),
		remediation: z.array(closeoutResultSchema).length(21),
		remediationCases: z.array(closeoutResultSchema).length(10),
		parentCloseout: z.array(closeoutResultSchema).length(4),
		ciPromotion: ciPromotionSchema,
		cleanup: z
			.object({
				activeOwnedProcessCount: z.number().int().nonnegative(),
				activeOwnedContainerCount: z.number().int().nonnegative(),
				activeOwnedListenerCount: z.number().int().nonnegative(),
				targetHeadUnchanged: z.boolean(),
				targetStatusUnchanged: z.boolean(),
				productionDatabaseUnchanged: z.boolean(),
				productionArtifactRootUnchanged: z.boolean(),
			})
			.strict(),
		verdict: z.enum(["passed", "blocked", "failed"]),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			value.scope.candidateCommit !== value.implementationCommit ||
			value.scope.planningBaselineCommit !== value.planningBaselineCommit ||
			value.scope.changeSetBaseCommit !== value.changeSetBaseCommit ||
			value.evidence.applicationCommit !== value.implementationCommit
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "receipt commit bindings do not agree",
			});
		}
		if (
			(value.ciPromotion.status === "passed") !==
			(value.evidence.ciReceipt !== null)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"a passing closeout must include the verified CI receipt bytes, and blocked closeout must not claim them",
			});
		}
		const resultStatuses = [
			...value.dod,
			...value.remediation,
			...value.remediationCases,
			...value.parentCloseout,
		];
		const cleanupPassed = Object.values(value.cleanup).every(
			(entry) => entry === true || entry === 0,
		);
		const shouldPass =
			value.scope.ok &&
			cleanupPassed &&
			value.ciPromotion.status === "passed" &&
			!resultStatuses.some((entry) =>
				["blocked", "failed"].includes(entry.status),
			);
		if ((value.verdict === "passed") !== shouldPass) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "closeout verdict must exactly reflect every required gate",
			});
		}
		if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "closeout completion cannot precede its start",
			});
		}
	});

export const scannerHardeningCiReceiptSchema = z
	.object({
		schemaVersion: z.literal(1),
		repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
		workflow: z.literal("verify"),
		createdAt: z.string().datetime(),
		runId: z.string().regex(/^\d+$/),
		runAttempt: z.number().int().positive(),
		applicationCommit: commitSchema,
		requiredJobs: z
			.array(
				z
					.object({
						id: z.enum([
							"verify / verify",
							"scanner-e2e-real / scanner-e2e-real",
						]),
						conclusion: z.literal("success"),
					})
					.strict(),
			)
			.length(2)
			.refine((value) => new Set(value.map((entry) => entry.id)).size === 2),
		target: targetIdentitySchema,
		toolboxImageDigest: sha256DigestSchema,
		qualificationHash: sha256DigestSchema,
		files: z.array(fileReferenceSchema).min(5).max(6),
		branchProtectionEvidence: fileReferenceSchema.nullable(),
		branchProtectionConfirmed: z.boolean(),
		verdict: z.enum(["candidate", "passed"]),
	})
	.strict()
	.superRefine((value, context) => {
		const promoted =
			value.branchProtectionConfirmed &&
			value.branchProtectionEvidence !== null &&
			value.files.length === 6;
		if (
			value.branchProtectionConfirmed !==
			(value.branchProtectionEvidence !== null && value.files.length === 6)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"branch protection confirmation requires its exact evidence file",
			});
		}
		if ((value.verdict === "passed") !== promoted) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"CI receipt verdict must exactly reflect confirmed branch protection",
			});
		}
		if (
			value.branchProtectionEvidence !== null &&
			!value.files.some(
				(entry) =>
					entry.path === value.branchProtectionEvidence?.path &&
					entry.sha256 === value.branchProtectionEvidence.sha256 &&
					entry.sizeBytes === value.branchProtectionEvidence.sizeBytes,
			)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"branch protection evidence must be part of the receipt file set",
			});
		}
	});

export type ScannerHardeningCloseoutReceipt = z.infer<
	typeof scannerHardeningCloseoutReceiptSchema
>;
export type ScannerHardeningCiReceipt = z.infer<
	typeof scannerHardeningCiReceiptSchema
>;
