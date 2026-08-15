import type { ProjectStructureSnapshotV2 } from "../../../shared/schemas/project-structure.schema";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	type ProjectExplorationCatalogFailure,
	type ProjectExplorationCatalogInput,
	type ProjectExplorationCatalogReadiness,
	type ProjectExplorationCatalogResult,
	type ProjectExplorationCatalogV2Result,
	projectExplorationCatalogResultSchema,
	projectExplorationCatalogV2ResultSchema,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import {
	buildRankedCatalogCandidates,
	type CatalogCandidateResolution,
	type CatalogSnapshot,
	catalogSnapshotFromV2,
	type RankedCatalogCandidates,
} from "./exploration-catalog-candidates";
import {
	catalogUnavailable,
	collectVerificationCandidates,
	compare,
	fitCatalogResponseBudget,
	fitCatalogV2ResponseBudget,
	normalizeExplorationFocus,
	uniqueSorted,
} from "./exploration-catalog-policy";
import type { StaticIntelligenceArtifactMetadata } from "./generation-types";
import { buildStaticIntelligenceModuleCandidates } from "./module-candidates";

const DEFAULT_LIMITS = { files: 12, tests: 6, verificationCommands: 4 };

export type ProjectExplorationGenerationView = {
	projectId: string;
	scanRunId: string;
	generationId: string;
	status: "available" | "degraded";
	structure: {
		metadata: Pick<
			StaticIntelligenceArtifactMetadata,
			| "generatedAt"
			| "rootRef"
			| "snapshotRef"
			| "sourceTreeHash"
			| "sourceStateHash"
			| "sourceRevision"
		>;
		snapshot: CodeStructureSnapshot;
	};
	export: { payload: StaticIntelligenceExportV1 };
};

export type ProjectExplorationGenerationV2View =
	ProjectExplorationGenerationView & {
		projectStructure: {
			metadata: Pick<
				StaticIntelligenceArtifactMetadata,
				"generatedAt" | "snapshotRef" | "sourceRevision" | "schemaVersion"
			>;
			snapshot: ProjectStructureSnapshotV2;
		};
	};

type Readiness = "available" | "stale" | "degraded";

export function buildProjectExplorationCatalog(input: {
	generation: ProjectExplorationGenerationView;
	readiness: Readiness;
	focus: ProjectExplorationCatalogInput["focus"];
	limits?: ProjectExplorationCatalogInput["limits"];
	generatedAt: string;
}): ProjectExplorationCatalogResult | ProjectExplorationCatalogFailure {
	try {
		const normalizedFocus = normalizeExplorationFocus(input.focus);
		const modules = buildStaticIntelligenceModuleCandidates({
			snapshot: input.generation.structure.snapshot,
			exportPayload: input.generation.export.payload,
		});
		const candidates = buildRankedCatalogCandidates({
			snapshot: input.generation.structure.snapshot,
			modules,
			focus: normalizedFocus,
			verification: collectVerificationCandidates(
				input.generation.export.payload,
			),
		});
		const result = buildCatalogResult({
			...input,
			resolution: candidates.resolution,
			ranked: candidates.ranked,
		});
		return fitCatalogResponseBudget(result, {
			files: candidates.ranked.likelyFiles.length,
			tests: candidates.ranked.relatedTests.length,
			verificationCommands: candidates.ranked.verificationCandidates.length,
		});
	} catch (error) {
		return catalogUnavailable(error);
	}
}

export function buildProjectExplorationCatalogV2(input: {
	generation: ProjectExplorationGenerationV2View;
	readiness: Readiness;
	focus: ProjectExplorationCatalogInput["focus"];
	limits?: ProjectExplorationCatalogInput["limits"];
	generatedAt: string;
}): ProjectExplorationCatalogV2Result | ProjectExplorationCatalogFailure {
	try {
		const normalizedFocus = normalizeExplorationFocus(input.focus);
		const projectStructure = input.generation.projectStructure.snapshot;
		const snapshot = catalogSnapshotFromV2(projectStructure);
		const modules = buildStaticIntelligenceModuleCandidates({
			snapshot: input.generation.structure.snapshot,
			projectStructureSnapshot: projectStructure,
			exportPayload: input.generation.export.payload,
		});
		const candidates = buildRankedCatalogCandidates({
			snapshot,
			modules,
			focus: normalizedFocus,
			verification: collectVerificationCandidates(
				input.generation.export.payload,
			),
		});
		const result = buildCatalogV2Result({
			...input,
			snapshot,
			resolution: candidates.resolution,
			ranked: candidates.ranked,
		});
		return fitCatalogV2ResponseBudget(result, {
			files: candidates.ranked.likelyFiles.length,
			tests: candidates.ranked.relatedTests.length,
			verificationCommands: candidates.ranked.verificationCandidates.length,
		});
	} catch (error) {
		return catalogUnavailable(error);
	}
}

function buildCatalogResult(input: {
	generation: ProjectExplorationGenerationView;
	readiness: Readiness;
	limits?: ProjectExplorationCatalogInput["limits"];
	generatedAt: string;
	resolution: CatalogCandidateResolution;
	ranked: RankedCatalogCandidates;
}): ProjectExplorationCatalogResult {
	const limits = { ...DEFAULT_LIMITS, ...input.limits };
	const likelyFiles = input.ranked.likelyFiles.slice(0, limits.files);
	const relatedTests = input.ranked.relatedTests.slice(0, limits.tests);
	const verificationCandidates = input.ranked.verificationCandidates.slice(
		0,
		limits.verificationCommands,
	);
	const degradedReasons = new Set<string>();
	if (input.readiness === "stale") degradedReasons.add("generation_stale");
	if (
		input.generation.status === "degraded" ||
		input.readiness === "degraded"
	) {
		degradedReasons.add("generation_degraded");
	}
	if (input.resolution.unmatchedPaths.length > 0) {
		degradedReasons.add("focus_path_unmatched");
	}
	if (input.resolution.unmatchedModuleIds.length > 0) {
		degradedReasons.add("focus_module_unmatched");
	}
	if (input.resolution.unmatchedTerms.length > 0) {
		degradedReasons.add("focus_terms_unmatched");
	}
	if (input.generation.structure.snapshot.status === "partial") {
		degradedReasons.add("code_structure_partial");
	}
	if (
		input.generation.structure.snapshot.degradedReasons.some((reason) =>
			reason.toLowerCase().includes("unresolved"),
		)
	) {
		degradedReasons.add("unresolved_relative_imports");
	}
	if (relatedTests.length === 0) degradedReasons.add("related_tests_missing");
	if (verificationCandidates.length === 0) {
		degradedReasons.add("verification_candidates_missing");
	}
	const truncation = {
		truncated:
			likelyFiles.length < input.ranked.likelyFiles.length ||
			relatedTests.length < input.ranked.relatedTests.length ||
			verificationCandidates.length <
				input.ranked.verificationCandidates.length,
		omittedFiles: input.ranked.likelyFiles.length - likelyFiles.length,
		omittedTests: input.ranked.relatedTests.length - relatedTests.length,
		omittedVerificationCommands:
			input.ranked.verificationCandidates.length -
			verificationCandidates.length,
	};
	const metadata = input.generation.structure.metadata;
	return projectExplorationCatalogResultSchema.parse({
		ok: true,
		status:
			input.readiness === "available" &&
			input.generation.status === "available" &&
			degradedReasons.size === 0
				? "completed"
				: "degraded",
		version: "v1",
		generatedAt: input.generatedAt,
		generation: {
			projectId: input.generation.projectId,
			scanRunId: input.generation.scanRunId,
			generationId: input.generation.generationId,
			snapshotRef: metadata.snapshotRef,
			sourceTreeHash: metadata.sourceTreeHash,
			sourceStateHash: metadata.sourceStateHash,
			sourceRevision: metadata.sourceRevision,
			readiness: input.readiness,
		},
		focusResolution: {
			matchedPaths: input.resolution.matchedPaths,
			matchedModuleIds: input.resolution.matchedModuleInputs,
			matchedTerms: input.resolution.matchedTerms,
			unmatched: input.resolution.unmatched,
		},
		likelyFiles,
		relatedTests,
		verificationCandidates,
		truncation,
		degradedReasons: [...degradedReasons].sort(compare),
	});
}

function buildCatalogV2Result(input: {
	generation: ProjectExplorationGenerationV2View;
	readiness: Readiness;
	limits?: ProjectExplorationCatalogInput["limits"];
	generatedAt: string;
	snapshot: CatalogSnapshot;
	resolution: CatalogCandidateResolution;
	ranked: RankedCatalogCandidates;
}): ProjectExplorationCatalogV2Result {
	const limits = { ...DEFAULT_LIMITS, ...input.limits };
	const likelyFiles = input.ranked.likelyFiles.slice(0, limits.files);
	const relatedTests = input.ranked.relatedTests.slice(0, limits.tests);
	const verificationCandidates = input.ranked.verificationCandidates.slice(
		0,
		limits.verificationCommands,
	);
	const sourceReadiness = summarizeProjectExplorationReadiness(
		input.generation.projectStructure.snapshot,
		input.generation.status,
	);
	const readiness: ProjectExplorationCatalogReadiness =
		likelyFiles.length === 0
			? {
					...sourceReadiness,
					usability: "unusable",
					reasonCodes: uniqueSorted([
						...sourceReadiness.reasonCodes,
						"no_catalog_candidates",
					]),
				}
			: sourceReadiness;
	const degradedReasons = new Set<string>();
	if (input.readiness === "stale") degradedReasons.add("generation_stale");
	if (
		input.generation.status === "degraded" ||
		input.readiness === "degraded"
	) {
		degradedReasons.add("generation_degraded");
	}
	if (input.resolution.unmatchedPaths.length > 0) {
		degradedReasons.add("focus_path_unmatched");
	}
	if (input.resolution.unmatchedModuleIds.length > 0) {
		degradedReasons.add("focus_module_unmatched");
	}
	if (input.resolution.unmatchedTerms.length > 0) {
		degradedReasons.add("focus_terms_unmatched");
	}
	if (input.snapshot.status === "partial") {
		degradedReasons.add("project_structure_partial");
	}
	if (
		input.generation.projectStructure.snapshot.summary
			.unresolvedReferenceCount > 0
	) {
		degradedReasons.add("project_structure_unresolved_references");
	}
	if (relatedTests.length === 0) degradedReasons.add("related_tests_missing");
	if (verificationCandidates.length === 0) {
		degradedReasons.add("verification_candidates_missing");
	}
	const truncation = {
		truncated:
			likelyFiles.length < input.ranked.likelyFiles.length ||
			relatedTests.length < input.ranked.relatedTests.length ||
			verificationCandidates.length <
				input.ranked.verificationCandidates.length,
		omittedFiles: input.ranked.likelyFiles.length - likelyFiles.length,
		omittedTests: input.ranked.relatedTests.length - relatedTests.length,
		omittedVerificationCommands:
			input.ranked.verificationCandidates.length -
			verificationCandidates.length,
	};
	const metadata = input.generation.projectStructure.metadata;
	if (!metadata.snapshotRef) {
		throw new Error("Project Structure V2 snapshotRef is missing.");
	}
	return projectExplorationCatalogV2ResultSchema.parse({
		ok: true,
		status:
			input.readiness === "available" &&
			input.generation.status === "available" &&
			readiness.usability === "usable" &&
			degradedReasons.size === 0
				? "completed"
				: "degraded",
		version: "v2",
		generatedAt: input.generatedAt,
		source: {
			structureSchemaVersion: "project-structure-v2",
			snapshotRef: metadata.snapshotRef,
			revision: metadata.sourceRevision,
		},
		readiness,
		focusResolution: {
			matchedPaths: input.resolution.matchedPaths,
			matchedModuleIds: input.resolution.matchedModuleInputs,
			matchedTerms: input.resolution.matchedTerms,
			unmatched: input.resolution.unmatched,
		},
		likelyFiles,
		relatedTests,
		verificationCandidates,
		truncation,
		degradedReasons: [...degradedReasons].sort(compare),
	});
}

export function summarizeProjectExplorationReadiness(
	snapshot: ProjectStructureSnapshotV2,
	generationStatus: "available" | "degraded" = "available",
): ProjectExplorationCatalogReadiness {
	const stages = Object.values(snapshot.readiness);
	const reasonCodes = new Set(stages.flatMap((stage) => stage.reasonCodes));
	for (const diagnostic of snapshot.diagnostics) {
		if (diagnostic.impact !== "none") reasonCodes.add(diagnostic.code);
	}
	const criticalStageFailed =
		snapshot.readiness.inventory.status === "failed" ||
		snapshot.readiness.analysis.status === "failed";
	if (snapshot.files.length === 0) reasonCodes.add("no_structure_files");
	if (snapshot.summary.analyzedFileCount === 0) {
		reasonCodes.add("no_analyzed_files");
	}
	if (snapshot.status === "partial") {
		reasonCodes.add("project_structure_partial");
	}
	if (generationStatus === "degraded") reasonCodes.add("generation_degraded");
	const unusable = criticalStageFailed || snapshot.files.length === 0;
	const degraded =
		!unusable &&
		(generationStatus === "degraded" ||
			snapshot.status === "partial" ||
			stages.some((stage) => stage.status !== "available"));
	return {
		usability: unusable ? "unusable" : degraded ? "degraded_usable" : "usable",
		reasonCodes: [...reasonCodes].sort(compare),
		coverage: {
			inventoriedFiles: snapshot.inventory.coverage.includedFileCount,
			analyzedFiles: snapshot.summary.analyzedFileCount,
			resolvedReferences: snapshot.summary.resolvedReferenceCount,
			unresolvedReferences: snapshot.summary.unresolvedReferenceCount,
			inferredModules: snapshot.summary.moduleCount,
		},
	};
}
