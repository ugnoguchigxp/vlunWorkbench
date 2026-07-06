import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import { staticIntelligenceKnowledgeSourceManifestSchema } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import {
	buildStaticIntelligenceKnowledgeSourceManifest,
	canonicalJson,
	sha256Hex,
} from "./knowledge-source-manifest";

const GENERATED_AT = new Date("2026-07-05T12:30:00.000Z");
const LATER_GENERATED_AT = new Date("2026-07-05T12:45:00.000Z");

describe("Static Intelligence knowledge source manifest", () => {
	it("canonicalizes object keys recursively", () => {
		const first = canonicalJson({
			b: 2,
			a: { z: true, y: "value" },
		});
		const second = canonicalJson({
			a: { y: "value", z: true },
			b: 2,
		});

		expect(first).toBe(second);
		expect(first).toBe('{"a":{"y":"value","z":true},"b":2}');
	});

	it("preserves array order", () => {
		expect(canonicalJson({ values: [3, 1, 2] })).toBe(
			'{"values":[3,1,2]}',
		);
	});

	it("omits undefined object fields", () => {
		expect(canonicalJson({ a: 1, b: undefined, c: null })).toBe(
			'{"a":1,"c":null}',
		);
	});

	it("throws for unsupported values", () => {
		expect(() => canonicalJson({ createdAt: new Date() })).toThrow(
			"Unsupported non-plain object value.",
		);
		expect(() => canonicalJson({ value: Number.NaN })).toThrow(
			"Unsupported non-finite number.",
		);
		expect(() => canonicalJson({ value: BigInt(1) })).toThrow(
			"Unsupported value type: bigint.",
		);
		expect(() => canonicalJson([undefined])).toThrow(
			"Unsupported undefined value outside object fields.",
		);
	});

	it("hashes strings with SHA-256 hex", () => {
		expect(sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("builds manifest from export payload", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);

		expect(() =>
			staticIntelligenceKnowledgeSourceManifestSchema.parse(manifest),
		).not.toThrow();
		expect(manifest).toMatchObject({
			version: "v1",
			generatedAt: GENERATED_AT.toISOString(),
			source: {
				kind: "vulnWorkbench.static_intelligence",
				sourceId: "vulnWorkbench.static_intelligence:scan-1",
				projectId: "project-1",
				scanRunId: "scan-1",
				schemaVersion: "static-intelligence-export-v1",
			},
			project: {
				id: "project-1",
				name: "Target Project",
			},
			scan: {
				id: "scan-1",
				profile: "baseline",
				status: "completed",
				findingCount: 1,
				reviewStatus: "completed",
			},
			risk: {
				band: "high",
				evidenceQuality: "strong",
				degradedReasons: ["alpha", "zeta"],
			},
			redaction: {
				status: "redacted",
				rawArtifactBodyIncluded: false,
				rawEvidenceSnippetIncluded: false,
				rawSecretIncluded: false,
			},
		});
		expect(manifest.source.exportHash).toMatch(/^[a-f0-9]{64}$/);
		expect(manifest.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("does not include project root path", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);

		expect(JSON.stringify(manifest)).not.toContain("/Users/example/private-repo");
	});

	it("keeps contentHash stable when generatedAt changes", () => {
		const exportPayload = buildExportPayload();
		const first = buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, {
			generatedAt: GENERATED_AT,
		});
		const second = buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, {
			generatedAt: LATER_GENERATED_AT,
		});

		expect(first.generatedAt).not.toBe(second.generatedAt);
		expect(first.source.contentHash).toBe(second.source.contentHash);
	});

	it("changes exportHash when export payload changes", () => {
		const first = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);
		const second = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload({ findingCount: 2 }),
			{ generatedAt: GENERATED_AT },
		);

		expect(first.source.exportHash).not.toBe(second.source.exportHash);
	});

	it("keeps exportHash stable when only export generatedAt changes", () => {
		const first = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload({
				exportGeneratedAt: "2026-07-05T12:00:00.000Z",
			}),
			{ generatedAt: GENERATED_AT },
		);
		const second = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload({
				exportGeneratedAt: "2026-07-05T12:15:00.000Z",
			}),
			{ generatedAt: GENERATED_AT },
		);

		expect(first.source.exportHash).toBe(second.source.exportHash);
		expect(first.source.contentHash).toBe(second.source.contentHash);
	});

	it("changes contentHash when risk summary changes", () => {
		const first = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);
		const second = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload({ riskBand: "critical" }),
			{ generatedAt: GENERATED_AT },
		);

		expect(first.source.contentHash).not.toBe(second.source.contentHash);
	});

	it("deduplicates and sorts degraded reasons", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload({
				degradedReasons: ["zeta", "alpha", "zeta", "beta"],
			}),
			{ generatedAt: GENERATED_AT },
		);

		expect(manifest.risk.degradedReasons).toEqual(["alpha", "beta", "zeta"]);
	});

	it("includes expected available bundle commands", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);

		expect(manifest.availableBundles.map((bundle) => bundle.kind)).toEqual([
			"static_intelligence_export",
			"code_structure_snapshot",
			"agent_query",
			"evidence_bundle",
			"verification_commands",
			"guardrail_material",
		]);
		expect(manifest.availableBundles[0].command).toEqual([
			"bun",
			"run",
			"intelligence:export",
			"--",
			"--scan-run-id",
			"scan-1",
		]);
		expect(manifest.availableBundles[1]).toMatchObject({
			kind: "code_structure_snapshot",
			command: [
				"bun",
				"run",
				"intelligence:code-structure",
				"--",
				"--project-path",
				"<project-path>",
			],
			requires: { projectPath: true },
		});
		expect(JSON.stringify(manifest.availableBundles[1])).not.toContain(
			"/Users/example/private-repo",
		);
		expect(manifest.availableBundles[3]).toMatchObject({
			kind: "evidence_bundle",
			requires: { findingId: true },
		});
		expect(manifest.availableBundles[5].command).toEqual([
			"bun",
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			"scan-1",
		]);
	});

	it("does not copy raw marker strings into serialized manifest", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload({
				rawMarker: "SECRET_RAW_SNIPPET_SHOULD_NOT_LEAK",
			}),
			{ generatedAt: GENERATED_AT },
		);
		const serialized = JSON.stringify(manifest);

		expect(serialized).not.toContain("SECRET_RAW_SNIPPET_SHOULD_NOT_LEAK");
		expect(serialized).not.toContain("PRIVATE_TOKEN_SHOULD_NOT_LEAK");
	});

	it("rejects malformed hash fields", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);

		expect(() =>
			staticIntelligenceKnowledgeSourceManifestSchema.parse({
				...manifest,
				source: {
					...manifest.source,
					contentHash: "not-a-sha256",
				},
			}),
		).toThrow();
	});

	it("rejects unknown fields instead of silently stripping leaked data", () => {
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			buildExportPayload(),
			{ generatedAt: GENERATED_AT },
		);

		expect(() =>
			staticIntelligenceKnowledgeSourceManifestSchema.parse({
				...manifest,
				project: {
					...manifest.project,
					rootPath: "/Users/example/private-repo",
				},
			}),
		).toThrow();
	});
});

function buildExportPayload(
	options: {
		findingCount?: number;
		riskBand?: StaticIntelligenceExportV1["scanSummary"]["riskBand"];
		degradedReasons?: string[];
		exportGeneratedAt?: string;
		rawMarker?: string;
	} = {},
): StaticIntelligenceExportV1 {
	const rawMarker = options.rawMarker ?? "RAW_BODY_SHOULD_NOT_LEAK";
	return {
		version: "v1",
		generatedAt: options.exportGeneratedAt ?? "2026-07-05T12:00:00.000Z",
		project: {
			id: "project-1",
			name: "Target Project",
			rootPath: "/Users/example/private-repo",
		},
		scan: {
			id: "scan-1",
			profile: "baseline",
			status: "completed",
			startedAt: "2026-07-05T11:50:00.000Z",
			completedAt: "2026-07-05T12:00:00.000Z",
			findingCount: options.findingCount ?? 1,
			toolRunCount: 1,
			artifactCount: 1,
			reviewStatus: "completed",
		},
		scanSummary: {
			riskBand: options.riskBand ?? "high",
			evidenceQuality: "strong",
			degradedReasons: options.degradedReasons ?? ["zeta", "alpha", "zeta"],
		},
		fileRiskIndex: [
			{
				path: "src/app.ts",
				findingCount: 1,
				maxSeverity: "high",
				evidenceQuality: "strong",
				scanners: ["semgrep"],
				ruleIds: ["typescript.express.xss"],
				findingIds: ["finding-1"],
				evidenceRefs: ["evidence-1"],
				artifactRefs: ["artifact-1"],
				verificationRefs: ["verification_command:1"],
				latestScanRunId: "scan-1",
				latestSeenAt: "2026-07-05T12:00:00.000Z",
			},
		],
		graph: {
			nodes: [
				{
					id: "finding:finding-1",
					kind: "finding",
					label: "Reflected XSS",
					sourceId: "finding-1",
					severity: "high",
					metadata: {
						rawSnippet: rawMarker,
						token: "PRIVATE_TOKEN_SHOULD_NOT_LEAK",
					},
				},
			],
			edges: [],
		},
		handoff: {
			title: rawMarker,
			objective: "Escape user-controlled output before rendering.",
			acceptanceCriteria: ["Injected HTML is escaped."],
			verificationCommands: ["bun test"],
			constraints: ["Do not add a new scanner."],
			nonGoals: ["Do not redesign the app."],
		},
	};
}
