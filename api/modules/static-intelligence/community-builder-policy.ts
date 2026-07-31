import type {
	StaticIntelligenceEvidenceQuality,
	StaticIntelligenceExportV1,
	StaticIntelligenceSeverity,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	RiskCommunity,
	RiskCommunityBasis,
	RiskCommunityConfidence,
} from "../../../shared/schemas/static-intelligence-landscape.schema";
import type { CommunityCandidate, GraphContext } from "./community-builder";
import { compareSeverity, normalizeSeverity } from "./file-risk-index";

const BASIS_ORDER: RiskCommunityBasis[] = [
	"same_file",
	"same_scanner_rule",
	"same_scanner",
	"same_cwe",
	"same_cve",
	"same_dependency",
	"graph_connected",
	"semantic",
];
const CONFIDENCE_RANK: Record<RiskCommunityConfidence, number> = {
	low: 1,
	medium: 2,
	high: 3,
};

export function summarizeCommunity(community: CommunityCandidate): string {
	return `${community.basis.join(", ")} community with ${community.findingIds.length} findings, max severity ${community.maxSeverity}, and ${community.evidenceQuality} evidence.`;
}

export function suggestedReviewFocus(
	community: CommunityCandidate,
	exportPayload: StaticIntelligenceExportV1,
): string[] {
	const focus: string[] = [];
	if (
		["none", "weak", "mixed", "unknown"].includes(community.evidenceQuality)
	) {
		focus.push("Review weak or missing evidence.");
	}
	if (
		community.basis.includes("same_file") &&
		community.findingIds.length > 1
	) {
		focus.push("Review multiple findings in the same file.");
	}
	if (community.basis.includes("same_scanner_rule")) {
		focus.push("Review repeated scanner rule output.");
	}
	if (exportPayload.scan.reviewStatus !== "completed") {
		focus.push(`Review status is ${exportPayload.scan.reviewStatus}.`);
	}
	if (!exportPayload.handoff) {
		focus.push("Improvement request is missing.");
	}
	if (community.fileRefs.includes("unknown")) {
		focus.push("Resolve unknown file path references.");
	}
	return sortedUnique(focus).slice(0, 5);
}

export function maxSeverityForFindings(
	context: GraphContext,
	findingIds: string[],
): StaticIntelligenceSeverity {
	return (
		findingIds
			.map(
				(findingId) => context.findings.get(findingId)?.severity ?? "unknown",
			)
			.map((severity) => normalizeSeverity(severity))
			.sort((a, b) => compareSeverity(b, a))[0] ?? "unknown"
	);
}

export function evidenceQualityForFindings(
	exportPayload: StaticIntelligenceExportV1,
	findingIds: string[],
): StaticIntelligenceEvidenceQuality {
	const qualities = exportPayload.fileRiskIndex
		.filter((entry) =>
			entry.findingIds.some((findingId) => findingIds.includes(findingId)),
		)
		.map((entry) => entry.evidenceQuality);
	if (qualities.length === 0) return "unknown";
	if (qualities.some((quality) => quality === "unknown")) return "unknown";
	if (qualities.every((quality) => quality === "strong")) return "strong";
	if (
		qualities.some((quality) => quality === "strong") ||
		qualities.some((quality) => quality === "mixed")
	) {
		return "mixed";
	}
	if (qualities.some((quality) => quality === "weak")) return "weak";
	return "none";
}

export function addConnectedNode(
	context: GraphContext,
	nodeId: string,
	findingId: string,
	confidence: number,
): void {
	addRef(context.findingIdsByConnectedNode, nodeId, findingId);
	context.maxConfidenceByConnectedNode.set(
		nodeId,
		Math.max(context.maxConfidenceByConnectedNode.get(nodeId) ?? 0, confidence),
	);
}

export function addRef(
	map: Map<string, string[]>,
	key: string,
	value: string,
): void {
	if (!key.trim() || !value.trim()) return;
	map.set(key, [...(map.get(key) ?? []), value]);
}

export function sortMapArrays(map: Map<string, string[]>): void {
	for (const [key, values] of map.entries()) map.set(key, sortedUnique(values));
}

export function stringMetadata(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sortBasis(values: RiskCommunityBasis[]): RiskCommunityBasis[] {
	const unique = [...new Set(values)];
	return unique.sort((a, b) => BASIS_ORDER.indexOf(a) - BASIS_ORDER.indexOf(b));
}

export function maxConfidence(
	left: RiskCommunityConfidence,
	right: RiskCommunityConfidence,
): RiskCommunityConfidence {
	return CONFIDENCE_RANK[left] >= CONFIDENCE_RANK[right] ? left : right;
}

export function compareCommunities(
	left: RiskCommunity,
	right: RiskCommunity,
): number {
	const severity = compareSeverity(right.maxSeverity, left.maxSeverity);
	if (severity !== 0) return severity;
	const findingCount = right.findingIds.length - left.findingIds.length;
	if (findingCount !== 0) return findingCount;
	return left.id.localeCompare(right.id);
}

export function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}
