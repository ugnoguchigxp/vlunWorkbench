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

export const slsaProvenancePolicySchema = z
	.object({
		schemaVersion: z.literal(1),
		sourceUri: z.string().min(1).max(1000),
		builderId: z.string().min(1).max(1000).optional(),
		sourceRef: z
			.object({
				kind: z.enum(["branch", "tag", "versioned_tag"]),
				value: z.string().min(1).max(500),
			})
			.strict()
			.optional(),
	})
	.strict();
export type SlsaProvenancePolicy = z.infer<typeof slsaProvenancePolicySchema>;

export const slsaProvenanceReceiptSchema = z
	.object({
		schemaVersion: z.literal(1),
		provider: z.literal("slsa-verifier"),
		offline: z.literal(false),
		subjectDigest: sha256DigestSchema,
		provenanceDigest: sha256DigestSchema,
		policyDigest: sha256DigestSchema,
		expected: slsaProvenancePolicySchema.nullable(),
		verified: z.boolean(),
		reasonCode: z.enum([
			"verified",
			"slsa_policy_invalid",
			"provenance_verification_failed",
		]),
		verifiedAt: z.string().datetime(),
	})
	.strict();
export type SlsaProvenanceReceipt = z.infer<typeof slsaProvenanceReceiptSchema>;
