import type {
	DastEvidence,
	DiagnosticReport,
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingGroup,
	FindingReview,
	ReproductionRun,
	ScanRun,
} from "../../../api";
import { buildEvidenceQuality } from "../evidence-quality";
import { buildRemediationPlanView } from "../remediation-plan";
import { deriveFindingWorkState, type FindingWorkState } from "../work-states";

export type VerificationByFindingId = Map<
	string,
	{ reproductionRuns?: ReproductionRun[]; dynamicRuns?: DynamicRun[] }
>;

type SelectedFindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};

const workStateRank: Record<FindingWorkState, number> = {
	blocked_by_evidence: 0,
	needs_review: 1,
	needs_verification: 2,
	ready_for_report: 3,
	false_positive_recorded: 4,
	accepted_risk_recorded: 5,
};

const severityRank: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

export function buildVerificationByFindingId(params: {
	selectedVerificationDataLoaded: boolean;
	selectedFindingId: string;
	reproductionRuns: ReproductionRun[];
	dynamicRuns: DynamicRun[];
}): VerificationByFindingId {
	const map: VerificationByFindingId = new Map();
	if (params.selectedVerificationDataLoaded && params.selectedFindingId) {
		map.set(params.selectedFindingId, {
			reproductionRuns: params.reproductionRuns,
			dynamicRuns: params.dynamicRuns,
		});
	}
	return map;
}

export function buildFindingWorkStates(
	findings: Finding[],
	verificationByFindingId: VerificationByFindingId,
): Map<string, FindingWorkState> {
	const states = new Map<string, FindingWorkState>();
	for (const finding of findings) {
		const verification = verificationByFindingId.get(finding.id);
		states.set(
			finding.id,
			deriveFindingWorkState({
				finding,
				reproductionRuns: verification?.reproductionRuns,
				dynamicRuns: verification?.dynamicRuns,
			}),
		);
	}
	return states;
}

export function buildEvidenceQualityByFindingId(params: {
	findings: Finding[];
	selectedFindingId: string;
	selectedFindingDetails: SelectedFindingDetails | null;
	verificationByFindingId: VerificationByFindingId;
	selectedFindingDastEvidence?: DastEvidence[];
	diagnosticReports: DiagnosticReport[];
}): Map<string, ReturnType<typeof buildEvidenceQuality>> {
	const map = new Map<string, ReturnType<typeof buildEvidenceQuality>>();
	for (const finding of params.findings) {
		const isSelected = finding.id === params.selectedFindingId;
		const verification = params.verificationByFindingId.get(finding.id);
		const details =
			isSelected && params.selectedFindingDetails?.finding.id === finding.id
				? params.selectedFindingDetails
				: null;
		map.set(
			finding.id,
			buildEvidenceQuality({
				finding: details?.finding ?? finding,
				evidence: details?.evidence,
				latestReview: details?.latestReview ?? finding.latestReview,
				latestDecision: details?.latestDecision ?? finding.latestDecision,
				reproductionRuns: verification?.reproductionRuns,
				dynamicRuns: verification?.dynamicRuns,
				dastEvidence: isSelected
					? params.selectedFindingDastEvidence
					: undefined,
				diagnosticReports: params.diagnosticReports,
				dataCompleteness: {
					hasFindingDetails: Boolean(details),
					hasVerificationData: Boolean(
						verification?.reproductionRuns?.length ||
							verification?.dynamicRuns?.length,
					),
					hasDastEvidenceLoaded:
						isSelected && (params.selectedFindingDastEvidence?.length ?? 0) > 0,
				},
			}),
		);
	}
	return map;
}

export function buildRemediationPlansByFindingId(params: {
	findings: Finding[];
	selectedFindingId: string;
	selectedFindingDetails: SelectedFindingDetails | null;
	verificationByFindingId: VerificationByFindingId;
}): Map<string, ReturnType<typeof buildRemediationPlanView>> {
	const map = new Map<string, ReturnType<typeof buildRemediationPlanView>>();
	for (const finding of params.findings) {
		const isSelected = finding.id === params.selectedFindingId;
		const verification = params.verificationByFindingId.get(finding.id);
		const details =
			isSelected && params.selectedFindingDetails?.finding.id === finding.id
				? params.selectedFindingDetails
				: null;
		map.set(
			finding.id,
			buildRemediationPlanView({
				finding: details?.finding ?? finding,
				latestDecision: details?.latestDecision ?? finding.latestDecision,
				latestReview: details?.latestReview ?? finding.latestReview,
				reproductionRuns: verification?.reproductionRuns,
				dynamicRuns: verification?.dynamicRuns,
			}),
		);
	}
	return map;
}

export function buildDisplayedFindings(params: {
	findings: Finding[];
	findingsViewMode: "list" | "grouped";
	selectedGroupId: string;
	scanGroups: FindingGroup[];
	findingWorkStatesById: Map<string, FindingWorkState>;
}): Finding[] {
	const base =
		params.findingsViewMode === "grouped" && params.selectedGroupId
			? params.findings.filter((item) =>
					params.scanGroups
						.find((group) => group.id === params.selectedGroupId)
						?.findingIds.includes(item.id),
				)
			: params.findings;
	if (params.findingsViewMode === "grouped") return base;
	return [...base].sort((left, right) => {
		const stateDelta =
			workStateRank[
				params.findingWorkStatesById.get(left.id) ?? "ready_for_report"
			] -
			workStateRank[
				params.findingWorkStatesById.get(right.id) ?? "ready_for_report"
			];
		if (stateDelta !== 0) return stateDelta;
		const severityDelta =
			(severityRank[left.severity] ?? severityRank.unknown) -
			(severityRank[right.severity] ?? severityRank.unknown);
		if (severityDelta !== 0) return severityDelta;
		const leftTime = new Date(left.updatedAt).getTime();
		const rightTime = new Date(right.updatedAt).getTime();
		if (leftTime !== rightTime) return rightTime - leftTime;
		return left.title.localeCompare(right.title);
	});
}

export function selectBaselineScanRun(
	scanRuns: ScanRun[],
	selectedScanRun: ScanRun | null,
): ScanRun | null {
	if (!selectedScanRun) return null;
	return (
		scanRuns
			.filter(
				(run) =>
					run.id !== selectedScanRun.id &&
					run.profile === selectedScanRun.profile &&
					new Date(run.createdAt).getTime() <
						new Date(selectedScanRun.createdAt).getTime(),
			)
			.sort(
				(left, right) =>
					new Date(right.createdAt).getTime() -
					new Date(left.createdAt).getTime(),
			)[0] ?? null
	);
}
