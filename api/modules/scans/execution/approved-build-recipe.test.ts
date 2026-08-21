import { describe, expect, it } from "vitest";
import { buildApprovedBuildRecipe, verifyApprovedBuildRecipe } from "./approved-build-recipe";

const DIGEST = `sha256:${"a".repeat(64)}`;
const receipt = {
	schemaVersion: 1 as const, provider: "cosign" as const, offline: true as const,
	subjectDigest: DIGEST, bundleDigest: DIGEST, trustPolicyDigest: DIGEST,
	verified: true, reasonCode: "verified" as const, verifiedAt: "2026-08-21T00:00:00.000Z",
};

describe("approved build recipe", () => {
	it("binds a fixed source snapshot and verified attestation before use", () => {
		const recipe = buildApprovedBuildRecipe({
			schemaVersion: 1, id: "go-race", sourceSnapshotDigest: DIGEST,
			attestationReceiptDigest: `sha256:${"4".repeat(64)}`,
			argv: ["go", "test", "-race", "./..."], workingDirectory: ".", timeoutSec: 600,
		});
		const result = verifyApprovedBuildRecipe({ recipe, sourceSnapshotDigest: DIGEST, attestationReceipt: receipt });
		expect(result).toEqual({ ok: false, reasonCode: "attestation_receipt_binding_mismatch" });
		expect(
			verifyApprovedBuildRecipe({
				recipe: {
					...recipe,
					sourceSnapshotDigest: `sha256:${"b".repeat(64)}`,
				},
				sourceSnapshotDigest: DIGEST,
				attestationReceipt: receipt,
			}),
		).toEqual({ ok: false, reasonCode: "source_snapshot_binding_mismatch" });
	});
});
