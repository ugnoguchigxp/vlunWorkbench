import { describe, expect, it } from "vitest";
import { generateFingerprint, normalizeFixture } from "./fixture";
import { redactSecrets } from "./redaction";

describe("Fixture Normalizer", () => {
	it("should parse and normalize valid fixture results", () => {
		const input = {
			tool: "fixture",
			results: [
				{
					ruleId: "fixture.rule",
					title: "Fixture finding",
					description: "Synthetic finding",
					severity: "medium",
					path: "src/example.ts",
					startLine: 1,
					endLine: 3,
					snippet: "const value = input;",
					evidence: [
						{
							kind: "tool-output",
							title: "Fixture raw result",
							snippet: "raw logs here",
						},
					],
				},
			],
		};

		const normalized = normalizeFixture(input);
		expect(normalized.length).toBe(1);

		const finding = normalized[0];
		expect(finding.ruleId).toBe("fixture.rule");
		expect(finding.severity).toBe("medium");
		expect(finding.confidence).toBe("static");
		expect(finding.status).toBe("open");
		expect(finding.primaryLocation).toEqual({
			path: "src/example.ts",
			startLine: 1,
			endLine: 3,
		});
		expect(finding.fingerprint).toBe(generateFingerprint("fixture.rule", "src/example.ts", 1));

		expect(finding.evidences.length).toBe(2);
		expect(finding.evidences[0].kind).toBe("source-location");
		expect(finding.evidences[0].snippet).toBe("const value = input;");
		expect(finding.evidences[1].kind).toBe("tool-output");
		expect(finding.evidences[1].snippet).toBe("raw logs here");
	});

	it("should throw error for invalid fixture schema", () => {
		const invalidInput = {
			tool: "fixture",
			results: [
				{
					ruleId: "fixture.rule",
					// missing title
					description: "Synthetic finding",
					severity: "invalid-severity", // invalid severity
					path: "src/example.ts",
					startLine: 1,
					endLine: 3,
				},
			],
		};

		expect(() => normalizeFixture(invalidInput)).toThrow();
	});

	describe("redactSecrets", () => {
		it("should redact slack tokens", () => {
			const slackToken = [
				"xoxb",
				"12345678901",
				"12345678901",
				"abcdefghijklmnopqrstuvwx",
			].join("-");
			const text = `slack = ${slackToken}`;
			expect(redactSecrets(text)).toContain("[REDACTED]");
		});

		it("should redact GitHub PATs", () => {
			const githubToken = `ghp_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
			const text = `token is ${githubToken}`;
			expect(redactSecrets(text)).toContain("[REDACTED]");
		});

		it("should redact AWS access key IDs", () => {
			const awsAccessKey = "AKIAIOSFODNN7EXAMPLE";
			const text = `aws key is ${awsAccessKey}`;
			expect(redactSecrets(text)).toBe("aws key is [REDACTED]");
		});

		it("should redact API keys and passwords in assignment syntax", () => {
			const text1 = 'const api_key = "sensitiveKeyStrHere"';
			expect(redactSecrets(text1)).toBe('const api_key = "[REDACTED]"');

			const text2 = 'const password = "superSecretPassword123"';
			expect(redactSecrets(text2)).toBe('const password = "[REDACTED]"');

			const text3 = "token=unquotedSecret123";
			expect(redactSecrets(text3)).toBe("token=[REDACTED]");
		});

		it("should redact authorization and cookie headers", () => {
			const headers = [
				"Authorization: Bearer headerTokenValue123",
				"Cookie: session=secretSessionValue123; theme=light",
				'{"x-api-key":"jsonHeaderSecret123"}',
			].join("\n");
			const redacted = redactSecrets(headers);
			expect(redacted).not.toContain("headerTokenValue123");
			expect(redacted).not.toContain("secretSessionValue123");
			expect(redacted).not.toContain("jsonHeaderSecret123");
			expect(redacted).toContain("Authorization: [REDACTED]");
			expect(redacted).toContain("Cookie: [REDACTED]");
			expect(redacted).toContain('"x-api-key":"[REDACTED]"');
		});
	});
});
