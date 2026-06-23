import crypto from "node:crypto";
import { z } from "zod";

// Zod schemas for validation
export const fixtureEvidenceSchema = z.object({
	kind: z.enum(["tool-output", "source-location", "scan-log"]),
	title: z.string().min(1),
	location: z.record(z.string(), z.unknown()).optional(),
	snippet: z.string().optional(),
});

export const fixtureResultSchema = z.object({
	ruleId: z.string().min(1),
	title: z.string().min(1),
	description: z.string().min(1),
	severity: z.enum(["info", "low", "medium", "high", "critical", "unknown"]),
	path: z.string().min(1),
	startLine: z.number().int().min(1),
	endLine: z.number().int().min(1),
	snippet: z.string().optional(),
	evidence: z.array(fixtureEvidenceSchema).optional(),
});

export const fixtureSchema = z.object({
	tool: z.literal("fixture"),
	results: z.array(fixtureResultSchema),
});

export type FixtureInput = z.infer<typeof fixtureSchema>;

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
	};
	fingerprint: string;
	evidences: Array<{
		kind: "tool-output" | "source-location" | "scan-log";
		title: string;
		location: Record<string, unknown> | null;
		snippet: string | null;
	}>;
}

export function redactSecrets(text: string): string {
	const patterns = [
		/ghp_[a-zA-Z0-9]{36}/gi, // GitHub PAT
		/xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}/gi, // Slack token
		/AIzaSy[a-zA-Z0-9-_]{33}/gi, // Google API Key
		/(?:key|pass|password|secret|token|api_key|apikey|private_key)\s*[:=]\s*["']([^"']{8,})["']/gi,
	];

	let redacted = text;
	for (const pattern of patterns) {
		redacted = redacted.replace(pattern, (match, ...args) => {
			// Zod / JS Regex replace callback args:
			// If group captured, first captured group will be in args[0]
			const captured = args[0];
			if (typeof captured === "string" && match.includes(captured)) {
				return match.replace(captured, "[REDACTED]");
			}
			return "[REDACTED]";
		});
	}
	return redacted;
}

export function generateFingerprint(
	ruleId: string,
	pathStr: string,
	startLine: number,
): string {
	const input = `${ruleId}:${pathStr}:${startLine}`;
	return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeFixture(input: unknown): NormalizedFinding[] {
	const parsed = fixtureSchema.parse(input);

	return parsed.results.map((result) => {
		const snippet = result.snippet ? redactSecrets(result.snippet) : undefined;
		const fingerprint = generateFingerprint(
			result.ruleId,
			result.path,
			result.startLine,
		);

		const primaryLocation = {
			path: result.path,
			startLine: result.startLine,
			endLine: result.endLine,
		};

		const evidences: NormalizedFinding["evidences"] = [];

		// Add source-location evidence if location details exist
		evidences.push({
			kind: "source-location",
			title: `Location in ${result.path}`,
			location: primaryLocation,
			snippet: snippet ?? null,
		});

		// Process explicit evidence array
		if (result.evidence) {
			for (const ev of result.evidence) {
				evidences.push({
					kind: ev.kind,
					title: ev.title,
					location: (ev.location as Record<string, unknown>) ?? null,
					snippet: ev.snippet ? redactSecrets(ev.snippet) : null,
				});
			}
		}

		return {
			ruleId: result.ruleId,
			title: result.title,
			description: result.description,
			severity: result.severity,
			confidence: "static",
			status: "open",
			primaryLocation,
			fingerprint,
			evidences,
		};
	});
}
