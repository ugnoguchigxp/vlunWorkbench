import { PROFILE_STABILITY_POLICY_DEFINITIONS } from "../../api/modules/scans/qualification/profile-stability-policy";

export const SCAN_PROFILE_QUALIFICATION_CASE_REGISTRY = Object.fromEntries(
	Object.entries(PROFILE_STABILITY_POLICY_DEFINITIONS).map(
		([policyId, policy]) => [
			policy.profileId,
			{
				policyId,
				cases: policy.requiredCaseIds.map((caseId) => ({
					caseId,
					fixtureManifest: `scripts/scan-profile-qualification/fixtures/${policy.profileId}.json`,
					metricPlugin: policyId,
				})),
			},
		],
	),
) as Record<
	string,
	{
		policyId: string;
		cases: Array<{
			caseId: string;
			fixtureManifest: string;
			metricPlugin: string;
		}>;
	}
>;

export function qualificationCaseRegistryEntry(profileId: string) {
	return SCAN_PROFILE_QUALIFICATION_CASE_REGISTRY[profileId];
}
