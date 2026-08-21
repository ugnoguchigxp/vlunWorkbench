import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

/** Stable assertions make the release verifier independent of log wording. */
export const scannerE2EAssertionIdSchema = z.enum([
	"INV-01",
	"ENT-01",
	"PLAN-01",
	"PREF-01",
	"PROV-01",
	"WORK-01",
	"ART-01",
	"NORM-01",
	"VERDICT-01",
	"REPORT-01",
	"SAFE-01",
	"CLEAN-01",
	"FAIL-01",
]);

/** Names are deliberately closed: a producer cannot satisfy a gate with an ad-hoc metric. */
export const scannerE2EWorkCounterNameSchema = z.enum([
	"filesScanned",
	"manifestsScanned",
	"packagesScanned",
	"prodPackagesScanned",
	"devPackagesScanned",
	"targetsScanned",
	"resultsProduced",
	"rulesLoaded",
	"parseErrors",
	"candidates",
	"components",
	"dependencyRelationships",
	"prodComponents",
	"devComponents",
	"workspaceComponents",
	"requestsSent",
	"eligibleRoutes",
	"coveredRoutes",
	"mutationRequests",
	"publicRequests",
	"templatesLoaded",
	"alertsProduced",
	"operationsSelected",
	"writeOperations",
]);

export const scannerE2EWorkCounterBoundsSchema = z
	.object({
		minimum: z.number().int().min(0),
		maximum: z.number().int().min(0).optional(),
	})
	.superRefine((value, context) => {
		if (value.maximum !== undefined && value.maximum < value.minimum) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "maximum must be greater than or equal to minimum",
			});
		}
	});

export const scannerE2ECaseV2Schema = z.object({
	id: z
		.string()
		.regex(/^[a-z0-9][a-z0-9-]*$/)
		.max(100),
	scannerId: z.string().min(1).max(80),
	mode: z.string().min(1).max(80),
	profileId: z.string().min(1).max(120),
	stepId: z.string().min(1).max(160).nullable(),
	expectedArtifactRoles: z.array(z.string().min(1).max(80)).max(12),
	expectedVerdict: z.enum(["passed", "not_applicable"]),
	requiredAssertionIds: z.array(scannerE2EAssertionIdSchema).min(1).max(32),
	workCounters: z.partialRecord(
		scannerE2EWorkCounterNameSchema,
		scannerE2EWorkCounterBoundsSchema,
	),
});

export const scannerE2ECaseRegistryV2Schema = z.object({
	schemaVersion: z.literal(2),
	cases: z.array(scannerE2ECaseV2Schema).length(12),
});

const scannerE2EArtifactEvidenceV2Schema = z.object({
	id: z.string().uuid(),
	kind: z.string().min(1).max(80),
	storageKey: z.string().min(1).max(500),
	sha256: sha256DigestSchema,
	sizeBytes: z.number().int().min(0),
});

const scannerE2ESuccessScenarioV2Schema = z.object({
	kind: z.literal("success"),
	scenarioType: z.enum(["executed_success", "not_applicable_success"]),
	scanRunId: z.string().uuid(),
	profileOutcome: z.enum(["completed", "completed_with_warnings"]),
	executionPlanHash: sha256DigestSchema,
	preflightHash: sha256DigestSchema,
	sourceRevisionHash: sha256DigestSchema.nullable(),
	scannerManifestHash: sha256DigestSchema.nullable(),
	executionHash: sha256DigestSchema,
	scannerIdentityHash: sha256DigestSchema,
	normalizedFindingHashes: z.array(sha256DigestSchema).max(10_000),
	normalizedEvidenceHash: sha256DigestSchema,
	scannerProcessCount: z.number().int().min(0),
	toolRunCount: z.number().int().min(0),
	work: z.partialRecord(
		scannerE2EWorkCounterNameSchema,
		z.number().int().min(0),
	),
	assertionIds: z.array(scannerE2EAssertionIdSchema).min(1).max(32),
	artifacts: z.array(scannerE2EArtifactEvidenceV2Schema).max(64),
	canonicalFinalReportId: z.string().uuid(),
	canonicalFinalArtifactId: z.string().uuid(),
	canonicalFinalReportStorageKey: z.string().min(1).max(500),
	canonicalFinalReportSha256: sha256DigestSchema,
	canonicalFinalReportSizeBytes: z.number().int().nonnegative(),
	canonicalFinalReportCount: z.literal(1),
	toolVersions: z.record(z.string(), z.string().min(1).max(200)),
	imageDigests: z.array(sha256DigestSchema).max(12),
	reasonCodes: z.array(z.string().min(1).max(100)).max(32),
});

const scannerE2EFailClosedScenarioV2Schema = z.object({
	kind: z.literal("fail_closed"),
	scenarioType: z.literal("preflight_blocked"),
	scanRunId: z.string().uuid(),
	profileOutcome: z.literal("blocked"),
	terminationReason: z.literal("plan_changed"),
	scannerProcessCount: z.literal(0),
	toolRunCount: z.literal(0),
	canonicalFinalReportCount: z.literal(0),
	artifactCount: z.literal(0),
	assertionIds: z.array(scannerE2EAssertionIdSchema).min(1).max(32),
	reasonCodes: z.array(z.string().min(1).max(100)).max(32),
});

export const scannerE2EEvidenceV2Schema = z.object({
	schemaVersion: z.literal(2),
	caseId: z.string().min(1).max(100),
	contractHash: sha256DigestSchema,
	executedAt: z.string().datetime(),
	scenarios: z
		.array(
			z.discriminatedUnion("kind", [
				scannerE2ESuccessScenarioV2Schema,
				scannerE2EFailClosedScenarioV2Schema,
			]),
		)
		.min(1)
		.max(2),
});

export const scannerE2EEvidenceBundleV2Schema = z.object({
	schemaVersion: z.literal(2),
	applicationCommit: z.string().regex(/^[a-f0-9]{40}$/),
	target: z
		.object({
			repository: z.literal("todolist"),
			commit: z.string().regex(/^[a-f0-9]{40}$/),
			snapshotSha256: sha256DigestSchema,
		})
		.strict(),
	toolboxImageDigest: sha256DigestSchema,
	// The harness permits a partial bundle for local `--only` diagnostics. The
	// release verifier separately requires the exact canonical 12-case set.
	evidence: z.array(scannerE2EEvidenceV2Schema).min(1).max(12),
});

export type ScannerE2ECaseV2 = z.infer<typeof scannerE2ECaseV2Schema>;
export type ScannerE2ECaseRegistryV2 = z.infer<
	typeof scannerE2ECaseRegistryV2Schema
>;
export type ScannerE2EEvidenceV2 = z.infer<typeof scannerE2EEvidenceV2Schema>;
