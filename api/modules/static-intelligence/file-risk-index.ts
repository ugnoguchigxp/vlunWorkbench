import type {
	FileRiskIndexEntry,
	StaticIntelligenceEvidenceQuality,
	StaticIntelligenceSeverity,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceEvidenceRow,
	StaticIntelligenceFindingRow,
	StaticIntelligenceSourceBundle,
} from "./types";
import {
	toProjectRelativePath,
	type RelativePathResult,
} from "./path-boundary";

const SEVERITY_RANK: Record<StaticIntelligenceSeverity, number> = {
	unknown: 0,
	info: 1,
	low: 2,
	medium: 3,
	high: 4,
	critical: 5,
};

export function normalizeStaticIntelligencePath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.replaceAll("\\", "/");
}

export function extractFindingPath(
	finding: StaticIntelligenceFindingRow,
	evidences: StaticIntelligenceEvidenceRow[],
): string {
	return extractFindingPathResult(finding, evidences, "").path;
}

export function extractFindingPathResult(
	finding: StaticIntelligenceFindingRow,
	evidences: StaticIntelligenceEvidenceRow[],
	projectRoot: string,
): RelativePathResult {
	const primaryPath = pathFromRecord(finding.primaryLocation, ["path", "file"]);
	if (primaryPath) return normalizeFindingPath(projectRoot, primaryPath);

	const metadataPath = pathFromRecord(finding.metadata, ["path", "file"]);
	if (metadataPath) return normalizeFindingPath(projectRoot, metadataPath);

	for (const evidence of evidences) {
		const evidencePath = pathFromRecord(evidence.location, ["path", "file"]);
		if (evidencePath) return normalizeFindingPath(projectRoot, evidencePath);
	}

	return { ok: false, path: "unknown", reason: "empty_path" };
}

export function normalizeSeverity(value: string): StaticIntelligenceSeverity {
	return isStaticSeverity(value) ? value : "unknown";
}

export function compareSeverity(
	left: StaticIntelligenceSeverity,
	right: StaticIntelligenceSeverity,
): number {
	return SEVERITY_RANK[left] - SEVERITY_RANK[right];
}

export function buildFileRiskIndex(
	bundle: StaticIntelligenceSourceBundle,
): FileRiskIndexEntry[] {
	const evidenceByFindingId = groupEvidenceByFindingId(bundle.evidences);
	const groups = new Map<
		string,
		{
			findings: StaticIntelligenceFindingRow[];
			evidences: StaticIntelligenceEvidenceRow[];
		}
	>();

	for (const finding of bundle.findings) {
		const evidenceRows = evidenceByFindingId.get(finding.id) ?? [];
		const path = extractFindingPathResult(
			finding,
			evidenceRows,
			bundle.project.repoPath,
		).path;
		const group = groups.get(path) ?? { findings: [], evidences: [] };
		group.findings.push(finding);
		group.evidences.push(...evidenceRows);
		groups.set(path, group);
	}

	return [...groups.entries()]
		.map(([path, group]) => {
			const findingIds = sortedUnique(
				group.findings.map((finding) => finding.id),
			);
			const evidenceRefs = sortedUnique(
				group.evidences.map((evidence) => evidence.id),
			);
			const artifactRefs = sortedUnique(
				group.evidences
					.map((evidence) => evidence.artifactId)
					.filter((artifactId): artifactId is string => Boolean(artifactId)),
			);
			const maxSeverity = group.findings
				.map((finding) => normalizeSeverity(finding.severity))
				.sort((a, b) => compareSeverity(b, a))[0];

			return {
				path,
				findingCount: group.findings.length,
				maxSeverity: maxSeverity ?? "unknown",
				evidenceQuality: classifyFileEvidenceQuality(
					path,
					group.findings,
					evidenceByFindingId,
				),
				scanners: sortedUnique(
					group.findings.map((finding) => finding.sourceTool),
				),
				ruleIds: sortedUnique(group.findings.map((finding) => finding.ruleId)),
				findingIds,
				evidenceRefs,
				artifactRefs,
				verificationRefs: [],
				latestScanRunId: bundle.scanRun.id,
				latestSeenAt: latestDate(
					group.findings.map((finding) => finding.updatedAt),
				),
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeFindingPath(
	projectRoot: string,
	candidate: string,
): RelativePathResult {
	// Preserve compatibility for pure builders whose fixture project root is
	// intentionally absent while still applying the boundary in real bundles.
	if (!projectRoot) return { ok: true, path: candidate.replaceAll("\\", "/") };
	return toProjectRelativePath(projectRoot, candidate);
}

export function groupEvidenceByFindingId(
	evidences: StaticIntelligenceEvidenceRow[],
): Map<string, StaticIntelligenceEvidenceRow[]> {
	const grouped = new Map<string, StaticIntelligenceEvidenceRow[]>();
	for (const evidence of evidences) {
		const rows = grouped.get(evidence.findingId) ?? [];
		rows.push(evidence);
		grouped.set(evidence.findingId, rows);
	}
	for (const [findingId, rows] of grouped.entries()) {
		grouped.set(
			findingId,
			[...rows].sort((a, b) => a.id.localeCompare(b.id)),
		);
	}
	return grouped;
}

function classifyFileEvidenceQuality(
	path: string,
	findings: StaticIntelligenceFindingRow[],
	evidenceByFindingId: Map<string, StaticIntelligenceEvidenceRow[]>,
): StaticIntelligenceEvidenceQuality {
	if (path === "unknown") return "unknown";

	const evidenceRows = findings.flatMap(
		(finding) => evidenceByFindingId.get(finding.id) ?? [],
	);
	if (evidenceRows.length === 0) return "none";

	const artifactBackedByFinding = findings.map((finding) =>
		(evidenceByFindingId.get(finding.id) ?? []).some((evidence) =>
			Boolean(evidence.artifactId),
		),
	);
	if (artifactBackedByFinding.every(Boolean)) return "strong";
	if (artifactBackedByFinding.some(Boolean)) return "mixed";
	return "weak";
}

function pathFromRecord(
	value: Record<string, unknown> | null | undefined,
	keys: string[],
): string | null {
	if (!value || typeof value !== "object") return null;
	for (const key of keys) {
		const path = normalizeStaticIntelligencePath(value[key]);
		if (path) return path;
	}
	return null;
}

function isStaticSeverity(value: string): value is StaticIntelligenceSeverity {
	return Object.hasOwn(SEVERITY_RANK, value);
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function latestDate(values: Date[]): string | undefined {
	const latest = values
		.map((value) => value.getTime())
		.filter((value) => Number.isFinite(value))
		.sort((a, b) => b - a)[0];
	return latest === undefined ? undefined : new Date(latest).toISOString();
}
