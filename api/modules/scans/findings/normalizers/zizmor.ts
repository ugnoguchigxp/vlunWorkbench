import crypto from "node:crypto";
import { z } from "zod";
import type { NormalizedFinding } from "./fixture";
import { redactSecrets } from "./redaction";

const pointSchema = z.object({
	row: z.number().int().nonnegative(),
	column: z.number().int().nonnegative(),
});

const locationSchema = z.object({
	symbolic: z.object({
		key: z.record(z.string(), z.unknown()),
		annotation: z.string().optional().default(""),
		kind: z.string().optional().default(""),
	}),
	concrete: z.object({
		location: z.object({
			start_point: pointSchema,
			end_point: pointSchema,
		}),
		feature: z.string().optional().default(""),
	}),
});

const findingSchema = z.object({
	ident: z.string().min(1),
	desc: z.string().min(1),
	url: z.string().url().optional(),
	determinations: z.object({
		confidence: z.string().optional().default(""),
		severity: z.string().optional().default(""),
		persona: z.string().optional().default(""),
	}),
	locations: z.array(locationSchema).min(1),
	ignored: z.boolean().optional().default(false),
});

export const zizmorOutputSchema = z.array(findingSchema);

function localPath(key: Record<string, unknown>): string | null {
	const local = key.Local;
	if (!local || typeof local !== "object" || Array.isArray(local)) return null;
	const value = (local as Record<string, unknown>).verbatim_path;
	return typeof value === "string" && value.trim() ? value : null;
}

export function mapZizmorSeverity(
	value: string,
): NormalizedFinding["severity"] {
	switch (value.trim().toLowerCase()) {
		case "high":
			return "high";
		case "medium":
			return "medium";
		case "low":
			return "low";
		case "informational":
		case "info":
			return "info";
		default:
			return "unknown";
	}
}

export function normalizeZizmor(input: unknown): NormalizedFinding[] {
	const parsed = zizmorOutputSchema.parse(input);
	return parsed.flatMap((finding) => {
		if (finding.ignored) return [];
		const primary =
			finding.locations.find(
				(location) =>
					location.symbolic.kind.toLowerCase() === "primary" &&
					localPath(location.symbolic.key),
			) ??
			finding.locations.find((location) => localPath(location.symbolic.key));
		if (!primary) return [];
		const path = localPath(primary.symbolic.key);
		if (!path) return [];
		// zizmor JSON v1 uses zero-based rows; vulnWorkbench locations are one-based.
		const startLine = primary.concrete.location.start_point.row + 1;
		const endLine = Math.max(
			startLine,
			primary.concrete.location.end_point.row + 1,
		);
		const raw = redactSecrets(JSON.stringify(finding, null, 2));
		const annotation = primary.symbolic.annotation.trim();
		const description = annotation
			? `${finding.desc}: ${annotation}`
			: finding.desc;
		const fingerprint = crypto
			.createHash("sha256")
			.update(
				`zizmor:v1:${finding.ident}:${path}:${primary.concrete.feature}:${annotation}`,
			)
			.digest("hex");
		return [
			{
				ruleId: finding.ident,
				title: finding.desc,
				description,
				severity: mapZizmorSeverity(finding.determinations.severity),
				confidence: "static" as const,
				status: "open" as const,
				primaryLocation: { path, startLine, endLine },
				fingerprint,
				evidences: [
					{
						kind: "source-location" as const,
						title: `GitHub Actions workflow location in ${path}`,
						location: { path, startLine, endLine },
						snippet: primary.concrete.feature
							? redactSecrets(primary.concrete.feature)
							: null,
					},
					{
						kind: "tool-output" as const,
						title: `Raw zizmor finding for ${finding.ident}`,
						location: null,
						snippet: raw,
					},
				],
				metadata: {
					scannerDomain: "cicd_workflow_integrity",
					confidence: finding.determinations.confidence,
					persona: finding.determinations.persona,
					reference: finding.url ?? null,
					format: "zizmor-json-v1",
				},
			},
		];
	});
}
