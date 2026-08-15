import {
	deriveNightworkersSecurityIntelligenceBundleRef,
	type NightworkersAuthorizationShadowState,
	type NightworkersSecurityIntelligenceBundle,
	parseNightworkersSecurityIntelligenceBundle,
} from "../../../../shared/schemas/nightworkers-security-intelligence.schema";
import type { SecurityIntelligenceAssessmentV1 } from "../../../../shared/schemas/security-intelligence-assessment.schema";
import { parseSecurityIntelligenceAssessmentV1 } from "../../../../shared/security-intelligence-assessment-contract";

export function projectNightworkersSecurityIntelligenceBundle(params: {
	dependencyAssessment: SecurityIntelligenceAssessmentV1;
	authorizationShadow: NightworkersAuthorizationShadowState;
}): NightworkersSecurityIntelligenceBundle {
	const dependencyAssessment = parseSecurityIntelligenceAssessmentV1(
		params.dependencyAssessment,
	);
	const authorizationShadow =
		params.authorizationShadow.status === "available"
			? {
					status: "available" as const,
					assessment: parseSecurityIntelligenceAssessmentV1(
						params.authorizationShadow.assessment,
					),
				}
			: params.authorizationShadow;
	const limitationCodes = canonicalStrings([
		...(authorizationShadow.status === "disabled"
			? [authorizationShadow.reasonCode]
			: authorizationShadow.status === "unavailable"
				? [authorizationShadow.reasonCode]
				: ["authorization_shadow_only"]),
	]);
	const semantic = {
		contractVersion: 1 as const,
		projectRef: dependencyAssessment.projectRef,
		scanRunRef: dependencyAssessment.source.scanRunRef,
		target: dependencyAssessment.target,
		dependencyAssessment,
		authorizationShadow,
		limitationCodes,
	};
	return parseNightworkersSecurityIntelligenceBundle({
		...semantic,
		bundleRef: deriveNightworkersSecurityIntelligenceBundleRef(semantic),
	});
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
}
