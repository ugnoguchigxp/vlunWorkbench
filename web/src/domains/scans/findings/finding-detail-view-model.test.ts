import { describe, expect, it } from "vitest";
import type { Finding, FindingEvidence } from "../../../api/scans";
import { buildFindingDetailViewModel } from "./finding-detail-view-model";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
	id: "finding-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	sourceTool: "semgrep",
	ruleId: "rule-1",
	title: "Example finding",
	description: "Example description",
	severity: "medium",
	confidence: "static",
	status: "open",
	primaryLocation: null,
	fingerprint: "fingerprint",
	metadata: {},
	createdAt: "2026-08-24T00:00:00.000Z",
	updatedAt: "2026-08-24T00:00:00.000Z",
	...overrides,
});

const evidence = (overrides: Partial<FindingEvidence> = {}): FindingEvidence => ({
	id: "evidence-1",
	findingId: "finding-1",
	kind: "source-location",
	title: "Source location",
	artifactId: null,
	location: null,
	snippet: null,
	metadata: {},
	createdAt: "2026-08-24T00:00:00.000Z",
	...overrides,
});

describe("buildFindingDetailViewModel", () => {
	it("keeps the full relative source path and start line", () => {
		const model = buildFindingDetailViewModel({
			finding: finding({
				primaryLocation: { path: "src/auth/session.ts", startLine: 12 },
			}),
			evidence: [],
			projectRoot: "/workspace/app",
		});

		expect(model.location).toEqual({
			kind: "source",
			path: "src/auth/session.ts",
			line: 12,
		});
	});

	it("uses line when startLine is absent and safely relativizes absolute source paths", () => {
		const model = buildFindingDetailViewModel({
			finding: finding({
				primaryLocation: { path: "/workspace/app/src/main.ts", line: "7" },
			}),
			evidence: [],
			projectRoot: "/workspace/app",
		});

		expect(model.location).toEqual({
			kind: "source",
			path: "src/main.ts",
			line: 7,
		});
	});

	it("hides source paths outside the selected project and accepts file URIs inside it", () => {
		const outside = buildFindingDetailViewModel({
			finding: finding({ primaryLocation: { path: "/private/secret.txt" } }),
			evidence: [],
			projectRoot: "/workspace/app",
		});
		const fileUri = buildFindingDetailViewModel({
			finding: finding({
				primaryLocation: { uri: "file:///workspace/app/src/file.ts", startLine: 3 },
			}),
			evidence: [],
			projectRoot: "/workspace/app",
		});

		expect(outside.location).toBeNull();
		expect(fileUri.location).toEqual({
			kind: "source",
			path: "src/file.ts",
			line: 3,
		});
	});

	it("uses a ZAP URL pathname, saved method, and JSON evidence", () => {
		const model = buildFindingDetailViewModel({
			finding: finding({
				sourceTool: "zap-baseline",
				primaryLocation: { path: "https://example.test/login?token=secret#fragment" },
				metadata: { method: "post", zapConfidenceLabel: "High" },
			}),
			evidence: [
				evidence({
					kind: "tool-output",
					location: { url: "https://example.test/login?token=secret", method: "post" },
					snippet: JSON.stringify({ evidence: "Content-Security-Policy: *" }),
				}),
			],
			projectRoot: null,
		});

		expect(model.location).toEqual({ kind: "web", path: "/login", method: "POST" });
		expect(model.observation).toEqual({
			text: "Content-Security-Policy: *",
			truncated: false,
		});
		expect(model.technical.toolConfidence).toBe("High");
	});

	it("uses a DAST structured URL and a business logic relative URL", () => {
		const dast = buildFindingDetailViewModel({
			finding: finding({
				sourceTool: "dast-http",
				primaryLocation: {
					kind: "url",
					origin: "https://example.test",
					path: "/api/users?token=secret",
				},
			}),
			evidence: [],
			projectRoot: null,
		});
		const businessLogic = buildFindingDetailViewModel({
			finding: finding({
				sourceTool: "business-logic",
				primaryLocation: { path: "/checkout" },
			}),
			evidence: [],
			projectRoot: null,
		});

		expect(dast.location).toEqual({ kind: "web", path: "/api/users", method: null });
		expect(businessLogic.location).toEqual({ kind: "web", path: "/checkout", method: null });
	});

	it("does not misclassify an invalid Web scanner path as source code", () => {
		const model = buildFindingDetailViewModel({
			finding: finding({
				sourceTool: "authorization-matrix",
				primaryLocation: { path: "operation-id" },
			}),
			evidence: [],
			projectRoot: "/workspace/app",
		});

		expect(model.location).toBeNull();
	});

	it("does not invent a method and falls back to malformed JSON evidence", () => {
		const model = buildFindingDetailViewModel({
			finding: finding({
				sourceTool: "nuclei-safe",
				primaryLocation: { path: "https://example.test/health" },
			}),
			evidence: [
				evidence({ kind: "tool-output", snippet: "{not-json" }),
			],
			projectRoot: null,
		});

		expect(model.location).toEqual({ kind: "web", path: "/health", method: null });
		expect(model.observation).toEqual({ text: "{not-json", truncated: false });
	});

	it("removes the ZAP solution suffix only for ZAP findings", () => {
		const zap = buildFindingDetailViewModel({
			finding: finding({
				sourceTool: "zap-active",
				description: "CSP permits a wildcard.\n\nSolution: Restrict sources.",
			}),
			evidence: [],
			projectRoot: null,
		});
		const nonZap = buildFindingDetailViewModel({
			finding: finding({
				description: "Do not remove this.\n\nSolution: This is source text.",
			}),
			evidence: [],
			projectRoot: null,
		});

		expect(zap.description).toBe("CSP permits a wildcard.");
		expect(nonZap.description).toContain("Solution: This is source text.");
	});

	it("suppresses duplicate observations, truncates long values, and deduplicates technical values", () => {
		const longSnippet = "a".repeat(2001);
		const duplicate = buildFindingDetailViewModel({
			finding: finding({ primaryLocation: { path: "src/file.ts" } }),
			evidence: [evidence({ snippet: "Example description" })],
			projectRoot: null,
		});
		const model = buildFindingDetailViewModel({
			finding: finding({
				metadata: {
					cweId: 79,
					wascId: "15",
					risk: { cweIds: ["79", "CWE-89", null] },
				},
			}),
			evidence: [
				evidence({
					id: "evidence-2",
					kind: "tool-output",
					snippet: longSnippet,
					artifactId: "artifact-1",
					title: "Raw result",
				}),
				evidence({ artifactId: "artifact-1", title: "Duplicate artifact" }),
			],
			projectRoot: null,
		});

		expect(duplicate.observation).toBeNull();
		expect(model.observation).toMatchObject({ truncated: true });
		expect(model.observation?.text).toHaveLength(2000);
		expect(model.technical.cweIds).toEqual(["79", "CWE-89"]);
		expect(model.technical.wascIds).toEqual(["15"]);
		expect(model.technical.artifacts).toEqual([
			expect.objectContaining({ id: "artifact-1", label: "Duplicate artifact" }),
		]);
	});
});
