import type { ScanResultPolicy } from "../../../../shared/schemas/scan-profile-catalog.schema";

export type GateDecision = "not_requested" | "pass" | "fail" | "blocked";

export type ScanGateEvaluation = {
	resultPolicy: ScanResultPolicy;
	gateDecision: GateDecision;
	gateThreshold: "critical" | "high" | "medium" | "low" | null;
	blockingFindingCount: number;
	reason: string | null;
};

const severityRank: Record<string, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
	info: 0,
};

export function evaluateScanGate(params: {
	resultPolicy: ScanResultPolicy;
	gateThreshold: "critical" | "high" | "medium" | "low" | null;
	profileOutcome: "completed" | "completed_with_warnings" | "blocked" | "incomplete" | "failed";
	findings: ReadonlyArray<{ severity: string }>;
}): ScanGateEvaluation {
	if (params.resultPolicy === "advisory") {
		return {
			resultPolicy: "advisory",
			gateDecision: "not_requested",
			gateThreshold: null,
			blockingFindingCount: 0,
			reason: null,
		};
	}
	if (
		params.profileOutcome === "blocked" ||
		params.profileOutcome === "incomplete" ||
		params.profileOutcome === "failed" ||
		!params.gateThreshold
	) {
		return {
			resultPolicy: "gate",
			gateDecision: "blocked",
			gateThreshold: params.gateThreshold,
			blockingFindingCount: 0,
			reason: params.gateThreshold
				? "scan_outcome_not_gate_eligible"
				: "gate_threshold_missing",
		};
	}
	if (
		params.findings.some(
			(finding) => severityRank[finding.severity.toLowerCase()] === undefined,
		)
	) {
		return {
			resultPolicy: "gate",
			gateDecision: "blocked",
			gateThreshold: params.gateThreshold,
			blockingFindingCount: 0,
			reason: "finding_severity_unknown",
		};
	}
	const thresholdRank = severityRank[params.gateThreshold];
	const blockingFindingCount = params.findings.filter((finding) => {
		const rank = severityRank[finding.severity.toLowerCase()];
		return rank !== undefined && rank >= thresholdRank;
	}).length;
	return {
		resultPolicy: "gate",
		gateDecision: blockingFindingCount > 0 ? "fail" : "pass",
		gateThreshold: params.gateThreshold,
		blockingFindingCount,
		reason: null,
	};
}
