import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	resolveProjectProperty as defaultProjectPropertyResolver,
	evaluateConfiguredHashFlow,
	type ProjectPropertyResolution,
} from "./java-configured-hash-evaluator";
import { createJavaProjectResolver } from "./java-project-model";
import { proveJavaSinkSafe } from "./java-sink-proof";
import {
	type JavaSource,
	methodAt,
	parseJavaSource,
} from "./java-source-analysis";

const OWNED_JAVA_TAINT_RULES = new Set([
	"command-injection",
	"sql-injection",
	"xss-response-writer",
	"path-traversal-file",
	"ldap-injection",
	"xpath-injection",
	"trust-boundary",
]);

type SemgrepResult = {
	check_id?: string;
	path?: string;
	start?: { line?: number; col?: number };
	end?: { line?: number; col?: number };
	extra?: { metadata?: Record<string, unknown> };
};

export type JavaTaintSuppression = {
	findingId: string;
	checkId: string;
	path: string;
	line: number | null;
	sourceHash: string;
	proofInputHash: string;
	reason:
		| "contextual_output_encoding"
		| "constant_branch"
		| "constant_switch"
		| "collection_overwrite"
		| "constant_interprocedural_flow"
		| "configured_algorithm_strong"
		| "configured_algorithm_unresolved"
		| "configured_algorithm_ambiguous";
};

export async function filterOwnedJavaTaintResults(
	input: unknown,
	options: {
		readSource?: (filePath: string) => Promise<string>;
		projectRoot?: string;
		resolveProjectProperty?: (params: {
			projectRoot: string;
			resourceName: string;
			key: string;
			fallback: string;
		}) => Promise<ProjectPropertyResolution>;
	} = {},
): Promise<{
	output: unknown;
	suppressions: JavaTaintSuppression[];
}> {
	if (!isRecord(input) || !Array.isArray(input.results)) {
		return { output: input, suppressions: [] };
	}
	const readSource =
		options.readSource ?? ((filePath: string) => readFile(filePath, "utf8"));
	const sourceCache = new Map<string, Promise<string>>();
	const parsedCache = new Map<string, JavaSource | null>();
	const resolveProject = options.projectRoot
		? createJavaProjectResolver(options.projectRoot)
		: null;
	const kept: unknown[] = [];
	const suppressions: JavaTaintSuppression[] = [];
	for (const rawResult of input.results) {
		if (!isRecord(rawResult)) {
			kept.push(rawResult);
			continue;
		}
		const result = rawResult as SemgrepResult;
		const rule = ownedJavaTaintRule(result.check_id);
		const configuredHashRule = isConfiguredHashRule(result.check_id);
		if ((!rule && !configuredHashRule) || !result.path?.endsWith(".java")) {
			kept.push(rawResult);
			continue;
		}
		const source =
			sourceCache.get(result.path) ?? readSource(result.path).catch(() => "");
		sourceCache.set(result.path, source);
		const sourceText = await source;
		let program = parsedCache.get(result.path);
		if (program === undefined) {
			program = parseJavaSource(sourceText);
			if (program && resolveProject) {
				try {
					await resolveProject(program);
				} catch {
					program = null;
				}
			}
			parsedCache.set(result.path, program);
			if (parsedCache.size > 32) {
				const oldest = parsedCache.keys().next().value;
				if (oldest) parsedCache.delete(oldest);
			}
		}
		const start = sourceOffset(sourceText, result.start);
		const end = sourceOffset(sourceText, result.end);
		const method = program && start !== null ? methodAt(program, start) : null;
		if (!program || !method || start === null || end === null || end <= start) {
			kept.push(rawResult);
			continue;
		}
		const propertyInputs: string[] = [];
		const hashEvaluation = configuredHashRule
			? await evaluateConfiguredHashFlow({
					methodSource: sourceText.slice(
						method.body.location.startOffset + 1,
						method.body.location.endOffset,
					),
					sinkOffset: start - method.body.location.startOffset - 1,
					projectRoot: options.projectRoot,
					resolveProjectProperty: async (params) => {
						const resolution = await (
							options.resolveProjectProperty ?? defaultProjectPropertyResolver
						)(params);
						propertyInputs.push(
							JSON.stringify({
								resource: params.resourceName,
								key: params.key,
								fallback: params.fallback,
								resolution,
							}),
						);
						return resolution;
					},
				})
			: null;
		const reason = configuredHashRule
			? hashEvaluation === "strong"
				? "configured_algorithm_strong"
				: null
			: rule
				? safeProof(program, method, start, end, rule)
				: null;
		if (configuredHashRule && !reason) {
			const extra = isRecord(rawResult.extra) ? rawResult.extra : {};
			const metadata = isRecord(extra.metadata) ? extra.metadata : {};
			kept.push({
				...rawResult,
				extra: {
					...extra,
					message:
						hashEvaluation === "weak"
							? "The configured resource selects a weak digest algorithm."
							: "The configured digest could not be proven strong; review the algorithm configuration.",
					metadata: {
						...metadata,
						"configured-algorithm-status": hashEvaluation ?? "unresolved",
						confidence: hashEvaluation === "weak" ? "high" : "low",
					},
				},
			});
			continue;
		}
		if (!reason) {
			kept.push(rawResult);
			continue;
		}
		suppressions.push({
			findingId: suppressionFindingId(result, sourceText),
			checkId: result.check_id ?? rule ?? "configured-weak-hash",
			path: result.path,
			line: result.start?.line ?? null,
			sourceHash: sha256(sourceText),
			proofInputHash: proofInputsHash(program, propertyInputs),
			reason,
		});
	}
	return {
		output:
			suppressions.length === 0
				? input
				: {
						...input,
						results: kept,
						vulnWorkbenchSuppressed: suppressions,
					},
		suppressions,
	};
}

function safeProof(
	...args: Parameters<typeof proveJavaSinkSafe>
): ReturnType<typeof proveJavaSinkSafe> {
	try {
		return proveJavaSinkSafe(...args);
	} catch {
		return null;
	}
}
function proofInputsHash(program: JavaSource, properties: string[]): string {
	const visited = new Set<JavaSource>(),
		inputs = [...properties];
	const visit = (source: JavaSource) => {
		if (visited.has(source)) return;
		visited.add(source);
		inputs.push(sha256(source.source), ...(source.configurationEvidence ?? []));
		for (const dependency of source.dependencies ?? []) visit(dependency);
		for (const targets of source.factories?.values() ?? [])
			for (const target of targets) visit(target.program);
	};
	visit(program);
	return sha256(inputs.sort().join("\n"));
}

function isConfiguredHashRule(checkId: string | undefined): boolean {
	return (
		!!checkId &&
		/(?:^|\.)vuln-workbench\.java\.configured-weak-hash$/.test(checkId)
	);
}

function suppressionFindingId(result: SemgrepResult, source: string): string {
	return sha256(
		[
			result.check_id ?? "unknown-rule",
			sha256(source),
			String(result.start?.line ?? 0),
			String(result.start?.col ?? 0),
		].join("\0"),
	);
}

function sha256(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function ownedJavaTaintRule(checkId: string | undefined): string | null {
	if (!checkId?.includes("vuln-workbench.java.")) return null;
	const suffix = checkId.split(".").at(-1) ?? "";
	if (
		suffix === "xss-parameter-name-output" ||
		suffix === "xss-encoding-context"
	)
		return "xss-response-writer";
	return OWNED_JAVA_TAINT_RULES.has(suffix) ? suffix : null;
}

function sourceOffset(
	source: string,
	position: { line?: number; col?: number } | undefined,
): number | null {
	if (!position?.line || !position.col || position.line < 1 || position.col < 1)
		return null;
	const lines = source.split("\n");
	const line = lines[position.line - 1];
	if (line === undefined) return null;
	const bytes = Buffer.from(line);
	if (position.col > bytes.length + 1) return null;
	const prefix = bytes.subarray(0, position.col - 1).toString("utf8");
	if (prefix.includes("�")) return null;
	return (
		lines
			.slice(0, position.line - 1)
			.reduce((n, line) => n + line.length + 1, 0) + prefix.length
	);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
