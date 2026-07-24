import { createHash } from "node:crypto";
import { z } from "zod";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type { ProjectStructureSnapshotV2 } from "../../../shared/schemas/project-structure.schema";
import type { StaticIntelligenceSourceBundle } from "./types";

export const STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS = [
	"project_structure_snapshot",
	"code_structure_snapshot",
	"static_intelligence_export",
] as const;

export type StaticIntelligenceDerivedArtifactKind =
	(typeof STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS)[number];

export function isStaticIntelligenceDerivedArtifact(
	kind: string,
): kind is StaticIntelligenceDerivedArtifactKind {
	return (
		STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS as readonly string[]
	).includes(kind);
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const summaryValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

export const staticIntelligenceArtifactMetadataSchema = z
	.object({
		generationId: z.string().uuid(),
		projectId: z.string().min(1),
		scanRunId: z.string().min(1),
		artifactRole: z.enum(["project_structure", "structure", "export"]),
		generationFormat: z.literal("project_structure_v2"),
		schemaVersion: z.enum([
			"project-structure-v2",
			"code-structure-v1",
			"static-intelligence-export-v1",
		]),
		status: z.enum(["available", "degraded"]),
		generatedAt: z.string().datetime(),
		sourceTreeHash: hashSchema,
		sourceStateHash: hashSchema,
		sourceRevision: z
			.object({
				kind: z.enum(["git", "tree_hash_only"]),
				head: z.string().min(1).optional(),
				dirtyHash: hashSchema.optional(),
				value: z.string().min(1),
			})
			.strict(),
		rootRef: hashSchema,
		structureInputHash: hashSchema.optional(),
		snapshotRef: z.string().min(1).optional(),
		exportHash: hashSchema.optional(),
		contentHash: hashSchema,
		degradedReasons: z.array(z.string()),
		summary: z.record(z.string(), summaryValueSchema),
	})
	.strict()
	.superRefine((metadata, ctx) => {
		if (
			metadata.sourceRevision.kind === "git" &&
			!metadata.sourceRevision.head
		) {
			ctx.addIssue({
				code: "custom",
				message: "Git source revision requires head.",
				path: ["sourceRevision", "head"],
			});
		}
		if (metadata.artifactRole === "project_structure") {
			if (metadata.schemaVersion !== "project-structure-v2") {
				ctx.addIssue({
					code: "custom",
					message: "Project structure metadata must use project-structure-v2.",
					path: ["schemaVersion"],
				});
			}
			if (!metadata.snapshotRef || !metadata.structureInputHash) {
				ctx.addIssue({
					code: "custom",
					message:
						"Project structure metadata requires snapshotRef and structureInputHash.",
					path: ["snapshotRef"],
				});
			}
		}
		if (metadata.artifactRole === "structure") {
			if (metadata.schemaVersion !== "code-structure-v1") {
				ctx.addIssue({
					code: "custom",
					message: "Structure metadata must use code-structure-v1.",
					path: ["schemaVersion"],
				});
			}
			if (!metadata.snapshotRef) {
				ctx.addIssue({
					code: "custom",
					message: "Structure metadata requires snapshotRef.",
					path: ["snapshotRef"],
				});
			}
		}
		if (metadata.artifactRole === "export") {
			if (metadata.schemaVersion !== "static-intelligence-export-v1") {
				ctx.addIssue({
					code: "custom",
					message: "Export metadata must use static-intelligence-export-v1.",
					path: ["schemaVersion"],
				});
			}
			if (!metadata.exportHash) {
				ctx.addIssue({
					code: "custom",
					message: "Export metadata requires exportHash.",
					path: ["exportHash"],
				});
			}
		}
	});

export type StaticIntelligenceArtifactMetadata = z.infer<
	typeof staticIntelligenceArtifactMetadataSchema
>;

export type StaticIntelligenceSourceRevision = NonNullable<
	StaticIntelligenceArtifactMetadata["sourceRevision"]
>;

export function buildSourceTreeHash(snapshot: CodeStructureSnapshot): string {
	const input = snapshot.files
		.map((file) => `${file.path}\u0000${file.contentHash}`)
		.sort((left, right) => left.localeCompare(right))
		.join("\n");
	return sha256Hex(input);
}

export function buildSnapshotRef(params: {
	rootRef: string;
	sourceTreeHash: string;
}): string {
	return `code_structure:${params.rootRef}:${params.sourceTreeHash.slice(0, 16)}`;
}

export function buildProjectStructureSnapshotRef(params: {
	rootRef: string;
	structureInputHash: string;
}): string {
	return `project_structure:v2:${params.rootRef}:${params.structureInputHash.slice(0, 16)}`;
}

export function buildProjectStructureHash(
	snapshot: ProjectStructureSnapshotV2,
): string {
	return sha256Hex(canonicalJson(snapshot));
}

export function buildStaticIntelligenceExportHash(
	exportPayload: StaticIntelligenceExportV1,
): string {
	const { generatedAt: _generatedAt, ...stableExportPayload } = exportPayload;
	return sha256Hex(canonicalJson(stableExportPayload));
}

export function buildSourceStateHash(
	bundle: StaticIntelligenceSourceBundle,
): string {
	return sha256Hex(
		canonicalJson({
			project: {
				id: bundle.project.id,
				name: bundle.project.name,
				updatedAt: dateToString(bundle.project.updatedAt),
			},
			scanRun: {
				id: bundle.scanRun.id,
				profile: bundle.scanRun.profile,
				status: bundle.scanRun.status,
				startedAt: dateToString(bundle.scanRun.startedAt),
				completedAt: dateToString(bundle.scanRun.completedAt),
				updatedAt: dateToString(bundle.scanRun.updatedAt),
			},
			toolRuns: bundle.toolRuns.map((toolRun) => ({
				id: toolRun.id,
				toolName: toolRun.toolName,
				toolVersion: toolRun.toolVersion,
				status: toolRun.status,
				exitCode: toolRun.exitCode,
				updatedAt: dateToString(toolRun.updatedAt),
			})),
			artifacts: bundle.artifacts
				.filter(
					(artifact) => !isStaticIntelligenceDerivedArtifact(artifact.kind),
				)
				.map((artifact) => ({
					id: artifact.id,
					kind: artifact.kind,
					format: artifact.format,
					path: artifact.path,
					sha256: artifact.sha256,
					createdAt: dateToString(artifact.createdAt),
				})),
			findings: bundle.findings.map((finding) => ({
				id: finding.id,
				sourceTool: finding.sourceTool,
				ruleId: finding.ruleId,
				title: finding.title,
				fingerprint: finding.fingerprint,
				status: finding.status,
				severity: finding.severity,
				updatedAt: dateToString(finding.updatedAt),
			})),
			evidences: bundle.evidences.map((evidence) => ({
				id: evidence.id,
				findingId: evidence.findingId,
				artifactId: evidence.artifactId,
				kind: evidence.kind,
				title: evidence.title,
				location: evidence.location,
				createdAt: dateToString(evidence.createdAt),
			})),
			latestReview: bundle.latestReview
				? {
						id: bundle.latestReview.id,
						status: bundle.latestReview.status,
						provider: bundle.latestReview.provider,
						model: bundle.latestReview.model,
						outputHash: sha256Hex(canonicalJson(bundle.latestReview.output)),
						updatedAt: dateToString(bundle.latestReview.updatedAt),
					}
				: null,
		}),
	);
}

export function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Hex(value: string): string {
	return sha256Text(value);
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

type CanonicalValue =
	| null
	| boolean
	| number
	| string
	| CanonicalValue[]
	| { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
	if (value === null) return null;
	if (
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		if (typeof value === "number" && !Number.isFinite(value)) {
			throw new Error("Unsupported non-finite number.");
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((item) => canonicalize(item));
	if (!value || typeof value !== "object") {
		throw new Error("Unsupported canonical JSON value.");
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error("Unsupported non-plain object value.");
	}
	const result: { [key: string]: CanonicalValue } = {};
	for (const key of Object.keys(value).sort()) {
		const item = (value as Record<string, unknown>)[key];
		if (item !== undefined) result[key] = canonicalize(item);
	}
	return result;
}

export function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort(
		(left, right) => left.localeCompare(right),
	);
}

function dateToString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}
