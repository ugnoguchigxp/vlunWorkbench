import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceAgentQueryInput,
	StaticIntelligenceAgentQueryItem,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import {
	staticIntelligenceAgentQueryInputSchema,
	staticIntelligenceAgentQueryResultSchema,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type {
	RiskCommunity,
	SecurityLandscape,
} from "../../../shared/schemas/static-intelligence-landscape.schema";
import type { AppDatabase } from "../../db";
import type { EmbeddingProvider } from "../../providers/types";
import {
	buildQueryGraph,
	collectResultRefs,
	communityItem,
	exactFilterCount,
	exactFindingMatches,
	exportStaticIntelligence,
	fileRiskItem,
	findingItem,
	intersectingCommunities,
	landscapeItem,
	matchedFileRiskEntries,
	message,
	projectLevelSourceRefs,
	type QueryContext,
	relatedBasis,
	renderMarkdown,
	requestedFindingDegradedReason,
	StaticIntelligenceAgentQueryInvalidRequestError,
	sanitizeMetadata,
	semanticCommunities,
	semanticItems,
	semanticQueryFromExactFilters,
	semanticResultCount,
	shouldDefaultCommunities,
	shouldDefaultLandscape,
	sortedUnique,
	sortItems,
	withAdditionalSourceRefs,
} from "./agent-query-support";
import { buildRiskCommunities } from "./community-builder";
import { buildStaticIntelligenceExport } from "./export-builder";
import { buildSecurityLandscape } from "./landscape-builder";
import { buildSemanticCommunityCandidates } from "./semantic-community-integration";
import { runStaticIntelligenceSemanticQuery } from "./semantic-query";

export async function runStaticIntelligenceAgentQuery(params: {
	db: AppDatabase;
	input: StaticIntelligenceAgentQueryInput;
	semanticProvider?: EmbeddingProvider;
	generatedAt?: Date;
	exportPayload?: StaticIntelligenceExportV1;
}): Promise<StaticIntelligenceAgentQueryResult> {
	const input = staticIntelligenceAgentQueryInputSchema.parse(params.input);
	const generatedAt = (params.generatedAt ?? new Date()).toISOString();
	const exportPayload =
		params.exportPayload ??
		(await buildStaticIntelligenceExport(params.db, input.scanRunId, {
			generatedAt: params.generatedAt,
		}));
	const graph = buildQueryGraph(exportPayload);
	const degradedReasons = [...exportPayload.scanSummary.degradedReasons];

	const includeCommunities =
		input.includeCommunities ?? shouldDefaultCommunities(input.queryKind);
	const includeLandscape =
		input.includeLandscape ?? shouldDefaultLandscape(input.queryKind);

	let semantic: StaticIntelligenceAgentQueryResult["bundles"]["semantic"];
	let semanticCommunityCandidates: Parameters<typeof buildRiskCommunities>[1] =
		{};
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
				if (semantic.results.length > 0) {
					const semanticIntegration = buildSemanticCommunityCandidates({
						exportPayload,
						semantic,
					});
					semanticCommunityCandidates = {
						semanticCandidates: semanticIntegration.semanticCandidates,
					};
					degradedReasons.push(...semanticIntegration.degradedReasons);
				}
			} catch (error) {
				degradedReasons.push(
					`semantic enrichment unavailable: ${message(error)}`,
				);
			}
		}
	}

	let communities: RiskCommunity[] | undefined;
	if (includeCommunities || includeLandscape) {
		communities = buildRiskCommunities(
			exportPayload,
			semanticCommunityCandidates,
		);
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

type RoutedQuery = Pick<
	StaticIntelligenceAgentQueryResult,
	"summary" | "results"
> & {
	degradedReasons: string[];
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
	if (context.input.query) {
		const existingCommunityIds = new Set(
			results
				.filter((item) => item.kind === "community")
				.map((item) => item.id),
		);
		for (const community of semanticCommunities(context)) {
			if (!existingCommunityIds.has(community.id)) {
				results.push(communityItem(community));
			}
		}
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
	if (context.input.query) {
		for (const community of semanticCommunities(context)) {
			for (const findingId of community.findingIds) related.add(findingId);
		}
	}

	const results = [...related]
		.filter((findingId) => !seedId || findingId !== seedId)
		.map((findingId) =>
			findingItem(context, findingId, {
				basis: relatedBasis(context, findingId),
			}),
		);
	results.push(
		...semanticItems(context).filter(
			(item) => !seedId || !item.findingIds.includes(seedId),
		),
	);
	for (const community of intersectingCommunities(context, matched)) {
		results.push(communityItem(community));
	}
	if (context.input.query) {
		const existingCommunityIds = new Set(
			results
				.filter((item) => item.kind === "community")
				.map((item) => item.id),
		);
		for (const community of semanticCommunities(context)) {
			if (!existingCommunityIds.has(community.id)) {
				results.push(communityItem(community));
			}
		}
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
	const results = commands.map((command, index) => ({
		id: `verification_command:${index + 1}`,
		kind: "verification_command" as const,
		title: command,
		candidateOnly: true as const,
		findingIds: [],
		evidenceRefs: [],
		artifactRefs: [],
		fileRefs: [],
		sourceRefs: [`handoff:${context.exportPayload.scan.id}`],
		metadata: { command, ordinal: index + 1, scope: "scan" },
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
		degradedReasons: [
			...(commands.length === 0
				? ["handoff verification commands missing"]
				: []),
			...(context.input.findingId && commands.length > 0
				? [
						"verification commands are scan-level and were not attributed to the requested finding",
					]
				: []),
		],
	};
}

export { StaticIntelligenceAgentQueryInvalidRequestError } from "./agent-query-support";
