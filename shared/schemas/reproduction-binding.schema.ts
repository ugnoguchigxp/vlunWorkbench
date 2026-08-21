import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

/**
 * Immutable provenance required to interpret a negative reproduction result.
 * A scanner recheck may report no match, but it is not evidence of a fix until
 * all three bindings are identical to the source finding's execution context.
 */
export const reproductionBindingSchema = z.object({
	sourceSnapshotDigest: sha256DigestSchema,
	executionPlanHash: sha256DigestSchema,
	scannerBindingHash: sha256DigestSchema,
});
export type ReproductionBindingContract = z.infer<
	typeof reproductionBindingSchema
>;

export const reproductionSpecV1Schema = z.object({
	schemaVersion: z.literal(1),
	profileId: z.string().min(1).max(160),
	findingFingerprint: z.string().min(1).max(200),
	originalBinding: reproductionBindingSchema,
});
export type ReproductionSpecV1 = z.infer<typeof reproductionSpecV1Schema>;
