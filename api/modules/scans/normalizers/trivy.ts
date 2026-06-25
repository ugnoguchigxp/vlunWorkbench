import crypto from "node:crypto";
import { z } from "zod";
import type { NormalizedFinding } from "./fixture";
import { redactSecrets } from "./redaction";

export const trivyVulnerabilitySchema = z.object({
	VulnerabilityID: z.string().min(1),
	PkgName: z.string().min(1),
	InstalledVersion: z.string().optional().default(""),
	FixedVersion: z.string().optional().default(""),
	Severity: z.string().optional().default(""),
	Title: z.string().optional(),
	Description: z.string().optional(),
	PrimaryURL: z.string().optional(),
});

export const trivyMisconfigurationSchema = z.object({
	ID: z.string().min(1),
	Title: z.string().optional(),
	Description: z.string().optional(),
	Message: z.string().optional(),
	Severity: z.string().optional().default(""),
	CauseMetadata: z
		.object({
			StartLine: z.number().int().optional(),
			EndLine: z.number().int().optional(),
		})
		.optional(),
});

export const trivySecretSchema = z.object({
	RuleID: z.string().min(1),
	Title: z.string().optional(),
	Severity: z.string().optional().default(""),
	StartLine: z.number().int().min(1),
	EndLine: z.number().int().min(1),
	Match: z.string().optional().default(""),
});

export const trivyResultItemSchema = z.object({
	Target: z.string().min(1),
	Class: z.string().optional().default(""),
	Type: z.string().optional().default(""),
	Vulnerabilities: z
		.array(trivyVulnerabilitySchema)
		.optional()
		.default(() => []),
	Misconfigurations: z
		.array(trivyMisconfigurationSchema)
		.optional()
		.default(() => []),
	Secrets: z
		.array(trivySecretSchema)
		.optional()
		.default(() => []),
});

export const trivySchema = z.object({
	SchemaVersion: z.number().optional(),
	Results: z
		.array(trivyResultItemSchema)
		.optional()
		.default(() => []),
});

export type TrivyInput = z.infer<typeof trivySchema>;

export function mapTrivySeverity(
	severity: string,
): "info" | "low" | "medium" | "high" | "critical" | "unknown" {
	const upper = severity.toUpperCase();
	switch (upper) {
		case "CRITICAL":
			return "critical";
		case "HIGH":
			return "high";
		case "MEDIUM":
			return "medium";
		case "LOW":
			return "low";
		default:
			return "unknown";
	}
}

export function generateTrivyFingerprint(
	ruleId: string,
	target: string,
	uniqSuffix: string,
): string {
	const input = `trivy:${ruleId}:${target}:${uniqSuffix}`;
	return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeTrivy(
	input: unknown,
	options?: { stderr?: string },
): NormalizedFinding[] {
	const parsed = trivySchema.parse(input);
	const findings: NormalizedFinding[] = [];

	const results = parsed.Results || [];
	for (const res of results) {
		const target = res.Target;
		const rClass = res.Class || "";
		const rType = res.Type || "";

		// 1. Process Vulnerabilities
		const vulnerabilities = res.Vulnerabilities || [];
		for (const vuln of vulnerabilities) {
			const severity = mapTrivySeverity(vuln.Severity);
			const fingerprint = generateTrivyFingerprint(
				vuln.VulnerabilityID,
				target,
				`${vuln.PkgName}:${vuln.InstalledVersion}`,
			);

			const title = vuln.Title || vuln.VulnerabilityID;
			const description =
				vuln.Description || vuln.Title || vuln.VulnerabilityID;

			const metadata = {
				target,
				vulnerabilityId: vuln.VulnerabilityID,
				packageName: vuln.PkgName,
				installedVersion: vuln.InstalledVersion,
				fixedVersion: vuln.FixedVersion,
				class: rClass,
				type: rType,
			};

			const primaryLocation = {
				path: target,
				startLine: 1,
				endLine: 1,
			};

			const evidences: NormalizedFinding["evidences"] = [];

			// source-location
			evidences.push({
				kind: "source-location",
				title: `Dependency: ${vuln.PkgName}@${vuln.InstalledVersion} in ${target}`,
				location: primaryLocation,
				snippet: `Dependency ${vuln.PkgName} version ${vuln.InstalledVersion} is vulnerable to ${vuln.VulnerabilityID}.`,
			});

			// tool-output
			evidences.push({
				kind: "tool-output",
				title: `Raw Trivy vulnerability details for ${vuln.VulnerabilityID}`,
				location: null,
				snippet: redactSecrets(JSON.stringify(vuln, null, 2)),
			});

			if (options?.stderr && options.stderr.trim().length > 0) {
				evidences.push({
					kind: "scan-log",
					title: "Trivy run stderr log",
					location: null,
					snippet: redactSecrets(options.stderr),
				});
			}

			findings.push({
				ruleId: vuln.VulnerabilityID,
				title: redactSecrets(title),
				description: redactSecrets(description),
				severity,
				confidence: "static",
				status: "open",
				primaryLocation,
				fingerprint,
				evidences,
				metadata,
			});
		}

		// 2. Process Misconfigurations
		const misconfigs = res.Misconfigurations || [];
		for (const misconfig of misconfigs) {
			const severity = mapTrivySeverity(misconfig.Severity);
			const startLine = misconfig.CauseMetadata?.StartLine || 1;
			const endLine = misconfig.CauseMetadata?.EndLine || 1;
			const fingerprint = generateTrivyFingerprint(
				misconfig.ID,
				target,
				String(startLine),
			);

			const title = misconfig.Title || misconfig.ID;
			const description =
				misconfig.Description ||
				misconfig.Message ||
				misconfig.Title ||
				misconfig.ID;

			const metadata = {
				target,
				misconfigurationId: misconfig.ID,
				class: rClass,
				type: rType,
			};

			const primaryLocation = {
				path: target,
				startLine,
				endLine,
			};

			const evidences: NormalizedFinding["evidences"] = [];

			evidences.push({
				kind: "source-location",
				title: `Misconfiguration: ${misconfig.ID} in ${target}`,
				location: primaryLocation,
				snippet:
					misconfig.Message ||
					misconfig.Description ||
					`Misconfiguration detected in ${target}`,
			});

			evidences.push({
				kind: "tool-output",
				title: `Raw Trivy misconfiguration details for ${misconfig.ID}`,
				location: null,
				snippet: redactSecrets(JSON.stringify(misconfig, null, 2)),
			});

			if (options?.stderr && options.stderr.trim().length > 0) {
				evidences.push({
					kind: "scan-log",
					title: "Trivy run stderr log",
					location: null,
					snippet: redactSecrets(options.stderr),
				});
			}

			findings.push({
				ruleId: misconfig.ID,
				title: redactSecrets(title),
				description: redactSecrets(description),
				severity,
				confidence: "static",
				status: "open",
				primaryLocation,
				fingerprint,
				evidences,
				metadata,
			});
		}

		// 3. Process Secrets
		const secrets = res.Secrets || [];
		for (const secret of secrets) {
			const severity = mapTrivySeverity(secret.Severity);
			const fingerprint = generateTrivyFingerprint(
				secret.RuleID,
				target,
				String(secret.StartLine),
			);

			const title = secret.Title || secret.RuleID;
			const description = secret.Title || secret.RuleID;

			const metadata = {
				target,
				ruleId: secret.RuleID,
				class: rClass,
				type: rType,
			};

			const primaryLocation = {
				path: target,
				startLine: secret.StartLine,
				endLine: secret.EndLine,
			};

			const evidences: NormalizedFinding["evidences"] = [];

			evidences.push({
				kind: "source-location",
				title: `Secret leak: ${secret.RuleID} in ${target}`,
				location: primaryLocation,
				snippet: `Secret detected of type: ${secret.Title || secret.RuleID}`,
			});

			// Redact secret before putting it into output evidence
			const redactedSecret = redactSecrets(secret.Match);
			const redactedSecretObj = {
				...secret,
				Match: redactedSecret,
			};

			evidences.push({
				kind: "tool-output",
				title: `Raw Trivy secret details for ${secret.RuleID}`,
				location: null,
				snippet: redactSecrets(JSON.stringify(redactedSecretObj, null, 2)),
			});

			if (options?.stderr && options.stderr.trim().length > 0) {
				evidences.push({
					kind: "scan-log",
					title: "Trivy run stderr log",
					location: null,
					snippet: redactSecrets(options.stderr),
				});
			}

			findings.push({
				ruleId: secret.RuleID,
				title: redactSecrets(title),
				description: redactSecrets(description),
				severity,
				confidence: "static",
				status: "open",
				primaryLocation,
				fingerprint,
				evidences,
				metadata,
			});
		}
	}

	return findings;
}
