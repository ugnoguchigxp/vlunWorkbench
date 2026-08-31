import type {
	BuiltFindingGroup as FindingGroupContract,
	FindingDedupeIdentityV1,
	FindingPairDecision,
} from "../../../../shared/schemas/finding-group.schema";
import {
	DETERMINISTIC_MAX_PAIR_COMPARISONS,
	GROUPING_ALGORITHM_VERSION,
} from "../../../../shared/schemas/finding-group.schema";
import { hasConcreteFamily } from "./finding-dedupe-families";
import {
	canonicalJsonHash,
	projectFindingDedupeIdentity,
} from "./finding-dedupe-identity";

export type FindingForGrouping = {
	id: string;
	sourceTool: string;
	ruleId: string;
	title: string;
	description: string;
	severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
	confidence: "static" | "runtime";
	primaryLocation: Record<string, unknown> | null;
	metadata: Record<string, unknown> | null;
};

export type GroupingFinding = FindingForGrouping & {
	identity: FindingDedupeIdentityV1;
};

export type GroupingMember = {
	finding: GroupingFinding;
	identity: FindingDedupeIdentityV1;
	role: "representative" | "supporting";
	matchConfidence: "exact" | "high" | "singleton";
	reasonCodes: string[];
	comparisonHash: string | null;
};

/** Internal form includes the immutable member projection to persist. */
export type BuiltFindingGroup = FindingGroupContract & {
	members: GroupingMember[];
};

export type BuiltGroupingSnapshot = {
	groups: BuiltFindingGroup[];
	ambiguousCount: number;
	limitations: string[];
};

export type BuiltGroupingResult = {
	groups: FindingGroupContract[];
	pairDecisions: FindingPairDecision[];
	ambiguousCount: number;
	limitations: string[];
};

const severityRank: Record<FindingForGrouping["severity"], number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

const sha256 = (value: unknown) => canonicalJsonHash(value);

const intersection = (left: string[], right: string[]) => {
	const rightSet = new Set(right);
	return left.filter((value) => rightSet.has(value));
};

const sorted = (values: Iterable<string>) =>
	[...new Set(values)].sort((a, b) => a.localeCompare(b));

const ordered = (left: GroupingFinding, right: GroupingFinding) =>
	left.id.localeCompare(right.id) < 0 ? [left, right] : [right, left];

function descriptionHash(finding: GroupingFinding): string {
	// Secret text must never become a durable grouping input, even in hashed form.
	const values =
		finding.identity.issueKind === "secret"
			? { title: finding.ruleId, description: "" }
			: { title: finding.title, description: finding.description };
	return sha256(values);
}

function comparisonHash(left: GroupingFinding, right: GroupingFinding): string {
	const [first, second] = ordered(left, right);
	return sha256({
		algorithmVersion: GROUPING_ALGORITHM_VERSION,
		findingIds: [first.id, second.id],
		identities: [first.identity, second.identity],
		contentHashes: [descriptionHash(first), descriptionHash(second)],
	});
}

function decision(
	left: GroupingFinding,
	right: GroupingFinding,
	verdict: FindingPairDecision["verdict"],
	confidence: FindingPairDecision["confidence"],
	reasonCodes: string[],
): FindingPairDecision {
	const [first, second] = ordered(left, right);
	return {
		leftFindingId: first.id,
		rightFindingId: second.id,
		verdict,
		confidence,
		method: "deterministic",
		reasonCodes: sorted(reasonCodes),
		comparisonHash: comparisonHash(first, second),
	};
}

function rangesOverlap(
	left: FindingDedupeIdentityV1["location"],
	right: FindingDedupeIdentityV1["location"],
): boolean | null {
	if (
		left.startLine === null ||
		left.endLine === null ||
		right.startLine === null ||
		right.endLine === null
	) {
		return null;
	}
	return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function exactSecretRange(
	left: FindingDedupeIdentityV1["location"],
	right: FindingDedupeIdentityV1["location"],
): boolean | null {
	if (
		left.startLine === null ||
		left.endLine === null ||
		left.startCol === null ||
		left.endCol === null ||
		right.startLine === null ||
		right.endLine === null ||
		right.startCol === null ||
		right.endCol === null
	) {
		return null;
	}
	const sameLineRange =
		left.startLine <= right.endLine && right.startLine <= left.endLine;
	const sameColumnRange =
		left.startCol <= right.endCol && right.startCol <= left.endCol;
	return sameLineRange && sameColumnRange;
}

function sameFamily(left: GroupingFinding, right: GroupingFinding): boolean {
	return (
		hasConcreteFamily(left.identity) &&
		hasConcreteFamily(right.identity) &&
		intersection(left.identity.familyKeys, right.identity.familyKeys).length > 0
	);
}

/** Decides a pair conservatively; ambiguous pairs are never auto-merged. */
export function decideFindingPair(
	left: GroupingFinding,
	right: GroupingFinding,
): FindingPairDecision {
	if (left.id === right.id) {
		throw new Error("Cannot compare a finding with itself");
	}
	if (left.identity.issueKind !== right.identity.issueKind) {
		return decision(left, right, "different", "none", ["different_issue_kind"]);
	}
	const kind = left.identity.issueKind;
	if (
		kind === "unknown" ||
		kind === "business_logic" ||
		left.identity.assetKey === null ||
		right.identity.assetKey === null
	) {
		return decision(left, right, "ambiguous", "none", [
			"auto_merge_not_supported",
		]);
	}
	if (left.identity.assetKey !== right.identity.assetKey) {
		return decision(left, right, "different", "none", ["different_asset"]);
	}

	if (kind === "dependency") {
		const matchingAdvisories = intersection(
			left.identity.advisoryIds,
			right.identity.advisoryIds,
		);
		if (matchingAdvisories.length > 0) {
			return decision(left, right, "same", "exact", [
				"same_asset",
				"same_advisory",
			]);
		}
		if (
			left.identity.advisoryIds.length > 0 &&
			right.identity.advisoryIds.length > 0
		) {
			return decision(left, right, "different", "none", ["different_advisory"]);
		}
		return decision(left, right, "ambiguous", "none", ["advisory_missing"]);
	}

	if (!sameFamily(left, right)) {
		return decision(left, right, "different", "none", ["different_family"]);
	}

	if (kind === "secret") {
		const overlap = exactSecretRange(
			left.identity.location,
			right.identity.location,
		);
		if (overlap === true) {
			return decision(left, right, "same", "exact", [
				"same_asset",
				"same_detector_family",
				"overlapping_exact_range",
			]);
		}
		return decision(
			left,
			right,
			overlap === false ? "different" : "ambiguous",
			"none",
			overlap === false ? ["non_overlapping_range"] : ["column_range_missing"],
		);
	}

	if (kind === "web" || kind === "api") {
		if (left.identity.location.method !== right.identity.location.method) {
			return decision(left, right, "different", "none", ["different_method"]);
		}
		if (
			left.identity.location.parameter !== right.identity.location.parameter
		) {
			return decision(left, right, "different", "none", [
				"different_parameter",
			]);
		}
		return decision(left, right, "same", "high", [
			"same_asset",
			"same_method",
			"same_parameter",
			"same_family",
		]);
	}

	if (kind === "iac") {
		if (left.identity.location.resource !== right.identity.location.resource) {
			return decision(left, right, "different", "none", ["different_resource"]);
		}
	}

	const overlap = rangesOverlap(
		left.identity.location,
		right.identity.location,
	);
	const anchorMatch =
		left.identity.anchor !== null &&
		left.identity.anchor === right.identity.anchor;
	if (overlap === true || anchorMatch) {
		return decision(left, right, "same", "high", [
			"same_asset",
			"same_family",
			overlap ? "overlapping_range" : "same_anchor",
		]);
	}
	return decision(
		left,
		right,
		overlap === false ? "different" : "ambiguous",
		"none",
		overlap === false ? ["non_overlapping_range"] : ["location_missing"],
	);
}

function representative(findings: GroupingFinding[]): GroupingFinding {
	return [...findings].sort((left, right) => {
		if (left.confidence !== right.confidence) {
			return left.confidence === "runtime" ? -1 : 1;
		}
		const severity = severityRank[left.severity] - severityRank[right.severity];
		if (severity !== 0) return severity;
		const completeness = (identity: FindingDedupeIdentityV1) =>
			[
				identity.assetKey,
				identity.packageKey,
				identity.anchor,
				identity.location.path,
				identity.location.resource,
			].filter(Boolean).length +
			identity.familyKeys.filter((key) => key !== "family:unknown").length;
		const completenessDifference =
			completeness(right.identity) - completeness(left.identity);
		if (completenessDifference !== 0) return completenessDifference;
		const tool = left.sourceTool.localeCompare(right.sourceTool);
		if (tool !== 0) return tool;
		const rule = left.ruleId.localeCompare(right.ruleId);
		return rule !== 0 ? rule : left.id.localeCompare(right.id);
	})[0];
}

function buildGroup(
	members: GroupingFinding[],
	decisions: Map<string, FindingPairDecision>,
): FindingGroupContract {
	const orderedMembers = [...members].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	const leader = representative(orderedMembers);
	const memberFindingIds = orderedMembers.map((finding) => finding.id);
	const evidenceDecisions = orderedMembers
		.filter((member) => member.id !== leader.id)
		.map((member) => decisions.get(pairKey(leader.id, member.id)))
		.filter((item): item is FindingPairDecision => item !== undefined);
	const allExact =
		evidenceDecisions.length > 0 &&
		evidenceDecisions.every((item) => item.confidence === "exact");
	const sourceTools = sorted(orderedMembers.map((member) => member.sourceTool));
	const topSeverity = orderedMembers.reduce(
		(current, item) =>
			severityRank[item.severity] < severityRank[current]
				? item.severity
				: current,
		leader.severity,
	);
	const packageName = leader.identity.packageKey?.split(":")[1] ?? null;
	const advisory = leader.identity.advisoryIds[0] ?? null;
	const isSecret = leader.identity.issueKind === "secret";
	return {
		stableKey: sha256({
			algorithmVersion: GROUPING_ALGORITHM_VERSION,
			memberFindingIds,
		}),
		representativeFindingId: leader.id,
		memberFindingIds,
		issueKind: leader.identity.issueKind,
		title:
			leader.identity.issueKind === "dependency" && packageName && advisory
				? `${packageName}: ${advisory}`
				: isSecret
					? "認証情報らしき値の検出"
					: leader.title,
		description: isSecret
			? "保存済みの検出結果で認証情報らしき値が示されました。実値は group snapshot に含めません。"
			: leader.description,
		severity: topSeverity,
		primaryLocation: leader.identity.location,
		sourceTools,
		matchConfidence:
			memberFindingIds.length === 1 ? "singleton" : allExact ? "exact" : "high",
		reasonCodes:
			memberFindingIds.length === 1
				? ["singleton"]
				: sorted(evidenceDecisions.flatMap((item) => item.reasonCodes)),
	};
}

const pairKey = (leftId: string, rightId: string) =>
	leftId.localeCompare(rightId) < 0
		? `${leftId}\u0000${rightId}`
		: `${rightId}\u0000${leftId}`;

function canMergeCompleteLink(
	left: GroupingFinding[],
	right: GroupingFinding[],
	decisions: Map<string, FindingPairDecision>,
) {
	return left.every((leftMember) =>
		right.every(
			(rightMember) =>
				decisions.get(pairKey(leftMember.id, rightMember.id))?.verdict ===
				"same",
		),
	);
}

/**
 * Builds a deterministic, complete-link snapshot. Any unproven relation
 * remains separate, which makes duplicate visibility preferable to a false
 * merge.
 */
export function buildFindingGroups(
	findings: FindingForGrouping[],
	options: { maxPairComparisons?: number } = {},
): BuiltGroupingResult {
	const projected = findings
		.map((finding) => ({
			...finding,
			identity: projectFindingDedupeIdentity(finding),
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	const budget =
		options.maxPairComparisons ?? DETERMINISTIC_MAX_PAIR_COMPARISONS;
	const blocks = new Map<string, GroupingFinding[]>();
	for (const finding of projected) {
		const { issueKind, assetKey } = finding.identity;
		if (
			assetKey === null ||
			issueKind === "unknown" ||
			issueKind === "business_logic"
		) {
			continue;
		}
		const key = `${issueKind}\u0000${assetKey}`;
		blocks.set(key, [...(blocks.get(key) ?? []), finding]);
	}

	const decisions = new Map<string, FindingPairDecision>();
	let comparisons = 0;
	let ambiguousCount = 0;
	let budgetExceeded = false;
	for (const block of [...blocks.values()]) {
		for (let left = 0; left < block.length; left++) {
			for (let right = left + 1; right < block.length; right++) {
				if (comparisons >= budget) {
					budgetExceeded = true;
					ambiguousCount++;
					continue;
				}
				const pair = decideFindingPair(block[left], block[right]);
				comparisons++;
				if (pair.verdict === "ambiguous") ambiguousCount++;
				decisions.set(pairKey(pair.leftFindingId, pair.rightFindingId), pair);
			}
		}
	}

	let clusters = projected.map((finding) => [finding]);
	for (const pair of [...decisions.values()]) {
		if (pair.verdict !== "same") continue;
		const leftIndex = clusters.findIndex((cluster) =>
			cluster.some((finding) => finding.id === pair.leftFindingId),
		);
		const rightIndex = clusters.findIndex((cluster) =>
			cluster.some((finding) => finding.id === pair.rightFindingId),
		);
		if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) continue;
		const left = clusters[leftIndex];
		const right = clusters[rightIndex];
		if (!canMergeCompleteLink(left, right, decisions)) continue;
		const merged = [...left, ...right].sort((a, b) => a.id.localeCompare(b.id));
		clusters = clusters.filter(
			(_, index) => index !== leftIndex && index !== rightIndex,
		);
		clusters.push(merged);
	}

	const groups = clusters
		.map((cluster) => buildGroup(cluster, decisions))
		.sort((left, right) => {
			const severity =
				severityRank[left.severity] - severityRank[right.severity];
			return severity !== 0
				? severity
				: left.stableKey.localeCompare(right.stableKey);
		});
	return {
		groups,
		pairDecisions: [...decisions.values()].sort((left, right) =>
			pairKey(left.leftFindingId, left.rightFindingId).localeCompare(
				pairKey(right.leftFindingId, right.rightFindingId),
			),
		),
		ambiguousCount,
		limitations: budgetExceeded ? ["deterministic_pair_budget_exceeded"] : [],
	};
}

/**
 * Persistence-facing deterministic snapshot. This contains only proofs from
 * each supporting member to the representative; it intentionally does not
 * persist every candidate pair.
 */
export function buildDeterministicFindingGroups(
	findings: Array<{
		id: string;
		sourceTool: string;
		ruleId: string;
		title: string;
		description: string;
		severity: string;
		confidence: string;
		primaryLocation: Record<string, unknown> | null;
		metadata: Record<string, unknown> | null;
	}>,
): BuiltGroupingSnapshot {
	const normalized: FindingForGrouping[] = findings.map((finding) => ({
		...finding,
		severity: normalizeSeverity(finding.severity),
		confidence: finding.confidence === "runtime" ? "runtime" : "static",
	}));
	const result = buildFindingGroups(normalized);
	const decisions = new Map(
		result.pairDecisions.map((pair) => [
			pairKey(pair.leftFindingId, pair.rightFindingId),
			pair,
		]),
	);
	const byId = new Map(
		normalized.map((finding) => [
			finding.id,
			{ ...finding, identity: projectFindingDedupeIdentity(finding) },
		]),
	);
	return {
		groups: result.groups.map((group) => ({
			...group,
			members: group.memberFindingIds.map((findingId) => {
				const finding = byId.get(findingId);
				if (!finding) throw new Error("grouping_member_not_found");
				const pair =
					findingId === group.representativeFindingId
						? null
						: decisions.get(pairKey(group.representativeFindingId, findingId));
				return {
					finding,
					identity: finding.identity,
					role:
						findingId === group.representativeFindingId
							? "representative"
							: "supporting",
					matchConfidence:
						group.matchConfidence === "exact"
							? "exact"
							: group.matchConfidence === "high"
								? "high"
								: "singleton",
					reasonCodes:
						findingId === group.representativeFindingId
							? ["representative"]
							: (pair?.reasonCodes ?? group.reasonCodes),
					comparisonHash: pair?.comparisonHash ?? null,
				};
			}),
		})),
		ambiguousCount: result.ambiguousCount,
		limitations: result.limitations,
	};
}

function normalizeSeverity(value: string): FindingForGrouping["severity"] {
	return ["info", "low", "medium", "high", "critical"].includes(value)
		? (value as FindingForGrouping["severity"])
		: "unknown";
}
