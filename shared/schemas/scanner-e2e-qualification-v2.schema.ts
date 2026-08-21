import { z } from "zod";
import { scannerE2EAssertionIdSchema } from "./scanner-e2e-v2.schema";
import { sha256DigestSchema } from "./security-capability.schema";

/** A v2 qualification cannot be mistaken for the legacy success-only bundle. */
export const scannerE2EQualificationV2Schema = z.object({
	schemaVersion: z.literal(2),
	qualificationHash: sha256DigestSchema,
	contractHash: sha256DigestSchema,
	qualifiedAt: z.string().datetime(),
	applicationCommit: z.string().regex(/^[a-f0-9]{40}$/),
	target: z
		.object({
			repository: z.literal("todolist"),
			commit: z.string().regex(/^[a-f0-9]{40}$/),
			snapshotSha256: sha256DigestSchema,
		})
		.strict(),
	toolboxImageDigest: sha256DigestSchema,
	scannerManifestHash: sha256DigestSchema.nullable(),
	executionHash: sha256DigestSchema,
	caseEvidenceHashes: z.record(z.string(), sha256DigestSchema),
	caseScannerIdentityHashes: z.record(z.string(), sha256DigestSchema),
	caseAssertionIds: z.record(
		z.string(),
		z.array(scannerE2EAssertionIdSchema).min(1).max(32),
	),
	qualifiedCaseIds: z.array(z.string().min(1).max(100)).length(12),
	individualEvidenceSha256: sha256DigestSchema,
	repeatEvidenceSha256: sha256DigestSchema,
	fullProfileEvidenceSha256: sha256DigestSchema,
	fullProfileExecutionPlanHash: sha256DigestSchema,
	fullProfileNormalizedEvidenceHash: sha256DigestSchema,
	canonicalFinalReportHashes: z
		.record(z.string().min(1).max(100), sha256DigestSchema)
		.refine((value) => Object.keys(value).length === 14),
});

export type ScannerE2EQualificationV2 = z.infer<
	typeof scannerE2EQualificationV2Schema
>;
