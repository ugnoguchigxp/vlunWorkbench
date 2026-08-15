import type { SecurityIntelligenceAssessmentV1 } from "../../../../shared/schemas/security-intelligence-assessment.schema";

export type NightworkersSecurityIntelligenceTelemetry = {
	dependencyBuildDurationMs: number;
	payloadBytes: number;
	authorizationStatus: "disabled" | "unavailable" | "available";
	dependencyOutcome: SecurityIntelligenceAssessmentV1["outcome"];
	evidenceRefCount: number;
	limitationCount: number;
};

export function emitNightworkersSecurityIntelligenceTelemetry(
	observation: NightworkersSecurityIntelligenceTelemetry,
): void {
	console.info(
		JSON.stringify({
			version: 1,
			level: "info",
			event: "nightworkers.security_intelligence.assessment_built",
			...observation,
		}),
	);
}
