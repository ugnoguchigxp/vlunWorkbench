import type { ProjectStructureSnapshotV2 } from "../../../shared/schemas/project-structure.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type {
	ExplorationFileClue,
	ExplorationFileReasonCode,
	ExplorationTestClue,
	ExplorationVerificationClue,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import {
	compare,
	inModule,
	lexicalMatch,
	type NormalizedFocus,
	termMatchesFile,
	termMatchesFilePathOrTag,
	termMatchesGeneration,
	termMatchesModule,
	uniqueSorted,
} from "./exploration-catalog-policy";
import type { buildStaticIntelligenceModuleCandidates } from "./module-candidates";

export type CatalogSnapshot = {
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

type ModuleCandidates = ReturnType<
	typeof buildStaticIntelligenceModuleCandidates
>;

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

export function catalogSnapshotFromV2(
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

export function buildRankedCatalogCandidates(input: {
	snapshot: CatalogSnapshot;
	modules: ModuleCandidates;
	focus: NormalizedFocus;
	verification: Array<Omit<ExplorationVerificationClue, "rank">>;
}) {
	const resolution = resolveFocusSeeds(
		input.snapshot,
		input.modules,
		input.focus,
	);
	const files = collectFileCandidates({ ...input, resolution });
	const tests = collectTestCandidates({
		snapshot: input.snapshot,
		modules: input.modules,
		resolution,
	});
	return {
		resolution,
		ranked: sortAndRankCandidates(files, tests, input.verification),
	};
}

export type CatalogCandidateResolution = ReturnType<
	typeof buildRankedCatalogCandidates
>["resolution"];

export type RankedCatalogCandidates = ReturnType<
	typeof buildRankedCatalogCandidates
>["ranked"];

function resolveFocusSeeds(
	snapshot: CatalogSnapshot,
	modules: ModuleCandidates,
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
	modules: ModuleCandidates;
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
	modules: ModuleCandidates;
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
