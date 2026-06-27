import type {
	DastEvidence,
	DiagnosticReport,
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingReview,
	ReproductionRun,
} from "../../api";

export type EvidenceQualityLevel = "strong" | "moderate" | "weak" | "missing";

export type EvidenceSignal = {
	id: string;
	label: string;
	kind:
		| "source_location"
		| "tool_output"
		| "llm_review"
		| "reproduction"
		| "dynamic"
		| "dast"
		| "diagnostic"
		| "decision";
	present: boolean;
	strength: "high" | "medium" | "low";
	reference?: string;
};

export type EvidenceQualityView = {
	findingId: string;
	level: EvidenceQualityLevel;
	score: number;
	label: string;
	reasons: string[];
	missingSignals: EvidenceSignal[];
	presentSignals: EvidenceSignal[];
	recommendedNextAction:
		| "run_review"
		| "run_reproduction"
		| "run_dynamic"
		| "record_decision"
		| "ready_for_report";
};

export type BuildEvidenceQualityInput = {
	finding: Finding;
	evidence?: FindingEvidence[];
	latestReview?: Partial<FindingReview> | null;
	latestDecision?: FindingDecision | null;
	reproductionRuns?: ReproductionRun[];
	dynamicRuns?: DynamicRun[];
	dastEvidence?: DastEvidence[];
	diagnosticReports?: DiagnosticReport[];
};

const labels: Record<EvidenceQualityLevel, string> = {
	strong: "Strong",
	moderate: "Moderate",
	weak: "Weak",
	missing: "Missing",
};

const hasText = (value: unknown): boolean =>
	typeof value === "string" && value.trim().length > 0;

const hasObjectValue = (value: unknown): boolean => {
	if (!value) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return (
		hasText(value) || typeof value === "number" || typeof value === "boolean"
	);
};

const formatLocationReference = (location: unknown): string | undefined => {
	if (!location || typeof location !== "object") return undefined;
	const record = location as Record<string, unknown>;
	const path =
		typeof record.path === "string"
			? record.path
			: typeof record.file === "string"
				? record.file
				: typeof record.uri === "string"
					? record.uri
					: "";
	if (!path) return undefined;
	const line =
		typeof record.startLine === "number" || typeof record.startLine === "string"
			? String(record.startLine)
			: "";
	return line ? `${path}:${line}` : path;
};

const sourceReference = (
	finding: Finding,
	evidence: FindingEvidence[],
): string | undefined => {
	const sourceEvidence = evidence.find(
		(item) => item.kind === "source-location",
	);
	return (
		formatLocationReference(finding.primaryLocation) ||
		formatLocationReference(sourceEvidence?.location) ||
		(sourceEvidence?.snippet ? sourceEvidence.title : undefined) ||
		(hasText(finding.metadata?.snippet) ? "metadata snippet" : undefined)
	);
};

const hasMetadataEvidence = (finding: Finding): boolean =>
	[
		"artifactId",
		"artifactIds",
		"artifactPath",
		"artifactPaths",
		"evidence",
		"evidenceRefs",
		"evidenceRefsJson",
		"sourceArtifactId",
		"sourceSnippet",
		"snippet",
	].some((key) => hasObjectValue(finding.metadata?.[key]));

const latestReviewOf = (
	input: BuildEvidenceQualityInput,
): Partial<FindingReview> | null =>
	input.latestReview ?? input.finding.latestReview ?? null;

const latestDecisionOf = (
	input: BuildEvidenceQualityInput,
): FindingDecision | null =>
	input.latestDecision ?? input.finding.latestDecision ?? null;

const completedReproduction = (
	runs: ReproductionRun[] | undefined,
): ReproductionRun | undefined =>
	runs?.find(
		(run) =>
			run.status === "completed" &&
			(run.outcome === "reproduced" || run.outcome === "not_reproduced"),
	);

const completedDynamic = (
	runs: DynamicRun[] | undefined,
): DynamicRun | undefined =>
	runs?.find(
		(run) =>
			run.status === "completed" &&
			(run.outcome === "passed" || run.outcome === "failed"),
	);

export function buildEvidenceQuality(
	input: BuildEvidenceQualityInput,
): EvidenceQualityView {
	const evidence = input.evidence ?? [];
	const review = latestReviewOf(input);
	const decision = latestDecisionOf(input);
	const reproduction = completedReproduction(input.reproductionRuns);
	const dynamic = completedDynamic(input.dynamicRuns);
	const sourceRef = sourceReference(input.finding, evidence);
	const toolEvidence = evidence.find((item) => item.kind === "tool-output");
	const hasArtifact =
		Boolean(toolEvidence?.artifactId) ||
		evidence.some((item) => Boolean(item.artifactId)) ||
		hasMetadataEvidence(input.finding);
	const completedReview = review?.status === "completed" ? review : null;
	const reviewStrength =
		completedReview?.evidenceStrength?.level === "strong"
			? "high"
			: completedReview?.evidenceStrength?.level === "moderate"
				? "medium"
				: "low";
	const dast = input.dastEvidence?.[0];
	const diagnostic = input.diagnosticReports?.find(
		(report) => report.status === "completed",
	);

	const signals: EvidenceSignal[] = [
		{
			id: "source-location",
			label: "Source location",
			kind: "source_location",
			present: Boolean(sourceRef),
			strength: sourceRef ? "medium" : "low",
			reference: sourceRef,
		},
		{
			id: "tool-output",
			label: "Tool output",
			kind: "tool_output",
			present: hasArtifact,
			strength: hasArtifact ? "medium" : "low",
			reference: toolEvidence?.title,
		},
		{
			id: "llm-review",
			label: "LLM review",
			kind: "llm_review",
			present: Boolean(completedReview),
			strength: reviewStrength,
			reference: completedReview
				? `${completedReview.provider ?? "review"} / ${completedReview.model ?? "model"}`
				: undefined,
		},
		{
			id: "reproduction",
			label: "Reproduction",
			kind: "reproduction",
			present: Boolean(reproduction),
			strength: "high",
			reference: reproduction?.outcome ?? undefined,
		},
		{
			id: "dynamic",
			label: "Dynamic verification",
			kind: "dynamic",
			present: Boolean(dynamic),
			strength: "high",
			reference: dynamic?.outcome ?? undefined,
		},
		{
			id: "dast",
			label: "DAST evidence",
			kind: "dast",
			present: Boolean(dast),
			strength: "high",
			reference: dast?.title ?? dast?.kind,
		},
		{
			id: "diagnostic",
			label: "Diagnostic report",
			kind: "diagnostic",
			present: Boolean(diagnostic),
			strength: "medium",
			reference: diagnostic?.summary ?? undefined,
		},
		{
			id: "decision",
			label: "Human decision",
			kind: "decision",
			present: Boolean(decision),
			strength: decision ? "medium" : "low",
			reference: decision?.decision,
		},
	];

	const presentSignals = signals.filter((signal) => signal.present);
	const missingSignals = signals.filter((signal) => !signal.present);
	const hasSourceOrTool = Boolean(sourceRef || hasArtifact);
	const hasTechnicalVerification = Boolean(reproduction || dynamic || dast);
	const hasModerateReview =
		completedReview &&
		completedReview.evidenceStrength?.level !== "weak" &&
		completedReview.evidenceStrength?.level !== "unknown";
	const hasDecision = Boolean(decision);
	const hasAnyEvidence = hasSourceOrTool || presentSignals.length > 0;

	let level: EvidenceQualityLevel = "missing";
	if (
		hasSourceOrTool &&
		(hasTechnicalVerification || hasDecision || hasModerateReview)
	) {
		level = hasTechnicalVerification ? "strong" : "moderate";
	} else if (hasAnyEvidence) {
		level = "weak";
	}

	if (
		level === "moderate" &&
		completedReview &&
		completedReview.evidenceStrength?.level === "weak" &&
		!hasDecision
	) {
		level = "weak";
	}

	const scoreByStrength = presentSignals.reduce((score, signal) => {
		if (signal.strength === "high") return score + 25;
		if (signal.strength === "medium") return score + 15;
		return score + 5;
	}, 0);
	const score = Math.min(
		100,
		level === "missing"
			? 0
			: level === "strong"
				? Math.max(80, scoreByStrength)
				: level === "moderate"
					? Math.max(55, Math.min(79, scoreByStrength))
					: Math.max(20, Math.min(54, scoreByStrength)),
	);

	const reasons: string[] = [];
	if (hasSourceOrTool) reasons.push("Usable source or tool evidence exists.");
	if (hasTechnicalVerification)
		reasons.push("Completed verification evidence exists.");
	if (completedReview) reasons.push("Completed LLM review is available.");
	if (hasDecision) reasons.push("Human decision is recorded.");
	if (!hasSourceOrTool)
		reasons.push("Source location or tool artifact is missing.");
	if (level === "weak")
		reasons.push("Evidence is not strong enough for final confidence.");
	if (level === "missing")
		reasons.push("No usable evidence signal is available.");

	const recommendedNextAction: EvidenceQualityView["recommendedNextAction"] =
		!completedReview
			? "run_review"
			: !hasTechnicalVerification && level !== "strong"
				? "run_reproduction"
				: !hasDecision
					? "record_decision"
					: "ready_for_report";

	return {
		findingId: input.finding.id,
		level,
		score,
		label: labels[level],
		reasons,
		missingSignals,
		presentSignals,
		recommendedNextAction,
	};
}
