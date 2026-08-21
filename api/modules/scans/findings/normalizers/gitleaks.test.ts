import { describe, expect, it } from "vitest";
import {
	generateGitleaksFingerprint,
	normalizeGitleaks,
} from "./gitleaks";

describe("Gitleaks Normalizer", () => {
	it("should parse and normalize valid Gitleaks results with redaction", () => {
		const slackToken = [
			"xoxb",
			"12345678901",
			"12345678901",
			"abcdefghijklmnopqrstuvwx",
		].join("-");
		const input = [
			{
				Description: `Slack token detected: ${slackToken}`,
				StartLine: 12,
				EndLine: 12,
				StartColumn: 5,
				EndColumn: 60,
				File: "src/auth.ts",
				Secret: slackToken,
				RuleID: "slack-token-rule",
			},
		];

		const normalized = normalizeGitleaks(input, { stderr: "gitleaks-warning" });
		expect(normalized.length).toBe(1);

		const finding = normalized[0];
		expect(finding.ruleId).toBe("slack-token-rule");
		expect(finding.title).toContain("[REDACTED]");
		expect(finding.title).not.toContain("xoxb-");
		expect(finding.severity).toBe("high");
		expect(finding.confidence).toBe("static");
		expect(finding.status).toBe("open");
		expect(finding.primaryLocation).toEqual({
			path: "src/auth.ts",
			startLine: 12,
			endLine: 12,
			startCol: 5,
			endCol: 60,
		});
		expect(finding.fingerprint).toBe(
			generateGitleaksFingerprint("slack-token-rule", "src/auth.ts", 12, 5),
		);

		expect(finding.evidences.length).toBe(3);
		
		// 1. source-location
		expect(finding.evidences[0].kind).toBe("source-location");
		expect(finding.evidences[0].snippet).toBe("Secret detected of type: Slack token detected: [REDACTED]");

		// 2. tool-output
		expect(finding.evidences[1].kind).toBe("tool-output");
		expect(finding.evidences[1].snippet).toContain("[REDACTED]");
		expect(finding.evidences[1].snippet).not.toContain("xoxb-");

		// 3. scan-log
		expect(finding.evidences[2].kind).toBe("scan-log");
		expect(finding.evidences[2].snippet).toBe("gitleaks-warning");
	});

	it("should parse empty findings successfully", () => {
		const normalized = normalizeGitleaks([]);
		expect(normalized).toEqual([]);
	});

	it("should throw for invalid schema", () => {
		const invalidInput = [
			{
				Description: "Missing StartLine and File",
				RuleID: "test",
			},
		];
		expect(() => normalizeGitleaks(invalidInput)).toThrow();
	});
});
