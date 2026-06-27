import { describe, expect, it } from "vitest";
import type { Finding } from "../../api";
import { buildScanComparison } from "./scan-comparison";

const now = "2026-06-27T00:00:00.000Z";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
	id: overrides.id ?? "finding-1",
	scanRunId: overrides.scanRunId ?? "scan-1",
	projectId: "project-1",
	sourceTool: "semgrep",
	ruleId: "rule.xss",
	title: "XSS",
	description: "risk",
	severity: "high",
	confidence: "static",
	status: "open",
	primaryLocation: { path: "src/app.ts" },
	fingerprint: "fp-1",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

describe("buildScanComparison", () => {
	it("missing baseline returns missing_baseline", () => {
		expect(
			buildScanComparison({
				currentScanRunId: "scan-2",
				currentFindings: [finding()],
			}).status,
		).toBe("missing_baseline");
	});

	it("matching stable metadata returns unchanged with stable confidence", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [
				finding({
					id: "current",
					scanRunId: "scan-2",
					metadata: { stableId: "stable-1" },
					fingerprint: "current-fp",
				}),
			],
			baselineFindings: [
				finding({
					id: "base",
					scanRunId: "scan-1",
					metadata: { stableId: "stable-1" },
					fingerprint: "base-fp",
				}),
			],
		});
		expect(result.counts.unchanged).toBe(1);
		expect(result.deltas[0]?.matchConfidence).toBe("stable");
	});

	it("matching fingerprint returns unchanged with fingerprint confidence", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [finding({ id: "current", scanRunId: "scan-2" })],
			baselineFindings: [finding({ id: "base", scanRunId: "scan-1" })],
		});
		expect(result.counts.unchanged).toBe(1);
		expect(result.deltas[0]?.matchConfidence).toBe("fingerprint");
	});

	it("matches metadata fingerprint when the top-level fingerprint is empty", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [
				finding({
					id: "current",
					scanRunId: "scan-2",
					fingerprint: "",
					metadata: { fingerprint: "metadata-fp" },
				}),
			],
			baselineFindings: [
				finding({
					id: "base",
					scanRunId: "scan-1",
					fingerprint: "",
					metadata: { fingerprint: "metadata-fp" },
				}),
			],
		});
		expect(result.counts.unchanged).toBe(1);
		expect(result.deltas[0]?.matchConfidence).toBe("fingerprint");
	});

	it("matching rule/location returns unchanged with heuristic confidence", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [
				finding({ id: "current", scanRunId: "scan-2", fingerprint: "" }),
			],
			baselineFindings: [
				finding({ id: "base", scanRunId: "scan-1", fingerprint: "" }),
			],
		});
		expect(result.counts.unchanged).toBe(1);
		expect(result.deltas[0]?.matchConfidence).toBe("rule_location");
	});

	it("current-only returns new", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [finding({ id: "current", ruleId: "rule.new" })],
			baselineFindings: [],
		});
		expect(result.counts.new).toBe(1);
	});

	it("localizes known default DAST finding titles in deltas", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [
				finding({
					id: "current",
					ruleId: "rule.new",
					title: "Missing common security header",
				}),
			],
			baselineFindings: [],
		});

		expect(result.deltas[0]?.title).toBe("一般的なセキュリティヘッダーが不足");
	});

	it("baseline-only returns resolved", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [],
			baselineFindings: [finding({ id: "base" })],
		});
		expect(result.counts.resolved).toBe(1);
	});

	it("severity increase returns regressed", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [finding({ id: "current", severity: "critical" })],
			baselineFindings: [finding({ id: "base", severity: "medium" })],
		});
		expect(result.counts.regressed).toBe(1);
	});

	it("title-only similarity does not match", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [
				finding({
					id: "current",
					ruleId: "a",
					primaryLocation: { path: "a.ts" },
					fingerprint: "current-fp",
				}),
			],
			baselineFindings: [
				finding({
					id: "base",
					ruleId: "b",
					primaryLocation: { path: "b.ts" },
					fingerprint: "base-fp",
				}),
			],
		});
		expect(result.counts.new).toBe(1);
		expect(result.counts.resolved).toBe(1);
	});

	it("does not match when fallback data is only the title", () => {
		const result = buildScanComparison({
			currentScanRunId: "scan-2",
			baselineScanRunId: "scan-1",
			currentFindings: [
				finding({
					id: "current",
					sourceTool: "",
					ruleId: "",
					primaryLocation: null,
					fingerprint: "",
					title: "Generic issue",
				}),
			],
			baselineFindings: [
				finding({
					id: "base",
					sourceTool: "",
					ruleId: "",
					primaryLocation: null,
					fingerprint: "",
					title: "Generic issue",
				}),
			],
		});

		expect(result.counts.new).toBe(1);
		expect(result.counts.resolved).toBe(1);
		expect(result.counts.unchanged).toBe(0);
		expect(result.deltas.map((delta) => delta.matchConfidence)).toEqual([
			"insufficient",
			"insufficient",
		]);
	});
});
