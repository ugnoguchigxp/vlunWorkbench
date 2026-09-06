import fs from "node:fs/promises";
import path from "node:path";
import { parseJavaProperties } from "./java-properties";
import {
	descendants,
	javaText,
	parseJavaSource,
	tokens,
} from "./java-source-analysis";

const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_DIRECTORY_DEPTH = 12;
const MAX_RESOURCE_CANDIDATES = 20;
const MAX_RESOURCE_BYTES = 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"build",
	"dist",
	"target",
	"vendor",
]);

export type ProjectPropertyResolution =
	| { status: "resolved"; value: string }
	| { status: "resource_missing" }
	| { status: "ambiguous" };

export type ConfiguredHashEvaluation =
	| "weak"
	| "strong"
	| "unresolved"
	| "ambiguous";

export async function evaluateConfiguredHashFlow(params: {
	methodSource: string;
	sinkOffset?: number;
	projectRoot?: string;
	resolveProjectProperty?: (params: {
		projectRoot: string;
		resourceName: string;
		key: string;
		fallback: string;
	}) => Promise<ProjectPropertyResolution>;
}): Promise<ConfiguredHashEvaluation | null> {
	const wrapped = `class Configuration { void run() {${params.methodSource}\n} }`;
	const program = parseJavaSource(wrapped);
	if (!program) return "unresolved";
	const prefixLength = "class Configuration { void run() {".length;
	const sinkCalls = descendants(program.root, "primary").filter((node) =>
		/^(?:java\.security\.)?MessageDigest\.getInstance\(/.test(javaText(node)),
	);
	const sink =
		params.sinkOffset === undefined
			? sinkCalls.length === 1
				? sinkCalls[0]
				: undefined
			: sinkCalls.find(
					(node) =>
						node.location.startOffset ===
						prefixLength + (params.sinkOffset ?? 0),
				);
	if (!sink) return sinkCalls.length ? "ambiguous" : null;
	const sinkText = javaText(sink);
	const algorithmVariable = sinkText.match(/getInstance\((\w+)[,)]/)?.[1];
	if (!algorithmVariable) return null;
	const priorTokens = tokens(program.methods[0]?.body).filter(
		(token) =>
			token.startOffset < sink.location.startOffset && token.image !== "{",
	);
	const prior = priorTokens.map((token) => token.image).join(" ");
	const assignmentPattern = new RegExp(
		`String\\s+${escapeRegex(algorithmVariable)}\\s*=\\s*(\\w+)\\s*\\.\\s*getProperty\\s*\\(\\s*("(?:[^"\\\\]|\\\\.)*")\\s*,\\s*("(?:[^"\\\\]|\\\\.)*")\\s*\\)\\s*;`,
		"g",
	);
	const assignments = [...prior.matchAll(assignmentPattern)];
	if (assignments.length === 0) return null;
	if (assignments.length !== 1) return "unresolved";
	const assignment = assignments[0];
	const propertiesVariable = assignment?.[1];
	let key: string, fallback: string;
	try {
		key = JSON.parse(assignment?.[2] ?? "");
		fallback = JSON.parse(assignment?.[3] ?? "");
	} catch {
		return "unresolved";
	}
	if (!assignment || !propertiesVariable) return "unresolved";
	const beforeAssignment = prior.slice(0, assignment.index);
	const afterAssignment = prior.slice(
		(assignment.index ?? 0) + assignment[0].length,
	);
	if (
		new RegExp(`\\b${escapeRegex(algorithmVariable)}\\b`).test(afterAssignment)
	)
		return "unresolved";
	const loads = [
		...beforeAssignment.matchAll(
			new RegExp(
				`\\b${escapeRegex(propertiesVariable)}\\s*\\.\\s*load\\s*\\(([^;]+)\\)\\s*;`,
				"g",
			),
		),
	];
	if (loads.length !== 1) return "unresolved";
	const load = loads[0];
	const loadExpression = load?.[1]?.replace(
		/\s+(?=(?:[^"\\]*(?:\\.[^"\\]*)*"[^"\\]*(?:\\.[^"\\]*)*")*[^"\\]*$)/g,
		"",
	);
	if (
		!loadExpression ||
		!/^(?:(?:this\.)?getClass\(\)|[\w$.]+\.class)\.getClassLoader\(\)\.getResourceAsStream\("(?:[^"\\]|\\.)*"\)$/.test(
			loadExpression,
		)
	)
		return "unresolved";
	const resourceLiteral = load?.[1]?.match(
		/getResourceAsStream\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/,
	)?.[1];
	let resourceName: string | undefined;
	try {
		resourceName = resourceLiteral ? JSON.parse(resourceLiteral) : undefined;
	} catch {
		return "unresolved";
	}
	// Only a fresh Properties object followed by one unconditional load and read
	// is proven. Aliasing, setProperty/put, additional loads, and branches need review.
	const construction = new RegExp(
		`(?:java\\s*\\.\\s*util\\s*\\.\\s*)?Properties\\s+${escapeRegex(propertiesVariable)}\\s*=\\s*new\\s+(?:java\\s*\\.\\s*util\\s*\\.\\s*)?Properties\\s*\\(\\s*\\)\\s*;`,
	);
	const constructed = beforeAssignment.match(construction);
	const proofWindow = prior.slice(constructed?.index ?? 0);
	const remainder = beforeAssignment
		.slice(constructed?.index ?? 0)
		.replace(construction, "")
		.replace(load?.[0] ?? "", "");
	if (
		!construction.test(beforeAssignment) ||
		new RegExp(`\\b${escapeRegex(propertiesVariable)}\\b`).test(remainder) ||
		/\b(?:if|for|while|switch|catch|finally|return|throw)\b/.test(proofWindow)
	)
		return "unresolved";
	if (!resourceName || !params.projectRoot) return "unresolved";
	const resolve = params.resolveProjectProperty ?? resolveProjectProperty;
	const resolution = await resolve({
		projectRoot: params.projectRoot,
		resourceName,
		key,
		fallback,
	}).catch((): ProjectPropertyResolution => ({ status: "ambiguous" }));
	if (resolution.status === "ambiguous") return "ambiguous";
	if (resolution.status === "resource_missing") return "unresolved";
	if (isWeakDigestAlgorithm(resolution.value)) return "weak";
	return /^(?:SHA-?(?:224|256|384|512)(?:\/(?:224|256))?|SHA3-(?:224|256|384|512))$/i.test(
		resolution.value,
	)
		? "strong"
		: "unresolved";
}

export async function resolveProjectProperty(params: {
	projectRoot: string;
	resourceName: string;
	key: string;
	fallback: string;
}): Promise<ProjectPropertyResolution> {
	const root = path.resolve(params.projectRoot);
	const normalizedResource = params.resourceName.replaceAll("\\", "/");
	if (
		normalizedResource.startsWith("/") ||
		normalizedResource.split("/").some((segment) => segment === "..") ||
		/[\0\r\n]/.test(normalizedResource)
	) {
		return { status: "resource_missing" };
	}
	const search = await findResourceCandidates(root, normalizedResource);
	if (!search.complete) return { status: "ambiguous" };
	const candidates = search.paths;
	if (candidates.length === 0) return { status: "resource_missing" };
	const values = new Set<string>();
	for (const candidate of candidates) {
		const candidatePath = path.resolve(candidate);
		if (!isPathInside(candidatePath, root)) continue;
		const size = await fs.stat(candidatePath).then((entry) => entry.size);
		if (size > MAX_RESOURCE_BYTES) return { status: "ambiguous" };
		const properties = parseJavaProperties(
			await fs.readFile(candidatePath, "latin1"),
		);
		if (!properties) return { status: "ambiguous" };
		values.add(properties.get(params.key) ?? params.fallback);
	}
	if (values.size !== 1) return { status: "ambiguous" };
	return { status: "resolved", value: [...values][0] ?? params.fallback };
}

function isWeakDigestAlgorithm(value: string): boolean {
	return /^(?:MD2|MD4|MD5|SHA|SHA-?1)$/i.test(value);
}

async function findResourceCandidates(
	root: string,
	resourceName: string,
): Promise<{ paths: string[]; complete: boolean }> {
	const matches: string[] = [];
	let visited = 0;
	let complete = true;
	const visit = async (directory: string, depth: number): Promise<void> => {
		if (
			depth > MAX_DIRECTORY_DEPTH ||
			visited >= MAX_DIRECTORY_ENTRIES ||
			matches.length >= MAX_RESOURCE_CANDIDATES
		) {
			complete = false;
			return;
		}
		const entries = await fs
			.readdir(directory, { withFileTypes: true })
			.catch(() => {
				complete = false;
				return [];
			});
		for (const entry of entries) {
			if (++visited > MAX_DIRECTORY_ENTRIES) {
				complete = false;
				return;
			}
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					await visit(entryPath, depth + 1);
				}
			} else if (entry.isSymbolicLink()) {
				complete = false;
			} else if (entry.isFile()) {
				const relative = path
					.relative(root, entryPath)
					.split(path.sep)
					.join("/");
				if (
					relative === resourceName ||
					relative.endsWith(`/${resourceName}`)
				) {
					matches.push(entryPath);
				}
			}
			if (matches.length >= MAX_RESOURCE_CANDIDATES) {
				complete = false;
				return;
			}
		}
	};
	await visit(root, 0);
	return { paths: matches.sort(), complete };
}

function isPathInside(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
