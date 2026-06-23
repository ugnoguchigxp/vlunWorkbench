import { describe, expect, it } from "vitest";
import {
	normalizeOsv,
	mapOsvSeverity,
	generateOsvFingerprint,
} from "./osv";

describe("OSV Normalizer", () => {
	it("should parse and normalize valid OSV results with fixed versions and metadata", () => {
		const input = {
			results: [
				{
					source: {
						path: "yarn.lock",
						type: "lockfile",
					},
					packages: [
						{
							package: {
								name: "express",
								version: "4.16.0",
								ecosystem: "npm",
							},
							vulnerabilities: [
								{
									id: "GHSA-fake-advisory",
									summary: "Fake Vulnerability in express",
									details: "A detailed explanation of the vulnerability.",
									database_specific: {
										severity: "HIGH",
									},
									aliases: ["CVE-2020-fake"],
									affected: [
										{
											ranges: [
												{
													type: "SEMVER",
													events: [
														{ introduced: "0" },
														{ fixed: "4.17.0" },
													],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		};

		const normalized = normalizeOsv(input, { stderr: "osv-stderr-log" });
		expect(normalized.length).toBe(1);

		const finding = normalized[0];
		expect(finding.ruleId).toBe("GHSA-fake-advisory");
		expect(finding.title).toBe("Fake Vulnerability in express");
		expect(finding.severity).toBe("high");
		expect(finding.primaryLocation).toEqual({
			path: "yarn.lock",
			startLine: 1,
			endLine: 1,
		});
		expect(finding.fingerprint).toBe(
			generateOsvFingerprint("GHSA-fake-advisory", "express", "4.16.0", "yarn.lock"),
		);

		// Verify metadata is attached
		const metadata = (finding as any).metadata;
		expect(metadata).toEqual({
			packageName: "express",
			packageVersion: "4.16.0",
			advisoryId: "GHSA-fake-advisory",
			aliases: ["CVE-2020-fake"],
			fixedVersions: ["4.17.0"],
			ecosystem: "npm",
			manifestPath: "yarn.lock",
		});

		expect(finding.evidences.length).toBe(3);
		expect(finding.evidences[0].kind).toBe("source-location");
		expect(finding.evidences[1].kind).toBe("tool-output");
		expect(finding.evidences[2].kind).toBe("scan-log");
		expect(finding.evidences[2].snippet).toBe("osv-stderr-log");
	});

	it("should map severity from CVSS scores if database_specific is missing", () => {
		const vuln1 = {
			id: "VULN-1",
			severity: [{ type: "CVSS_V3", score: "9.8" }],
		};
		const vuln2 = {
			id: "VULN-2",
			severity: [{ type: "CVSS_V3", score: "5.5" }],
		};
		const vuln3 = {
			id: "VULN-3",
			severity: [{ type: "CVSS_V3", score: "invalid-score" }],
		};

		expect(mapOsvSeverity(vuln1)).toBe("critical");
		expect(mapOsvSeverity(vuln2)).toBe("medium");
		expect(mapOsvSeverity(vuln3)).toBe("unknown");
	});

	it("should parse empty results successfully", () => {
		const normalized = normalizeOsv({ results: [] });
		expect(normalized).toEqual([]);
	});

	it("should throw for invalid schema", () => {
		const invalidInput = {
			results: [
				{
					source: {
						// missing path
					},
				},
			],
		};
		expect(() => normalizeOsv(invalidInput)).toThrow();
	});
});
