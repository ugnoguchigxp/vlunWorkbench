import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceSemanticQueryResult,
	StaticIntelligenceSemanticQueryResultItem,
} from "../../../shared/schemas/static-intelligence-search.schema";
import { buildSemanticCommunityCandidates } from "./semantic-community-integration";

describe("Static Intelligence semantic community integration", () => {
	it("builds a query cluster from multiple semantic items", () => {
		const exportPayload = exportFixture(["finding-a", "finding-b"]);
		const result = buildSemanticCommunityCandidates({
			exportPayload,
			semantic: semanticFixture([
				semanticItem({
					id: "item-a",
					relatedFindingIds: ["finding-a"],
					evidenceRefs: ["evidence-a"],
					artifactRefs: ["artifact-a"],
					filePath: "src/auth.ts",
				}),
				semanticItem({
					id: "item-b",
					relatedFindingIds: ["finding-b"],
					evidenceRefs: ["evidence-b"],
					artifactRefs: ["artifact-b"],
					filePath: "src/session.ts",
				}),
			]),
		});

		expect(result.semanticCandidates).toHaveLength(1);
		expect(result.semanticCandidates[0]).toMatchObject({
			findingIds: ["finding-a", "finding-b"],
			evidenceRefs: ["evidence-a", "evidence-b"],
			artifactRefs: ["artifact-a", "artifact-b"],
			fileRefs: ["src/auth.ts", "src/finding-b.ts", "src/session.ts"],
		});
		expect(result.semanticCandidates[0]?.stableKey).toMatch(
			/^semantic-query:[a-f0-9]{64}$/,
		);
	});

	it("builds a source cluster from one semantic item with multiple findings", () => {
		const exportPayload = exportFixture(["finding-a", "finding-b"]);
		const result = buildSemanticCommunityCandidates({
			exportPayload,
			semantic: semanticFixture([
				semanticItem({
					id: "source-risk",
					relatedFindingIds: ["finding-a", "finding-b"],
					filePath: "src/auth.ts",
				}),
			]),
		});

		expect(result.semanticCandidates).toEqual([
			expect.objectContaining({
				stableKey: "semantic-source:source-risk",
				findingIds: ["finding-a", "finding-b"],
			}),
		]);
	});

	it("filters low vector score items and reports degraded threshold status", () => {
		const result = buildSemanticCommunityCandidates({
			exportPayload: exportFixture(["finding-a", "finding-b"]),
			semantic: semanticFixture([
				semanticItem({
					id: "low-score",
					relatedFindingIds: ["finding-a", "finding-b"],
					vectorScore: 0.64,
				}),
			]),
		});

		expect(result.semanticCandidates).toEqual([]);
		expect(result.degradedReasons).toContain(
			"semantic community candidates did not meet confidence threshold",
		);
	});

	it("caps eligible semantic items after threshold filtering", () => {
		const result = buildSemanticCommunityCandidates({
			exportPayload: exportFixture(["finding-a", "finding-b", "finding-c"]),
			semantic: semanticFixture([
				semanticItem({
					id: "low-score",
					relatedFindingIds: ["finding-a"],
					vectorScore: 0.1,
				}),
				semanticItem({
					id: "eligible-a",
					relatedFindingIds: ["finding-a"],
				}),
				semanticItem({
					id: "eligible-b",
					relatedFindingIds: ["finding-b"],
				}),
				semanticItem({
					id: "eligible-c",
					relatedFindingIds: ["finding-c"],
				}),
			]),
			options: { maxSemanticItems: 2 },
		});

		expect(result.semanticCandidates).toEqual([
			expect.objectContaining({
				findingIds: ["finding-a", "finding-b"],
			}),
		]);
		expect(result.semanticFindingIds).toEqual(["finding-a", "finding-b"]);
	});

	it("drops unknown finding refs before candidate construction", () => {
		const result = buildSemanticCommunityCandidates({
			exportPayload: exportFixture(["finding-a"]),
			semantic: semanticFixture([
				semanticItem({
					id: "unknown-ref",
					relatedFindingIds: ["finding-a", "missing-finding"],
				}),
			]),
		});

		expect(result.semanticCandidates).toEqual([]);
		expect(result.degradedReasons).toContain(
			"semantic community candidate referenced unknown finding",
		);
		expect(result.semanticFindingIds).toEqual([]);
	});

	it("returns deterministic sorted and de-duplicated candidates", () => {
		const exportPayload = exportFixture(["finding-a", "finding-b", "finding-c"]);
		const semantic = semanticFixture([
			semanticItem({
				id: "z-source",
				relatedFindingIds: ["finding-b", "finding-a"],
			}),
			semanticItem({
				id: "a-single",
				relatedFindingIds: ["finding-c"],
			}),
		]);

		const first = buildSemanticCommunityCandidates({ exportPayload, semantic });
		const second = buildSemanticCommunityCandidates({ exportPayload, semantic });

		expect(first).toEqual(second);
		expect(first.semanticCandidates.map((candidate) => candidate.findingIds)).toEqual([
			["finding-a", "finding-b", "finding-c"],
			["finding-a", "finding-b"],
		]);
	});

	it("does not copy raw semantic metadata into candidates", () => {
		const result = buildSemanticCommunityCandidates({
			exportPayload: exportFixture(["finding-a", "finding-b"]),
			semantic: semanticFixture([
				semanticItem({
					id: "raw-source",
					relatedFindingIds: ["finding-a", "finding-b"],
					metadata: {
						snippet: "SECRET_SNIPPET_SHOULD_NOT_LEAK",
						rawContent: "SECRET_ARTIFACT_SHOULD_NOT_LEAK",
						content: "SECRET_CONTENT_SHOULD_NOT_LEAK",
					},
				}),
			]),
		});

		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("SECRET_SNIPPET_SHOULD_NOT_LEAK");
		expect(serialized).not.toContain("SECRET_ARTIFACT_SHOULD_NOT_LEAK");
		expect(serialized).not.toContain("SECRET_CONTENT_SHOULD_NOT_LEAK");
	});
});

function exportFixture(findingIds: string[]): StaticIntelligenceExportV1 {
	return {
		version: "v1",
		generatedAt: "2026-07-05T12:30:00.000Z",
		project: {
			id: "project-1",
			name: "Semantic Community Fixture",
			rootPath: "/workspace/fixture",
		},
		scan: {
			id: "scan-1",
			profile: "baseline",
			status: "completed",
			startedAt: "2026-07-05T12:00:00.000Z",
			completedAt: "2026-07-05T12:01:00.000Z",
			findingCount: findingIds.length,
			toolRunCount: 1,
			artifactCount: 1,
			reviewStatus: "missing",
		},
		scanSummary: {
			riskBand: "medium",
			evidenceQuality: "mixed",
			degradedReasons: [],
		},
		fileRiskIndex: findingIds.map((findingId, index) => ({
			path: index === 0 ? "src/auth.ts" : `src/${findingId}.ts`,
			findingCount: 1,
			maxSeverity: "medium",
			evidenceQuality: "mixed",
			scanners: ["semgrep"],
			ruleIds: [`rule-${index + 1}`],
			findingIds: [findingId],
			evidenceRefs: [`evidence-${index + 1}`],
			artifactRefs: [`artifact-${index + 1}`],
			verificationRefs: [],
			latestScanRunId: "scan-1",
		})),
		graph: {
			nodes: findingIds.map((findingId) => ({
				id: `node:${findingId}`,
				kind: "finding",
				label: findingId,
				sourceId: findingId,
				severity: "medium",
				confidence: "static",
				metadata: { sourceTool: "semgrep" },
			})),
			edges: [],
		},
	};
}

function semanticFixture(
	results: StaticIntelligenceSemanticQueryResultItem[],
): StaticIntelligenceSemanticQueryResult {
	return {
		ok: true,
		status: "completed",
		scanRunId: "scan-1",
		query: "auth validation risk",
		topK: 10,
		results,
		degradedReasons: [],
	};
}

function semanticItem(
	overrides: Partial<StaticIntelligenceSemanticQueryResultItem> & {
		id: string;
		relatedFindingIds: string[];
	},
): StaticIntelligenceSemanticQueryResultItem {
	return {
		id: overrides.id,
		sourceKind: "finding",
		sourceId: overrides.id,
		sourceRef: `finding:${overrides.id}`,
		title: overrides.id,
		score: 0.9,
		vectorScore: overrides.vectorScore ?? 0.9,
		exactScore: 0,
		candidateOnly: true,
		relatedFindingIds: overrides.relatedFindingIds,
		evidenceRefs: overrides.evidenceRefs ?? [],
		artifactRefs: overrides.artifactRefs ?? [],
		...(overrides.filePath ? { filePath: overrides.filePath } : {}),
		metadata: overrides.metadata ?? { candidateOnly: true },
	};
}
