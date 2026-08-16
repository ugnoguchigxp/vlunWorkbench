import fs from "node:fs/promises";
import path from "node:path";

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
	projectRoot?: string;
	resolveProjectProperty?: (params: {
		projectRoot: string;
		resourceName: string;
		key: string;
		fallback: string;
	}) => Promise<ProjectPropertyResolution>;
}): Promise<ConfiguredHashEvaluation | null> {
	const assignment = params.methodSource.match(
		/String\s+(\w+)\s*=\s*(\w+)\.getProperty\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*;/,
	);
	const algorithmVariable = assignment?.[1];
	const propertiesVariable = assignment?.[2];
	const key = assignment?.[3];
	const fallback = assignment?.[4];
	if (
		!algorithmVariable ||
		!propertiesVariable ||
		!key ||
		fallback === undefined
	) {
		return null;
	}
	const sinkPattern = new RegExp(
		`(?:[\\w$.]+\\.)?getInstance\\(\\s*${escapeRegex(algorithmVariable)}\\s*(?:,|\\))`,
	);
	if (!sinkPattern.test(params.methodSource)) return null;
	const loadPattern = new RegExp(
		`${escapeRegex(propertiesVariable)}\\.load\\([\\s\\S]*?getResourceAsStream\\(\\s*"([^"]+)"\\s*\\)[\\s\\S]*?\\)\\s*;`,
	);
	const resourceName = params.methodSource.match(loadPattern)?.[1];
	if (!resourceName || !params.projectRoot) return "unresolved";
	const resolve = params.resolveProjectProperty ?? resolveProjectProperty;
	const resolution = await resolve({
		projectRoot: params.projectRoot,
		resourceName,
		key,
		fallback,
	});
	if (resolution.status === "ambiguous") return "ambiguous";
	if (resolution.status === "resource_missing") return "unresolved";
	return isWeakDigestAlgorithm(resolution.value) ? "weak" : "strong";
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
	const candidates = await findResourceCandidates(root, normalizedResource);
	if (candidates.length === 0) return { status: "resource_missing" };
	const values = new Set<string>();
	for (const candidate of candidates) {
		const candidatePath = path.resolve(candidate);
		if (!isPathInside(candidatePath, root)) continue;
		const size = await fs.stat(candidatePath).then((entry) => entry.size);
		if (size > MAX_RESOURCE_BYTES) return { status: "ambiguous" };
		const properties = parseJavaProperties(
			await fs.readFile(candidatePath, "utf8"),
		);
		values.add(properties.get(params.key) ?? params.fallback);
	}
	if (values.size !== 1) return { status: "ambiguous" };
	return { status: "resolved", value: [...values][0] ?? params.fallback };
}

function isWeakDigestAlgorithm(value: string): boolean {
	return /^(?:MD5|SHA-?1)$/i.test(value.trim());
}

async function findResourceCandidates(
	root: string,
	resourceName: string,
): Promise<string[]> {
	const matches: string[] = [];
	let visited = 0;
	const visit = async (directory: string, depth: number): Promise<void> => {
		if (
			depth > MAX_DIRECTORY_DEPTH ||
			visited >= MAX_DIRECTORY_ENTRIES ||
			matches.length >= MAX_RESOURCE_CANDIDATES
		) {
			return;
		}
		const entries = await fs
			.readdir(directory, { withFileTypes: true })
			.catch(() => []);
		for (const entry of entries) {
			if (++visited > MAX_DIRECTORY_ENTRIES) return;
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					await visit(entryPath, depth + 1);
				}
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
			if (matches.length >= MAX_RESOURCE_CANDIDATES) return;
		}
	};
	await visit(root, 0);
	return matches.sort();
}

function parseJavaProperties(source: string): Map<string, string> {
	const properties = new Map<string, string>();
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith("!")) continue;
		const match = line.match(/^([^:=\s]+)\s*(?:=|:)\s*(.*)$/);
		if (match?.[1] !== undefined && match[2] !== undefined) {
			properties.set(match[1], match[2].trim());
		}
	}
	return properties;
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
