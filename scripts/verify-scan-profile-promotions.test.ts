import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../shared/canonical-json";
import { scanProfilePromotionManifestV1Schema } from "../shared/schemas/scan-profile-promotion-manifest.schema";
import { verifyScanProfilePromotions } from "./verify-scan-profile-promotions";

const digest = (value: string) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
let root = "";
afterEach(async () => {
	if (root) await fs.rm(root, { recursive: true, force: true });
	root = "";
});

function manifest() {
	const unsigned = {
		schemaVersion: 1 as const,
		candidateCommit: "a".repeat(40),
		promotions: [
			{
				profileId: "api-readonly" as const,
				fromAvailability: "experimental" as const,
				toAvailability: "stable" as const,
				requiredEnvironments: [
					"darwin/arm64+linux/arm64" as const,
					"linux/x64+linux/amd64" as const,
				],
				qualificationReceiptHashes: [digest("darwin"), digest("linux")],
			},
		],
		verdict: "passed" as const,
	};
	return { ...unsigned, manifestHash: digest(canonicalJson(unsigned)) };
}

describe("scan profile promotion verifier", () => {
	it("accepts only promotable profiles with sorted environment bindings", () => {
		expect(scanProfilePromotionManifestV1Schema.safeParse(manifest()).success).toBe(true);
		const reversed = manifest();
		reversed.promotions[0].requiredEnvironments.reverse();
		expect(scanProfilePromotionManifestV1Schema.safeParse(reversed).success).toBe(false);
		expect(
			scanProfilePromotionManifestV1Schema.safeParse({
				...manifest(),
				promotions: [{ ...manifest().promotions[0], profileId: "professional-full" }],
			}).success,
		).toBe(false);
	});

	it("requires receipt bytes for every declared profile and environment", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "promotion-verify-"));
		const manifestPath = path.join(root, "promotion-manifest.v1.json");
		await fs.writeFile(manifestPath, JSON.stringify(manifest()));
		await expect(verifyScanProfilePromotions(manifestPath)).rejects.toThrow();
	});
});
