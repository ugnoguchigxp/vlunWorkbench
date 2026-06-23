import crypto from "node:crypto";
import { z } from "zod";
import { redactSecrets } from "./redaction";
import type { NormalizedFinding } from "./fixture";

export const osvVulnerabilitySchema = z.object({
	id: z.string().min(1),
	summary: z.string().optional(),
	details: z.string().optional(),
	severity: z
		.array(
			z.object({
				type: z.string(),
				score: z.string(),
			}),
		)
		.optional(),
	database_specific: z
		.object({
			severity: z.string().optional(),
		})
		.optional(),
	aliases: z.array(z.string()).optional(),
	affected: z
		.array(
			z.object({
				ranges: z
					.array(
						z.object({
							type: z.string(),
							events: z
								.array(
									z.object({
										introduced: z.string().optional(),
										fixed: z.string().optional(),
									}),
								)
								.optional(),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
});

export const osvPackageSchema = z.object({
	package: z.object({
		name: z.string().min(1),
		version: z.string().min(1),
		ecosystem: z.string().optional().default(""),
	}),
	vulnerabilities: z
		.array(osvVulnerabilitySchema)
		.optional()
		.default(() => []),
});

export const osvSourceSchema = z.object({
	source: z.object({
		path: z.string().min(1),
		type: z.string().optional().default(""),
	}),
	packages: z
		.array(osvPackageSchema)
		.optional()
		.default(() => []),
});

export const osvSchema = z.object({
	results: z
		.array(osvSourceSchema)
		.optional()
		.default(() => []),
});

export type OsvInput = z.infer<typeof osvSchema>;

export function mapOsvSeverity(
	vuln: z.infer<typeof osvVulnerabilitySchema>,
): "info" | "low" | "medium" | "high" | "critical" | "unknown" {
	const dbSev = vuln.database_specific?.severity;
	if (typeof dbSev === "string") {
		const upper = dbSev.toUpperCase();
		if (upper === "CRITICAL") return "critical";
		if (upper === "HIGH") return "high";
		if (upper === "MEDIUM" || upper === "MODERATE") return "medium";
		if (upper === "LOW") return "low";
	}

	if (Array.isArray(vuln.severity)) {
		for (const s of vuln.severity) {
			if (s.score) {
				const num = Number.parseFloat(s.score);
				if (!Number.isNaN(num)) {
					if (num >= 9.0) return "critical";
					if (num >= 7.0) return "high";
					if (num >= 4.0) return "medium";
					if (num >= 0.1) return "low";
					return "info";
				}
			}
		}
	}

	return "unknown";
}

export function generateOsvFingerprint(
	advisoryId: string,
	packageName: string,
	packageVersion: string,
	manifestPath: string,
): string {
	const input = `osv:${advisoryId}:${packageName}:${packageVersion}:${manifestPath}`;
	return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeOsv(
	input: unknown,
	options?: { stderr?: string },
): NormalizedFinding[] {
	const parsed = osvSchema.parse(input);
	const findings: NormalizedFinding[] = [];

	const results = parsed.results || [];
	for (const res of results) {
		const manifestPath = res.source.path;
		const packages = res.packages || [];

		for (const pkg of packages) {
			const pkgName = pkg.package.name;
			const pkgVersion = pkg.package.version;
			const ecosystem = pkg.package.ecosystem;

			const vulnerabilities = pkg.vulnerabilities || [];
			for (const vuln of vulnerabilities) {
				const severity = mapOsvSeverity(vuln);
				const fingerprint = generateOsvFingerprint(
					vuln.id,
					pkgName,
					pkgVersion,
					manifestPath,
				);

				const title = vuln.summary || vuln.id;
				const description = vuln.details || vuln.summary || vuln.id;

				// Extract fixed versions
				const fixedVersions: string[] = [];
				if (Array.isArray(vuln.affected)) {
					for (const aff of vuln.affected) {
						if (Array.isArray(aff.ranges)) {
							for (const r of aff.ranges) {
								if (Array.isArray(r.events)) {
									for (const e of r.events) {
										if (e.fixed) {
											fixedVersions.push(e.fixed);
										}
									}
								}
							}
						}
					}
				}

				const metadata = {
					packageName: pkgName,
					packageVersion: pkgVersion,
					advisoryId: vuln.id,
					aliases: vuln.aliases || [],
					fixedVersions,
					ecosystem,
					manifestPath,
				};

				const primaryLocation = {
					path: manifestPath,
					startLine: 1,
					endLine: 1,
				};

				const evidences: NormalizedFinding["evidences"] = [];

				// 1. source-location evidence
				evidences.push({
					kind: "source-location",
					title: `Dependency: ${pkgName}@${pkgVersion} in ${manifestPath}`,
					location: primaryLocation,
					snippet: `Dependency ${pkgName} version ${pkgVersion} is vulnerable to ${vuln.id}.`,
				});

				// 2. tool-output evidence (redacted)
				evidences.push({
					kind: "tool-output",
					title: `Raw OSV vulnerability details for ${vuln.id}`,
					location: null,
					snippet: redactSecrets(JSON.stringify(vuln, null, 2)),
				});

				// 3. scan-log evidence
				if (options?.stderr && options.stderr.trim().length > 0) {
					evidences.push({
						kind: "scan-log",
						title: "OSV run stderr log",
						location: null,
						snippet: redactSecrets(options.stderr),
					});
				}

				findings.push({
					ruleId: vuln.id,
					title: redactSecrets(title),
					description: redactSecrets(description),
					severity,
					confidence: "static",
					status: "open",
					primaryLocation,
					fingerprint,
					evidences,
					metadata,
				} as any);
			}
		}
	}

	return findings;
}
