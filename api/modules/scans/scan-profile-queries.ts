import type { ScanProfile } from "../../../shared/schemas/scan-profile.schema";
import { buildCanonicalScanProfiles } from "./canonical-scan-profiles";
import {
	applyDastStandardRollout,
	assertRuntimeAssessmentBudget,
} from "./dast-profile-rollout";
import { SCAN_PROFILES, SLSA_SUPPLY_CHAIN_PROFILE } from "./profiles";
import {
	DEPENDENCY_MANIFEST_SCOPE,
	SOURCE_BASELINE_SCOPE,
	staticProfileSteps,
} from "./scan-profile-scopes";

/** Canonical profiles are intentionally separate from the frozen legacy list. */
export function getCanonicalProfileById(id: string): ScanProfile | undefined {
	const profile = buildCanonicalScanProfiles({
		sourceScope: SOURCE_BASELINE_SCOPE,
		dependencyScope: DEPENDENCY_MANIFEST_SCOPE,
	}).find((candidate) => candidate.id === id && candidate.enabled);
	if (profile) assertRuntimeAssessmentBudget(profile);
	return profile;
}

export function listCanonicalProfiles(): ScanProfile[] {
	return buildCanonicalScanProfiles({
		sourceScope: SOURCE_BASELINE_SCOPE,
		dependencyScope: DEPENDENCY_MANIFEST_SCOPE,
	}).map((profile) => {
		assertRuntimeAssessmentBudget(profile);
		return profile;
	});
}

export function getProfileById(id: string): ScanProfile | undefined {
	if (id === SLSA_SUPPLY_CHAIN_PROFILE.id) return SLSA_SUPPLY_CHAIN_PROFILE;
	const profile = SCAN_PROFILES.find((p) => p.id === id && p.enabled);
	const rolledOut = profile
		? applyDastStandardRollout({
				...profile,
				steps: profile.steps ?? staticProfileSteps(profile),
			})
		: undefined;
	if (rolledOut) assertRuntimeAssessmentBudget(rolledOut);
	return rolledOut;
}
export function listProfiles(): ScanProfile[] {
	return SCAN_PROFILES.filter((p) => p.enabled).map((profile) => {
		const rolledOut = applyDastStandardRollout({
			...profile,
			steps: profile.steps ?? staticProfileSteps(profile),
		});
		assertRuntimeAssessmentBudget(rolledOut);
		return rolledOut;
	});
}
