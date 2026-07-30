import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ApplicationModelInput } from "./application-model-builder";

const METHODS = new Set([
	"get",
	"head",
	"options",
	"post",
	"put",
	"patch",
	"delete",
]);
const EXCLUDED = new Set([
	".git",
	"node_modules",
	"vendor",
	"dist",
	"build",
	"coverage",
	"artifacts",
]);

export async function readProjectSupplementalModelEvidence(
	projectRoot: string,
): Promise<
	Pick<ApplicationModelInput, "openApiOperations" | "databaseTables">
> {
	const root = await realpath(projectRoot);
	const openApiOperations: NonNullable<
		ApplicationModelInput["openApiOperations"]
	> = [];
	const databaseTables: NonNullable<ApplicationModelInput["databaseTables"]> =
		[];
	let files = 0;
	let bytes = 0;
	let entries = 0;
	await walk(root, 0);
	return {
		openApiOperations: openApiOperations.sort((left, right) =>
			left.ref.localeCompare(right.ref),
		),
		databaseTables: databaseTables.sort((left, right) =>
			left.ref.localeCompare(right.ref),
		),
	};

	async function walk(directory: string, depth: number): Promise<void> {
		if (depth > 64) throw new Error("application_model_evidence_depth_limit");
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (++entries > 100_000)
				throw new Error("application_model_evidence_entry_limit");
			if (entry.isSymbolicLink()) continue;
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!EXCLUDED.has(entry.name)) await walk(absolute, depth + 1);
				continue;
			}
			const extension = path.extname(entry.name).toLowerCase();
			const isOpenApi = /^(openapi|swagger)(?:[._-].*)?\.(json|ya?ml)$/i.test(
				entry.name,
			);
			if (!isOpenApi && extension !== ".sql") continue;
			if (++files > 200)
				throw new Error("application_model_evidence_file_limit");
			const size = (await stat(absolute)).size;
			if (size > 2 * 1024 * 1024) continue;
			bytes += size;
			if (bytes > 10 * 1024 * 1024)
				throw new Error("application_model_evidence_size_limit");
			const relative = path.relative(root, absolute).split(path.sep).join("/");
			const content = await readFile(absolute, "utf8");
			if (extension === ".sql") {
				for (const match of content.matchAll(
					/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w.-]*)/gi,
				))
					databaseTables.push({
						name: match[1],
						ref: `${relative}:${lineAt(content, match.index ?? 0)}`,
					});
			} else if (extension === ".json") {
				readJsonOpenApi(content, relative, openApiOperations);
			} else {
				readYamlOpenApi(content, relative, openApiOperations);
			}
		}
	}
}

function readJsonOpenApi(
	content: string,
	filePath: string,
	output: NonNullable<ApplicationModelInput["openApiOperations"]>,
): void {
	const document = JSON.parse(content) as {
		openapi?: string;
		swagger?: string;
		paths?: Record<string, Record<string, unknown>>;
	};
	if (!document.openapi && !document.swagger)
		throw new Error(`application_model_openapi_version_missing:${filePath}`);
	for (const [routePath, operations] of Object.entries(document.paths ?? {}))
		for (const method of Object.keys(operations))
			if (METHODS.has(method.toLowerCase()))
				output.push({
					method: method.toUpperCase() as (typeof output)[number]["method"],
					path: routePath,
					ref: `${filePath}#/paths/${escapePointer(routePath)}/${method}`,
				});
}

function readYamlOpenApi(
	content: string,
	filePath: string,
	output: NonNullable<ApplicationModelInput["openApiOperations"]>,
): void {
	if (!/^(?:openapi|swagger):/m.test(content))
		throw new Error(`application_model_openapi_version_missing:${filePath}`);
	let currentPath: string | null = null;
	for (const [index, line] of content.split(/\r?\n/).entries()) {
		const pathMatch = line.match(/^\s{2}(["']?)(\/[^"']*)\1:\s*$/);
		if (pathMatch) {
			currentPath = pathMatch[2];
			continue;
		}
		const methodMatch = line.match(
			/^\s{4}(get|head|options|post|put|patch|delete):\s*$/i,
		);
		if (currentPath && methodMatch)
			output.push({
				method:
					methodMatch[1].toUpperCase() as (typeof output)[number]["method"],
				path: currentPath,
				ref: `${filePath}:${index + 1}`,
			});
	}
}

function lineAt(content: string, index: number): number {
	return content.slice(0, index).split("\n").length;
}

function escapePointer(value: string): string {
	return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
