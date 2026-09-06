import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

const profileStepIdSchema = z.enum([
	"gitleaks",
	"osv",
	"trivy",
	"semgrep",
	"zizmor",
	"sbom_export:trivy",
	"dast:web-passive-standard",
	"runtime_scanner:nuclei-safe",
	"runtime_scanner:zap-baseline",
	"api_schema_scan:schemathesis",
]);

const profileStepSchema = z
	.object({
		id: profileStepIdSchema,
		status: z.enum(["completed", "skipped"]),
		applicability: z.enum(["applicable", "not_applicable"]),
		reasonCodes: z.array(z.string().min(1)).max(8),
		requestCount: z.number().int().nonnegative(),
	})
	.strict();

const artifactSchema = z
	.object({
		kind: z.string().min(1).max(80),
		storageKey: z.string().min(1).max(500),
		sha256: sha256DigestSchema,
		sizeBytes: z.number().int().nonnegative(),
	})
	.strict();

const apiWithoutSchemaBlockSchema = z
	.object({
		scanRunId: z.string().uuid(),
		profileOutcome: z.literal("blocked"),
		preflightHash: sha256DigestSchema,
		sourceRevisionHash: sha256DigestSchema,
		reasonCodes: z.array(z.literal("schema_not_found")).length(1),
		scannerProcessCount: z.literal(0),
		artifactCount: z.literal(0),
		targetStartCount: z.literal(0),
	})
	.strict();

export const scannerE2EFullProfileRunSchema = z
	.object({
		scanRunId: z.string().uuid(),
		profileOutcome: z.enum(["completed", "completed_with_warnings"]),
		executionPlanHash: sha256DigestSchema,
		preflightHash: sha256DigestSchema,
		sourceRevisionHash: sha256DigestSchema,
		scannerManifestHash: sha256DigestSchema,
		steps: z.array(profileStepSchema).length(10),
		scannerProcessCount: z.number().int().min(1),
		runtimeRequestCount: z.number().int().min(1),
		normalizedFindingHashes: z.array(sha256DigestSchema).max(10_000),
		toolVersions: z.record(z.string().min(1), z.string().min(1).max(200)),
		artifacts: z.array(artifactSchema).min(1).max(128),
		canonicalFinalReportCount: z.literal(1),
		canonicalFinalReportStorageKey: z.string().min(1).max(500),
		canonicalFinalReportSha256: sha256DigestSchema,
		canonicalFinalReportSizeBytes: z.number().int().nonnegative(),
		targetStartCount: z.literal(1),
		activeTargetCountAfterRun: z.literal(0),
		normalizedEvidenceHash: sha256DigestSchema,
	})
	.strict()
	.superRefine((value, context) => {
		const expected = profileStepIdSchema.options;
		if (
			new Set(value.steps.map((step) => step.id)).size !== expected.length ||
			expected.some((id) => !value.steps.some((step) => step.id === id))
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "full profile must observe every configured step exactly once",
			});
		}
		const schema = value.steps.find(
			(step) => step.id === "api_schema_scan:schemathesis",
		);
		if (
			schema?.status !== "completed" ||
			schema.applicability !== "applicable" ||
			schema.requestCount < 1
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"the composite profile must execute the reviewed read-only schema",
			});
		}
		if (
			value.steps.some(
				(step) =>
					step.status !== "completed" || step.applicability !== "applicable",
			)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "all non-schema full-profile steps must execute successfully",
			});
		}
	});

export const scannerE2EFullProfileEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		applicationCommit: z.string().regex(/^[a-f0-9]{40}$/),
		executedAt: z.string().datetime(),
		target: z
			.object({
				repository: z.literal("todolist"),
				commit: z.string().regex(/^[a-f0-9]{40}$/),
				snapshotSha256: sha256DigestSchema,
			})
			.strict(),
		toolboxImageDigest: sha256DigestSchema,
		apiWithoutSchemaBlock: apiWithoutSchemaBlockSchema,
		runs: z.array(scannerE2EFullProfileRunSchema).length(2),
	})
	.strict();

export type ScannerE2EFullProfileEvidence = z.infer<
	typeof scannerE2EFullProfileEvidenceSchema
>;
