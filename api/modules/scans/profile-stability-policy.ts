export {
	evaluateProfileStabilityQualification,
	PROFILE_STABILITY_POLICY_DEFINITIONS as PROFILE_STABILITY_POLICIES,
	policyForProfile,
} from "./qualification/profile-stability-policy";

import { PROFILE_STABILITY_POLICY_DEFINITIONS } from "./qualification/profile-stability-policy";

export function validateProfileStabilityCases(
	profileId: string,
	policyId: string,
	caseIds: readonly string[],
) {
	const policy =
		PROFILE_STABILITY_POLICY_DEFINITIONS[
			policyId as keyof typeof PROFILE_STABILITY_POLICY_DEFINITIONS
		];
	if (!policy || policy.profileId !== profileId)
		return { ok: false as const, reason: "qualification_policy_mismatch" };
	const actual = [...new Set(caseIds)].sort();
	const required = [...policy.requiredCaseIds].sort();
	const missing = required.filter((caseId) => !actual.includes(caseId));
	const unexpected = actual.filter((caseId) => !required.includes(caseId));
	return missing.length || unexpected.length
		? {
				ok: false as const,
				reason: "qualification_case_set_mismatch",
				missing,
				unexpected,
			}
		: { ok: true as const };
}
