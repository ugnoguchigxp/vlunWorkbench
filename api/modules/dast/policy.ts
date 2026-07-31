import crypto from "node:crypto";
import type { DastProfileDefinition } from "./profiles";

export const DAST_STANDARD_POLICY_ID = "dast-standard-v1";
export const DAST_STANDARD_POLICY_HASH =
	"sha256:4bee9b2e3d724fc118eae393c8e12f9f3d92b8e52c5fe69524d6e576dbaa71c9";

export function policyForDastProfile(profile: DastProfileDefinition): {
	policyId: string;
	policyHash: string;
} {
	if (
		profile.id === "web-passive-standard" ||
		profile.id === "authenticated-readonly-standard"
	) {
		return {
			policyId: DAST_STANDARD_POLICY_ID,
			policyHash: DAST_STANDARD_POLICY_HASH,
		};
	}
	const policyId = `dast-${profile.id}-legacy-v1`;
	return {
		policyId,
		policyHash: `sha256:${crypto
			.createHash("sha256")
			.update(
				JSON.stringify({
					policyId,
					kind: profile.kind,
					checks: profile.checks,
					crawlerEnabled: profile.crawlerEnabled,
					requiresAuth: profile.requiresAuth,
				}),
			)
			.digest("hex")}`,
	};
}
