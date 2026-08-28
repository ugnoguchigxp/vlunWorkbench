import { describe, expect, it } from "vitest";
import {
	buildFindingTextExport,
	buildFindingTextExportFilename,
} from "./finding-text-export";

describe("buildFindingTextExport", () => {
	it("renders stored scan findings as deterministic TOML-like text", () => {
		const text = buildFindingTextExport(
			{
				id: "scan-1",
				profile: "baseline",
				status: "completed",
				startedAt: new Date("2026-08-28T00:00:00.000Z"),
				completedAt: new Date("2026-08-28T00:01:00.000Z"),
				createdAt: new Date("2026-08-28T00:00:00.000Z"),
			},
			[
				{
					id: "finding-1",
					sourceTool: "Semgrep",
					ruleId: "typescript.lang.security.audit.xss",
					title: 'Unsafe "HTML" output',
					description: "First line\nSecond line\\path",
					severity: "high",
					confidence: "static",
					status: "open",
					primaryLocation: { startLine: 42, path: "src/view.ts" },
					fingerprint: "fingerprint-1",
					metadata: { z: true, a: { ruleSource: "scanner" } },
					createdAt: "2026-08-28T00:00:05.000Z",
					updatedAt: "2026-08-28T00:00:05.000Z",
				},
			],
		);

		expect(text).toContain("[scan]\n");
		expect(text).toContain("finding_count = 1");
		expect(text).toContain("[[findings]]");
		expect(text).toContain('source_tool = "Semgrep"');
		expect(text).toContain('title = "Unsafe \\"HTML\\" output"');
		expect(text).toContain(
			'description = "First line\\nSecond line\\\\path"',
		);
		expect(text).toContain(
			'primary_location_json = "{\\"path\\":\\"src/view.ts\\",\\"startLine\\":42}"',
		);
		expect(text).toContain(
			'metadata_json = "{\\"a\\":{\\"ruleSource\\":\\"scanner\\"},\\"z\\":true}"',
		);
		expect(text).not.toContain("remediation_plan");
		expect(text.endsWith("\n")).toBe(true);
	});

	it("emits a scan section for a zero-finding result", () => {
		const text = buildFindingTextExport(
			{
				id: "scan-empty",
				profile: "baseline",
				status: "completed",
				startedAt: null,
				completedAt: null,
				createdAt: "not-a-date",
			},
			[],
		);

		expect(text).toContain("finding_count = 0");
		expect(text).toContain('created_at = "not-a-date"');
		expect(text).not.toContain("[[findings]]");
		expect(text).not.toContain("started_at");
	});
});

describe("buildFindingTextExportFilename", () => {
	it("keeps the attachment filename ASCII and path-safe", () => {
		const filename = buildFindingTextExportFilename("scan/../../日本語 id");

		expect(filename).toMatch(/^scan-results-[a-zA-Z0-9_-]+\.txt$/);
		expect(filename).not.toContain("/");
		expect(filename).not.toContain("..");
	});
});
