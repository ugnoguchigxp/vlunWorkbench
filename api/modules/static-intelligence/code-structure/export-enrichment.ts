import { createHash } from "node:crypto";
import type {
	CodeStructureSnapshot,
	CodeStructureSummary,
} from "../../../../shared/schemas/static-intelligence-code-structure.schema";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";

export function buildCodeStructureExportEnrichment(
	snapshot: CodeStructureSnapshot | null,
): StaticIntelligenceExportV1["codeStructure"] {
	if (!snapshot) return undefined;
	const summary = snapshot.summary;
	return {
		status: snapshot.status === "completed" ? "available" : "degraded",
		snapshotRef: `code_structure:${snapshot.project.rootRef}:${summaryHashPrefix(summary)}`,
		summary,
		fileTagsByPath: Object.fromEntries(
			snapshot.files.map((file) => [file.path, file.tags]),
		),
		degradedReasons: snapshot.degradedReasons,
	};
}

function summaryHashPrefix(summary: CodeStructureSummary): string {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(summary)))
		.digest("hex")
		.slice(0, 12);
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => [key, canonicalize(item)]),
	);
}
