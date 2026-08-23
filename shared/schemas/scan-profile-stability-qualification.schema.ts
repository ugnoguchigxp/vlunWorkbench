import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const relativePathSchema = z
	.string()
	.min(1)
	.max(500)
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.includes("\\") &&
			!value.split("/").includes(".."),
		"qualification paths must be relative and traversal-free",
	);
const profileIdSchema = z.enum([
	"api-readonly",
	"remediation-verification",
	"dynamic-verification",
	"authenticated-web",
	"active-technical-lab",
	"business-logic-lab",
]);

const testSchema = z
	.object({
		testId: z.string().min(1).max(200),
		caseId: z.string().min(1).max(160),
		repetition: z.number().int().min(1).max(3),
		redactedArgv: z.array(z.string().min(1).max(300)).min(1).max(32),
		exitCode: z.number().int().min(0).max(255),
		durationMs: z.number().int().nonnegative().max(3_600_000),
		stdoutDigest: sha256DigestSchema,
		stderrDigest: sha256DigestSchema,
		artifactRefs: z.array(z.string().min(1).max(160)).min(1).max(32),
		verdict: z.enum(["passed", "failed", "blocked"]),
	})
	.strict();

const artifactSchema = z
	.object({
		artifactId: z.string().min(1).max(160),
		kind: z.string().min(1).max(100),
		relativePath: relativePathSchema,
		byteLength: z.number().int().nonnegative().max(262_144_000),
		sha256: sha256DigestSchema,
		secretScanPassed: z.literal(true),
	})
	.strict();

const safetySchema = z
	.object({
		unauthorizedExternalRequests: z.number().int().nonnegative(),
		stateChangingScanRequests: z.number().int().nonnegative(),
		unauthorizedAuthenticationTransactionRequests: z
			.number()
			.int()
			.nonnegative(),
		secretLeaks: z.number().int().nonnegative(),
		hostMutations: z.number().int().nonnegative(),
		resourceLeaks: z.number().int().nonnegative(),
		falsePasses: z.number().int().nonnegative(),
	})
	.strict();

const reviewSchema = z
	.object({
		kind: z.enum(["security_reviewer", "operator"]),
		reviewerHash: sha256DigestSchema,
		decision: z.enum(["approved", "rejected"]),
		decidedAt: z.string().datetime(),
		reviewedArtifactRefs: z.array(z.string().min(1).max(160)).min(1),
		candidateCommit: commitSchema,
	})
	.strict();

export const scanProfileStabilityQualificationV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		qualificationId: sha256DigestSchema,
		profileId: profileIdSchema,
		candidateAvailability: z.literal("stable"),
		candidateCommit: commitSchema,
		sourceTreeDigest: sha256DigestSchema,
		catalogEntryHash: sha256DigestSchema,
		hashAlgorithms: z
			.object({
				qualification: z.literal("rfc8785-sha256-v1"),
				catalogEntry: z.literal("scan-profile-catalog-hash-v1"),
				sourceTree: z.literal("git-tree-list-sha256-v1"),
			})
			.strict(),
		executionDefinitionHashes: z.array(sha256DigestSchema).min(1).max(32),
		policyHashes: z.array(sha256DigestSchema).min(1).max(32),
		scannerManifestHash: sha256DigestSchema,
		executionEnvironment: z
			.object({
				hostOs: z.enum(["linux", "darwin"]),
				hostArch: z.enum(["x64", "arm64"]),
				containerPlatform: z.enum(["linux/amd64", "linux/arm64"]),
				dockerServerVersion: z.string().min(1).max(100),
				toolVersions: z.record(
					z.string().min(1).max(100),
					z.string().min(1).max(100),
				),
				imageDigests: z.record(z.string().min(1).max(100), sha256DigestSchema),
				databaseDigests: z.record(
					z.string().min(1).max(100),
					sha256DigestSchema,
				),
			})
			.strict(),
		tests: z.array(testSchema).min(1).max(256),
		artifacts: z.array(artifactSchema).min(1).max(256),
		metrics: z
			.object({
				policyId: z.string().min(1).max(160),
				values: z.record(z.string(), z.number().int().nonnegative()),
			})
			.strict(),
		safety: safetySchema,
		repeatability: z
			.object({
				requiredRunCount: z.literal(3),
				groups: z
					.array(
						z
							.object({
								caseId: z.string().min(1),
								normalizedResultHashes: z.array(sha256DigestSchema).length(3),
								cleanupReceiptHashes: z.array(sha256DigestSchema).length(3),
								consistent: z.literal(true),
							})
							.strict(),
					)
					.min(1),
			})
			.strict(),
		reviews: z.array(reviewSchema).max(16),
		limitations: z.array(z.string().min(1).max(100)).max(32),
		verdict: z.enum(["passed", "failed", "blocked"]),
	})
	.strict()
	.superRefine((value, ctx) => {
		const artifactIds = new Set(
			value.artifacts.map((artifact) => artifact.artifactId),
		);
		for (const test of value.tests) {
			for (const artifactRef of test.artifactRefs) {
				if (!artifactIds.has(artifactRef))
					ctx.addIssue({
						code: "custom",
						path: ["tests"],
						message: "qualification_test_artifact_missing",
					});
			}
		}
		if (value.verdict === "passed") {
			if (Object.values(value.safety).some((metric) => metric !== 0))
				ctx.addIssue({
					code: "custom",
					path: ["safety"],
					message: "qualification_safety_metric_nonzero",
				});
			if (value.tests.some((test) => test.verdict !== "passed"))
				ctx.addIssue({
					code: "custom",
					path: ["tests"],
					message: "qualification_passed_test_required",
				});
			if (
				value.profileId === "active-technical-lab" ||
				value.profileId === "business-logic-lab"
			) {
				if (
					!value.reviews.some(
						(review) =>
							review.kind === "security_reviewer" &&
							review.decision === "approved" &&
							review.candidateCommit === value.candidateCommit,
					)
				)
					ctx.addIssue({
						code: "custom",
						path: ["reviews"],
						message: "qualification_security_review_required",
					});
			}
		}
	});

export type ScanProfileStabilityQualificationV1 = z.infer<
	typeof scanProfileStabilityQualificationV1Schema
>;
