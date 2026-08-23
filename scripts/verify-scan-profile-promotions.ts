import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { canonicalJson } from "../shared/canonical-json";
import { scanProfilePromotionManifestV1Schema } from "../shared/schemas/scan-profile-promotion-manifest.schema";
import { verifyScanProfileStabilityQualification } from "./verify-scan-profile-stability-qualification";

const digest = (value: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;

export async function verifyScanProfilePromotions(
	manifestPath: string,
	receiptRoot = path.dirname(manifestPath),
) {
	const manifest = scanProfilePromotionManifestV1Schema.parse(
		JSON.parse(await fs.readFile(manifestPath, "utf8")),
	);
	const { manifestHash, ...unsigned } = manifest;
	if (manifestHash !== digest(canonicalJson(unsigned)))
		throw new Error("promotion_manifest_hash_invalid");
	for (const promotion of manifest.promotions) {
		for (const [
			index,
			environment,
		] of promotion.requiredEnvironments.entries()) {
			const receiptPath = path.join(
				receiptRoot,
				promotion.profileId,
				environment,
				"qualification.v1.json",
			);
			const receiptBytes = await fs.readFile(receiptPath);
			if (digest(receiptBytes) !== promotion.qualificationReceiptHashes[index])
				throw new Error("promotion_receipt_hash_mismatch");
			const receipt = await verifyScanProfileStabilityQualification({
				receiptPath,
				artifactRoot: path.dirname(receiptPath),
			});
			if (
				receipt.profileId !== promotion.profileId ||
				receipt.candidateCommit !== manifest.candidateCommit ||
				receipt.verdict !== "passed"
			)
				throw new Error("promotion_receipt_binding_mismatch");
			const actualEnvironment = `${receipt.executionEnvironment.hostOs}/${receipt.executionEnvironment.hostArch}+${receipt.executionEnvironment.containerPlatform}`;
			if (actualEnvironment !== environment)
				throw new Error("promotion_receipt_environment_mismatch");
		}
	}
	return manifest;
}

async function main() {
	const { values } = parseArgs({ options: { manifest: { type: "string" } } });
	if (!values.manifest) throw new Error("promotion_manifest_arg_required");
	const manifest = await verifyScanProfilePromotions(values.manifest);
	console.log(
		JSON.stringify({ ok: true, candidateCommit: manifest.candidateCommit }),
	);
}
if (import.meta.main) await main();
