import { createHash } from "node:crypto";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import {
	type StaticIntelligenceKnowledgeSourceManifest,
	staticIntelligenceKnowledgeSourceManifestSchema,
} from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type { AppDatabase } from "../../db";
import type { StaticIntelligenceReadiness } from "../../../shared/schemas/static-intelligence-module.schema";
import type { PersistedStaticIntelligenceGeneration } from "./generation-repository";
import { buildStaticIntelligenceExport } from "./export-builder";

export type StaticIntelligenceKnowledgeSourceManifestOptions = {
	generatedAt?: Date;
	generation?: PersistedStaticIntelligenceGeneration;
	readiness?: StaticIntelligenceReadiness;
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
			availableBundles: buildAvailableBundles(
				scanRunId,
				options.generation?.generationId,
			),
			...(options.generation
				? {
						generation: manifestGeneration(options.generation),
					}
				: {}),
			...(options.readiness ? { readiness: options.readiness } : {}),
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

function manifestGeneration(generation: PersistedStaticIntelligenceGeneration) {
	const snapshotRef = generation.structure.metadata.snapshotRef;
	const exportHash = generation.export.metadata.exportHash;
	if (!snapshotRef || !exportHash)
		throw new Error("Generation provenance missing.");
	return {
		generationId: generation.generationId,
		generatedAt: generation.structure.metadata.generatedAt,
		sourceTreeHash: generation.structure.metadata.sourceTreeHash,
		sourceStateHash: generation.structure.metadata.sourceStateHash,
		snapshotRef,
		exportHash,
		status: generation.status,
	} as const;
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
	const {
		generatedAt: _generatedAt,
		readiness: _readiness,
		source,
		...rest
	} = manifest;
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

function buildAvailableBundles(scanRunId: string, generationId?: string) {
	const generationArgs = generationId ? ["--generation-id", generationId] : [];
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
				...generationArgs,
			],
			description: "Fetch the full Static Intelligence export payload.",
		},
		{
			kind: "project_structure_snapshot" as const,
			command: [
				"bun",
				"run",
				"intelligence:project-structure",
				"--",
				"--project-path",
				"<project-path>",
			],
			description:
				"Extract the current redacted Project Structure snapshot for the project.",
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
				...generationArgs,
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
				...generationArgs,
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
				...generationArgs,
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
				...generationArgs,
			],
			description:
				"Fetch reusable guardrail material when Phase 35 is available.",
		},
	];
}
