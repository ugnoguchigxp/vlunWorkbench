import type {
	DiagnosticEvidenceNode,
	StaticIntelligenceExportV1,
	StaticIntelligenceRiskBand,
	StaticIntelligenceSeverity,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	RiskCommunity,
	SecurityLandscape,
} from "../../../shared/schemas/static-intelligence-landscape.schema";
import { securityLandscapeSchema } from "../../../shared/schemas/static-intelligence-landscape.schema";
import { normalizeSeverity } from "./file-risk-index";

export function buildSecurityLandscape(
	exportPayload: StaticIntelligenceExportV1,
	_communities: RiskCommunity[] = [],
): SecurityLandscape {
	const graph = buildGraphContext(exportPayload);
	const unknownFileCount = exportPayload.fileRiskIndex.filter(
		(entry) => entry.path === "unknown",
	).length;
	const missingEvidenceFindingIds = missingEvidenceFindings(
		exportPayload,
		graph,
	);
	const weakEvidenceFindingIds = weakEvidenceFindings(graph);

	return securityLandscapeSchema.parse({
		risk: {
			band: riskBand(exportPayload),
			findingCount: exportPayload.scan.findingCount,
			bySeverity: countBySeverity(graph.findings),
			byScanner: countByScanner(graph),
			byFile: exportPayload.fileRiskIndex.map((entry) => ({
				path: entry.path,
				findingCount: entry.findingCount,
				maxSeverity: entry.maxSeverity,
				evidenceQuality: entry.evidenceQuality,
				findingIds: [...entry.findingIds],
				evidenceRefs: [...entry.evidenceRefs],
			})),
		},
		coverage: {
			status: coverageStatus(exportPayload, unknownFileCount),
			scannedToolCount: exportPayload.scan.toolRunCount,
			artifactCount: exportPayload.scan.artifactCount,
			unknownFileCount,
			degradedReasons: [...exportPayload.scanSummary.degradedReasons].sort(
				(a, b) => a.localeCompare(b),
			),
		},
		evidence: {
			quality: exportPayload.scanSummary.evidenceQuality,
			missingEvidenceFindingIds,
			weakEvidenceFindingIds,
			artifactBackedEvidenceRefs: artifactBackedEvidenceRefs(graph),
		},
		remediation: {
			reviewStatus: exportPayload.scan.reviewStatus,
			hasImprovementRequest: Boolean(exportPayload.handoff),
			acceptanceCriteriaCount:
				exportPayload.handoff?.acceptanceCriteria.length ?? 0,
			verificationCommandCount:
				exportPayload.handoff?.verificationCommands.length ?? 0,
			openFocus: remediationOpenFocus(
				exportPayload,
				unknownFileCount,
				missingEvidenceFindingIds,
				weakEvidenceFindingIds,
			),
		},
	});
}

function riskBand(
	exportPayload: StaticIntelligenceExportV1,
): StaticIntelligenceRiskBand {
	if (exportPayload.scan.findingCount === 0) return "none";
	return exportPayload.scanSummary.riskBand;
}

function coverageStatus(
	exportPayload: StaticIntelligenceExportV1,
	unknownFileCount: number,
): "covered" | "partial" | "unknown" {
	if (exportPayload.scan.status !== "completed") return "unknown";
	if (exportPayload.scan.toolRunCount === 0) return "unknown";
	if (exportPayload.scan.artifactCount === 0 || unknownFileCount > 0) {
		return "partial";
	}
	return "covered";
}

type GraphContext = {
	nodes: Map<string, DiagnosticEvidenceNode>;
	findings: DiagnosticEvidenceNode[];
	evidenceByFindingId: Map<string, string[]>;
	artifactByFindingId: Map<string, string[]>;
	artifactBackedEvidenceRefs: string[];
	scannerByFindingId: Map<string, string[]>;
};

function buildGraphContext(
	exportPayload: StaticIntelligenceExportV1,
): GraphContext {
	const nodes = new Map(
		exportPayload.graph.nodes.map((node) => [node.id, node]),
	);
	const findings = exportPayload.graph.nodes.filter(
		(node) => node.kind === "finding" && node.sourceId,
	);
	const context: GraphContext = {
		nodes,
		findings,
		evidenceByFindingId: new Map(),
		artifactByFindingId: new Map(),
		artifactBackedEvidenceRefs: [],
		scannerByFindingId: new Map(),
	};

	for (const edge of exportPayload.graph.edges) {
		const from = nodes.get(edge.from);
		const to = nodes.get(edge.to);
		if (from?.kind !== "finding" || !from.sourceId || !to) continue;
		if (to.kind === "evidence" && to.sourceId) {
			addRef(context.evidenceByFindingId, from.sourceId, to.sourceId);
		}
		if (to.kind === "scanner" && to.label) {
			addRef(context.scannerByFindingId, from.sourceId, to.label);
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
		addUniqueRef(context.artifactBackedEvidenceRefs, evidence.sourceId);
		for (const findingId of evidenceToFindings.get(evidence.sourceId) ?? []) {
			addRef(context.artifactByFindingId, findingId, artifact.sourceId);
		}
	}

	context.artifactBackedEvidenceRefs.sort((a, b) => a.localeCompare(b));
	sortMapArrays(context.evidenceByFindingId);
	sortMapArrays(context.artifactByFindingId);
	sortMapArrays(context.scannerByFindingId);
	return context;
}

function countBySeverity(
	findings: DiagnosticEvidenceNode[],
): Record<StaticIntelligenceSeverity, number> {
	const counts: Record<StaticIntelligenceSeverity, number> = {
		info: 0,
		low: 0,
		medium: 0,
		high: 0,
		critical: 0,
		unknown: 0,
	};
	for (const finding of findings) {
		counts[normalizeSeverity(finding.severity ?? "unknown")] += 1;
	}
	return counts;
}

function countByScanner(graph: GraphContext): Record<string, number> {
	const counts = new Map<string, number>();
	for (const [findingId, scanners] of graph.scannerByFindingId.entries()) {
		if (!findingId) continue;
		for (const scanner of scanners) {
			counts.set(scanner, (counts.get(scanner) ?? 0) + 1);
		}
	}
	return Object.fromEntries(
		[...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
	);
}

function missingEvidenceFindings(
	exportPayload: StaticIntelligenceExportV1,
	graph: GraphContext,
): string[] {
	const allFindingIds = exportPayload.graph.nodes
		.filter((node) => node.kind === "finding" && node.sourceId)
		.map((node) => node.sourceId as string);
	return allFindingIds
		.filter(
			(findingId) =>
				(graph.evidenceByFindingId.get(findingId) ?? []).length === 0,
		)
		.sort((a, b) => a.localeCompare(b));
}

function weakEvidenceFindings(graph: GraphContext): string[] {
	return graph.findings
		.map((finding) => finding.sourceId as string)
		.filter((findingId) => {
			const evidenceRefs = graph.evidenceByFindingId.get(findingId) ?? [];
			if (evidenceRefs.length === 0) return false;
			return (graph.artifactByFindingId.get(findingId) ?? []).length === 0;
		})
		.sort((a, b) => a.localeCompare(b));
}

function artifactBackedEvidenceRefs(graph: GraphContext): string[] {
	return [...graph.artifactBackedEvidenceRefs];
}

function remediationOpenFocus(
	exportPayload: StaticIntelligenceExportV1,
	unknownFileCount: number,
	missingEvidenceFindingIds: string[],
	weakEvidenceFindingIds: string[],
): string[] {
	const focus: string[] = [];
	if (exportPayload.scan.reviewStatus === "missing") {
		focus.push("scan review missing");
	}
	if (exportPayload.scan.reviewStatus === "failed") {
		focus.push("scan review failed");
	}
	if (!exportPayload.handoff) {
		focus.push("improvement request missing");
	}
	if ((exportPayload.handoff?.acceptanceCriteria.length ?? 0) === 0) {
		focus.push("acceptance criteria missing");
	}
	if ((exportPayload.handoff?.verificationCommands.length ?? 0) === 0) {
		focus.push("verification commands missing");
	}
	if (
		missingEvidenceFindingIds.length > 0 ||
		weakEvidenceFindingIds.length > 0
	) {
		focus.push("weak or missing evidence");
	}
	if (unknownFileCount > 0) {
		focus.push("unknown file path");
	}
	return sortedUnique(focus);
}

function addRef(map: Map<string, string[]>, key: string, value: string): void {
	if (!key.trim() || !value.trim()) return;
	map.set(key, [...(map.get(key) ?? []), value]);
}

function addUniqueRef(values: string[], value: string): void {
	if (!value.trim() || values.includes(value)) return;
	values.push(value);
}

function sortMapArrays(map: Map<string, string[]>): void {
	for (const [key, values] of map.entries()) map.set(key, sortedUnique(values));
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}
