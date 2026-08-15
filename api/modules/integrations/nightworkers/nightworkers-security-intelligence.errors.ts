import type { NightworkersSecurityIntelligenceErrorCode } from "../../../../shared/schemas/nightworkers-security-intelligence.schema";

export class NightworkersSecurityIntelligenceError extends Error {
	constructor(
		readonly code: Extract<
			NightworkersSecurityIntelligenceErrorCode,
			"assessment_not_ready" | "assessment_unavailable"
		>,
		message: string,
		readonly retryable: boolean,
		readonly status: 409 | 422,
	) {
		super(message);
		this.name = "NightworkersSecurityIntelligenceError";
	}
}

export function assessmentNotReady(): NightworkersSecurityIntelligenceError {
	return new NightworkersSecurityIntelligenceError(
		"assessment_not_ready",
		"Security Intelligence assessment is not ready.",
		true,
		409,
	);
}

export function assessmentUnavailable(): NightworkersSecurityIntelligenceError {
	return new NightworkersSecurityIntelligenceError(
		"assessment_unavailable",
		"Security Intelligence assessment is unavailable for this scan.",
		false,
		422,
	);
}
