import { z } from "zod";
import { scannerE2EAssertionIdSchema } from "./scanner-e2e-v2.schema";
import { sha256DigestSchema } from "./security-capability.schema";

/** A v2 qualification cannot be mistaken for the legacy success-only bundle. */
export const scannerE2EQualificationV2Schema = z.object({
	schemaVersion: z.literal(2),
	qualificationHash: sha256DigestSchema,
	contractHash: sha256DigestSchema,
	qualifiedAt: z.string().datetime(),
	scannerManifestHash: sha256DigestSchema.nullable(),
	executionHash: sha256DigestSchema,
	caseEvidenceHashes: z.record(z.string(), sha256DigestSchema),
	caseScannerIdentityHashes: z.record(z.string(), sha256DigestSchema),
	caseAssertionIds: z.record(
		z.string(),
		z.array(scannerE2EAssertionIdSchema).min(1).max(32),
	),
	qualifiedCaseIds: z.array(z.string().min(1).max(100)).length(12),
});

export type ScannerE2EQualificationV2 = z.infer<
	typeof scannerE2EQualificationV2Schema
>;
