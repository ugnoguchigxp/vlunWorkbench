import { createHash } from "node:crypto";
import type {
	DiagnosticEvidenceNode,
	StaticIntelligenceExportV1,
} from "../../../shared/schemas/static-intelligence.schema";
import type { RiskCommunity } from "../../../shared/schemas/static-intelligence-landscape.schema";
import { riskCommunitySchema } from "../../../shared/schemas/static-intelligence-landscape.schema";
import {
	addConnectedNode,
	addRef,
	compareCommunities,
	evidenceQualityForFindings,
	maxConfidence,
	maxSeverityForFindings,
	sortBasis,
	sortedUnique,
	sortMapArrays,
	stringMetadata,
	suggestedReviewFocus,
	summarizeCommunity,
} from "./community-builder-policy";

export type CommunityCandidate = Omit<
	RiskCommunity,
	"summary" | "suggestedReviewFocus"
> & {
	sourceLabel: string;
};

export type SemanticRiskCommunityCandidate = {
	stableKey?: string;
	findingIds: string[];
	evidenceRefs?: string[];
	artifactRefs?: string[];
	fileRefs?: string[];
	scannerRefs?: string[];
	ruleIds?: string[];
	degradedReasons?: string[];
};

export type BuildRiskCommunitiesOptions = {
	semanticCandidates?: SemanticRiskCommunityCandidate[];
};

export function buildRiskCommunities(
	exportPayload: StaticIntelligenceExportV1,
	options: BuildRiskCommunitiesOptions = {},
): RiskCommunity[] {
	const context = buildGraphContext(exportPayload);
	const candidates: CommunityCandidate[] = [
		...buildSameFileCandidates(exportPayload, context),
		...buildSameScannerRuleCandidates(context),
		...buildSameScannerCandidates(context),
		...buildGraphConnectedCandidates(exportPayload, context),
		...buildSemanticCandidates(exportPayload, context, options),
	];

	const merged = mergeDuplicateCommunities(candidates, exportPayload, context);
	return merged
		.map((community) => riskCommunitySchema.parse(community))
		.sort(compareCommunities);
}

function buildSameFileCandidates(
	exportPayload: StaticIntelligenceExportV1,
	context: GraphContext,
): CommunityCandidate[] {
	return exportPayload.fileRiskIndex
		.filter((entry) => entry.findingIds.length > 1)
		.map((entry) => {
			const refs = collectRefs(exportPayload, context, entry.findingIds);
			return makeCandidate(exportPayload, context, {
				id: `community:file:${entry.path}`,
				title: `Risk cluster in ${entry.path}`,
				sourceLabel: entry.path,
				basis: ["same_file"],
				confidence: entry.path === "unknown" ? "low" : "high",
				findingIds: entry.findingIds,
				evidenceRefs: [...entry.evidenceRefs, ...refs.evidenceRefs],
				artifactRefs: [...entry.artifactRefs, ...refs.artifactRefs],
				fileRefs: [entry.path],
				scannerRefs: refs.scannerRefs,
				ruleIds: refs.ruleIds,
				degradedReasons: entry.path === "unknown" ? ["unknown file path"] : [],
			});
		});
}

function buildSameScannerRuleCandidates(
	context: GraphContext,
): CommunityCandidate[] {
	const groups = new Map<string, string[]>();
	for (const finding of context.findings.values()) {
		const scanner = stringMetadata(finding.metadata?.sourceTool);
		const ruleId = stringMetadata(finding.metadata?.ruleId);
		if (!scanner || !ruleId) continue;
		const key = `${scanner}\0${ruleId}`;
		groups.set(key, [...(groups.get(key) ?? []), finding.sourceId ?? ""]);
	}

	return [...groups.entries()]
		.map(([key, findingIds]) => {
			const [scanner, ruleId] = key.split("\0");
			return { scanner, ruleId, findingIds: sortedUnique(findingIds) };
		})
		.filter((group) => group.findingIds.length > 1)
		.map((group) =>
			makeCandidateFromContext(context, {
				id: `community:scanner-rule:${group.scanner}:${group.ruleId}`,
				title: `${group.scanner} / ${group.ruleId} cluster`,
				sourceLabel: `${group.scanner} / ${group.ruleId}`,
				basis: ["same_scanner_rule"],
				confidence: "high",
				findingIds: group.findingIds,
			}),
		);
}

function buildSameScannerCandidates(
	context: GraphContext,
): CommunityCandidate[] {
	const groups = new Map<string, string[]>();
	for (const finding of context.findings.values()) {
		const scanner = stringMetadata(finding.metadata?.sourceTool);
		const ruleId = stringMetadata(finding.metadata?.ruleId);
		if (!scanner || ruleId) continue;
		groups.set(scanner, [
			...(groups.get(scanner) ?? []),
			finding.sourceId ?? "",
		]);
	}

	return [...groups.entries()]
		.map(([scanner, findingIds]) => ({
			scanner,
			findingIds: sortedUnique(findingIds),
		}))
		.filter((group) => group.findingIds.length > 1)
		.map((group) =>
			makeCandidateFromContext(context, {
				id: `community:scanner:${group.scanner}`,
				title: `${group.scanner} finding cluster`,
				sourceLabel: group.scanner,
				basis: ["same_scanner"],
				confidence: "medium",
				findingIds: group.findingIds,
			}),
		);
}

function buildGraphConnectedCandidates(
	exportPayload: StaticIntelligenceExportV1,
	context: GraphContext,
): CommunityCandidate[] {
	const candidates: CommunityCandidate[] = [];
	for (const [
		nodeId,
		findingIds,
	] of context.findingIdsByConnectedNode.entries()) {
		const uniqueFindingIds = sortedUnique(findingIds);
		if (uniqueFindingIds.length < 2) continue;

		const node = context.nodes.get(nodeId);
		if (
			!node ||
			!["file", "evidence", "artifact", "scanner"].includes(node.kind)
		) {
			continue;
		}

		const confidence =
			(context.maxConfidenceByConnectedNode.get(nodeId) ?? 0) >= 0.75
				? "medium"
				: "low";
		const refs = collectRefs(exportPayload, context, uniqueFindingIds);
		candidates.push(
			makeCandidate(exportPayload, context, {
				id: `community:graph:${nodeId}`,
				title: `Graph-connected risk around ${node.label}`,
				sourceLabel: node.label,
				basis: ["graph_connected"],
				confidence,
				findingIds: uniqueFindingIds,
				evidenceRefs: refs.evidenceRefs,
				artifactRefs: refs.artifactRefs,
				fileRefs: refs.fileRefs,
				scannerRefs: refs.scannerRefs,
				ruleIds: refs.ruleIds,
				degradedReasons: [],
			}),
		);
	}
	return candidates;
}

function buildSemanticCandidates(
	exportPayload: StaticIntelligenceExportV1,
	context: GraphContext,
	options: BuildRiskCommunitiesOptions,
): CommunityCandidate[] {
	const knownFindingIds = new Set(context.findings.keys());
	return (options.semanticCandidates ?? [])
		.map((candidate) => ({
			...candidate,
			findingIds: sortedUnique(
				candidate.findingIds.filter((findingId) =>
					knownFindingIds.has(findingId),
				),
			),
			degradedReasons: [
				...(candidate.degradedReasons ?? []),
				...(candidate.findingIds.some(
					(findingId) => !knownFindingIds.has(findingId),
				)
					? ["semantic candidate referenced unknown finding"]
					: []),
			],
		}))
		.filter((candidate) => candidate.findingIds.length > 0)
		.map((candidate) => {
			const refs = collectRefs(exportPayload, context, candidate.findingIds);
			const stableKey =
				candidate.stableKey ??
				createHash("sha256")
					.update(candidate.findingIds.join("\0"))
					.digest("hex");
			return makeCandidate(exportPayload, context, {
				id: `community:semantic:${stableKey.slice(0, 16)}`,
				title: "Semantically related risk candidates",
				sourceLabel: "semantic similarity",
				basis: ["semantic"],
				confidence: "low",
				findingIds: candidate.findingIds,
				evidenceRefs: [...(candidate.evidenceRefs ?? []), ...refs.evidenceRefs],
				artifactRefs: [...(candidate.artifactRefs ?? []), ...refs.artifactRefs],
				fileRefs: [...(candidate.fileRefs ?? []), ...refs.fileRefs],
				scannerRefs: [...(candidate.scannerRefs ?? []), ...refs.scannerRefs],
				ruleIds: [...(candidate.ruleIds ?? []), ...refs.ruleIds],
				degradedReasons: candidate.degradedReasons ?? [],
			});
		});
}

function makeCandidateFromContext(
	context: GraphContext,
	input: Pick<
		CommunityCandidate,
		"id" | "title" | "sourceLabel" | "basis" | "confidence" | "findingIds"
	>,
): CommunityCandidate {
	const refs = collectRefs(context.exportPayload, context, input.findingIds);
	return makeCandidate(context.exportPayload, context, {
		...input,
		...refs,
		degradedReasons: [],
	});
}

function makeCandidate(
	exportPayload: StaticIntelligenceExportV1,
	context: GraphContext,
	input: Omit<
		CommunityCandidate,
		"candidateOnly" | "maxSeverity" | "evidenceQuality"
	>,
): CommunityCandidate {
	const findingIds = sortedUnique(input.findingIds);
	const community: CommunityCandidate = {
		...input,
		basis: sortBasis(input.basis),
		candidateOnly: true,
		findingIds,
		evidenceRefs: sortedUnique(input.evidenceRefs),
		artifactRefs: sortedUnique(input.artifactRefs),
		fileRefs: sortedUnique(input.fileRefs),
		scannerRefs: sortedUnique(input.scannerRefs),
		ruleIds: sortedUnique(input.ruleIds),
		maxSeverity: maxSeverityForFindings(context, findingIds),
		evidenceQuality: evidenceQualityForFindings(exportPayload, findingIds),
		degradedReasons: sortedUnique(input.degradedReasons),
	};
	return community;
}

function mergeDuplicateCommunities(
	candidates: CommunityCandidate[],
	exportPayload: StaticIntelligenceExportV1,
	context: GraphContext,
): RiskCommunity[] {
	const byFindingSet = new Map<string, CommunityCandidate>();

	for (const candidate of candidates) {
		const key = candidate.findingIds.join("\0");
		const existing = byFindingSet.get(key);
		if (!existing) {
			byFindingSet.set(key, candidate);
			continue;
		}

		byFindingSet.set(
			key,
			makeCandidate(exportPayload, context, {
				...existing,
				basis: sortBasis([...existing.basis, ...candidate.basis]),
				confidence: maxConfidence(existing.confidence, candidate.confidence),
				evidenceRefs: [...existing.evidenceRefs, ...candidate.evidenceRefs],
				artifactRefs: [...existing.artifactRefs, ...candidate.artifactRefs],
				fileRefs: [...existing.fileRefs, ...candidate.fileRefs],
				scannerRefs: [...existing.scannerRefs, ...candidate.scannerRefs],
				ruleIds: [...existing.ruleIds, ...candidate.ruleIds],
				degradedReasons: [
					...existing.degradedReasons,
					...candidate.degradedReasons,
				],
			}),
		);
	}

	return [...byFindingSet.values()].map((community) => ({
		...community,
		summary: summarizeCommunity(community),
		suggestedReviewFocus: suggestedReviewFocus(community, exportPayload),
	}));
}

export type GraphContext = {
	exportPayload: StaticIntelligenceExportV1;
	nodes: Map<string, DiagnosticEvidenceNode>;
	findings: Map<string, DiagnosticEvidenceNode>;
	findingIdsByConnectedNode: Map<string, string[]>;
	maxConfidenceByConnectedNode: Map<string, number>;
	evidenceByFindingId: Map<string, string[]>;
	artifactByFindingId: Map<string, string[]>;
	fileByFindingId: Map<string, string[]>;
	scannerByFindingId: Map<string, string[]>;
	ruleByFindingId: Map<string, string[]>;
};

function buildGraphContext(
	exportPayload: StaticIntelligenceExportV1,
): GraphContext {
	const nodes = new Map(
		exportPayload.graph.nodes.map((node) => [node.id, node]),
	);
	const findings = new Map(
		exportPayload.graph.nodes
			.filter((node) => node.kind === "finding" && node.sourceId)
			.map((node) => [node.sourceId as string, node]),
	);
	const context: GraphContext = {
		exportPayload,
		nodes,
		findings,
		findingIdsByConnectedNode: new Map(),
		maxConfidenceByConnectedNode: new Map(),
		evidenceByFindingId: new Map(),
		artifactByFindingId: new Map(),
		fileByFindingId: new Map(),
		scannerByFindingId: new Map(),
		ruleByFindingId: new Map(),
	};

	for (const entry of exportPayload.fileRiskIndex) {
		for (const findingId of entry.findingIds) {
			addRef(context.fileByFindingId, findingId, entry.path);
			for (const scanner of entry.scanners)
				addRef(context.scannerByFindingId, findingId, scanner);
			for (const ruleId of entry.ruleIds)
				addRef(context.ruleByFindingId, findingId, ruleId);
		}
	}

	for (const finding of findings.values()) {
		const findingId = finding.sourceId;
		if (!findingId) continue;
		const scanner = stringMetadata(finding.metadata?.sourceTool);
		const ruleId = stringMetadata(finding.metadata?.ruleId);
		if (scanner) addRef(context.scannerByFindingId, findingId, scanner);
		if (ruleId) addRef(context.ruleByFindingId, findingId, ruleId);
	}

	for (const edge of exportPayload.graph.edges) {
		const from = nodes.get(edge.from);
		const to = nodes.get(edge.to);
		if (!from || !to) continue;

		if (from.kind === "finding" && from.sourceId) {
			addConnectedNode(context, to.id, from.sourceId, edge.confidence);
			if (to.kind === "evidence" && to.sourceId) {
				addRef(context.evidenceByFindingId, from.sourceId, to.sourceId);
			}
			if (to.kind === "file" && to.sourceId) {
				addRef(context.fileByFindingId, from.sourceId, to.sourceId);
			}
			if (to.kind === "scanner" && to.label) {
				addRef(context.scannerByFindingId, from.sourceId, to.label);
			}
		}
		if (to.kind === "finding" && to.sourceId) {
			addConnectedNode(context, from.id, to.sourceId, edge.confidence);
		}
	}

	const evidenceToFindings = new Map<string, string[]>();
	for (const [
		findingId,
		evidenceRefs,
	] of context.evidenceByFindingId.entries()) {
		for (const evidenceRef of evidenceRefs) {
			addRef(evidenceToFindings, evidenceRef, findingId);
		}
	}

	for (const edge of exportPayload.graph.edges) {
		if (edge.kind !== "stored_as") continue;
		const evidence = nodes.get(edge.from);
		const artifact = nodes.get(edge.to);
		if (evidence?.kind !== "evidence" || !evidence.sourceId) continue;
		if (artifact?.kind !== "artifact" || !artifact.sourceId) continue;
		for (const findingId of evidenceToFindings.get(evidence.sourceId) ?? []) {
			addRef(context.artifactByFindingId, findingId, artifact.sourceId);
			addConnectedNode(context, artifact.id, findingId, edge.confidence);
		}
	}

	sortMapArrays(context.findingIdsByConnectedNode);
	sortMapArrays(context.evidenceByFindingId);
	sortMapArrays(context.artifactByFindingId);
	sortMapArrays(context.fileByFindingId);
	sortMapArrays(context.scannerByFindingId);
	sortMapArrays(context.ruleByFindingId);
	return context;
}

function collectRefs(
	exportPayload: StaticIntelligenceExportV1,
	context: GraphContext,
	findingIds: string[],
) {
	const evidenceRefs: string[] = [];
	const artifactRefs: string[] = [];
	const fileRefs: string[] = [];
	const scannerRefs: string[] = [];
	const ruleIds: string[] = [];

	for (const findingId of findingIds) {
		evidenceRefs.push(...(context.evidenceByFindingId.get(findingId) ?? []));
		artifactRefs.push(...(context.artifactByFindingId.get(findingId) ?? []));
		fileRefs.push(...(context.fileByFindingId.get(findingId) ?? []));
		scannerRefs.push(...(context.scannerByFindingId.get(findingId) ?? []));
		ruleIds.push(...(context.ruleByFindingId.get(findingId) ?? []));
	}

	for (const entry of exportPayload.fileRiskIndex) {
		if (!entry.findingIds.some((findingId) => findingIds.includes(findingId))) {
			continue;
		}
		evidenceRefs.push(...entry.evidenceRefs);
		artifactRefs.push(...entry.artifactRefs);
		fileRefs.push(entry.path);
		scannerRefs.push(...entry.scanners);
		ruleIds.push(...entry.ruleIds);
	}

	return {
		evidenceRefs: sortedUnique(evidenceRefs),
		artifactRefs: sortedUnique(artifactRefs),
		fileRefs: sortedUnique(fileRefs),
		scannerRefs: sortedUnique(scannerRefs),
		ruleIds: sortedUnique(ruleIds),
	};
}
