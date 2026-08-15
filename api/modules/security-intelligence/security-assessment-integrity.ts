import { createHash } from "node:crypto";
import {
	type DiffManifest,
	diffManifestSchema,
	type ResolvedScanTarget,
} from "../../../shared/schemas/scan-target.schema";
import { canonicalStringifySecurityIntelligenceValue } from "../../../shared/security-intelligence-assessment-contract";
import type { scanArtifacts } from "../../db/schema";
import type { ArtifactStorage } from "../scans/artifact-storage";
import { canonicalJson } from "../scans/diff-scan-plan";
import type { PersistedDependencyToolResult } from "./persisted-dependency-assessment.schema";
import {
	failSecurityAssessmentInput as fail,
	parseSecurityAssessmentJson as parseJsonOrFail,
	parseSecurityAssessmentInput as parseOrFail,
	SecurityAssessmentInputError,
} from "./persisted-dependency-assessment.schema";

const MAX_DIFF_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_REFERENCED_ARTIFACT_BYTES = 32 * 1024 * 1024;

type PersistedArtifact = typeof scanArtifacts.$inferSelect;

export async function loadVerifiedDiffManifest(params: {
	storage: ArtifactStorage;
	artifact: PersistedArtifact;
	metadataTarget: ResolvedScanTarget;
}): Promise<DiffManifest> {
	const text = await params.storage
		.readTextArtifact(params.artifact.path, {
			maxBytes: MAX_DIFF_MANIFEST_BYTES,
		})
		.catch((error) => {
			throw new SecurityAssessmentInputError(
				"diff_manifest_unreadable",
				message(error),
			);
		});
	assertArtifactIntegrity(params.artifact, text);
	const manifest = parseOrFail(
		diffManifestSchema,
		parseJsonOrFail(text, "diff_manifest_json_invalid"),
		"diff_manifest_schema_invalid",
	);
	assertTargetBinding({
		metadataTarget: params.metadataTarget,
		manifestTarget: manifest.target,
		artifactTargetDigest: params.artifact.metadata?.targetDigest,
	});
	assertManifestCoverage(manifest);
	assertManifestTargetDigest(manifest);
	return manifest;
}

export async function assertReferencedArtifactIntegrity(params: {
	storage: ArtifactStorage;
	results: readonly PersistedDependencyToolResult[];
	artifactRows: PersistedArtifact[];
}): Promise<void> {
	const artifactIds = canonicalStrings(
		params.results.flatMap((result) => result.artifactIds ?? []),
	);
	for (const artifactId of artifactIds) {
		const artifact = params.artifactRows.find((row) => row.id === artifactId);
		if (!artifact) fail("tool_artifact_binding_mismatch");
		const actual = await params.storage
			.hashArtifact(artifact.path, {
				maxBytes: MAX_REFERENCED_ARTIFACT_BYTES,
			})
			.catch((error) => {
				throw new SecurityAssessmentInputError(
					"tool_artifact_unreadable",
					message(error),
				);
			});
		if (
			actual.sha256 !== artifact.sha256 ||
			actual.sizeBytes !== artifact.sizeBytes
		) {
			fail("tool_artifact_digest_mismatch");
		}
	}
}

function assertArtifactIntegrity(
	artifact: PersistedArtifact,
	content: string,
): void {
	if (Buffer.byteLength(content, "utf8") !== artifact.sizeBytes) {
		fail("diff_manifest_size_mismatch");
	}
	if (sha256Hex(content) !== artifact.sha256) {
		fail("diff_manifest_digest_mismatch");
	}
}

function assertTargetBinding(params: {
	metadataTarget: ResolvedScanTarget;
	manifestTarget: ResolvedScanTarget;
	artifactTargetDigest: unknown;
}): void {
	if (
		canonicalStringifySecurityIntelligenceValue(params.metadataTarget) !==
		canonicalStringifySecurityIntelligenceValue(params.manifestTarget)
	) {
		fail("scan_target_manifest_mismatch");
	}
	if (params.artifactTargetDigest !== params.metadataTarget.targetDigest) {
		fail("diff_manifest_target_mismatch");
	}
}

function assertManifestCoverage(manifest: DiffManifest): void {
	const count = (disposition: string) =>
		manifest.entries.filter((entry) => entry.disposition === disposition)
			.length;
	const expected = {
		changed: manifest.entries.length,
		scannable: count("scan"),
		deleted: count("deleted"),
		excluded: count("excluded"),
		unsupported: count("unsupported"),
		tooLarge: count("too_large"),
	};
	if (
		canonicalStringifySecurityIntelligenceValue(expected) !==
			canonicalStringifySecurityIntelligenceValue(manifest.coverage) ||
		manifest.target.changedFileCount !== expected.changed ||
		manifest.target.scannableFileCount !== expected.scannable
	) {
		fail("diff_manifest_coverage_mismatch");
	}
}

function assertManifestTargetDigest(manifest: DiffManifest): void {
	const identity = {
		schemaVersion: manifest.target.schemaVersion,
		kind: manifest.target.kind,
		projectPrefix: manifest.target.projectPrefix,
		baseSha: manifest.target.baseSha,
		headSha: manifest.target.headSha,
		mergeBaseSha: manifest.target.mergeBaseSha,
		includeUntracked: manifest.target.includeUntracked,
		entries: manifest.entries.map((entry) => ({
			status: entry.status,
			path: entry.path,
			oldPath: entry.oldPath ?? null,
			contentSha256: entry.contentSha256 ?? null,
			sizeBytes: entry.sizeBytes ?? null,
			disposition: entry.disposition,
			reasonCode: entry.reasonCode,
		})),
	};
	if (sha256Hex(canonicalJson(identity)) !== manifest.target.targetDigest) {
		fail("diff_manifest_target_digest_mismatch");
	}
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
