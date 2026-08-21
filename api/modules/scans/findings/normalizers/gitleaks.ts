import crypto from "node:crypto";
import { z } from "zod";
import type { NormalizedFinding } from "./fixture";
import { redactSecrets } from "./redaction";

export const gitleaksFindingSchema = z.object({
	Description: z.string().optional().default(""),
	StartLine: z.number().int().min(1),
	EndLine: z.number().int().min(1),
	StartColumn: z.number().int().optional().default(1),
	EndColumn: z.number().int().optional().default(1),
	File: z.string().min(1),
	Secret: z.string().optional().default(""),
	RuleID: z.string().min(1),
	Fingerprint: z.string().optional(),
});

export const gitleaksSchema = z.array(gitleaksFindingSchema);

export type GitleaksInput = z.infer<typeof gitleaksSchema>;

export function generateGitleaksFingerprint(
	ruleId: string,
	pathStr: string,
	startLine: number,
	startCol: number,
): string {
	const input = `gitleaks:${ruleId}:${pathStr}:${startLine}:${startCol}`;
	return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeGitleaks(
	input: unknown,
	options?: { stderr?: string },
): NormalizedFinding[] {
	const parsed = gitleaksSchema.parse(input);

	return parsed.map((finding) => {
		// Redact secrets in finding content
		const redactedSecret = redactSecrets(finding.Secret);
		const redactedDescription = redactSecrets(finding.Description);

		const fingerprint = generateGitleaksFingerprint(
			finding.RuleID,
			finding.File,
			finding.StartLine,
			finding.StartColumn ?? 1,
		);

		const primaryLocation = {
			path: finding.File,
			startLine: finding.StartLine,
			endLine: finding.EndLine,
			startCol: finding.StartColumn,
			endCol: finding.EndColumn,
		};

		const evidences: NormalizedFinding["evidences"] = [];

		// 1. source-location evidence (never store raw secret!)
		evidences.push({
			kind: "source-location",
			title: `Leak location in ${finding.File}`,
			location: primaryLocation,
			snippet: `Secret detected of type: ${redactedDescription}`,
		});

		// 2. tool-output evidence (redacted)
		const redactedFinding = {
			...finding,
			Secret: redactedSecret,
			Description: redactedDescription,
		};
		evidences.push({
			kind: "tool-output",
			title: `Raw Gitleaks finding for ${finding.RuleID}`,
			location: null,
			snippet: redactSecrets(JSON.stringify(redactedFinding, null, 2)),
		});

		// 3. scan-log evidence
		if (options?.stderr && options.stderr.trim().length > 0) {
			evidences.push({
				kind: "scan-log",
				title: "Gitleaks run stderr log",
				location: null,
				snippet: redactSecrets(options.stderr),
			});
		}

		return {
			ruleId: finding.RuleID,
			title: redactedDescription || finding.RuleID,
			description: redactedDescription || finding.RuleID,
			severity: "high", // Defaulting to high for secrets
			confidence: "static",
			status: "open",
			primaryLocation,
			fingerprint,
			evidences,
		};
	});
}
