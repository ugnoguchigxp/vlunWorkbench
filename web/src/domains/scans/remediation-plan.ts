import type {
	DynamicRun,
	Finding,
	FindingDecision,
	FindingReview,
	ReproductionRun,
} from "../../api";

export type RemediationStatus =
	| "not_started"
	| "planned"
	| "in_progress"
	| "fixed"
	| "accepted"
	| "false_positive"
	| "deferred";

export type RemediationPriority = "p0" | "p1" | "p2" | "p3";

export type RemediationInput = {
	owner?: string | null;
	priority?: RemediationPriority;
	dueDate?: string | null;
	status?: RemediationStatus;
	recommendedFix?: string | null;
};

export type RemediationPlanView = {
	findingId: string;
	status: RemediationStatus;
	owner: string | null;
	priority: RemediationPriority;
	dueDate: string | null;
	recommendedFix: string | null;
	verificationRequired: boolean;
	verificationStatus:
		| "not_run"
		| "running"
		| "passed"
		| "failed"
		| "inconclusive";
	blockingReasons: string[];
};

type FindingDecisionWithMetadata = FindingDecision & {
	metadata?: Record<string, unknown>;
};

export type BuildRemediationPlanInput = {
	finding: Finding;
	latestDecision?: FindingDecisionWithMetadata | null;
	latestReview?: Partial<FindingReview> | null;
	reproductionRuns?: ReproductionRun[];
	dynamicRuns?: DynamicRun[];
};

const severityPriority: Record<string, RemediationPriority> = {
	critical: "p0",
	high: "p1",
	medium: "p2",
	low: "p3",
	info: "p3",
	unknown: "p3",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const readRemediationMetadata = (
	decision: FindingDecisionWithMetadata | null | undefined,
): RemediationInput => {
	const remediation = decision?.metadata?.remediation;
	if (!isRecord(remediation)) return {};
	return {
		owner: typeof remediation.owner === "string" ? remediation.owner : null,
		priority:
			remediation.priority === "p0" ||
			remediation.priority === "p1" ||
			remediation.priority === "p2" ||
			remediation.priority === "p3"
				? remediation.priority
				: undefined,
		dueDate:
			typeof remediation.dueDate === "string" ? remediation.dueDate : null,
		status:
			remediation.status === "not_started" ||
			remediation.status === "planned" ||
			remediation.status === "in_progress" ||
			remediation.status === "fixed" ||
			remediation.status === "accepted" ||
			remediation.status === "false_positive" ||
			remediation.status === "deferred"
				? remediation.status
				: undefined,
		recommendedFix:
			typeof remediation.recommendedFix === "string"
				? remediation.recommendedFix
				: null,
	};
};

const defaultStatus = (
	decision: FindingDecisionWithMetadata | null | undefined,
): RemediationStatus => {
	if (decision?.decision === "accepted") return "accepted";
	if (decision?.decision === "false_positive") return "false_positive";
	if (decision?.decision === "deferred") return "deferred";
	if (decision?.decision === "needs_fix") return "not_started";
	return "not_started";
};

const verificationStatus = (
	reproductionRuns: ReproductionRun[] | undefined,
	dynamicRuns: DynamicRun[] | undefined,
): RemediationPlanView["verificationStatus"] => {
	const runs = [...(reproductionRuns ?? []), ...(dynamicRuns ?? [])];
	if (runs.some((run) => run.status === "running")) return "running";
	if (
		runs.some(
			(run) =>
				run.status === "completed" &&
				(run.outcome === "passed" || run.outcome === "not_reproduced"),
		)
	) {
		return "passed";
	}
	if (
		runs.some(
			(run) =>
				run.status === "completed" &&
				(run.outcome === "failed" || run.outcome === "reproduced"),
		)
	) {
		return "failed";
	}
	if (runs.some((run) => run.status === "completed")) return "inconclusive";
	return "not_run";
};

export function buildRemediationPlanView(
	input: BuildRemediationPlanInput,
): RemediationPlanView {
	const decision = input.latestDecision ?? input.finding.latestDecision ?? null;
	const remediation = readRemediationMetadata(decision);
	const status = remediation.status ?? defaultStatus(decision);
	const priority =
		remediation.priority ?? severityPriority[input.finding.severity] ?? "p3";
	const verification = verificationStatus(
		input.reproductionRuns,
		input.dynamicRuns,
	);
	const verificationRequired =
		decision?.decision === "needs_fix" ||
		input.finding.severity === "critical" ||
		input.finding.severity === "high";
	const blockingReasons: string[] = [];
	if (!decision) blockingReasons.push("decision_required");
	if (
		(decision?.decision === "needs_fix" ||
			status === "planned" ||
			status === "in_progress") &&
		(input.finding.severity === "critical" || input.finding.severity === "high")
	) {
		if (!remediation.owner?.trim()) blockingReasons.push("owner_required");
		if (!remediation.dueDate?.trim()) blockingReasons.push("due_date_required");
	}
	if (verificationRequired && status === "fixed" && verification !== "passed") {
		blockingReasons.push("verification_required");
	}

	return {
		findingId: input.finding.id,
		status,
		owner: remediation.owner?.trim() || null,
		priority,
		dueDate: remediation.dueDate?.trim() || null,
		recommendedFix:
			remediation.recommendedFix?.trim() ||
			input.latestReview?.remediationDirection ||
			null,
		verificationRequired,
		verificationStatus: verification,
		blockingReasons,
	};
}
