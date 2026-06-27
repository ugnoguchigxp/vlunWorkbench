import type { Finding } from "../../api";

export type FindingDeltaKind = "new" | "resolved" | "unchanged" | "regressed";

export type ScanComparisonView = {
	currentScanRunId: string;
	baselineScanRunId: string | null;
	status: "available" | "missing_baseline" | "insufficient_data";
	counts: {
		new: number;
		resolved: number;
		unchanged: number;
		regressed: number;
	};
	severityTrend: {
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
	};
	deltas: Array<{
		id: string;
		kind: FindingDeltaKind;
		title: string;
		severity: string;
		currentFindingId?: string;
		baselineFindingId?: string;
		reason: string;
	}>;
};

type BuildScanComparisonInput = {
	currentScanRunId: string;
	baselineScanRunId?: string | null;
	currentFindings: Finding[];
	baselineFindings?: Finding[] | null;
};

const severityRank: Record<string, number> = {
	critical: 5,
	high: 4,
	medium: 3,
	low: 2,
	info: 1,
	unknown: 0,
};

const locationPath = (finding: Finding): string => {
	const location = finding.primaryLocation;
	if (!location || typeof location !== "object") return "";
	const record = location as Record<string, unknown>;
	return typeof record.path === "string"
		? record.path
		: typeof record.file === "string"
			? record.file
			: typeof record.uri === "string"
				? record.uri
				: "";
};

const metadataStableId = (finding: Finding): string => {
	const metadata = finding.metadata ?? {};
	for (const key of ["stableId", "normalizedId", "dedupeKey", "fingerprint"]) {
		const value = metadata[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return finding.fingerprint || "";
};

const matchKey = (finding: Finding): string | null => {
	const stable = metadataStableId(finding);
	if (stable) return `stable:${stable}`;
	const location = locationPath(finding);
	if (!finding.ruleId.trim() && !location.trim()) return null;
	return [
		"fallback",
		finding.sourceTool,
		finding.ruleId,
		finding.title,
		location,
	]
		.map((part) => part.trim().toLowerCase())
		.join("|");
};

const isRegressed = (current: Finding, baseline: Finding): boolean => {
	const severityRegressed =
		(severityRank[current.severity] ?? 0) >
		(severityRank[baseline.severity] ?? 0);
	const currentActive =
		!current.latestDecision ||
		current.latestDecision.decision === "needs_fix" ||
		current.latestDecision.decision === "deferred";
	const baselineResolved =
		baseline.latestDecision?.decision === "accepted" ||
		baseline.latestDecision?.decision === "false_positive";
	return severityRegressed || (baselineResolved && currentActive);
};

const emptyCounts = () => ({ new: 0, resolved: 0, unchanged: 0, regressed: 0 });

export function buildScanComparison(
	input: BuildScanComparisonInput,
): ScanComparisonView {
	if (!input.baselineScanRunId) {
		return {
			currentScanRunId: input.currentScanRunId,
			baselineScanRunId: null,
			status: "missing_baseline",
			counts: emptyCounts(),
			severityTrend: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
			deltas: [],
		};
	}
	if (!input.baselineFindings) {
		return {
			currentScanRunId: input.currentScanRunId,
			baselineScanRunId: input.baselineScanRunId,
			status: "insufficient_data",
			counts: emptyCounts(),
			severityTrend: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
			deltas: [],
		};
	}

	const baselineByKey = new Map<string, Finding>();
	for (const finding of input.baselineFindings) {
		const key = matchKey(finding);
		if (key) baselineByKey.set(key, finding);
	}
	const currentByKey = new Map<string, Finding>();
	for (const finding of input.currentFindings) {
		const key = matchKey(finding);
		if (key) currentByKey.set(key, finding);
	}
	const deltas: ScanComparisonView["deltas"] = [];

	for (const current of input.currentFindings) {
		const currentKey = matchKey(current);
		const baseline = currentKey ? baselineByKey.get(currentKey) : undefined;
		if (!baseline) {
			deltas.push({
				id: `new:${current.id}`,
				kind: "new",
				title: current.title,
				severity: current.severity,
				currentFindingId: current.id,
				reason: "Finding appears in the current scan only.",
			});
			continue;
		}
		const kind: FindingDeltaKind = isRegressed(current, baseline)
			? "regressed"
			: "unchanged";
		deltas.push({
			id: `${kind}:${current.id}:${baseline.id}`,
			kind,
			title: current.title,
			severity: current.severity,
			currentFindingId: current.id,
			baselineFindingId: baseline.id,
			reason:
				kind === "regressed"
					? "Severity or active decision state worsened since baseline."
					: "Finding matches the previous scan.",
		});
	}

	for (const baseline of input.baselineFindings) {
		const baselineKey = matchKey(baseline);
		if (baselineKey && currentByKey.has(baselineKey)) continue;
		deltas.push({
			id: `resolved:${baseline.id}`,
			kind: "resolved",
			title: baseline.title,
			severity: baseline.severity,
			baselineFindingId: baseline.id,
			reason: "Finding was present in the baseline scan but not current scan.",
		});
	}

	const counts = emptyCounts();
	for (const delta of deltas) counts[delta.kind] += 1;
	const severityTrend = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	for (const severity of Object.keys(severityTrend) as Array<
		keyof typeof severityTrend
	>) {
		const currentCount = input.currentFindings.filter(
			(finding) => finding.severity === severity,
		).length;
		const baselineCount = input.baselineFindings.filter(
			(finding) => finding.severity === severity,
		).length;
		severityTrend[severity] = currentCount - baselineCount;
	}

	return {
		currentScanRunId: input.currentScanRunId,
		baselineScanRunId: input.baselineScanRunId,
		status: "available",
		counts,
		severityTrend,
		deltas: deltas.sort((a, b) => {
			const order = { regressed: 0, new: 1, resolved: 2, unchanged: 3 };
			const kindDelta = order[a.kind] - order[b.kind];
			if (kindDelta !== 0) return kindDelta;
			return (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
		}),
	};
}
