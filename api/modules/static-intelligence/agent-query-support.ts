import type {
	DiagnosticEvidenceNode,
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	ParsedStaticIntelligenceAgentQueryInput,
	StaticIntelligenceAgentQueryItem,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type {
	RiskCommunity,
	SecurityLandscape,
} from "../../../shared/schemas/static-intelligence-landscape.schema";

export type QueryContext = {
	input: ParsedStaticIntelligenceAgentQueryInput;
	exportPayload: StaticIntelligenceExportV1;
	graph: QueryGraph;
	semantic?: StaticIntelligenceAgentQueryResult["bundles"]["semantic"];
	communities?: RiskCommunity[];
	landscape?: SecurityLandscape;
	degradedReasons: string[];
};

export type QueryGraph = {
	findings: Map<string, DiagnosticEvidenceNode>;
	evidence: Map<string, DiagnosticEvidenceNode>;
	artifacts: Map<string, DiagnosticEvidenceNode>;
	files: Map<string, DiagnosticEvidenceNode>;
	findingIdsByFile: Map<string, string[]>;
	evidenceRefsByFinding: Map<string, string[]>;
	artifactRefsByFinding: Map<string, string[]>;
	fileRefsByFinding: Map<string, string[]>;
};

export function buildQueryGraph(
	exportPayload: StaticIntelligenceExportV1,
): QueryGraph {
	const graph: QueryGraph = {
		findings: new Map(),
		evidence: new Map(),
		artifacts: new Map(),
		files: new Map(),
		findingIdsByFile: new Map(),
		evidenceRefsByFinding: new Map(),
		artifactRefsByFinding: new Map(),
		fileRefsByFinding: new Map(),
	};
	const nodesById = new Map(
		exportPayload.graph.nodes.map((node) => [node.id, node]),
	);
	for (const node of exportPayload.graph.nodes) {
		if (node.kind === "finding" && node.sourceId)
			graph.findings.set(node.sourceId, node);
		if (node.kind === "evidence" && node.sourceId)
			graph.evidence.set(node.sourceId, node);
		if (node.kind === "artifact" && node.sourceId)
			graph.artifacts.set(node.sourceId, node);
		if (node.kind === "file" && node.sourceId)
			graph.files.set(node.sourceId, node);
	}
	const evidenceToFinding = new Map<string, string[]>();
	for (const edge of exportPayload.graph.edges) {
		const from = nodesById.get(edge.from);
		const to = nodesById.get(edge.to);
		if (from?.kind !== "finding" || !from.sourceId || !to) continue;
		if (to.kind === "evidence" && to.sourceId) {
			addRef(graph.evidenceRefsByFinding, from.sourceId, to.sourceId);
			addRef(evidenceToFinding, to.sourceId, from.sourceId);
		}
		if (to.kind === "file" && to.sourceId) {
			addRef(graph.fileRefsByFinding, from.sourceId, to.sourceId);
			addRef(graph.findingIdsByFile, to.sourceId, from.sourceId);
		}
	}
	for (const edge of exportPayload.graph.edges) {
		if (edge.kind !== "stored_as") continue;
		const from = nodesById.get(edge.from);
		const to = nodesById.get(edge.to);
		if (from?.kind !== "evidence" || !from.sourceId) continue;
		if (to?.kind !== "artifact" || !to.sourceId) continue;
		for (const findingId of evidenceToFinding.get(from.sourceId) ?? []) {
			addRef(graph.artifactRefsByFinding, findingId, to.sourceId);
		}
	}
	sortMapArrays(graph.findingIdsByFile);
	sortMapArrays(graph.evidenceRefsByFinding);
	sortMapArrays(graph.artifactRefsByFinding);
	sortMapArrays(graph.fileRefsByFinding);
	return graph;
}

export function exactFindingMatches(context: QueryContext): string[] {
	const matches = new Set<string>();
	const { input } = context;
	if (input.findingId && context.graph.findings.has(input.findingId)) {
		matches.add(input.findingId);
	}
	for (const entry of context.exportPayload.fileRiskIndex) {
		if (input.file && entry.path === input.file) {
			for (const findingId of entry.findingIds) matches.add(findingId);
		}
		if (input.ruleId && entry.ruleIds.includes(input.ruleId)) {
			for (const findingId of entry.findingIds) matches.add(findingId);
		}
		if (input.scanner && entry.scanners.includes(input.scanner)) {
			for (const findingId of entry.findingIds) matches.add(findingId);
		}
	}
	return [...matches].sort((a, b) => a.localeCompare(b));
}

export function matchedFileRiskEntries(
	context: QueryContext,
	findingIds: string[],
): FileRiskIndexEntry[] {
	const findingSet = new Set(findingIds);
	return context.exportPayload.fileRiskIndex.filter((entry) => {
		if (context.input.file && entry.path === context.input.file) return true;
		if (context.input.ruleId && entry.ruleIds.includes(context.input.ruleId))
			return true;
		if (context.input.scanner && entry.scanners.includes(context.input.scanner))
			return true;
		return entry.findingIds.some((findingId) => findingSet.has(findingId));
	});
}

export function findingItem(
	context: QueryContext,
	findingId: string,
	metadata: Record<string, unknown>,
): StaticIntelligenceAgentQueryItem {
	const finding = context.graph.findings.get(findingId);
	return {
		id: `finding:${findingId}`,
		kind: "finding",
		title: finding?.label ?? findingId,
		candidateOnly: true,
		findingIds: [findingId],
		evidenceRefs: context.graph.evidenceRefsByFinding.get(findingId) ?? [],
		artifactRefs: context.graph.artifactRefsByFinding.get(findingId) ?? [],
		fileRefs: context.graph.fileRefsByFinding.get(findingId) ?? [],
		sourceRefs: [`finding:${findingId}`],
		metadata: {
			...sanitizeMetadata(finding?.metadata ?? {}),
			severity: finding?.severity,
			confidence: finding?.confidence,
			...metadata,
		},
	};
}

export function fileRiskItem(
	entry: FileRiskIndexEntry,
	metadata: Record<string, unknown>,
): StaticIntelligenceAgentQueryItem {
	return {
		id: `file_risk:${entry.path}`,
		kind: "file_risk",
		title: entry.path,
		candidateOnly: true,
		findingIds: [...entry.findingIds],
		evidenceRefs: [...entry.evidenceRefs],
		artifactRefs: [...entry.artifactRefs],
		fileRefs: [entry.path],
		sourceRefs: [`file:${entry.path}`],
		metadata: {
			findingCount: entry.findingCount,
			maxSeverity: entry.maxSeverity,
			evidenceQuality: entry.evidenceQuality,
			scanners: entry.scanners,
			ruleIds: entry.ruleIds,
			...metadata,
		},
	};
}

export function communityItem(
	community: RiskCommunity,
): StaticIntelligenceAgentQueryItem {
	return {
		id: community.id,
		kind: "community",
		title: community.title,
		candidateOnly: true,
		findingIds: [...community.findingIds],
		evidenceRefs: [...community.evidenceRefs],
		artifactRefs: [...community.artifactRefs],
		fileRefs: [...community.fileRefs],
		sourceRefs: [community.id],
		metadata: {
			basis: community.basis,
			confidence: community.confidence,
			maxSeverity: community.maxSeverity,
			evidenceQuality: community.evidenceQuality,
		},
	};
}

export function landscapeItem(
	landscape: SecurityLandscape,
): StaticIntelligenceAgentQueryItem {
	return {
		id: "landscape:risk",
		kind: "landscape",
		title: `Landscape risk band: ${landscape.risk.band}`,
		candidateOnly: true,
		findingIds: sortedUnique(
			landscape.risk.byFile.flatMap((entry) => entry.findingIds),
		),
		evidenceRefs: sortedUnique(
			landscape.risk.byFile.flatMap((entry) => entry.evidenceRefs),
		),
		artifactRefs: [],
		fileRefs: landscape.risk.byFile.map((entry) => entry.path).sort(),
		sourceRefs: ["landscape:risk"],
		metadata: {
			riskBand: landscape.risk.band,
			findingCount: landscape.risk.findingCount,
			coverageStatus: landscape.coverage.status,
			verificationCommandCount: landscape.remediation.verificationCommandCount,
		},
	};
}

export function semanticItems(
	context: QueryContext,
): StaticIntelligenceAgentQueryItem[] {
	return (context.semantic?.results ?? []).map((item) => ({
		id: `semantic:${item.id}`,
		kind: "semantic_candidate" as const,
		title: item.title,
		score: item.score,
		candidateOnly: true as const,
		findingIds: [...item.relatedFindingIds],
		evidenceRefs: [...item.evidenceRefs],
		artifactRefs: [...item.artifactRefs],
		fileRefs: item.filePath ? [item.filePath] : [],
		sourceRefs: [item.sourceRef],
		metadata: {
			sourceKind: item.sourceKind,
			sourceId: item.sourceId,
			vectorScore: item.vectorScore,
			exactScore: item.exactScore,
		},
	}));
}

export function intersectingCommunities(
	context: QueryContext,
	findingIds: string[],
): RiskCommunity[] {
	if (findingIds.length === 0) return [];
	const findingSet = new Set(findingIds);
	return (context.communities ?? []).filter((community) =>
		community.findingIds.some((findingId) => findingSet.has(findingId)),
	);
}

export function semanticCommunities(context: QueryContext): RiskCommunity[] {
	return (context.communities ?? []).filter((community) =>
		community.basis.includes("semantic"),
	);
}

export function relatedBasis(
	context: QueryContext,
	findingId: string,
): string[] {
	const basis: string[] = [];
	if (
		context.input.file &&
		(context.graph.fileRefsByFinding.get(findingId) ?? []).includes(
			context.input.file,
		)
	) {
		basis.push("same_file");
	}
	if (context.input.ruleId) basis.push("same_rule");
	if (context.input.scanner) basis.push("same_scanner");
	if (basis.length === 0) basis.push("graph_or_community");
	return basis.sort();
}

export function collectResultRefs(
	results: StaticIntelligenceAgentQueryItem[],
	exportPayload: StaticIntelligenceExportV1,
): StaticIntelligenceAgentQueryResult["refs"] {
	return {
		findingIds: sortedUnique(results.flatMap((item) => item.findingIds)),
		evidenceRefs: sortedUnique(results.flatMap((item) => item.evidenceRefs)),
		artifactRefs: sortedUnique(results.flatMap((item) => item.artifactRefs)),
		fileRefs: sortedUnique(results.flatMap((item) => item.fileRefs)),
		sourceRefs: sortedUnique([
			`scan:${exportPayload.scan.id}`,
			`project:${exportPayload.project.id}`,
			...results.flatMap((item) => item.sourceRefs),
		]),
	};
}

export function renderMarkdown(
	result: StaticIntelligenceAgentQueryResult,
): string {
	const lines = [
		"# Static Intelligence Context",
		"",
		"## Summary",
		result.summary.body,
		`Source refs: ${result.refs.sourceRefs.join(", ") || "none"}`,
		"",
		"## Results",
	];
	for (const item of result.results) {
		lines.push(`- ${item.kind}: ${item.title} [${item.sourceRefs.join(", ")}]`);
	}
	if (result.degradedReasons.length > 0) {
		lines.push("", "## Degraded Reasons");
		for (const reason of result.degradedReasons) lines.push(`- ${reason}`);
	}
	return `${lines.join("\n")}\n`;
}

export function shouldDefaultCommunities(
	queryKind: ParsedStaticIntelligenceAgentQueryInput["queryKind"],
): boolean {
	return (
		queryKind === "project_overview" ||
		queryKind === "risk_context" ||
		queryKind === "related_findings"
	);
}

export function shouldDefaultLandscape(
	queryKind: ParsedStaticIntelligenceAgentQueryInput["queryKind"],
): boolean {
	return queryKind === "project_overview" || queryKind === "risk_context";
}

export function semanticQueryFromExactFilters(
	input: ParsedStaticIntelligenceAgentQueryInput,
): string | undefined {
	return [input.findingId, input.file, input.ruleId, input.scanner]
		.filter((value): value is string => Boolean(value))
		.join(" ");
}

export function exactFilterCount(
	input: ParsedStaticIntelligenceAgentQueryInput,
): number {
	return [input.findingId, input.file, input.ruleId, input.scanner].filter(
		Boolean,
	).length;
}

export function semanticResultCount(context: QueryContext): number {
	return context.semantic?.results.length ?? 0;
}

export function requestedFindingDegradedReason(
	context: QueryContext,
): string[] {
	if (
		!context.input.findingId ||
		context.graph.findings.has(context.input.findingId)
	) {
		return [];
	}
	return [`requested finding not found: ${context.input.findingId}`];
}

export function withAdditionalSourceRefs(
	item: StaticIntelligenceAgentQueryItem,
	sourceRefs: string[],
): StaticIntelligenceAgentQueryItem {
	return {
		...item,
		sourceRefs: sortedUnique([...item.sourceRefs, ...sourceRefs]),
	};
}

export function projectLevelSourceRefs(
	exportPayload: StaticIntelligenceExportV1,
): string[] {
	return [
		`scan:${exportPayload.scan.id}`,
		`project:${exportPayload.project.id}`,
	];
}

export function exportStaticIntelligence(context: QueryContext) {
	return {
		summary: {
			title: "Static intelligence export",
			body: "Candidate-only envelope contains the Phase 29 static intelligence export payload.",
			candidateOnly: true as const,
		},
		results: [
			{
				id: `scan:${context.exportPayload.scan.id}`,
				kind: "file_risk" as const,
				title: `Static intelligence export for ${context.exportPayload.project.name}`,
				candidateOnly: true as const,
				findingIds: allFindingIds(context.exportPayload),
				evidenceRefs: allEvidenceRefs(context.exportPayload),
				artifactRefs: allArtifactRefs(context.exportPayload),
				fileRefs: context.exportPayload.fileRiskIndex.map(
					(entry) => entry.path,
				),
				sourceRefs: [
					`scan:${context.exportPayload.scan.id}`,
					`project:${context.exportPayload.project.id}`,
				],
				metadata: {
					riskBand: context.exportPayload.scanSummary.riskBand,
					findingCount: context.exportPayload.scan.findingCount,
				},
			},
		],
		degradedReasons: [],
	};
}

export function sanitizeMetadata(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const { snippet, rawContent, content, ...safe } = metadata;
	void snippet;
	void rawContent;
	void content;
	return safe;
}

export const allFindingIds = (payload: StaticIntelligenceExportV1): string[] =>
	sortedUnique(
		payload.graph.nodes
			.filter((node) => node.kind === "finding" && node.sourceId)
			.map((node) => node.sourceId as string),
	);

export const allEvidenceRefs = (
	payload: StaticIntelligenceExportV1,
): string[] =>
	sortedUnique(
		payload.graph.nodes
			.filter((node) => node.kind === "evidence" && node.sourceId)
			.map((node) => node.sourceId as string),
	);

export const allArtifactRefs = (
	payload: StaticIntelligenceExportV1,
): string[] =>
	sortedUnique(
		payload.graph.nodes
			.filter((node) => node.kind === "artifact" && node.sourceId)
			.map((node) => node.sourceId as string),
	);

export function sortItems(
	items: StaticIntelligenceAgentQueryItem[],
): StaticIntelligenceAgentQueryItem[] {
	return items.sort((left, right) => left.id.localeCompare(right.id));
}

function addRef(map: Map<string, string[]>, key: string, value: string): void {
	if (!key || !value) return;
	map.set(key, [...(map.get(key) ?? []), value]);
}

function sortMapArrays(map: Map<string, string[]>): void {
	for (const [key, value] of map.entries()) map.set(key, sortedUnique(value));
}

export function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class StaticIntelligenceAgentQueryInvalidRequestError extends Error {
	constructor(messageText: string) {
		super(messageText);
		this.name = "StaticIntelligenceAgentQueryInvalidRequestError";
	}
}
