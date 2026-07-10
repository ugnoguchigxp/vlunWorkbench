import type {
	DiagnosticEvidenceEdge,
	DiagnosticEvidenceEdgeKind,
	DiagnosticEvidenceGraph,
	DiagnosticEvidenceNode,
	StaticIntelligenceHandoff,
} from "../../../shared/schemas/static-intelligence.schema";
import {
	extractFindingPathResult,
	groupEvidenceByFindingId,
	normalizeStaticIntelligencePath,
} from "./file-risk-index";
import type {
	StaticIntelligenceArtifactRow,
	StaticIntelligenceEvidenceRow,
	StaticIntelligenceSourceBundle,
} from "./types";
import { toProjectRelativePath } from "./path-boundary";

export function buildDiagnosticEvidenceGraph(
	bundle: StaticIntelligenceSourceBundle,
	options: { handoff?: StaticIntelligenceHandoff | null } = {},
): DiagnosticEvidenceGraph {
	const nodes = new Map<string, DiagnosticEvidenceNode>();
	const edges = new Map<string, DiagnosticEvidenceEdge>();
	const evidenceByFindingId = groupEvidenceByFindingId(bundle.evidences);
	const artifactsById = new Map(
		bundle.artifacts.map((artifact) => [artifact.id, artifact]),
	);

	addNode(nodes, {
		id: projectNodeId(bundle.project.id),
		kind: "project",
		label: bundle.project.name,
		sourceId: bundle.project.id,
	});
	addNode(nodes, {
		id: scanRunNodeId(bundle.scanRun.id),
		kind: "scan_run",
		label: bundle.scanRun.profile,
		sourceId: bundle.scanRun.id,
		metadata: {
			status: bundle.scanRun.status,
			startedAt: dateToString(bundle.scanRun.startedAt),
			completedAt: dateToString(bundle.scanRun.completedAt),
		},
	});
	addEdge(edges, {
		kind: "has_scan",
		from: projectNodeId(bundle.project.id),
		to: scanRunNodeId(bundle.scanRun.id),
		confidence: 1,
		evidenceRefs: [],
	});

	for (const toolRun of bundle.toolRuns) {
		addNode(nodes, {
			id: scannerNodeId(bundle.scanRun.id, toolRun.toolName),
			kind: "scanner",
			label: toolRun.toolName,
			sourceId: toolRun.id,
			metadata: {
				status: toolRun.status,
				toolVersion: toolRun.toolVersion,
				exitCode: toolRun.exitCode,
			},
		});
	}

	for (const artifact of bundle.artifacts) {
		addArtifactNode(nodes, artifact);
	}

	for (const finding of bundle.findings) {
		const findingEvidences = evidenceByFindingId.get(finding.id) ?? [];
		const path = extractFindingPathResult(
			finding,
			findingEvidences,
			bundle.project.repoPath,
		).path;
		const fileNode = fileNodeId(path);

		addNode(nodes, {
			id: scannerNodeId(bundle.scanRun.id, finding.sourceTool),
			kind: "scanner",
			label: finding.sourceTool,
			sourceId: finding.sourceTool,
		});
		addNode(nodes, {
			id: findingNodeId(finding.id),
			kind: "finding",
			label: finding.title,
			sourceId: finding.id,
			severity: finding.severity,
			confidence: finding.confidence,
			metadata: {
				ruleId: finding.ruleId,
				status: finding.status,
				sourceTool: finding.sourceTool,
			},
		});
		addNode(nodes, {
			id: fileNode,
			kind: "file",
			label: path,
			sourceId: path,
		});
		addEdge(edges, {
			kind: "detected_by",
			from: findingNodeId(finding.id),
			to: scannerNodeId(bundle.scanRun.id, finding.sourceTool),
			confidence: 1,
			evidenceRefs: [],
		});
		addEdge(edges, {
			kind: "located_in",
			from: findingNodeId(finding.id),
			to: fileNode,
			confidence: path === "unknown" ? 0 : 1,
			evidenceRefs: findingEvidences.map((evidence) => evidence.id),
		});

		for (const evidence of findingEvidences) {
			addNode(nodes, {
				id: evidenceNodeId(evidence.id),
				kind: "evidence",
				label: evidence.title,
				sourceId: evidence.id,
				metadata: {
					kind: evidence.kind,
					location: safeLocationMetadata(
						evidence.location,
						bundle.project.repoPath,
					),
				},
			});
			addEdge(edges, {
				kind: "evidenced_by",
				from: findingNodeId(finding.id),
				to: evidenceNodeId(evidence.id),
				confidence: 1,
				evidenceRefs: [evidence.id],
			});

			if (evidence.artifactId) {
				const artifact = artifactsById.get(evidence.artifactId);
				if (artifact) addArtifactNode(nodes, artifact);
				addEdge(edges, {
					kind: "stored_as",
					from: evidenceNodeId(evidence.id),
					to: artifactNodeId(evidence.artifactId),
					confidence: artifact ? 1 : 0.5,
					evidenceRefs: [evidence.id],
				});
			}
		}
	}

	if (bundle.latestCompletedReview) {
		const reviewNode = reviewNodeId(bundle.latestCompletedReview.id);
		addNode(nodes, {
			id: reviewNode,
			kind: "review",
			label: "Completed scan review",
			sourceId: bundle.latestCompletedReview.id,
			metadata: {
				provider: bundle.latestCompletedReview.provider,
				model: bundle.latestCompletedReview.model,
				completedAt: dateToString(bundle.latestCompletedReview.completedAt),
			},
		});
		addEdge(edges, {
			kind: "reviewed_by",
			from: scanRunNodeId(bundle.scanRun.id),
			to: reviewNode,
			confidence: 1,
			evidenceRefs: [],
		});
		for (const [index, command] of (
			options.handoff?.verificationCommands ?? []
		).entries()) {
			const verificationNode = verificationNodeId(bundle.scanRun.id, index);
			addNode(nodes, {
				id: verificationNode,
				kind: "verification",
				label: command,
				sourceId: verificationRef(index),
				metadata: {
					command,
					ordinal: index + 1,
					reviewId: bundle.latestCompletedReview.id,
				},
			});
			addEdge(edges, {
				kind: "verified_by",
				from: scanRunNodeId(bundle.scanRun.id),
				to: verificationNode,
				confidence: 1,
				evidenceRefs: [],
			});
			addEdge(edges, {
				kind: "related_to",
				from: reviewNode,
				to: verificationNode,
				confidence: 1,
				evidenceRefs: [],
			});
		}
	}

	return {
		nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
		edges: [...edges.values()]
			.map((edge) => ({
				...edge,
				evidenceRefs: sortedUnique(edge.evidenceRefs),
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function addArtifactNode(
	nodes: Map<string, DiagnosticEvidenceNode>,
	artifact: StaticIntelligenceArtifactRow,
): void {
	addNode(nodes, {
		id: artifactNodeId(artifact.id),
		kind: "artifact",
		label: `${artifact.kind} artifact`,
		sourceId: artifact.id,
		metadata: {
			kind: artifact.kind,
			format: artifact.format,
			sha256: artifact.sha256,
			sizeBytes: artifact.sizeBytes,
		},
	});
}

function addNode(
	nodes: Map<string, DiagnosticEvidenceNode>,
	node: DiagnosticEvidenceNode,
): void {
	if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(
	edges: Map<string, DiagnosticEvidenceEdge>,
	input: Omit<DiagnosticEvidenceEdge, "id">,
): void {
	const id = edgeId(input.kind, input.from, input.to);
	const existing = edges.get(id);
	if (existing) {
		edges.set(id, {
			...existing,
			confidence: Math.max(existing.confidence, input.confidence),
			evidenceRefs: sortedUnique([
				...existing.evidenceRefs,
				...input.evidenceRefs,
			]),
		});
		return;
	}
	edges.set(id, {
		id,
		...input,
		evidenceRefs: sortedUnique(input.evidenceRefs),
	});
}

function safeLocationMetadata(
	location: StaticIntelligenceEvidenceRow["location"],
	projectRoot: string,
): Record<string, unknown> | undefined {
	if (!location) return undefined;
	const candidate = normalizeStaticIntelligencePath(
		location.path ?? location.file,
	);
	const path = candidate
		? toProjectRelativePath(projectRoot, candidate).path
		: "unknown";
	const startLine =
		typeof location.startLine === "number" ? location.startLine : undefined;
	const endLine =
		typeof location.endLine === "number" ? location.endLine : undefined;
	return { path, startLine, endLine };
}

function projectNodeId(projectId: string): string {
	return `project:${projectId}`;
}

function scanRunNodeId(scanRunId: string): string {
	return `scan_run:${scanRunId}`;
}

function scannerNodeId(scanRunId: string, toolName: string): string {
	return `scanner:${scanRunId}:${toolName}`;
}

function findingNodeId(findingId: string): string {
	return `finding:${findingId}`;
}

function evidenceNodeId(evidenceId: string): string {
	return `evidence:${evidenceId}`;
}

function artifactNodeId(artifactId: string): string {
	return `artifact:${artifactId}`;
}

function fileNodeId(path: string): string {
	return `file:${path}`;
}

function reviewNodeId(reviewId: string): string {
	return `review:${reviewId}`;
}

function verificationNodeId(scanRunId: string, index: number): string {
	return `verification:${scanRunId}:${index + 1}`;
}

function verificationRef(index: number): string {
	return `verification_command:${index + 1}`;
}

function edgeId(
	kind: DiagnosticEvidenceEdgeKind,
	from: string,
	to: string,
): string {
	return `${kind}:${from}:${to}`;
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function dateToString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}
