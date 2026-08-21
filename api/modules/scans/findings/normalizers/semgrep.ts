import crypto from "node:crypto";
import { z } from "zod";
import { cweList, deriveFindingPriority, stringList } from "./finding-risk";
import { redactSecrets } from "./redaction";

export const semgrepResultSchema = z.object({
	check_id: z.string().min(1),
	path: z.string().min(1),
	start: z.object({
		line: z.number().int().min(1),
		col: z.number().int().min(1),
	}),
	end: z.object({
		line: z.number().int().min(1),
		col: z.number().int().min(1),
	}),
	extra: z.object({
		message: z.string().optional().default(""),
		severity: z.string().optional().default(""),
		metadata: z
			.record(z.string(), z.unknown())
			.optional()
			.default(() => ({})),
		lines: z.string().optional(),
	}),
});

export const semgrepSchema = z.object({
	results: z.array(semgrepResultSchema),
});

export type SemgrepInput = z.infer<typeof semgrepSchema>;

export interface NormalizedFinding {
	ruleId: string;
	title: string;
	description: string;
	severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
	confidence: "static";
	status: "open";
	primaryLocation: {
		path: string;
		startLine: number;
		endLine: number;
		startCol?: number;
		endCol?: number;
	};
	fingerprint: string;
	evidences: Array<{
		kind: "tool-output" | "source-location" | "scan-log";
		title: string;
		location: Record<string, unknown> | null;
		snippet: string | null;
	}>;
	metadata?: Record<string, unknown>;
}

export function mapSemgrepSeverity(
	severity: string,
): "info" | "low" | "medium" | "high" | "critical" | "unknown" {
	const upper = severity.toUpperCase();
	switch (upper) {
		case "ERROR":
			return "high";
		case "WARNING":
			return "medium";
		case "INFO":
			return "low";
		default:
			return "unknown";
	}
}

export function generateSemgrepFingerprint(
	checkId: string,
	pathStr: string,
	startLine: number,
	startCol: number,
): string {
	const input = `semgrep:${checkId}:${pathStr}:${startLine}:${startCol}`;
	return crypto.createHash("sha256").update(input).digest("hex");
}

export function generateSemgrepFingerprintV2(
	checkId: string,
	pathStr: string,
	snippet: string | undefined,
	startLine: number,
	startCol: number,
): string {
	const identity = snippet?.replace(/\s+/g, " ").trim();
	const input = identity
		? `semgrep:v2:${checkId}:${pathStr}:${identity}`
		: `semgrep:v2:${checkId}:${pathStr}:${startLine}:${startCol}`;
	return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeSemgrep(
	input: unknown,
	options?: { stderr?: string },
): NormalizedFinding[] {
	const parsed = semgrepSchema.parse(input);

	return parsed.results.map((result) => {
		const snippet = result.extra.lines
			? redactSecrets(result.extra.lines)
			: undefined;
		const redactedResult = {
			...result,
			extra: {
				...result.extra,
				lines: snippet ?? result.extra.lines,
			},
		};
		const legacyFingerprint = generateSemgrepFingerprint(
			result.check_id,
			result.path,
			result.start.line,
			result.start.col,
		);
		const fingerprint = generateSemgrepFingerprintV2(
			result.check_id,
			result.path,
			snippet,
			result.start.line,
			result.start.col,
		);
		const severity = mapSemgrepSeverity(result.extra.severity);
		const priority = deriveFindingPriority({ severity });

		const primaryLocation = {
			path: result.path,
			startLine: result.start.line,
			endLine: result.end.line,
			startCol: result.start.col,
			endCol: result.end.col,
		};

		const evidences: NormalizedFinding["evidences"] = [];

		// 1. source-location evidence
		evidences.push({
			kind: "source-location",
			title: `Location in ${result.path}`,
			location: primaryLocation,
			snippet: snippet ?? null,
		});

		// 2. tool-output evidence
		evidences.push({
			kind: "tool-output",
			title: `Raw Semgrep finding for ${result.check_id}`,
			location: null,
			snippet: redactSecrets(JSON.stringify(redactedResult, null, 2)),
		});

		// 3. scan-log evidence
		if (options?.stderr && options.stderr.trim().length > 0) {
			evidences.push({
				kind: "scan-log",
				title: "Semgrep run stderr log",
				location: null,
				snippet: redactSecrets(options.stderr),
			});
		}

		return {
			ruleId: result.check_id,
			title: result.extra.message || result.check_id,
			description: result.extra.message || result.check_id,
			severity,
			confidence: "static",
			status: "open",
			primaryLocation,
			fingerprint,
			evidences,
			metadata: {
				risk: {
					cweIds: cweList(result.extra.metadata.cwe),
					advisoryAliases: [],
					cvss: [],
					references: stringList(
						result.extra.metadata.references ?? result.extra.metadata.reference,
					).filter((value) => URL.canParse(value)),
					package: null,
					fixedVersions: [],
					rule: {
						source:
							typeof result.extra.metadata.source === "string"
								? result.extra.metadata.source
								: "semgrep",
						version:
							typeof result.extra.metadata.version === "string"
								? result.extra.metadata.version
								: null,
					},
					reachability: "unknown",
					reachabilityEvidenceRefs: [],
					vex: null,
					kev: null,
					epss: null,
					...priority,
				},
				fingerprintVersion: 2,
				fingerprintAliases: [legacyFingerprint],
				semgrepMetadata: result.extra.metadata,
			},
		};
	});
}
