import { createHash } from "node:crypto";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceSemanticQueryResult,
	StaticIntelligenceSemanticQueryResultItem,
} from "../../../shared/schemas/static-intelligence-search.schema";
import type { SemanticRiskCommunityCandidate } from "./community-builder";

export type SemanticCommunityIntegrationOptions = {
	minVectorScore?: number;
	maxSemanticItems?: number;
	maxSemanticCommunities?: number;
};

export type SemanticCommunityIntegrationResult = {
	semanticCandidates: SemanticRiskCommunityCandidate[];
	semanticFindingIds: string[];
	degradedReasons: string[];
};

type EligibleSemanticItem = {
	item: StaticIntelligenceSemanticQueryResultItem;
	findingIds: string[];
	evidenceRefs: string[];
	artifactRefs: string[];
	fileRefs: string[];
};

const DEFAULT_MIN_VECTOR_SCORE = 0.65;
const DEFAULT_MAX_SEMANTIC_ITEMS = 10;
const DEFAULT_MAX_SEMANTIC_COMMUNITIES = 5;

export function buildSemanticCommunityCandidates(params: {
	exportPayload: StaticIntelligenceExportV1;
	semantic: StaticIntelligenceSemanticQueryResult;
	options?: SemanticCommunityIntegrationOptions;
}): SemanticCommunityIntegrationResult {
	const minVectorScore =
		params.options?.minVectorScore ?? DEFAULT_MIN_VECTOR_SCORE;
	const maxSemanticItems =
		params.options?.maxSemanticItems ?? DEFAULT_MAX_SEMANTIC_ITEMS;
	const maxSemanticCommunities =
		params.options?.maxSemanticCommunities ?? DEFAULT_MAX_SEMANTIC_COMMUNITIES;
	const knownFindingIds = knownFindingIdSet(params.exportPayload);
	const degradedReasons: string[] = [];
	const eligibleItems = params.semantic.results
		.flatMap((item): EligibleSemanticItem[] => {
			if (!item.candidateOnly || item.relatedFindingIds.length === 0) return [];
			if (item.vectorScore < minVectorScore) return [];
			const findingIds = sortedUnique(
				item.relatedFindingIds.filter((findingId) =>
					knownFindingIds.has(findingId),
				),
			);
			if (
				item.relatedFindingIds.some(
					(findingId) => !knownFindingIds.has(findingId),
				)
			) {
				degradedReasons.push(
					"semantic community candidate referenced unknown finding",
				);
			}
			if (findingIds.length === 0) return [];
			return [
				{
					item,
					findingIds,
					evidenceRefs: sortedUnique(item.evidenceRefs),
					artifactRefs: sortedUnique(item.artifactRefs),
					fileRefs: semanticItemFileRefs(
						params.exportPayload,
						item,
						findingIds,
					),
				},
			];
		})
		.slice(0, maxSemanticItems);

	if (params.semantic.results.length > 0 && eligibleItems.length === 0) {
		degradedReasons.push(
			"semantic community candidates did not meet confidence threshold",
		);
	}

	const candidates: SemanticRiskCommunityCandidate[] = [];
	const queryFindingIds = sortedUnique(
		eligibleItems.flatMap((eligible) => eligible.findingIds),
	);
	if (queryFindingIds.length >= 2) {
		candidates.push({
			stableKey: `semantic-query:${semanticQueryHash(
				params.semantic.query,
				queryFindingIds,
			)}`,
			findingIds: queryFindingIds,
			evidenceRefs: sortedUnique(
				eligibleItems.flatMap((eligible) => eligible.evidenceRefs),
			),
			artifactRefs: sortedUnique(
				eligibleItems.flatMap((eligible) => eligible.artifactRefs),
			),
			fileRefs: sortedUnique(
				eligibleItems.flatMap((eligible) => eligible.fileRefs),
			),
		});
	}

	for (const eligible of eligibleItems) {
		if (eligible.findingIds.length < 2) continue;
		candidates.push({
			stableKey: `semantic-source:${eligible.item.id}`,
			findingIds: eligible.findingIds,
			evidenceRefs: eligible.evidenceRefs,
			artifactRefs: eligible.artifactRefs,
			fileRefs: eligible.fileRefs,
		});
	}

	const semanticCandidates = dedupeCandidates(candidates)
		.sort(compareCandidates)
		.slice(0, maxSemanticCommunities);

	return {
		semanticCandidates,
		semanticFindingIds: sortedUnique(
			semanticCandidates.flatMap((candidate) => candidate.findingIds),
		),
		degradedReasons: sortedUnique(degradedReasons),
	};
}

function knownFindingIdSet(
	exportPayload: StaticIntelligenceExportV1,
): Set<string> {
	return new Set(
		exportPayload.graph.nodes
			.filter((node) => node.kind === "finding" && node.sourceId)
			.map((node) => node.sourceId as string),
	);
}

function semanticItemFileRefs(
	exportPayload: StaticIntelligenceExportV1,
	item: StaticIntelligenceSemanticQueryResultItem,
	findingIds: string[],
): string[] {
	const refs = item.filePath ? [item.filePath] : [];
	const findingSet = new Set(findingIds);
	for (const entry of exportPayload.fileRiskIndex) {
		if (entry.findingIds.some((findingId) => findingSet.has(findingId))) {
			refs.push(entry.path);
		}
	}
	return sortedUnique(refs);
}

function semanticQueryHash(query: string, findingIds: string[]): string {
	return createHash("sha256")
		.update(query)
		.update("\0")
		.update(findingIds.join("\0"))
		.digest("hex");
}

function dedupeCandidates(
	candidates: SemanticRiskCommunityCandidate[],
): SemanticRiskCommunityCandidate[] {
	const byFindingSet = new Map<string, SemanticRiskCommunityCandidate>();
	for (const candidate of candidates) {
		const findingIds = sortedUnique(candidate.findingIds);
		const key = findingIds.join("\0");
		const existing = byFindingSet.get(key);
		if (!existing) {
			byFindingSet.set(key, { ...candidate, findingIds });
			continue;
		}
		const preferred =
			preferCandidate(candidate, existing) === candidate ? candidate : existing;
		byFindingSet.set(key, {
			...preferred,
			findingIds,
			evidenceRefs: sortedUnique([
				...(existing.evidenceRefs ?? []),
				...(candidate.evidenceRefs ?? []),
			]),
			artifactRefs: sortedUnique([
				...(existing.artifactRefs ?? []),
				...(candidate.artifactRefs ?? []),
			]),
			fileRefs: sortedUnique([
				...(existing.fileRefs ?? []),
				...(candidate.fileRefs ?? []),
			]),
			degradedReasons: sortedUnique([
				...(existing.degradedReasons ?? []),
				...(candidate.degradedReasons ?? []),
			]),
		});
	}
	return [...byFindingSet.values()];
}

function preferCandidate(
	left: SemanticRiskCommunityCandidate,
	right: SemanticRiskCommunityCandidate,
): SemanticRiskCommunityCandidate {
	const leftKey = left.stableKey ?? "";
	const rightKey = right.stableKey ?? "";
	const leftIsSource = leftKey.startsWith("semantic-source:");
	const rightIsSource = rightKey.startsWith("semantic-source:");
	if (leftIsSource !== rightIsSource) return leftIsSource ? left : right;
	return leftKey.localeCompare(rightKey) <= 0 ? left : right;
}

function compareCandidates(
	left: SemanticRiskCommunityCandidate,
	right: SemanticRiskCommunityCandidate,
): number {
	const findingCount = right.findingIds.length - left.findingIds.length;
	if (findingCount !== 0) return findingCount;
	return (left.stableKey ?? "").localeCompare(right.stableKey ?? "");
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}
