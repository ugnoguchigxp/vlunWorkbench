import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	ProjectStructureDiagnostic,
	ProjectStructureFile,
	ProjectStructureReference,
	ProjectStructureSnapshotV2,
	ProjectStructureStageReadiness,
} from "../../../../shared/schemas/project-structure.schema";
import {
	analyzerFor,
	type AnalyzerOutput,
	type UnresolvedStructureReference,
} from "./analyzers/registry";
import { structureDiagnostic } from "./diagnostics";
import {
	buildProjectInventory,
	type ProjectInventory,
	type ProjectInventoryEntry,
} from "./inventory";
import { inferProjectStructureModules } from "./modules/infer-modules";
import { resolveStructureReferences } from "./resolution/resolver";

export type BuildProjectStructureSnapshotInput = {
	projectPath: string;
	projectId?: string;
	generatedAt?: Date;
	includeRootPath?: boolean;
	maxFiles?: number;
	maxParsedFileBytes?: number;
	maxTotalParsedBytes?: number;
};

const MAX_PARSED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_PARSED_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT_READS = 8;
const MAX_PERSISTED_DIAGNOSTICS = 1_000;

export async function buildProjectStructureSnapshot(
	input: BuildProjectStructureSnapshotInput,
): Promise<ProjectStructureSnapshotV2> {
	const inventory = await buildProjectInventory({
		projectPath: input.projectPath,
		maxFiles: input.maxFiles ?? 20_000,
	});
	return buildProjectStructureSnapshotFromInventory(input, inventory);
}

export async function buildProjectStructureSnapshotFromInventory(
	input: BuildProjectStructureSnapshotInput,
	inventory: ProjectInventory,
): Promise<ProjectStructureSnapshotV2> {
	const generatedAt = (input.generatedAt ?? new Date()).toISOString();
	const diagnostics: ProjectStructureDiagnostic[] = [...inventory.diagnostics];
	const analysis = await analyzeInventoryEntries(input, inventory, diagnostics);
	const files = analysis.files;
	const rawReferences = analysis.references;

	const resolution = await resolveStructureReferences({
		references: rawReferences,
		inventoryEntries: inventory.entries,
	});
	diagnostics.push(...resolution.diagnostics);
	const sortedFiles = files.sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const sortedDiagnostics = capDiagnostics(
		uniqueDiagnostics(diagnostics),
		MAX_PERSISTED_DIAGNOSTICS,
	);
	const modules = inferProjectStructureModules({
		rootRef: inventory.rootRef,
		files: sortedFiles,
		references: resolution.references,
		inventoryEntries: inventory.entries,
		workspacePatterns: analysis.workspacePatterns,
	});
	const packages = packagesForReferences(resolution.references);
	const readiness = readinessForDiagnostics(sortedDiagnostics);
	const snapshot: ProjectStructureSnapshotV2 = {
		version: "v2",
		generatedAt,
		project: {
			...(input.projectId ? { id: input.projectId } : {}),
			rootRef: inventory.rootRef,
			...(input.includeRootPath ? { rootPath: inventory.rootPath } : {}),
			rootPathIncluded: input.includeRootPath === true,
		},
		status: sortedDiagnostics.some((diagnostic) => diagnostic.impact !== "none")
			? "partial"
			: "completed",
		structureInputHash: inventory.structureInputHash,
		inventory: {
			entries: inventory.entries.map(stripInventoryAbsolutePath),
			coverage: inventory.coverage,
		},
		files: sortedFiles,
		references: resolution.references,
		modules,
		packages,
		diagnostics: sortedDiagnostics,
		readiness,
		summary: {
			fileCount: inventory.entries.length,
			analyzedFileCount: sortedFiles.filter(
				(file) => file.status === "analyzed",
			).length,
			styleFileCount: inventory.entries.filter(
				(entry) => entry.kind === "style",
			).length,
			markupFileCount: inventory.entries.filter(
				(entry) => entry.kind === "markup",
			).length,
			resourceFileCount: inventory.coverage.resourceFileCount,
			resolvedReferenceCount: resolution.references.filter(
				(reference) =>
					reference.status === "resolved" ||
					reference.status === "resolved_unparsed",
			).length,
			unresolvedReferenceCount: resolution.references.filter(
				(reference) =>
					reference.status === "unresolved" ||
					reference.status === "ambiguous" ||
					reference.status === "blocked",
			).length,
			moduleCount: modules.length,
		},
	};
	return snapshot;
}

async function analyzeInventoryEntry(
	entry: ProjectInventoryEntry,
	analyzerId: string,
) {
	const analyzer = analyzerFor(entry);
	if (!analyzer || analyzer.id !== analyzerId) {
		return {
			analyzerId,
			references: [],
			diagnosticCodes: ["analysis_adapter_unavailable"],
		};
	}
	try {
		return analyzer.analyze(entry, await fs.readFile(entry.absolutePath));
	} catch {
		return {
			analyzerId,
			references: [],
			diagnosticCodes: ["analysis_file_unreadable"],
		};
	}
}

async function analyzeInventoryEntries(
	input: BuildProjectStructureSnapshotInput,
	inventory: ProjectInventory,
	diagnostics: ProjectStructureDiagnostic[],
): Promise<{
	files: ProjectStructureFile[];
	references: UnresolvedStructureReference[];
	workspacePatterns: Array<{ root: string; pattern: string }>;
}> {
	const maxAnalyzedFiles = input.maxFiles ?? 5_000;
	const maxParsedFileBytes = input.maxParsedFileBytes ?? MAX_PARSED_FILE_BYTES;
	const maxTotalParsedBytes =
		input.maxTotalParsedBytes ?? MAX_TOTAL_PARSED_BYTES;
	const entries = inventory.entries.filter((entry) => analyzerFor(entry));
	let consumedBytes = 0;
	const selections = entries.map((entry, index) => {
		if (index >= maxAnalyzedFiles)
			return { entry, skipCode: "analysis_file_limit_reached" };
		if (entry.sizeBytes > maxParsedFileBytes)
			return { entry, skipCode: "analysis_file_too_large" };
		if (consumedBytes + entry.sizeBytes > maxTotalParsedBytes)
			return { entry, skipCode: "analysis_total_byte_limit_reached" };
		consumedBytes += entry.sizeBytes;
		return { entry };
	});
	const analyzed = await mapWithConcurrency(
		selections,
		MAX_CONCURRENT_READS,
		async ({ entry, skipCode }) => {
			const analyzer = analyzerFor(entry);
			if (!analyzer)
				return {
					entry,
					result: null,
					skipCode: "analysis_adapter_unavailable",
				};
			if (skipCode) return { entry, result: null, skipCode };
			return { entry, result: await analyzeInventoryEntry(entry, analyzer.id) };
		},
	);
	const files: ProjectStructureFile[] = [];
	const references: UnresolvedStructureReference[] = [];
	const workspacePatterns: Array<{ root: string; pattern: string }> = [];
	for (const item of analyzed) {
		const analyzer = analyzerFor(item.entry);
		const codes = item.skipCode
			? [item.skipCode]
			: (item.result?.diagnosticCodes ?? ["analysis_adapter_unavailable"]);
		for (const code of codes) {
			diagnostics.push(
				structureDiagnostic({
					code,
					scope: "analysis",
					impact: "degraded",
					path: item.entry.path,
					analyzerId: analyzer?.id,
				}),
			);
		}
		if (item.result) references.push(...item.result.references);
		for (const hint of item.result?.roleHints ?? []) {
			if (!hint.startsWith("workspace-pattern:")) continue;
			workspacePatterns.push({
				root: path.posix.dirname(item.entry.path),
				pattern: hint.slice("workspace-pattern:".length),
			});
		}
		files.push(
			fileForAnalysis(
				item.entry,
				analyzer?.id ?? "unknown",
				item.result,
				codes,
			),
		);
	}
	return {
		files,
		references,
		workspacePatterns: workspacePatterns.sort(
			(left, right) =>
				left.root.localeCompare(right.root) ||
				left.pattern.localeCompare(right.pattern),
		),
	};
}

function fileForAnalysis(
	entry: ProjectInventoryEntry,
	analyzerId: string,
	result: AnalyzerOutput | null,
	diagnosticCodes: string[],
): ProjectStructureFile {
	const facts = result?.fileFacts;
	return {
		path: entry.path,
		analyzerId,
		language: facts?.language ?? languageForEntry(entry),
		moduleKind: facts?.moduleKind ?? "unknown",
		tags:
			facts?.tags ??
			(entry.kind === "config" || entry.kind === "manifest"
				? ["config"]
				: ["source"]),
		exportedSymbols: facts?.exportedSymbols ?? [],
		identifiers: facts?.identifiers ?? [],
		contentHash: entry.contentHash ?? sha256Hex(entry.path),
		status: diagnosticCodes.length > 0 ? "partial" : "analyzed",
		diagnosticCodes,
	};
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const output = new Array<R>(items.length);
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (nextIndex < items.length) {
				const index = nextIndex++;
				const item = items[index];
				if (item !== undefined) output[index] = await mapper(item);
			}
		}),
	);
	return output;
}

function stripInventoryAbsolutePath(entry: ProjectInventoryEntry) {
	const { absolutePath: _absolutePath, ...persisted } = entry;
	return persisted;
}

function languageForEntry(entry: ProjectInventoryEntry): string {
	switch (entry.kind) {
		case "style":
			return "css";
		case "markup":
			return "html";
		case "manifest":
		case "config":
			return "json";
		default:
			return "unknown";
	}
}

function packagesForReferences(references: ProjectStructureReference[]) {
	const importedBy = new Map<string, Set<string>>();
	for (const reference of references) {
		if (reference.kind !== "external_package") continue;
		const files = importedBy.get(reference.specifier) ?? new Set<string>();
		files.add(reference.from);
		importedBy.set(reference.specifier, files);
	}
	return [...importedBy.entries()]
		.map(([name, files]) => ({
			name,
			importedBy: [...files].sort((left, right) => left.localeCompare(right)),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function readinessForDiagnostics(
	diagnostics: ProjectStructureDiagnostic[],
): ProjectStructureSnapshotV2["readiness"] {
	return {
		inventory: stageReadiness(diagnostics, "inventory"),
		analysis: stageReadiness(diagnostics, "analysis"),
		resolution: stageReadiness(diagnostics, "resolution"),
		moduleInference: stageReadiness(diagnostics, "module_inference"),
	};
}

function stageReadiness(
	diagnostics: ProjectStructureDiagnostic[],
	scope: ProjectStructureDiagnostic["scope"],
): ProjectStructureStageReadiness {
	const reasons = diagnostics
		.filter(
			(diagnostic) =>
				diagnostic.scope === scope && diagnostic.impact !== "none",
		)
		.map((diagnostic) => diagnostic.code)
		.sort((left, right) => left.localeCompare(right));
	return {
		status:
			reasons.length === 0
				? "available"
				: reasons.some((reason) => reason.includes("failed"))
					? "failed"
					: "degraded",
		reasonCodes: [...new Set(reasons)],
	};
}

function uniqueDiagnostics(
	diagnostics: ProjectStructureDiagnostic[],
): ProjectStructureDiagnostic[] {
	const byKey = new Map<string, ProjectStructureDiagnostic>();
	for (const diagnostic of diagnostics) {
		const key = `${diagnostic.code}\0${diagnostic.path ?? ""}\0${diagnostic.specifier ?? ""}`;
		byKey.set(key, diagnostic);
	}
	return [...byKey.values()].sort(
		(left, right) =>
			left.scope.localeCompare(right.scope) ||
			left.code.localeCompare(right.code) ||
			(left.path ?? "").localeCompare(right.path ?? ""),
	);
}

function capDiagnostics(
	diagnostics: ProjectStructureDiagnostic[],
	limit: number,
): ProjectStructureDiagnostic[] {
	if (diagnostics.length <= limit) return diagnostics;
	const retainedCount = Math.max(0, limit - 100);
	const retained = diagnostics.slice(0, retainedCount);
	const counts = new Map<
		string,
		{ diagnostic: ProjectStructureDiagnostic; count: number }
	>();
	for (const diagnostic of diagnostics.slice(retainedCount)) {
		const current = counts.get(diagnostic.code);
		counts.set(diagnostic.code, {
			diagnostic,
			count: (current?.count ?? 0) + (diagnostic.count ?? 1),
		});
	}
	const aggregates = [...counts.values()]
		.sort((left, right) =>
			left.diagnostic.code.localeCompare(right.diagnostic.code),
		)
		.slice(0, limit - retained.length)
		.map(({ diagnostic, count }) => ({
			code: diagnostic.code,
			scope: diagnostic.scope,
			severity: diagnostic.severity,
			impact: diagnostic.impact,
			...(diagnostic.analyzerId ? { analyzerId: diagnostic.analyzerId } : {}),
			count,
		}));
	return [...retained, ...aggregates];
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
