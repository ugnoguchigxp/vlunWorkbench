import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const attestationReceiptSchema = z.object({
	schemaVersion: z.literal(1),
	provider: z.literal("cosign"),
	offline: z.literal(true),
	subjectDigest: sha256DigestSchema,
	bundleDigest: sha256DigestSchema,
	trustPolicyDigest: sha256DigestSchema,
	verified: z.boolean(),
	reasonCode: z.enum([
		"verified",
		"attestation_bundle_invalid",
		"trust_policy_invalid",
		"attestation_verification_failed",
	]),
	verifiedAt: z.string().datetime(),
});
export type AttestationReceipt = z.infer<typeof attestationReceiptSchema>;
