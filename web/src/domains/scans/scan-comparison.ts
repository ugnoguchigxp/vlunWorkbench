import type { Finding } from "../../api";
import { formatFindingTitle } from "./scan-display-copy";

export type FindingDeltaKind = "new" | "resolved" | "unchanged" | "regressed";
export type ComparisonMatchConfidence =
	| "stable"
	| "fingerprint"
	| "rule_location"
	| "insufficient";

export type ScanComparisonDelta = {
	id: string;
	kind: FindingDeltaKind;
	title: string;
	severity: string;
	currentFindingId?: string;
	baselineFindingId?: string;
	reason: string;
	matchConfidence: ComparisonMatchConfidence;
	matchReason: string;
};

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
	deltas: ScanComparisonDelta[];
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
	for (const key of ["stableId", "normalizedId", "dedupeKey"]) {
		const value = metadata[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
};

const metadataFingerprint = (finding: Finding): string => {
	const value = finding.metadata?.fingerprint;
	return typeof value === "string" && value.trim() ? value.trim() : "";
};

const comparisonMatch = (
	finding: Finding,
): {
	key: string | null;
	confidence: ComparisonMatchConfidence;
	reason: string;
} => {
	const stable = metadataStableId(finding);
	if (stable) {
		return {
			key: `stable:${stable}`,
			confidence: "stable",
			reason: "安定メタデータ ID で照合しました。",
		};
	}
	const fingerprint =
		finding.fingerprint?.trim() || metadataFingerprint(finding);
	if (fingerprint) {
		return {
			key: `fingerprint:${fingerprint}`,
			confidence: "fingerprint",
			reason: "tool fingerprint で照合しました。",
		};
	}
	const location = locationPath(finding);
	if (finding.sourceTool.trim() && finding.ruleId.trim() && location.trim()) {
		return {
			key: ["rule_location", finding.sourceTool, finding.ruleId, location]
				.map((part) => part.trim().toLowerCase())
				.join("|"),
			confidence: "rule_location",
			reason: "tool、rule、source location で照合しました。",
		};
	}
	return {
		key: null,
		confidence: "insufficient",
		reason: "安定 ID、fingerprint、rule/location key が利用できません。",
	};
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
	const baselineMatchByKey = new Map<
		string,
		ReturnType<typeof comparisonMatch>
	>();
	for (const finding of input.baselineFindings) {
		const match = comparisonMatch(finding);
		if (match.key) {
			baselineByKey.set(match.key, finding);
			baselineMatchByKey.set(match.key, match);
		}
	}
	const currentByKey = new Map<string, Finding>();
	for (const finding of input.currentFindings) {
		const match = comparisonMatch(finding);
		if (match.key) currentByKey.set(match.key, finding);
	}
	const deltas: ScanComparisonView["deltas"] = [];

	for (const current of input.currentFindings) {
		const currentMatch = comparisonMatch(current);
		const baseline = currentMatch.key
			? baselineByKey.get(currentMatch.key)
			: undefined;
		if (!baseline) {
			deltas.push({
				id: `new:${current.id}`,
				kind: "new",
				title: formatFindingTitle(current.title),
				severity: current.severity,
				currentFindingId: current.id,
				reason: "現在の scan のみに存在する finding です。",
				matchConfidence: currentMatch.key
					? currentMatch.confidence
					: "insufficient",
				matchReason: currentMatch.reason,
			});
			continue;
		}
		const matched = currentMatch.key
			? (baselineMatchByKey.get(currentMatch.key) ?? currentMatch)
			: currentMatch;
		const kind: FindingDeltaKind = isRegressed(current, baseline)
			? "regressed"
			: "unchanged";
		deltas.push({
			id: `${kind}:${current.id}:${baseline.id}`,
			kind,
			title: formatFindingTitle(current.title),
			severity: current.severity,
			currentFindingId: current.id,
			baselineFindingId: baseline.id,
			reason:
				kind === "regressed"
					? "baseline 以降に severity または有効な判断状態が悪化しています。"
					: "前回の scan と一致する finding です。",
			matchConfidence: matched.confidence,
			matchReason: matched.reason,
		});
	}

	for (const baseline of input.baselineFindings) {
		const baselineMatch = comparisonMatch(baseline);
		if (baselineMatch.key && currentByKey.has(baselineMatch.key)) continue;
		deltas.push({
			id: `resolved:${baseline.id}`,
			kind: "resolved",
			title: formatFindingTitle(baseline.title),
			severity: baseline.severity,
			baselineFindingId: baseline.id,
			reason:
				"baseline scan には存在し、現在の scan には存在しない finding です。",
			matchConfidence: baselineMatch.key
				? baselineMatch.confidence
				: "insufficient",
			matchReason: baselineMatch.reason,
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
