import crypto from "node:crypto";
import type { AttestationReceipt } from "../../../../shared/schemas/attestation-receipt.schema";
import {
	approvedBuildRecipeSchema,
	type ApprovedBuildRecipe,
} from "../../../../shared/schemas/approved-build-recipe.schema";

export function buildApprovedBuildRecipe(
	params: Omit<ApprovedBuildRecipe, "recipeHash">,
): ApprovedBuildRecipe {
	const unsigned = { ...params };
	return approvedBuildRecipeSchema.parse({
		...unsigned,
		recipeHash: digest(unsigned),
	});
}

/** Refuses stale snapshots, unverified receipts, and modified recipe content. */
export function verifyApprovedBuildRecipe(params: {
	recipe: ApprovedBuildRecipe;
	sourceSnapshotDigest: string;
	attestationReceipt: AttestationReceipt;
}): { ok: true } | { ok: false; reasonCode: string } {
	if (!params.attestationReceipt.verified) {
		return { ok: false, reasonCode: "attestation_verification_failed" };
	}
	if (params.recipe.sourceSnapshotDigest !== params.sourceSnapshotDigest) {
		return { ok: false, reasonCode: "source_snapshot_binding_mismatch" };
	}
	if (
		params.recipe.attestationReceiptDigest !== digest(params.attestationReceipt)
	) {
		return { ok: false, reasonCode: "attestation_receipt_binding_mismatch" };
	}
	const { recipeHash: _recipeHash, ...unsigned } = params.recipe;
	if (params.recipe.recipeHash !== digest(unsigned)) {
		return { ok: false, reasonCode: "approved_recipe_modified" };
	}
	return { ok: true };
}

function digest(value: unknown): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
