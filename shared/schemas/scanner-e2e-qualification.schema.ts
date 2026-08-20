import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const scannerE2EQualificationSchema = z.object({
	schemaVersion: z.literal(1),
	qualificationHash: sha256DigestSchema,
	contractHash: sha256DigestSchema,
	qualifiedAt: z.string().datetime(),
	scannerManifestHash: sha256DigestSchema.nullable(),
	executionHash: sha256DigestSchema,
	caseEvidenceHashes: z.record(z.string(), sha256DigestSchema),
	caseScannerIdentityHashes: z.record(z.string(), sha256DigestSchema),
	qualifiedCaseIds: z.array(z.string().min(1).max(100)).length(12),
});

export type ScannerE2EQualification = z.infer<
	typeof scannerE2EQualificationSchema
>;
