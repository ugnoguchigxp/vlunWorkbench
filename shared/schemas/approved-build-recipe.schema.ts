import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const approvedBuildRecipeSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string().regex(/^[a-z][a-z0-9-]{2,99}$/),
	sourceSnapshotDigest: sha256DigestSchema,
	attestationReceiptDigest: sha256DigestSchema,
	argv: z.array(z.string().min(1).max(200)).min(1).max(32),
	workingDirectory: z.string().regex(/^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]*$/),
	timeoutSec: z.number().int().positive().max(3_600),
	recipeHash: sha256DigestSchema,
});
export type ApprovedBuildRecipe = z.infer<typeof approvedBuildRecipeSchema>;
