import { describe, expect, it } from "vitest";
import {
	generateSemgrepFingerprint,
	generateSemgrepFingerprintV2,
	mapSemgrepSeverity,
	normalizeSemgrep,
} from "./semgrep";

describe("Semgrep Normalizer", () => {
	it("should parse and normalize valid Semgrep results", () => {
		const slackToken = [
			"xoxb",
			"12345678901",
			"12345678901",
			"abcdefghijklmnopqrstuvwx",
		].join("-");
		const input = {
			results: [
				{
					check_id: "rules.security.detect-slack-token",
					path: "src/auth.ts",
					start: { line: 4, col: 12 },
					end: { line: 4, col: 60 },
					extra: {
						message: "Slack token detected",
						lines: `const slack_token = "${slackToken}";`,
						severity: "ERROR",
						metadata: {
							cwe: "CWE-798",
						},
					},
				},
			],
		};

		const normalized = normalizeSemgrep(input, { stderr: "some-warning-log" });
		expect(normalized.length).toBe(1);

		const finding = normalized[0];
		expect(finding.ruleId).toBe("rules.security.detect-slack-token");
		expect(finding.title).toBe("Slack token detected");
		expect(finding.description).toBe("Slack token detected");
		expect(finding.severity).toBe("high");
		expect(finding.confidence).toBe("static");
		expect(finding.status).toBe("open");
		expect(finding.primaryLocation).toEqual({
			path: "src/auth.ts",
			startLine: 4,
			endLine: 4,
			startCol: 12,
			endCol: 60,
		});
	expect(finding.fingerprint).toBe(
			generateSemgrepFingerprintV2(
				"rules.security.detect-slack-token",
				"src/auth.ts",
				`const slack_token = "[REDACTED]";`,
				4,
				12,
			),
		);
		expect((finding.metadata?.fingerprintAliases as string[])[0]).toBe(
			generateSemgrepFingerprint(
				"rules.security.detect-slack-token",
				"src/auth.ts",
				4,
				12,
			),
		);
		expect((finding.metadata?.risk as any).cweIds).toEqual(["CWE-798"]);

		expect(finding.evidences.length).toBe(3);
		
		// 1. source-location
		expect(finding.evidences[0].kind).toBe("source-location");
		expect(finding.evidences[0].snippet).toContain("[REDACTED]");
		expect(finding.evidences[0].snippet).not.toContain("xoxb-");

		// 2. tool-output
		expect(finding.evidences[1].kind).toBe("tool-output");
		expect(finding.evidences[1].snippet).toContain("[REDACTED]");
		expect(finding.evidences[1].snippet).not.toContain("xoxb-");
		expect(finding.evidences[1].title).toBe("Raw Semgrep finding for rules.security.detect-slack-token");

		// 3. scan-log (since stderr option is provided)
		expect(finding.evidences[2].kind).toBe("scan-log");
		expect(finding.evidences[2].title).toBe("Semgrep run stderr log");
		expect(finding.evidences[2].snippet).toBe("some-warning-log");
	});

	it("uses a line-shift-stable v2 identity while retaining the legacy alias", () => {
		const result = (line: number) =>
			normalizeSemgrep({
				results: [
					{
						check_id: "owned.sql-injection",
						path: "src/db.ts",
						start: { line, col: 1 },
						end: { line, col: 20 },
						extra: {
							message: "SQL injection",
							severity: "ERROR",
							lines: "db.query(userInput)",
							metadata: {},
						},
					},
				],
			})[0];
		const before = result(10);
		const after = result(18);
		expect(before.fingerprint).toBe(after.fingerprint);
		expect(before.metadata?.fingerprintAliases).not.toEqual(
			after.metadata?.fingerprintAliases,
		);
	});

	it("should map severity correctly", () => {
		expect(mapSemgrepSeverity("ERROR")).toBe("high");
		expect(mapSemgrepSeverity("WARNING")).toBe("medium");
		expect(mapSemgrepSeverity("INFO")).toBe("low");
		expect(mapSemgrepSeverity("UNKNOWN")).toBe("unknown");
		expect(mapSemgrepSeverity("disabled")).toBe("unknown");
	});

	it("should parse empty results successfully", () => {
		const input = { results: [] };
		const normalized = normalizeSemgrep(input);
		expect(normalized).toEqual([]);
	});

	it("should throw for invalid schema", () => {
		const invalidInput = {
			results: [
				{
					check_id: "rules.security.detect-slack-token",
					// missing path
					start: { line: 4, col: 12 },
					end: { line: 4, col: 60 },
					extra: {
						message: "Slack token detected",
						severity: "ERROR",
					},
				},
			],
		};
		expect(() => normalizeSemgrep(invalidInput)).toThrow();
	});
});
