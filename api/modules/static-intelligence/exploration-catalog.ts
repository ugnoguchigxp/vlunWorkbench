import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	type ExplorationFileClue,
	type ExplorationFileReasonCode,
	type ExplorationTestClue,
	type ExplorationVerificationClue,
	type ProjectExplorationCatalogFailure,
	type ProjectExplorationCatalogInput,
	type ProjectExplorationCatalogResult,
	projectExplorationCatalogResultSchema,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import { redactSecrets } from "../scans/normalizers/redaction";
import type { StaticIntelligenceArtifactMetadata } from "./generation-types";
import { buildStaticIntelligenceModuleCandidates } from "./module-candidates";

const DEFAULT_LIMITS = { files: 12, tests: 6, verificationCommands: 4 };
const TARGET_RESPONSE_BYTES = 8 * 1024;
const HARD_RESPONSE_BYTES = 12 * 1024;

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

type Readiness = "available" | "stale" | "degraded";
type NormalizedFocus = {
	paths: string[];
	moduleIds: string[];
	terms: string[];
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
		const normalizedFocus = normalizeFocus(input.focus);
		const modules = buildStaticIntelligenceModuleCandidates({
			snapshot: input.generation.structure.snapshot,
			exportPayload: input.generation.export.payload,
		});
		const resolution = resolveFocusSeeds(
			input.generation.structure.snapshot,
			modules,
			normalizedFocus,
		);
		const files = collectFileCandidates({
			snapshot: input.generation.structure.snapshot,
			modules,
			focus: normalizedFocus,
			resolution,
		});
		const tests = collectTestCandidates({
			snapshot: input.generation.structure.snapshot,
			modules,
			resolution,
		});
		const verification = collectVerificationCandidates(
			input.generation.export.payload,
		);
		const ranked = sortAndRankCandidates(files, tests, verification);
		const result = buildCatalogResult({
			...input,
			resolution,
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

function normalizeFocus(
	focus: ProjectExplorationCatalogInput["focus"],
): NormalizedFocus {
	return {
		paths: uniqueSorted(focus.paths ?? []),
		moduleIds: uniqueSorted(focus.moduleIds ?? []),
		terms: uniqueSorted(
			(focus.terms ?? []).map((term) => normalizeLexical(term)),
		),
	};
}

function resolveFocusSeeds(
	snapshot: CodeStructureSnapshot,
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
	snapshot: CodeStructureSnapshot;
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
	snapshot: CodeStructureSnapshot;
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

function collectVerificationCandidates(
	exportPayload: StaticIntelligenceExportV1,
): Array<Omit<ExplorationVerificationClue, "rank">> {
	return uniqueSorted(
		(exportPayload.handoff?.verificationCommands ?? [])
			.map((command) =>
				sanitizeVerificationCommand(command, exportPayload.project.rootPath),
			)
			.filter(Boolean),
	).map((command, index) => ({
		command,
		candidateOnly: true,
		sourceRefs: [`verification_command:${index + 1}`],
	}));
}

function sanitizeVerificationCommand(
	command: string,
	projectRoot: string | undefined,
): string {
	const withoutProjectRoot = projectRoot
		? command.split(projectRoot).join("<project-root>")
		: command;
	return redactSecrets(withoutProjectRoot.trim())
		.replaceAll(/\/Users\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/\/home\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/[A-Za-z]:\\Users\\[^\s"'`)]+/g, "<redacted-path>");
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

function fitCatalogResponseBudget(
	initial: ProjectExplorationCatalogResult,
	totals: { files: number; tests: number; verificationCommands: number },
): ProjectExplorationCatalogResult | ProjectExplorationCatalogFailure {
	const result = structuredClone(initial);
	let budgetTrimmed = false;
	while (serializedBytes(result) > TARGET_RESPONSE_BYTES) {
		const target = result.verificationCandidates.length
			? result.verificationCandidates
			: result.relatedTests.length
				? result.relatedTests
				: result.likelyFiles;
		if (target.length === 0) break;
		target.pop();
		if (!budgetTrimmed) {
			budgetTrimmed = true;
			result.status = "degraded";
			result.degradedReasons = uniqueSorted([
				...result.degradedReasons,
				"response_budget_truncated",
			]);
		}
		result.truncation.truncated = true;
		result.truncation.omittedFiles = totals.files - result.likelyFiles.length;
		result.truncation.omittedTests = totals.tests - result.relatedTests.length;
		result.truncation.omittedVerificationCommands =
			totals.verificationCommands - result.verificationCandidates.length;
	}
	if (serializedBytes(result) > HARD_RESPONSE_BYTES) {
		return catalogUnavailable(
			"Catalog provenance exceeds hard response budget.",
		);
	}
	return projectExplorationCatalogResultSchema.parse(result);
}

function termMatchesGeneration(
	term: string,
	snapshot: CodeStructureSnapshot,
	modules: ReturnType<typeof buildStaticIntelligenceModuleCandidates>,
): boolean {
	return (
		snapshot.files.some(
			(file) => !file.tags.includes("test") && termMatchesFile(term, file),
		) || modules.some((module) => termMatchesModule(term, module))
	);
}

function termMatchesFile(
	term: string,
	file: CodeStructureSnapshot["files"][number],
): boolean {
	return (
		termMatchesFilePathOrTag(term, file) ||
		file.exportedSymbols.some((symbol) => lexicalMatch(term, symbol)) ||
		(file.identifiers ?? []).some((name) => lexicalMatch(term, name))
	);
}

function termMatchesFilePathOrTag(
	term: string,
	file: CodeStructureSnapshot["files"][number],
): boolean {
	const basename = file.path.split("/").at(-1) ?? file.path;
	return [file.path, basename, ...file.path.split("/"), ...file.tags].some(
		(value) => lexicalMatch(term, value),
	);
}

function termMatchesModule(
	term: string,
	module: ReturnType<typeof buildStaticIntelligenceModuleCandidates>[number],
): boolean {
	return [module.id, module.label, module.pathPrefix, ...module.roleTags].some(
		(value) => lexicalMatch(term, value),
	);
}

function lexicalMatch(term: string, value: string): boolean {
	const normalizedTerm = normalizeLexical(term);
	const normalizedValue = normalizeLexical(value);
	if (
		normalizedValue === normalizedTerm ||
		normalizedValue.includes(normalizedTerm)
	) {
		return true;
	}
	const termTokens = lexicalTokens(term);
	const valueTokens = new Set(lexicalTokens(value));
	return (
		termTokens.length > 0 && termTokens.every((token) => valueTokens.has(token))
	);
}

function lexicalTokens(value: string): string[] {
	const separated = value
		.normalize("NFKC")
		.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
		.toLowerCase();
	const tokens = separated.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	return uniqueSorted(tokens.map(singularize));
}

function singularize(token: string): string {
	if (token.length > 4 && token.endsWith("ies"))
		return `${token.slice(0, -3)}y`;
	if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
		return token.slice(0, -1);
	}
	return token;
}

function normalizeLexical(value: string): string {
	return value
		.normalize("NFKC")
		.trim()
		.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1-$2")
		.toLowerCase();
}

function inModule(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

function serializedBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort(compare);
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function catalogUnavailable(_error: unknown): ProjectExplorationCatalogFailure {
	return {
		ok: false,
		status: "failed",
		message: "Project exploration catalog unavailable.",
		reasonCode: "catalog_unavailable",
	};
}
