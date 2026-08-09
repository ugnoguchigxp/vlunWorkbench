import type { ProjectStructureSnapshotV2 } from "../../../shared/schemas/project-structure.schema";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	type ExplorationFileClue,
	type ExplorationFileReasonCode,
	type ExplorationTestClue,
	type ExplorationVerificationClue,
	type ProjectExplorationCatalogFailure,
	type ProjectExplorationCatalogInput,
	type ProjectExplorationCatalogReadiness,
	type ProjectExplorationCatalogResult,
	type ProjectExplorationCatalogV2Result,
	projectExplorationCatalogResultSchema,
	projectExplorationCatalogV2ResultSchema,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import {
	catalogUnavailable,
	collectVerificationCandidates,
	compare,
	fitCatalogResponseBudget,
	fitCatalogV2ResponseBudget,
	inModule,
	lexicalMatch,
	type NormalizedFocus,
	normalizeExplorationFocus,
	termMatchesFile,
	termMatchesFilePathOrTag,
	termMatchesGeneration,
	termMatchesModule,
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
type CatalogSnapshot = {
	status: "completed" | "partial";
	degradedReasons: string[];
	files: Array<
		Pick<
			CodeStructureSnapshot["files"][number],
			"path" | "tags" | "exportedSymbols" | "identifiers"
		>
	>;
	edges: Array<
		Pick<CodeStructureSnapshot["edges"][number], "from" | "to" | "kind">
	>;
};
type FileCandidate = {
	path: string;
	priority: number;
	matchedFocusTerms: Set<string>;
	matchedPathTerms: Set<string>;
	roleTags: Set<ExplorationFileClue["roleTags"][number]>;
	reasonCodes: Set<ExplorationFileReasonCode>;
	sourceRefs: Set<string>;
};
type TestCandidate = {
	path: string;
	priority: number;
	matchedFocusTerms: Set<string>;
	reasonCodes: Set<ExplorationTestClue["reasonCodes"][number]>;
	sourceRefs: Set<string>;
};

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
		const rankedInput = buildRankedCatalogCandidates(
			input.generation.structure.snapshot,
			modules,
			normalizedFocus,
		);
		const verification = collectVerificationCandidates(
			input.generation.export.payload,
		);
		const ranked = sortAndRankCandidates(
			rankedInput.files,
			rankedInput.tests,
			verification,
		);
		const result = buildCatalogResult({
			...input,
			resolution: rankedInput.resolution,
			ranked,
		});
		return fitCatalogResponseBudget(result, {
			files: ranked.likelyFiles.length,
			tests: ranked.relatedTests.length,
			verificationCommands: ranked.verificationCandidates.length,
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
		const rankedInput = buildRankedCatalogCandidates(
			snapshot,
			modules,
			normalizedFocus,
		);
		const ranked = sortAndRankCandidates(
			rankedInput.files,
			rankedInput.tests,
			collectVerificationCandidates(input.generation.export.payload),
		);
		const result = buildCatalogV2Result({
			...input,
			snapshot,
			resolution: rankedInput.resolution,
			ranked,
		});
		return fitCatalogV2ResponseBudget(result, {
			files: ranked.likelyFiles.length,
			tests: ranked.relatedTests.length,
			verificationCommands: ranked.verificationCandidates.length,
		});
	} catch (error) {
		return catalogUnavailable(error);
	}
}

function buildRankedCatalogCandidates(
	snapshot: CatalogSnapshot,
	modules: ReturnType<typeof buildStaticIntelligenceModuleCandidates>,
	focus: NormalizedFocus,
) {
	const resolution = resolveFocusSeeds(snapshot, modules, focus);
	return {
		resolution,
		files: collectFileCandidates({ snapshot, modules, focus, resolution }),
		tests: collectTestCandidates({ snapshot, modules, resolution }),
	};
}

function catalogSnapshotFromV2(
	snapshot: ProjectStructureSnapshotV2,
): CatalogSnapshot {
	const filePaths = new Set(snapshot.files.map((file) => file.path));
	return {
		status: snapshot.status,
		degradedReasons: uniqueSorted([
			...snapshot.diagnostics
				.filter((diagnostic) => diagnostic.impact !== "none")
				.map((diagnostic) => diagnostic.code),
			...Object.values(snapshot.readiness).flatMap(
				(stage) => stage.reasonCodes,
			),
		]),
		files: snapshot.files.map((file) => ({
			path: file.path,
			tags: file.tags,
			exportedSymbols: file.exportedSymbols,
			identifiers: file.identifiers,
		})),
		edges: snapshot.references.flatMap((reference) =>
			reference.kind === "code_module" &&
			(reference.status === "resolved" ||
				reference.status === "resolved_unparsed") &&
			reference.target &&
			filePaths.has(reference.target)
				? [
						{
							from: reference.from,
							to: reference.target,
							kind: "imports" as const,
						},
					]
				: [],
		),
	};
}

function resolveFocusSeeds(
	snapshot: CatalogSnapshot,
	modules: ReturnType<typeof buildStaticIntelligenceModuleCandidates>,
	focus: NormalizedFocus,
) {
	const fileByPath = new Map(snapshot.files.map((file) => [file.path, file]));
	const matchedPaths = focus.paths.filter((item) => fileByPath.has(item));
	const matchedModules = modules.filter(
		(module) =>
			focus.moduleIds.includes(module.id) ||
			focus.moduleIds.includes(module.pathPrefix),
	);
	const matchedModuleInputs = focus.moduleIds.filter((item) =>
		matchedModules.some(
			(module) => module.id === item || module.pathPrefix === item,
		),
	);
	const matchedTerms = focus.terms.filter((term) =>
		termMatchesGeneration(term, snapshot, modules),
	);
	const unmatchedPaths = focus.paths.filter(
		(item) => !matchedPaths.includes(item),
	);
	const unmatchedModuleIds = focus.moduleIds.filter(
		(item) => !matchedModuleInputs.includes(item),
	);
	const unmatchedTerms = focus.terms.filter(
		(item) => !matchedTerms.includes(item),
	);
	const seedPaths = new Set(matchedPaths);
	for (const module of matchedModules) {
		for (const file of snapshot.files) {
			if (inModule(file.path, module.pathPrefix)) seedPaths.add(file.path);
		}
	}
	for (const term of matchedTerms) {
		for (const file of snapshot.files) {
			if (!file.tags.includes("test") && termMatchesFile(term, file)) {
				seedPaths.add(file.path);
			}
		}
		for (const module of modules) {
			if (!termMatchesModule(term, module)) continue;
			for (const file of snapshot.files) {
				if (
					!file.tags.includes("test") &&
					inModule(file.path, module.pathPrefix)
				) {
					seedPaths.add(file.path);
				}
			}
		}
	}
	return {
		matchedPaths,
		matchedModules,
		matchedModuleInputs,
		matchedTerms,
		unmatchedPaths,
		unmatchedModuleIds,
		unmatchedTerms,
		seedPaths,
		unmatched: uniqueSorted([
			...unmatchedPaths,
			...unmatchedModuleIds,
			...unmatchedTerms,
		]),
	};
}

function collectFileCandidates(input: {
	snapshot: CatalogSnapshot;
	modules: ReturnType<typeof buildStaticIntelligenceModuleCandidates>;
	focus: NormalizedFocus;
	resolution: ReturnType<typeof resolveFocusSeeds>;
}): Map<string, FileCandidate> {
	const files = new Map<string, FileCandidate>();
	const fileByPath = new Map(
		input.snapshot.files.map((file) => [file.path, file]),
	);
	const add = (
		path: string,
		priority: number,
		reason: ExplorationFileReasonCode,
		sourceRef: string,
	) => {
		const file = fileByPath.get(path);
		if (!file || file.tags.includes("test")) return;
		const current = files.get(path) ?? {
			path,
			priority,
			matchedFocusTerms: new Set<string>(),
			matchedPathTerms: new Set<string>(),
			roleTags: new Set(file.tags),
			reasonCodes: new Set<ExplorationFileReasonCode>(),
			sourceRefs: new Set<string>(),
		};
		current.priority = Math.min(current.priority, priority);
		current.reasonCodes.add(reason);
		current.sourceRefs.add(sourceRef);
		if (sourceRef.startsWith("term:")) {
			const term = sourceRef.slice("term:".length);
			current.matchedFocusTerms.add(term);
			if (reason === "path_term_match") current.matchedPathTerms.add(term);
		}
		files.set(path, current);
	};

	for (const path of input.resolution.matchedPaths) {
		add(path, 0, "focus_path_exact", `file:${path}`);
	}
	for (const module of input.resolution.matchedModules) {
		for (const file of input.snapshot.files) {
			if (!inModule(file.path, module.pathPrefix)) continue;
			const entrypoint = module.entrypointFiles.includes(file.path);
			add(
				file.path,
				entrypoint ? 20 : 30,
				entrypoint ? "module_entrypoint" : "same_module_role",
				`module:${module.id}`,
			);
		}
	}
	for (const term of input.resolution.matchedTerms) {
		for (const file of input.snapshot.files) {
			if (file.tags.includes("test")) continue;
			if (file.exportedSymbols.some((symbol) => lexicalMatch(term, symbol))) {
				add(file.path, 12, "exported_symbol_match", `term:${term}`);
			}
			if ((file.identifiers ?? []).some((name) => lexicalMatch(term, name))) {
				add(file.path, 15, "declared_identifier_match", `term:${term}`);
			}
			if (termMatchesFilePathOrTag(term, file)) {
				add(file.path, 10, "path_term_match", `term:${term}`);
			}
		}
		for (const module of input.modules) {
			if (!termMatchesModule(term, module)) continue;
			for (const file of input.snapshot.files) {
				if (inModule(file.path, module.pathPrefix)) {
					add(file.path, 30, "same_module_role", `term:${term}`);
				}
			}
		}
	}
	for (const edge of input.snapshot.edges) {
		if (edge.kind !== "imports") continue;
		if (input.resolution.seedPaths.has(edge.from)) {
			add(edge.to, 40, "imports_from_focus", `file:${edge.from}`);
		}
		if (input.resolution.seedPaths.has(edge.to)) {
			add(edge.from, 50, "imports_focus", `file:${edge.to}`);
		}
	}
	return files;
}

function collectTestCandidates(input: {
	snapshot: CatalogSnapshot;
	modules: ReturnType<typeof buildStaticIntelligenceModuleCandidates>;
	resolution: ReturnType<typeof resolveFocusSeeds>;
}): Map<string, TestCandidate> {
	const tests = new Map<string, TestCandidate>();
	const fileByPath = new Map(
		input.snapshot.files.map((file) => [file.path, file]),
	);
	const add = (
		path: string,
		priority: number,
		reason: ExplorationTestClue["reasonCodes"][number],
		sourceRef: string,
	) => {
		const file = fileByPath.get(path);
		if (!file?.tags.includes("test")) return;
		const current = tests.get(path) ?? {
			path,
			priority,
			matchedFocusTerms: new Set<string>(),
			reasonCodes: new Set<ExplorationTestClue["reasonCodes"][number]>(),
			sourceRefs: new Set<string>(),
		};
		current.priority = Math.min(current.priority, priority);
		current.reasonCodes.add(reason);
		current.sourceRefs.add(sourceRef);
		for (const term of input.resolution.matchedTerms) {
			if (lexicalMatch(term, file.path)) current.matchedFocusTerms.add(term);
		}
		tests.set(path, current);
	};
	for (const path of input.resolution.matchedPaths) {
		add(path, 0, "focus_path_exact", `file:${path}`);
	}
	for (const file of input.snapshot.files) {
		if (!file.tags.includes("test")) continue;
		for (const term of input.resolution.matchedTerms) {
			if (lexicalMatch(term, file.path)) {
				add(file.path, 60, "test_path_term_match", `term:${term}`);
			}
		}
	}
	for (const edge of input.snapshot.edges) {
		if (
			edge.kind === "imports" &&
			input.resolution.seedPaths.has(edge.to) &&
			fileByPath.get(edge.from)?.tags.includes("test")
		) {
			add(edge.from, 70, "direct_test_importer", `file:${edge.to}`);
		}
	}
	const seedModules = input.modules.filter((module) =>
		[...input.resolution.seedPaths].some((path) =>
			inModule(path, module.pathPrefix),
		),
	);
	for (const module of seedModules) {
		for (const file of input.snapshot.files) {
			if (inModule(file.path, module.pathPrefix)) {
				add(file.path, 80, "same_module_test", `module:${module.id}`);
			}
		}
	}
	return tests;
}

function sortAndRankCandidates(
	files: Map<string, FileCandidate>,
	tests: Map<string, TestCandidate>,
	verification: Array<Omit<ExplorationVerificationClue, "rank">>,
) {
	const likelyFiles: ExplorationFileClue[] = [...files.values()]
		.sort(
			(left, right) =>
				left.priority - right.priority ||
				right.matchedPathTerms.size - left.matchedPathTerms.size ||
				right.matchedFocusTerms.size - left.matchedFocusTerms.size ||
				compare(left.path, right.path),
		)
		.map((item, index) => ({
			rank: index + 1,
			path: item.path,
			roleTags: [...item.roleTags].sort(compare),
			reasonCodes: [...item.reasonCodes].sort(compare),
			sourceRefs: [...item.sourceRefs].sort(compare),
		}));
	const relatedTests: ExplorationTestClue[] = [...tests.values()]
		.sort(
			(left, right) =>
				left.priority - right.priority ||
				right.matchedFocusTerms.size - left.matchedFocusTerms.size ||
				compare(left.path, right.path),
		)
		.map((item, index) => ({
			rank: index + 1,
			path: item.path,
			reasonCodes: [...item.reasonCodes].sort(compare),
			sourceRefs: [...item.sourceRefs].sort(compare),
		}));
	const verificationCandidates = verification.map((item, index) => ({
		...item,
		rank: index + 1,
	}));
	return { likelyFiles, relatedTests, verificationCandidates };
}

function buildCatalogResult(input: {
	generation: ProjectExplorationGenerationView;
	readiness: Readiness;
	limits?: ProjectExplorationCatalogInput["limits"];
	generatedAt: string;
	resolution: ReturnType<typeof resolveFocusSeeds>;
	ranked: ReturnType<typeof sortAndRankCandidates>;
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
	resolution: ReturnType<typeof resolveFocusSeeds>;
	ranked: ReturnType<typeof sortAndRankCandidates>;
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
	if (snapshot.status === "partial")
		reasonCodes.add("project_structure_partial");
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
