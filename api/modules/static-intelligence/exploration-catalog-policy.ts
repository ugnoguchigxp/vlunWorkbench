import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type {
	ExplorationVerificationClue,
	ProjectExplorationCatalogFailure,
	ProjectExplorationCatalogInput,
	ProjectExplorationCatalogResult,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import { projectExplorationCatalogResultSchema } from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import { redactSecrets } from "../scans/normalizers/redaction";
import { buildStaticIntelligenceModuleCandidates } from "./module-candidates";

const TARGET_RESPONSE_BYTES = 8 * 1024;
const HARD_RESPONSE_BYTES = 12 * 1024;

export type NormalizedFocus = {
	paths: string[];
	moduleIds: string[];
	terms: string[];
};

export function normalizeExplorationFocus(
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

export function collectVerificationCandidates(
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

export function fitCatalogResponseBudget(
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

export function termMatchesGeneration(
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

export function termMatchesFile(
	term: string,
	file: CodeStructureSnapshot["files"][number],
): boolean {
	return (
		termMatchesFilePathOrTag(term, file) ||
		file.exportedSymbols.some((symbol) => lexicalMatch(term, symbol)) ||
		(file.identifiers ?? []).some((name) => lexicalMatch(term, name))
	);
}

export function termMatchesFilePathOrTag(
	term: string,
	file: CodeStructureSnapshot["files"][number],
): boolean {
	const basename = file.path.split("/").at(-1) ?? file.path;
	return [file.path, basename, ...file.path.split("/"), ...file.tags].some(
		(value) => lexicalMatch(term, value),
	);
}

export function termMatchesModule(
	term: string,
	module: ReturnType<typeof buildStaticIntelligenceModuleCandidates>[number],
): boolean {
	return [module.id, module.label, module.pathPrefix, ...module.roleTags].some(
		(value) => lexicalMatch(term, value),
	);
}

export function lexicalMatch(term: string, value: string): boolean {
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

export function inModule(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

function serializedBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort(compare);
}

export function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function catalogUnavailable(
	_error: unknown,
): ProjectExplorationCatalogFailure {
	return {
		ok: false,
		status: "failed",
		message: "Project exploration catalog unavailable.",
		reasonCode: "catalog_unavailable",
	};
}
