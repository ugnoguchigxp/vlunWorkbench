import { createHash } from "node:crypto";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import {
	type StaticIntelligenceKnowledgeSourceManifest,
	staticIntelligenceKnowledgeSourceManifestSchema,
} from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type { AppDatabase } from "../../db";
import { buildStaticIntelligenceExport } from "./export-builder";

export type StaticIntelligenceKnowledgeSourceManifestOptions = {
	generatedAt?: Date;
};

type JsonScalar = null | boolean | number | string;
type CanonicalValue =
	| JsonScalar
	| CanonicalValue[]
	| { [key: string]: CanonicalValue };

export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function buildStaticIntelligenceKnowledgeSourceManifest(
	exportPayload: StaticIntelligenceExportV1,
	options: StaticIntelligenceKnowledgeSourceManifestOptions = {},
): StaticIntelligenceKnowledgeSourceManifest {
	const generatedAt = (options.generatedAt ?? new Date()).toISOString();
	const exportHash = sha256Hex(canonicalJson(exportHashInput(exportPayload)));
	const scanRunId = exportPayload.scan.id;
	const manifestWithoutContentHash: StaticIntelligenceKnowledgeSourceManifest =
		{
			version: "v1",
			generatedAt,
			source: {
				kind: "vulnWorkbench.static_intelligence",
				sourceId: `vulnWorkbench.static_intelligence:${scanRunId}`,
				projectId: exportPayload.project.id,
				scanRunId,
				exportHash,
				contentHash: "",
				schemaVersion: "static-intelligence-export-v1",
			},
			project: {
				id: exportPayload.project.id,
				name: exportPayload.project.name,
			},
			scan: {
				id: exportPayload.scan.id,
				profile: exportPayload.scan.profile,
				status: exportPayload.scan.status,
				findingCount: exportPayload.scan.findingCount,
				reviewStatus: exportPayload.scan.reviewStatus,
			},
			risk: {
				band: exportPayload.scanSummary.riskBand,
				evidenceQuality: exportPayload.scanSummary.evidenceQuality,
				degradedReasons: uniqueSorted(
					exportPayload.scanSummary.degradedReasons,
				),
			},
			redaction: {
				status: "redacted",
				rawArtifactBodyIncluded: false,
				rawEvidenceSnippetIncluded: false,
				rawSecretIncluded: false,
			},
			availableBundles: buildAvailableBundles(scanRunId),
		};

	const contentHash = sha256Hex(
		canonicalJson(contentHashInput(manifestWithoutContentHash)),
	);

	return staticIntelligenceKnowledgeSourceManifestSchema.parse({
		...manifestWithoutContentHash,
		source: {
			...manifestWithoutContentHash.source,
			contentHash,
		},
	});
}

export async function buildStaticIntelligenceKnowledgeSourceManifestForScan(
	db: AppDatabase,
	scanRunId: string,
	options: StaticIntelligenceKnowledgeSourceManifestOptions = {},
): Promise<StaticIntelligenceKnowledgeSourceManifest> {
	const exportPayload = await buildStaticIntelligenceExport(db, scanRunId);
	return buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, options);
}

function canonicalize(value: unknown): CanonicalValue {
	if (value === null) return null;
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("Unsupported non-finite number.");
		return value;
	}
	const valueType = typeof value;
	if (valueType === "undefined") {
		throw new Error("Unsupported undefined value outside object fields.");
	}
	if (
		valueType === "bigint" ||
		valueType === "function" ||
		valueType === "symbol"
	) {
		throw new Error(`Unsupported value type: ${valueType}.`);
	}
	if (Array.isArray(value)) return value.map((item) => canonicalize(item));
	if (!isPlainObject(value)) {
		throw new Error("Unsupported non-plain object value.");
	}

	const output: { [key: string]: CanonicalValue } = {};
	for (const key of Object.keys(value).sort()) {
		const item = value[key];
		if (item === undefined) continue;
		output[key] = canonicalize(item);
	}
	return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function contentHashInput(
	manifest: StaticIntelligenceKnowledgeSourceManifest,
): unknown {
	const { generatedAt: _generatedAt, source, ...rest } = manifest;
	const { contentHash: _contentHash, ...sourceWithoutContentHash } = source;
	return {
		...rest,
		source: sourceWithoutContentHash,
	};
}

function exportHashInput(exportPayload: StaticIntelligenceExportV1): unknown {
	const { generatedAt: _generatedAt, ...stableExportPayload } = exportPayload;
	return stableExportPayload;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function buildAvailableBundles(scanRunId: string) {
	return [
		{
			kind: "static_intelligence_export" as const,
			command: [
				"bun",
				"run",
				"intelligence:export",
				"--",
				"--scan-run-id",
				scanRunId,
			],
			description: "Fetch the full Static Intelligence export payload.",
		},
		{
			kind: "code_structure_snapshot" as const,
			command: [
				"bun",
				"run",
				"intelligence:code-structure",
				"--",
				"--project-path",
				"<project-path>",
			],
			description:
				"Extract a redacted lightweight code structure snapshot for the project.",
			requires: { projectPath: true },
		},
		{
			kind: "agent_query" as const,
			command: [
				"bun",
				"run",
				"intelligence:agent-query",
				"--",
				"--scan-run-id",
				scanRunId,
				"--kind",
				"project_overview",
			],
			description: "Fetch a focused agent-facing overview bundle.",
		},
		{
			kind: "evidence_bundle" as const,
			command: [
				"bun",
				"run",
				"intelligence:agent-query",
				"--",
				"--scan-run-id",
				scanRunId,
				"--kind",
				"evidence_bundle",
				"--finding-id",
				"<finding-id>",
			],
			description: "Fetch evidence for one finding.",
			requires: { findingId: true },
		},
		{
			kind: "verification_commands" as const,
			command: [
				"bun",
				"run",
				"intelligence:agent-query",
				"--",
				"--scan-run-id",
				scanRunId,
				"--kind",
				"verification_commands",
			],
			description: "Fetch scan-level verification command candidates.",
		},
		{
			kind: "guardrail_material" as const,
			command: [
				"bun",
				"run",
				"intelligence:guardrail-material",
				"--",
				"--scan-run-id",
				scanRunId,
			],
			description:
				"Fetch reusable guardrail material when Phase 35 is available.",
		},
	];
}
