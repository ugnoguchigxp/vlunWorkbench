import type {
	DiagnosticEvidenceNode,
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	RiskCommunity,
	SecurityLandscape,
} from "../../../shared/schemas/static-intelligence-landscape.schema";
import type {
	ParsedStaticIntelligenceAgentQueryInput,
	StaticIntelligenceAgentQueryInput,
	StaticIntelligenceAgentQueryItem,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import {
	staticIntelligenceAgentQueryInputSchema,
	staticIntelligenceAgentQueryResultSchema,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type { AppDatabase } from "../../db";
import type { EmbeddingProvider } from "../../providers/types";
import { buildRiskCommunities } from "./community-builder";
import { buildStaticIntelligenceExport } from "./export-builder";
import { buildSecurityLandscape } from "./landscape-builder";
import { runStaticIntelligenceSemanticQuery } from "./semantic-query";

export async function runStaticIntelligenceAgentQuery(params: {
	db: AppDatabase;
	input: StaticIntelligenceAgentQueryInput;
	semanticProvider?: EmbeddingProvider;
	generatedAt?: Date;
}): Promise<StaticIntelligenceAgentQueryResult> {
	const input = staticIntelligenceAgentQueryInputSchema.parse(params.input);
	const generatedAt = (params.generatedAt ?? new Date()).toISOString();
	const exportPayload = await buildStaticIntelligenceExport(
		params.db,
		input.scanRunId,
		{ generatedAt: params.generatedAt },
	);
	const graph = buildQueryGraph(exportPayload);
	const degradedReasons = [...exportPayload.scanSummary.degradedReasons];

	const includeCommunities =
		input.includeCommunities ?? shouldDefaultCommunities(input.queryKind);
	const includeLandscape =
		input.includeLandscape ?? shouldDefaultLandscape(input.queryKind);

	let semantic: StaticIntelligenceAgentQueryResult["bundles"]["semantic"];
	if (input.includeSemantic) {
		const semanticQuery = input.query ?? semanticQueryFromExactFilters(input);
		if (!semanticQuery) {
			degradedReasons.push("semantic query text missing");
		} else {
			try {
				semantic = await runStaticIntelligenceSemanticQuery({
					db: params.db,
					scanRunId: input.scanRunId,
					query: semanticQuery,
					embeddingProvider: params.semanticProvider,
					options: {
						topK: input.topK,
						filters: {
							file: input.file,
							ruleId: input.ruleId,
							scanner: input.scanner,
						},
					},
				});
				degradedReasons.push(...semantic.degradedReasons);
			} catch (error) {
				degradedReasons.push(
					`semantic enrichment unavailable: ${message(error)}`,
				);
			}
		}
	}

	let communities: RiskCommunity[] | undefined;
	if (includeCommunities || includeLandscape) {
		communities = buildRiskCommunities(exportPayload);
	}

	let landscape: SecurityLandscape | undefined;
	if (includeLandscape) {
		landscape = buildSecurityLandscape(exportPayload, communities ?? []);
	}

	const context: QueryContext = {
		input,
		exportPayload,
		graph,
		semantic,
		communities: includeCommunities ? (communities ?? []) : undefined,
		landscape,
		degradedReasons,
	};
	const routed = routeQuery(context);
	degradedReasons.push(...routed.degradedReasons);

	const bundles: StaticIntelligenceAgentQueryResult["bundles"] = {};
	if (input.queryKind === "export_static_intelligence") {
		bundles.export = exportPayload;
	}
	if (semantic) bundles.semantic = semantic;
	if (includeCommunities && communities) bundles.communities = communities;
	if (includeLandscape && landscape) bundles.landscape = landscape;

	const resultWithoutMarkdown: StaticIntelligenceAgentQueryResult = {
		ok: true,
		status: "completed",
		version: "v1",
		generatedAt,
		scanRunId: input.scanRunId,
		queryKind: input.queryKind,
		summary: routed.summary,
		refs: collectResultRefs(routed.results, exportPayload),
		results: routed.results,
		bundles,
		degradedReasons: sortedUnique(degradedReasons),
	};

	const parsed = staticIntelligenceAgentQueryResultSchema.parse(
		resultWithoutMarkdown,
	);
	if (!input.includeMarkdown) return parsed;
	return staticIntelligenceAgentQueryResultSchema.parse({
		...parsed,
		bundles: {
			...parsed.bundles,
			markdown: renderMarkdown(parsed),
		},
	});
}

type QueryContext = {
	input: ParsedStaticIntelligenceAgentQueryInput;
	exportPayload: StaticIntelligenceExportV1;
	graph: QueryGraph;
	semantic?: StaticIntelligenceAgentQueryResult["bundles"]["semantic"];
	communities?: RiskCommunity[];
	landscape?: SecurityLandscape;
	degradedReasons: string[];
};

type RoutedQuery = Pick<
	StaticIntelligenceAgentQueryResult,
	"summary" | "results"
> & {
	degradedReasons: string[];
};

type QueryGraph = {
	findings: Map<string, DiagnosticEvidenceNode>;
	evidence: Map<string, DiagnosticEvidenceNode>;
	artifacts: Map<string, DiagnosticEvidenceNode>;
	files: Map<string, DiagnosticEvidenceNode>;
	findingIdsByFile: Map<string, string[]>;
	evidenceRefsByFinding: Map<string, string[]>;
	artifactRefsByFinding: Map<string, string[]>;
	fileRefsByFinding: Map<string, string[]>;
};

function routeQuery(context: QueryContext): RoutedQuery {
	switch (context.input.queryKind) {
		case "project_overview":
			return projectOverview(context);
		case "risk_context":
			return riskContext(context);
		case "related_findings":
			return relatedFindings(context);
		case "evidence_bundle":
			return evidenceBundle(context);
		case "verification_commands":
			return verificationCommands(context);
		case "export_static_intelligence":
			return exportStaticIntelligence(context);
	}
}

function projectOverview(context: QueryContext): RoutedQuery {
	const projectSourceRefs = projectLevelSourceRefs(context.exportPayload);
	const results = context.exportPayload.fileRiskIndex.map((entry) =>
		withAdditionalSourceRefs(
			fileRiskItem(entry, { basis: ["project_overview"] }),
			projectSourceRefs,
		),
	);
	if (context.landscape) {
		results.push(
			withAdditionalSourceRefs(
				landscapeItem(context.landscape),
				projectSourceRefs,
			),
		);
	}
	for (const community of context.communities ?? []) {
		results.push(
			withAdditionalSourceRefs(communityItem(community), projectSourceRefs),
		);
	}
	return {
		summary: {
			title: `Static intelligence overview for ${context.exportPayload.project.name}`,
			body: `Candidate-only overview: risk band ${context.exportPayload.scanSummary.riskBand}, ${context.exportPayload.scan.findingCount} stored finding(s), review ${context.exportPayload.scan.reviewStatus}.`,
			candidateOnly: true,
		},
		results: sortItems(results),
		degradedReasons:
			context.exportPayload.scan.findingCount === 0
				? ["no stored findings in this scan run"]
				: [],
	};
}

function riskContext(context: QueryContext): RoutedQuery {
	const findingIds = exactFindingMatches(context);
	const degradedReasons = requestedFindingDegradedReason(context);
	const results: StaticIntelligenceAgentQueryItem[] = [
		...matchedFileRiskEntries(context, findingIds).map((entry) =>
			fileRiskItem(entry, { basis: ["exact_filter"] }),
		),
		...findingIds.map((findingId) =>
			findingItem(context, findingId, { basis: ["exact_filter"] }),
		),
	];
	for (const community of intersectingCommunities(context, findingIds)) {
		results.push(communityItem(community));
	}
	results.push(...semanticItems(context));

	const hasOnlyQuery =
		Boolean(context.input.query) && exactFilterCount(context.input) === 0;
	return {
		summary: {
			title: "Focused static intelligence context",
			body:
				results.length > 0
					? `Candidate-only context matched ${results.length} item(s) from exact graph data${context.semantic ? " and semantic candidates" : ""}.`
					: "Candidate-only context found no exact graph matches for the requested focus.",
			candidateOnly: true,
		},
		results: sortItems(results),
		degradedReasons: [
			...degradedReasons,
			...(results.length === 0 &&
			hasOnlyQuery &&
			semanticResultCount(context) === 0
				? ["query-only risk context has no semantic enrichment available"]
				: []),
			...(results.length === 0 && !hasOnlyQuery
				? ["no exact risk context matches found"]
				: []),
		],
	};
}

function relatedFindings(context: QueryContext): RoutedQuery {
	const seedId = context.input.findingId;
	const matched = exactFindingMatches(context);
	const degradedReasons = requestedFindingDegradedReason(context);
	const related = new Set<string>();
	for (const findingId of matched) {
		for (const file of context.graph.fileRefsByFinding.get(findingId) ?? []) {
			for (const relatedId of context.graph.findingIdsByFile.get(file) ?? []) {
				related.add(relatedId);
			}
		}
	}
	for (const entry of context.exportPayload.fileRiskIndex) {
		const sameRule =
			context.input.ruleId && entry.ruleIds.includes(context.input.ruleId);
		const sameScanner =
			context.input.scanner && entry.scanners.includes(context.input.scanner);
		if (sameRule || sameScanner) {
			for (const findingId of entry.findingIds) related.add(findingId);
		}
	}
	for (const community of intersectingCommunities(context, matched)) {
		for (const findingId of community.findingIds) related.add(findingId);
	}

	const results = [...related]
		.filter((findingId) => !seedId || findingId !== seedId)
		.map((findingId) =>
			findingItem(context, findingId, {
				basis: relatedBasis(context, findingId),
			}),
		);
	results.push(
		...semanticItems(context).filter((item) => item.findingIds[0] !== seedId),
	);
	for (const community of intersectingCommunities(context, matched)) {
		results.push(communityItem(community));
	}

	const hasOnlyQuery =
		Boolean(context.input.query) && exactFilterCount(context.input) === 0;
	return {
		summary: {
			title: "Related static findings",
			body:
				results.length > 0
					? `Candidate-only related findings returned ${results.length} item(s) from exact, graph, community, or requested semantic signals.`
					: "Candidate-only related finding search found no matching stored findings.",
			candidateOnly: true,
		},
		results: sortItems(results),
		degradedReasons: [
			...degradedReasons,
			...(results.length === 0 &&
			hasOnlyQuery &&
			semanticResultCount(context) === 0
				? ["query-only related findings has no semantic enrichment available"]
				: []),
			...(results.length === 0 ? ["no matching related findings found"] : []),
		],
	};
}

function evidenceBundle(context: QueryContext): RoutedQuery {
	const findingId = context.input.findingId as string;
	const finding = context.graph.findings.get(findingId);
	if (!finding) {
		throw new StaticIntelligenceAgentQueryInvalidRequestError(
			`Finding not found: ${findingId}`,
		);
	}
	const results: StaticIntelligenceAgentQueryItem[] = [
		findingItem(context, findingId, { basis: ["requested_finding"] }),
	];
	for (const evidenceRef of context.graph.evidenceRefsByFinding.get(
		findingId,
	) ?? []) {
		const node = context.graph.evidence.get(evidenceRef);
		results.push({
			id: `evidence:${evidenceRef}`,
			kind: "evidence",
			title: node?.label ?? evidenceRef,
			candidateOnly: true,
			findingIds: [findingId],
			evidenceRefs: [evidenceRef],
			artifactRefs: [],
			fileRefs: context.graph.fileRefsByFinding.get(findingId) ?? [],
			sourceRefs: [`evidence:${evidenceRef}`],
			metadata: sanitizeMetadata(node?.metadata ?? {}),
		});
	}
	for (const artifactRef of context.graph.artifactRefsByFinding.get(
		findingId,
	) ?? []) {
		const node = context.graph.artifacts.get(artifactRef);
		results.push({
			id: `artifact:${artifactRef}`,
			kind: "artifact",
			title: node?.label ?? artifactRef,
			candidateOnly: true,
			findingIds: [findingId],
			evidenceRefs: context.graph.evidenceRefsByFinding.get(findingId) ?? [],
			artifactRefs: [artifactRef],
			fileRefs: context.graph.fileRefsByFinding.get(findingId) ?? [],
			sourceRefs: [`artifact:${artifactRef}`],
			metadata: sanitizeMetadata(node?.metadata ?? {}),
		});
	}
	for (const entry of matchedFileRiskEntries(context, [findingId])) {
		results.push(fileRiskItem(entry, { basis: ["requested_finding"] }));
	}
	return {
		summary: {
			title: `Evidence bundle for ${finding.label}`,
			body: "Candidate-only evidence bundle references stored evidence, artifacts, and file risk without raw snippets or artifact bodies.",
			candidateOnly: true,
		},
		results: sortItems(results),
		degradedReasons: [],
	};
}

function verificationCommands(context: QueryContext): RoutedQuery {
	if (
		context.input.findingId &&
		!context.graph.findings.has(context.input.findingId)
	) {
		throw new StaticIntelligenceAgentQueryInvalidRequestError(
			`Finding not found: ${context.input.findingId}`,
		);
	}
	const commands = context.exportPayload.handoff?.verificationCommands ?? [];
	const findingIds = context.input.findingId ? [context.input.findingId] : [];
	const fileRefs = sortedUnique(
		findingIds.flatMap((id) => context.graph.fileRefsByFinding.get(id) ?? []),
	);
	const results = commands.map((command, index) => ({
		id: `verification_command:${index + 1}`,
		kind: "verification_command" as const,
		title: command,
		candidateOnly: true as const,
		findingIds,
		evidenceRefs: sortedUnique(
			findingIds.flatMap(
				(id) => context.graph.evidenceRefsByFinding.get(id) ?? [],
			),
		),
		artifactRefs: sortedUnique(
			findingIds.flatMap(
				(id) => context.graph.artifactRefsByFinding.get(id) ?? [],
			),
		),
		fileRefs,
		sourceRefs: [
			`handoff:${context.exportPayload.scan.id}`,
			...(findingIds.length > 0 ? findingIds.map((id) => `finding:${id}`) : []),
			...fileRefs.map((fileRef) => `file:${fileRef}`),
		],
		metadata: { command, ordinal: index + 1 },
	}));
	return {
		summary: {
			title: "Verification commands",
			body:
				commands.length > 0
					? `Candidate-only handoff exposes ${commands.length} stored verification command(s); commands were not executed.`
					: "No stored verification commands are available for this scan handoff.",
			candidateOnly: true,
		},
		results,
		degradedReasons:
			commands.length === 0 ? ["handoff verification commands missing"] : [],
	};
}

function exportStaticIntelligence(context: QueryContext): RoutedQuery {
	return {
		summary: {
			title: "Static intelligence export",
			body: "Candidate-only envelope contains the Phase 29 static intelligence export payload.",
			candidateOnly: true,
		},
		results: [
			{
				id: `scan:${context.exportPayload.scan.id}`,
				kind: "file_risk",
				title: `Static intelligence export for ${context.exportPayload.project.name}`,
				candidateOnly: true,
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

function buildQueryGraph(
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

function exactFindingMatches(context: QueryContext): string[] {
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

function matchedFileRiskEntries(
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

function findingItem(
	context: QueryContext,
	findingId: string,
	metadata: Record<string, unknown>,
): StaticIntelligenceAgentQueryItem {
	const finding = context.graph.findings.get(findingId);
	const fileRefs = context.graph.fileRefsByFinding.get(findingId) ?? [];
	const evidenceRefs = context.graph.evidenceRefsByFinding.get(findingId) ?? [];
	const artifactRefs = context.graph.artifactRefsByFinding.get(findingId) ?? [];
	return {
		id: `finding:${findingId}`,
		kind: "finding",
		title: finding?.label ?? findingId,
		candidateOnly: true,
		findingIds: [findingId],
		evidenceRefs,
		artifactRefs,
		fileRefs,
		sourceRefs: [`finding:${findingId}`],
		metadata: {
			...sanitizeMetadata(finding?.metadata ?? {}),
			severity: finding?.severity,
			confidence: finding?.confidence,
			...metadata,
		},
	};
}

function fileRiskItem(
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

function communityItem(
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

function landscapeItem(
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

function semanticItems(
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

function intersectingCommunities(
	context: QueryContext,
	findingIds: string[],
): RiskCommunity[] {
	if (findingIds.length === 0) return [];
	const findingSet = new Set(findingIds);
	return (context.communities ?? []).filter((community) =>
		community.findingIds.some((findingId) => findingSet.has(findingId)),
	);
}

function relatedBasis(context: QueryContext, findingId: string): string[] {
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

function collectResultRefs(
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

function renderMarkdown(result: StaticIntelligenceAgentQueryResult): string {
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

function shouldDefaultCommunities(
	queryKind: ParsedStaticIntelligenceAgentQueryInput["queryKind"],
): boolean {
	return (
		queryKind === "project_overview" ||
		queryKind === "risk_context" ||
		queryKind === "related_findings"
	);
}

function shouldDefaultLandscape(
	queryKind: ParsedStaticIntelligenceAgentQueryInput["queryKind"],
): boolean {
	return queryKind === "project_overview" || queryKind === "risk_context";
}

function semanticQueryFromExactFilters(
	input: ParsedStaticIntelligenceAgentQueryInput,
): string | undefined {
	return [input.findingId, input.file, input.ruleId, input.scanner]
		.filter((value): value is string => Boolean(value))
		.join(" ");
}

function exactFilterCount(
	input: ParsedStaticIntelligenceAgentQueryInput,
): number {
	return [input.findingId, input.file, input.ruleId, input.scanner].filter(
		Boolean,
	).length;
}

function semanticResultCount(context: QueryContext): number {
	return context.semantic?.results.length ?? 0;
}

function requestedFindingDegradedReason(context: QueryContext): string[] {
	if (
		!context.input.findingId ||
		context.graph.findings.has(context.input.findingId)
	) {
		return [];
	}
	return [`requested finding not found: ${context.input.findingId}`];
}

function withAdditionalSourceRefs(
	item: StaticIntelligenceAgentQueryItem,
	sourceRefs: string[],
): StaticIntelligenceAgentQueryItem {
	return {
		...item,
		sourceRefs: sortedUnique([...item.sourceRefs, ...sourceRefs]),
	};
}

function projectLevelSourceRefs(
	exportPayload: StaticIntelligenceExportV1,
): string[] {
	return [
		`scan:${exportPayload.scan.id}`,
		`project:${exportPayload.project.id}`,
	];
}

function sanitizeMetadata(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const { snippet, rawContent, content, ...safe } = metadata;
	void snippet;
	void rawContent;
	void content;
	return safe;
}

function allFindingIds(exportPayload: StaticIntelligenceExportV1): string[] {
	return sortedUnique(
		exportPayload.graph.nodes
			.filter((node) => node.kind === "finding" && node.sourceId)
			.map((node) => node.sourceId as string),
	);
}

function allEvidenceRefs(exportPayload: StaticIntelligenceExportV1): string[] {
	return sortedUnique(
		exportPayload.graph.nodes
			.filter((node) => node.kind === "evidence" && node.sourceId)
			.map((node) => node.sourceId as string),
	);
}

function allArtifactRefs(exportPayload: StaticIntelligenceExportV1): string[] {
	return sortedUnique(
		exportPayload.graph.nodes
			.filter((node) => node.kind === "artifact" && node.sourceId)
			.map((node) => node.sourceId as string),
	);
}

function sortItems(
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

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class StaticIntelligenceAgentQueryInvalidRequestError extends Error {
	constructor(messageText: string) {
		super(messageText);
		this.name = "StaticIntelligenceAgentQueryInvalidRequestError";
	}
}
