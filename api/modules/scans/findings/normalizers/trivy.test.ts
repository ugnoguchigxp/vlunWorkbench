import { describe, expect, it } from "vitest";
import {
	generateTrivyFingerprint,
	mapTrivySeverity,
	normalizeTrivy,
} from "./trivy";

describe("Trivy Normalizer", () => {
	it("should parse and normalize valid Trivy results including vulnerabilities, configs, and secrets", () => {
		const slackToken = [
			"xoxb",
			"12345678901",
			"12345678901",
			"abcdefghijklmnopqrstuvwx",
		].join("-");
		const input = {
			SchemaVersion: 2,
			Results: [
				{
					Target: "package.json",
					Class: "lang-pkgs",
					Type: "npm",
					Vulnerabilities: [
						{
							VulnerabilityID: "CVE-2023-12345",
							PkgName: "axios",
							InstalledVersion: "0.21.1",
							FixedVersion: "0.21.2",
							Severity: "CRITICAL",
							Title: "DoS in axios",
							Description: "Axios description",
						},
					],
				},
				{
					Target: "main.tf",
					Class: "config",
					Type: "terraform",
					Misconfigurations: [
						{
							ID: "AVD-AWS-0001",
							Title: "S3 public read",
							Description: "Do not allow public read",
							Message: "S3 bucket is public",
							Severity: "HIGH",
							CauseMetadata: {
								StartLine: 10,
								EndLine: 12,
							},
						},
					],
				},
				{
					Target: "secrets.txt",
					Class: "secret",
					Secrets: [
						{
							RuleID: "slack-token",
							Title: "Slack Token Leak",
							Severity: "HIGH",
							StartLine: 5,
							EndLine: 5,
							Match: slackToken,
						},
					],
				},
			],
		};

		const normalized = normalizeTrivy(input, { stderr: "trivy-stderr" });
		expect(normalized.length).toBe(3);

		// 1. Check vulnerability finding
		const vulnFinding = normalized.find((f) => f.ruleId === "CVE-2023-12345")!;
		expect(vulnFinding).toBeDefined();
		expect(vulnFinding.title).toBe("DoS in axios");
		expect(vulnFinding.severity).toBe("critical");
		expect(vulnFinding.primaryLocation).toEqual({
			path: "package.json",
			startLine: 1,
			endLine: 1,
		});
		expect(vulnFinding.fingerprint).toBe(
			generateTrivyFingerprint("CVE-2023-12345", "package.json", "axios:0.21.1"),
		);
		expect((vulnFinding as any).metadata).toEqual(expect.objectContaining({
			target: "package.json",
			vulnerabilityId: "CVE-2023-12345",
			packageName: "axios",
			installedVersion: "0.21.1",
			fixedVersion: "0.21.2",
			class: "lang-pkgs",
			type: "npm",
		}));
		expect((vulnFinding as any).metadata.risk.package.purl).toBe(
			"pkg:npm/axios@0.21.1",
		);
		expect((vulnFinding as any).metadata.risk.derivedPriority).toBe("p1");

		// 2. Check misconfig finding
		const misconfigFinding = normalized.find((f) => f.ruleId === "AVD-AWS-0001")!;
		expect(misconfigFinding).toBeDefined();
		expect(misconfigFinding.title).toBe("S3 public read");
		expect(misconfigFinding.severity).toBe("high");
		expect(misconfigFinding.primaryLocation).toEqual({
			path: "main.tf",
			startLine: 10,
			endLine: 12,
		});
		expect(misconfigFinding.fingerprint).toBe(
			generateTrivyFingerprint("AVD-AWS-0001", "main.tf", "10"),
		);

		// 3. Check secret finding
		const secretFinding = normalized.find((f) => f.ruleId === "slack-token")!;
		expect(secretFinding).toBeDefined();
		expect(secretFinding.severity).toBe("high");
		expect(secretFinding.primaryLocation).toEqual({
			path: "secrets.txt",
			startLine: 5,
			endLine: 5,
		});
		expect(secretFinding.fingerprint).toBe(
			generateTrivyFingerprint("slack-token", "secrets.txt", "5"),
		);

		// Check redaction on secret output
		const toolOutputEv = secretFinding.evidences.find((e) => e.kind === "tool-output")!;
		expect(toolOutputEv.snippet).toContain("[REDACTED]");
		expect(toolOutputEv.snippet).not.toContain("xoxb-");
	});

	it("should map severities correctly", () => {
		expect(mapTrivySeverity("CRITICAL")).toBe("critical");
		expect(mapTrivySeverity("HIGH")).toBe("high");
		expect(mapTrivySeverity("MEDIUM")).toBe("medium");
		expect(mapTrivySeverity("LOW")).toBe("low");
		expect(mapTrivySeverity("UNKNOWN")).toBe("unknown");
	});

	it("keeps findings when an upstream advisory contains malformed references", () => {
		const normalized = normalizeTrivy({
			SchemaVersion: 2,
			Results: [
				{
					Target: "pom.xml",
					Class: "lang-pkgs",
					Type: "pom",
					Vulnerabilities: [
						{
							VulnerabilityID: "CVE-2026-47838",
							PkgName: "org.springframework.security:spring-security-web",
							InstalledVersion: "4.0.0.RELEASE",
							PrimaryURL:
								"https://avd.aquasec.com/nvd/cve-2026-47838",
							References: [
								"https://nvd.nist.gov/vuln/detail/CVE-2026-47838",
								"https://nvd.nist.gov/vuln/detail/CVE-2026-47838",
								"spring-projects/spring-security",
								null,
							],
						},
					],
				},
			],
		});

		expect(normalized).toHaveLength(1);
		const risk = normalized[0].metadata?.risk as { references: string[] };
		expect(risk.references).toEqual([
			"https://avd.aquasec.com/nvd/cve-2026-47838",
			"https://nvd.nist.gov/vuln/detail/CVE-2026-47838",
		]);
		expect(normalized[0].metadata?.normalizationDiagnostics).toEqual({
			invalidReferenceCount: 2,
		});
	});

	it("should parse empty Results successfully", () => {
		const normalized = normalizeTrivy({ Results: [] });
		expect(normalized).toEqual([]);
	});
});
