import { describe, expect, it } from "vitest";
import type {
	StaticIntelligenceExportV1,
	StaticIntelligenceRiskBand,
} from "../../../shared/schemas/static-intelligence.schema";
import { staticIntelligenceGuardrailMaterialResultSchema } from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import type {
	RiskCommunity,
	SecurityLandscape,
} from "../../../shared/schemas/static-intelligence-landscape.schema";
import {
	buildStaticIntelligenceGuardrailMaterial,
	renderGuardrailMaterialMarkdown,
} from "./guardrail-material";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";

const GENERATED_AT = new Date("2026-07-06T10:00:00.000Z");
const LATER_GENERATED_AT = new Date("2026-07-06T11:00:00.000Z");

describe("Static Intelligence guardrail material builder", () => {
	it("returns schema-valid empty result for a zero-finding export", () => {
		const exportPayload = makeExport({ findingCount: 0 });
		const result = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape({
				findingCount: 0,
				riskBand: "none",
				openFocus: ["improvement request missing"],
			}),
		});

		expect(() =>
			staticIntelligenceGuardrailMaterialResultSchema.parse(result),
		).not.toThrow();
		expect(result.materials).toEqual([]);
		expect(result.sourceManifest.sourceId).toBe(
			`vulnWorkbench.static_intelligence:${exportPayload.scan.id}`,
		);
		expect(result.sourceManifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("generates security material from high severity file risk", () => {
		const exportPayload = makeFindingExport();
		const result = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape(),
		});
		const material = result.materials.find(
			(item) => item.type === "security_guardrail_material",
		);

		expect(material).toBeDefined();
		expect(material?.candidateOnly).toBe(true);
		expect(material?.refs).toMatchObject({
			findingIds: ["finding-1"],
			evidenceRefs: ["evidence-1"],
			artifactRefs: ["artifact-1"],
			fileRefs: ["src/app.ts"],
			ruleIds: ["typescript.express.xss"],
			scanners: ["semgrep"],
		});
		expect(material?.source.sourceRefs).toContain(
			`manifest:${result.sourceManifest.sourceId}`,
		);
		expect(material?.metadata.materialHash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(material)).not.toContain("/Users/y.noguchi/project");
	});

	it("hashes unsafe file-risk source refs instead of leaking absolute paths", () => {
		const result = buildMaterial(
			makeFindingExport({
				fileRiskIndex: [
					{
						path: "/Users/alice/private-project/src/app.ts",
						findingCount: 1,
						maxSeverity: "high",
						evidenceQuality: "strong",
						scanners: ["semgrep"],
						ruleIds: ["typescript.express.xss"],
						findingIds: ["finding-1"],
						evidenceRefs: ["evidence-1"],
						artifactRefs: ["artifact-1"],
						verificationRefs: [],
						latestScanRunId: "scan-1",
					},
				],
			}),
			{
				communities: [],
				landscape: makeLandscape(),
			},
		);
		const material = result.materials.find(
			(item) => item.type === "security_guardrail_material",
		);
		const serialized = JSON.stringify(material);

		expect(material?.source.sourceRefs).toContainEqual(
			expect.stringMatching(/^file_risk:redacted:[a-f0-9]{16}$/),
		);
		expect(serialized).not.toContain("/Users/alice");
	});

	it("keeps material ids stable when only generatedAt changes", () => {
		const exportPayload = makeFindingExport();
		const first = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape(),
			generatedAt: GENERATED_AT,
		});
		const second = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape(),
			generatedAt: LATER_GENERATED_AT,
		});

		expect(first.generatedAt).not.toBe(second.generatedAt);
		expect(first.materials.map((material) => material.id)).toEqual(
			second.materials.map((material) => material.id),
		);
	});

	it("generates procedure-shaped verification material without finding refs", () => {
		const exportPayload = makeFindingExport({
			handoff: {
				title: "Fix XSS",
				objective: "Escape output.",
				acceptanceCriteria: ["Injected HTML is escaped."],
				verificationCommands: ["bun test"],
				constraints: [],
				nonGoals: [],
			},
		});
		const result = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape({
				openFocus: [],
				acceptanceCriteriaCount: 1,
				verificationCommandCount: 1,
			}),
		});
		const material = result.materials.find(
			(item) => item.type === "verification_recipe_material",
		);

		expect(material?.suggestedDistillation.contextStillType).toBe("procedure");
		expect(material?.suggestedDistillation.polarity).toBe("positive");
		expect(material?.refs.findingIds).toEqual([]);
		expect(material?.source.sourceRefs).toContain("verification_command:1");
		expect(
			material?.suggestedDistillation.procedureSections?.workflow.join("\n"),
		).toContain("bun test");
		expect(
			material?.suggestedDistillation.procedureSections?.avoid.join("\n"),
		).toContain("Do not claim verification commands passed unless they were executed.");
	});

	it("redacts unsafe handoff text and preserves original verification command ordinals", () => {
		const result = buildMaterial(
			makeFindingExport({
				handoff: {
					title: "Fix XSS",
					objective: "Escape output.",
					acceptanceCriteria: [
						"Check /home/alice/private-project manually.",
						"Snippet: RAW_SNIPPET_SHOULD_NOT_LEAK",
					],
					verificationCommands: [
						"echo RAW_ARTIFACT_BODY_SHOULD_NOT_LEAK",
						"cat /Users/alice/private-project/report.txt",
					],
					constraints: [],
					nonGoals: [],
				},
			}),
			{
				communities: [],
				landscape: makeLandscape({
					openFocus: [],
					acceptanceCriteriaCount: 2,
					verificationCommandCount: 2,
				}),
			},
		);
		const material = result.materials.find(
			(item) => item.type === "verification_recipe_material",
		);
		const serialized = JSON.stringify(material);

		expect(material?.source.sourceRefs).toContain("verification_command:2");
		expect(material?.source.sourceRefs).not.toContain("verification_command:1");
		expect(serialized).toContain("<redacted-path>");
		expect(serialized).not.toContain("/Users/alice");
		expect(serialized).not.toContain("/home/alice");
		expect(serialized).not.toContain("RAW_ARTIFACT_BODY_SHOULD_NOT_LEAK");
		expect(serialized).not.toContain("RAW_SNIPPET_SHOULD_NOT_LEAK");
	});

	it("does not emit a verification recipe when handoff is missing", () => {
		const result = buildMaterial(makeFindingExport(), {
			communities: [],
			landscape: makeLandscape(),
		});

		expect(
			result.materials.some(
				(material) => material.type === "verification_recipe_material",
			),
		).toBe(false);
	});

	it("generates actionability material for weak evidence and missing handoff", () => {
		const result = buildMaterial(
			makeFindingExport({
				evidenceQuality: "weak",
				scanDegradedReasons: [
					"completed scan review missing",
					"completed scan review missing",
				],
			}),
			{
				communities: [],
				landscape: makeLandscape({
					evidenceQuality: "weak",
					missingEvidenceFindingIds: ["finding-2"],
					weakEvidenceFindingIds: ["finding-1"],
					openFocus: ["weak or missing evidence", "improvement request missing"],
				}),
			},
		);
		const material = result.materials.find(
			(item) => item.type === "agent_actionability_lesson_material",
		);

		expect(material?.suggestedDistillation.contextStillType).toBe("procedure");
		expect(material?.refs.findingIds).toEqual(["finding-1", "finding-2"]);
		expect(material?.metadata.degradedReasons).toEqual([
			"completed scan review missing",
			"improvement request missing",
			"weak or missing evidence",
		]);
	});

	it("does not generate actionability material for a complete handoff with no open focus", () => {
		const result = buildMaterial(
			makeFindingExport({
				handoff: {
					title: "Fix XSS",
					objective: "Escape output.",
					acceptanceCriteria: ["Injected HTML is escaped."],
					verificationCommands: ["bun test"],
					constraints: [],
					nonGoals: [],
				},
			}),
			{
				communities: [],
				landscape: makeLandscape({
					openFocus: [],
					acceptanceCriteriaCount: 1,
					verificationCommandCount: 1,
				}),
			},
		);

		expect(
			result.materials.some(
				(material) => material.type === "agent_actionability_lesson_material",
			),
		).toBe(false);
	});

	it("generates scanner tuning material for repeated weak scanner communities", () => {
		const community = makeCommunity({
			basis: ["same_scanner_rule"],
			evidenceQuality: "weak",
			findingIds: ["finding-1", "finding-2"],
			evidenceRefs: ["evidence-1"],
			artifactRefs: [],
			fileRefs: ["src/app.ts", "src/admin.ts"],
		});
		const result = buildMaterial(makeFindingExport(), {
			communities: [community],
			landscape: makeLandscape(),
		});
		const material = result.materials.find(
			(item) => item.type === "scanner_tuning_lesson_material",
		);

		expect(material?.suggestedDistillation.polarity).toBe("neutral");
		const serialized = JSON.stringify(material).toLowerCase();
		expect(serialized).not.toContain("allowlist");
		expect(serialized).not.toContain("suppress");
	});

	it("does not fabricate false-positive material from generic review text", () => {
		const result = buildMaterial(
			makeFindingExport({
				handoff: {
					title: "Review possible false positive",
					objective: "Check whether this might be a false positive.",
					acceptanceCriteria: ["Review is documented."],
					verificationCommands: [],
					constraints: [],
					nonGoals: [],
				},
			}),
			{
				communities: [],
				landscape: makeLandscape(),
			},
		);

		expect(
			result.materials.some(
				(material) => material.type === "false_positive_lesson_material",
			),
		).toBe(false);
	});

	it("includes markdown only when requested", () => {
		const exportPayload = makeFindingExport();
		const withoutMarkdown = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape(),
		});
		const withMarkdown = buildMaterial(exportPayload, {
			communities: [],
			landscape: makeLandscape(),
			includeMarkdown: true,
		});

		expect(withoutMarkdown.markdown).toBeUndefined();
		expect(withMarkdown.markdown).toContain(
			"# Static Intelligence Guardrail Material",
		);
		expect(renderGuardrailMaterialMarkdown(withMarkdown)).not.toContain(
			"RAW_ARTIFACT_BODY",
		);
		expect(withMarkdown.markdown).not.toContain("/Users/y.noguchi/project");
	});

	it("filters materials by type", () => {
		const result = buildMaterial(
			makeFindingExport({
				handoff: {
					title: "Fix XSS",
					objective: "Escape output.",
					acceptanceCriteria: ["Injected HTML is escaped."],
					verificationCommands: ["bun test"],
					constraints: [],
					nonGoals: [],
				},
			}),
			{
				communities: [],
				landscape: makeLandscape({
					openFocus: [],
					acceptanceCriteriaCount: 1,
					verificationCommandCount: 1,
				}),
				type: "verification_recipe_material",
			},
		);

		expect(result.filters.type).toBe("verification_recipe_material");
		expect(result.materials.length).toBeGreaterThan(0);
		expect(
			result.materials.every(
				(material) => material.type === "verification_recipe_material",
			),
		).toBe(true);
	});
});

function buildMaterial(
	exportPayload: StaticIntelligenceExportV1,
	options: {
		communities: RiskCommunity[];
		landscape: SecurityLandscape;
		type?: Parameters<typeof buildStaticIntelligenceGuardrailMaterial>[0]["type"];
		includeMarkdown?: boolean;
		generatedAt?: Date;
	},
) {
	return buildStaticIntelligenceGuardrailMaterial({
		exportPayload,
		sourceManifest: buildStaticIntelligenceKnowledgeSourceManifest(
			exportPayload,
			{ generatedAt: GENERATED_AT },
		),
		communities: options.communities,
		landscape: options.landscape,
		type: options.type,
		includeMarkdown: options.includeMarkdown,
		generatedAt: options.generatedAt ?? GENERATED_AT,
	});
}

function makeFindingExport(
	overrides: Partial<StaticIntelligenceExportV1> & {
		evidenceQuality?: StaticIntelligenceExportV1["scanSummary"]["evidenceQuality"];
		scanDegradedReasons?: string[];
	} = {},
): StaticIntelligenceExportV1 {
	return makeExport({
		findingCount: 1,
		riskBand: "high",
		evidenceQuality: overrides.evidenceQuality ?? "strong",
		scanDegradedReasons: overrides.scanDegradedReasons ?? [],
		handoff: overrides.handoff,
		fileRiskIndex: overrides.fileRiskIndex ?? [
			{
				path: "src/app.ts",
				findingCount: 1,
				maxSeverity: "high",
				evidenceQuality: overrides.evidenceQuality ?? "strong",
				scanners: ["semgrep"],
				ruleIds: ["typescript.express.xss"],
				findingIds: ["finding-1"],
				evidenceRefs: ["evidence-1"],
				artifactRefs: ["artifact-1"],
				verificationRefs: [],
				latestScanRunId: "scan-1",
			},
		],
		graph: {
			nodes: [
				{ id: "project:project-1", kind: "project", label: "Project" },
				{ id: "scan:scan-1", kind: "scan_run", label: "Scan" },
				{
					id: "finding:finding-1",
					kind: "finding",
					label: "Reflected XSS",
					sourceId: "finding-1",
					severity: "high",
					metadata: {
						sourceTool: "semgrep",
						ruleId: "typescript.express.xss",
					},
				},
				{
					id: "evidence:evidence-1",
					kind: "evidence",
					label: "Source location",
					sourceId: "evidence-1",
				},
				{
					id: "artifact:artifact-1",
					kind: "artifact",
					label: "artifacts/semgrep.json",
					sourceId: "artifact-1",
				},
				{
					id: "file:src/app.ts",
					kind: "file",
					label: "src/app.ts",
					sourceId: "src/app.ts",
				},
			],
			edges: [],
		},
	});
}

function makeExport(
	options: Partial<StaticIntelligenceExportV1> & {
		findingCount?: number;
		riskBand?: StaticIntelligenceRiskBand;
		evidenceQuality?: StaticIntelligenceExportV1["scanSummary"]["evidenceQuality"];
		scanDegradedReasons?: string[];
	} = {},
): StaticIntelligenceExportV1 {
	const findingCount = options.findingCount ?? 0;
	return {
		version: "v1",
		generatedAt: GENERATED_AT.toISOString(),
		project: {
			id: "project-1",
			name: "Project",
			rootPath: "/Users/y.noguchi/project",
		},
		scan: {
			id: "scan-1",
			profile: "baseline",
			status: "completed",
			startedAt: GENERATED_AT.toISOString(),
			completedAt: GENERATED_AT.toISOString(),
			findingCount,
			toolRunCount: findingCount > 0 ? 1 : 0,
			artifactCount: findingCount > 0 ? 1 : 0,
			reviewStatus: options.handoff ? "completed" : "missing",
		},
		scanSummary: {
			riskBand: options.riskBand ?? (findingCount > 0 ? "high" : "none"),
			evidenceQuality:
				options.evidenceQuality ?? (findingCount > 0 ? "strong" : "none"),
			degradedReasons: options.scanDegradedReasons ?? [],
		},
		fileRiskIndex: options.fileRiskIndex ?? [],
		graph: options.graph ?? {
			nodes: [
				{ id: "project:project-1", kind: "project", label: "Project" },
				{ id: "scan:scan-1", kind: "scan_run", label: "Scan" },
			],
			edges: [],
		},
		...(options.handoff ? { handoff: options.handoff } : {}),
	};
}

function makeLandscape(
	options: {
		findingCount?: number;
		riskBand?: StaticIntelligenceRiskBand;
		evidenceQuality?: SecurityLandscape["evidence"]["quality"];
		missingEvidenceFindingIds?: string[];
		weakEvidenceFindingIds?: string[];
		openFocus?: string[];
		acceptanceCriteriaCount?: number;
		verificationCommandCount?: number;
	} = {},
): SecurityLandscape {
	const findingCount = options.findingCount ?? 1;
	return {
		risk: {
			band: options.riskBand ?? "high",
			findingCount,
			bySeverity: {},
			byScanner: {},
			byFile: [],
		},
		coverage: {
			status: "covered",
			scannedToolCount: findingCount > 0 ? 1 : 0,
			artifactCount: findingCount > 0 ? 1 : 0,
			unknownFileCount: 0,
			degradedReasons: [],
		},
		evidence: {
			quality: options.evidenceQuality ?? "strong",
			missingEvidenceFindingIds: options.missingEvidenceFindingIds ?? [],
			weakEvidenceFindingIds: options.weakEvidenceFindingIds ?? [],
			artifactBackedEvidenceRefs: ["evidence-1"],
		},
		remediation: {
			reviewStatus:
				(options.acceptanceCriteriaCount ?? 0) > 0 ||
				(options.verificationCommandCount ?? 0) > 0
					? "completed"
					: "missing",
			hasImprovementRequest:
				(options.acceptanceCriteriaCount ?? 0) > 0 ||
				(options.verificationCommandCount ?? 0) > 0,
			acceptanceCriteriaCount: options.acceptanceCriteriaCount ?? 0,
			verificationCommandCount: options.verificationCommandCount ?? 0,
			openFocus: options.openFocus ?? ["improvement request missing"],
		},
	};
}

function makeCommunity(
	overrides: Partial<RiskCommunity> = {},
): RiskCommunity {
	return {
		id: "community-1",
		title: "semgrep / xss cluster",
		basis: ["same_scanner_rule"],
		confidence: "high",
		candidateOnly: true,
		summary: "Repeated scanner rule.",
		suggestedReviewFocus: [],
		findingIds: ["finding-1", "finding-2"],
		evidenceRefs: ["evidence-1"],
		artifactRefs: ["artifact-1"],
		fileRefs: ["src/app.ts"],
		scannerRefs: ["semgrep"],
		ruleIds: ["typescript.express.xss"],
		maxSeverity: "high",
		evidenceQuality: "strong",
		degradedReasons: [],
		...overrides,
	};
}
