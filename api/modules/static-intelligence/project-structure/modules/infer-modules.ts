import { createHash } from "node:crypto";
import path from "node:path";
import type {
	ProjectStructureFile,
	ProjectStructureModule,
	ProjectStructureReference,
} from "../../../../../shared/schemas/project-structure.schema";
import type { ProjectInventoryEntry } from "../inventory";

export function inferProjectStructureModules(input: {
	rootRef: string;
	files: ProjectStructureFile[];
	references: ProjectStructureReference[];
	inventoryEntries: ProjectInventoryEntry[];
	workspacePatterns?: Array<{ root: string; pattern: string }>;
}): ProjectStructureModule[] {
	const packageRoots = packageRootsForInventory(
		input.inventoryEntries,
		input.workspacePatterns ?? [],
	);
	const entrypointRoots = entrypointRootsForFiles(input.files);
	const graphFallbacks = graphFallbacksForFiles(input.files, input.references);
	const filesByModule = new Map<string, ProjectStructureFile[]>();
	const boundaryByFile = new Map<
		string,
		{ pathPrefix: string; boundaryKind: ProjectStructureModule["boundaryKind"] }
	>();
	for (const file of input.files) {
		const boundary = boundaryForFile(
			file.path,
			packageRoots,
			entrypointRoots,
			graphFallbacks,
		);
		boundaryByFile.set(file.path, boundary);
		const files = filesByModule.get(boundary.pathPrefix) ?? [];
		files.push(file);
		filesByModule.set(boundary.pathPrefix, files);
	}

	return [...filesByModule.entries()]
		.map(([pathPrefix, files]) => {
			const firstBoundary = boundaryByFile.get(files[0]?.path ?? pathPrefix);
			const dependencies = new Set<string>();
			const externalDependencies = new Set<string>();
			for (const reference of input.references) {
				if (boundaryByFile.get(reference.from)?.pathPrefix !== pathPrefix)
					continue;
				if (reference.status === "external") {
					externalDependencies.add(reference.specifier);
					continue;
				}
				if (!reference.target) continue;
				const targetBoundary = boundaryByFile.get(reference.target)?.pathPrefix;
				if (targetBoundary && targetBoundary !== pathPrefix)
					dependencies.add(targetBoundary);
			}
			const sortedFiles = [...files].sort((left, right) =>
				left.path.localeCompare(right.path),
			);
			const boundaryKind = firstBoundary?.boundaryKind ?? "directory";
			return {
				id: moduleId(input.rootRef, boundaryKind, pathPrefix),
				label: path.posix.basename(pathPrefix) || pathPrefix,
				pathPrefix,
				boundaryKind,
				files: sortedFiles.map((file) => file.path),
				entrypoints: sortedFiles
					.filter((file) => isEntrypoint(file))
					.map((file) => file.path),
				internalDependencies: [...dependencies].sort((left, right) =>
					left.localeCompare(right),
				),
				externalDependencies: [...externalDependencies].sort((left, right) =>
					left.localeCompare(right),
				),
				confidence:
					boundaryKind === "workspace" || boundaryKind === "package"
						? 0.95
						: boundaryKind === "entrypoint"
							? 0.85
							: boundaryKind === "graph"
								? 0.8
								: 0.65,
				confidenceReasons:
					boundaryKind === "workspace"
						? ["workspace manifest boundary"]
						: boundaryKind === "package"
							? ["package manifest boundary"]
							: boundaryKind === "entrypoint"
								? ["entrypoint locality boundary"]
								: boundaryKind === "graph"
									? ["strongly connected reference component"]
									: ["stable directory fallback"],
			} satisfies ProjectStructureModule;
		})
		.sort((left, right) => left.pathPrefix.localeCompare(right.pathPrefix));
}

function packageRootsForInventory(
	entries: ProjectInventoryEntry[],
	workspacePatterns: Array<{ root: string; pattern: string }>,
): Array<{ pathPrefix: string; boundaryKind: "workspace" | "package" }> {
	return entries
		.filter((entry) => path.posix.basename(entry.path) === "package.json")
		.map((entry) => path.posix.dirname(entry.path))
		.filter((root) => root !== ".")
		.map((pathPrefix) => ({
			pathPrefix,
			boundaryKind: workspacePatterns.some(({ root, pattern }) =>
				matchesWorkspacePattern(
					root === "." ? pathPrefix : path.posix.relative(root, pathPrefix),
					pattern,
				),
			)
				? ("workspace" as const)
				: ("package" as const),
		}))
		.sort(
			(left, right) =>
				right.pathPrefix.length - left.pathPrefix.length ||
				left.pathPrefix.localeCompare(right.pathPrefix),
		);
}

function matchesWorkspacePattern(candidate: string, pattern: string): boolean {
	const escaped = pattern
		.replace(/^\.\//, "")
		.split("**")
		.map((part) =>
			part
				.split("*")
				.map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
				.join("[^/]*"),
		)
		.join(".*");
	return new RegExp(`^${escaped}$`).test(candidate);
}

function boundaryForFile(
	filePath: string,
	packageRoots: Array<{
		pathPrefix: string;
		boundaryKind: "workspace" | "package";
	}>,
	entrypointRoots: string[],
	graphFallbacks: Map<string, string>,
): {
	pathPrefix: string;
	boundaryKind: ProjectStructureModule["boundaryKind"];
} {
	for (const root of packageRoots) {
		if (
			filePath === root.pathPrefix ||
			filePath.startsWith(`${root.pathPrefix}/`)
		) {
			return root;
		}
	}
	for (const root of entrypointRoots) {
		if (filePath === root || filePath.startsWith(`${root}/`)) {
			return { pathPrefix: root, boundaryKind: "entrypoint" };
		}
	}
	const graphPrefix = graphFallbacks.get(filePath);
	if (graphPrefix) return { pathPrefix: graphPrefix, boundaryKind: "graph" };
	const [first] = filePath.split("/").filter(Boolean);
	return {
		pathPrefix: filePath.includes("/") ? (first ?? "root") : "root",
		boundaryKind: "directory",
	};
}

function entrypointRootsForFiles(files: ProjectStructureFile[]): string[] {
	return [
		...new Set(
			files
				.filter(isEntrypoint)
				.map((file) => path.posix.dirname(file.path))
				.filter((directory) => directory !== "."),
		),
	].sort(
		(left, right) => right.length - left.length || left.localeCompare(right),
	);
}

function graphFallbacksForFiles(
	files: ProjectStructureFile[],
	references: ProjectStructureReference[],
): Map<string, string> {
	const filePaths = new Set(files.map((file) => file.path));
	const adjacent = new Map<string, string[]>();
	for (const filePath of filePaths) adjacent.set(filePath, []);
	for (const reference of references) {
		if (
			(reference.status !== "resolved" &&
				reference.status !== "resolved_unparsed") ||
			!reference.target ||
			!filePaths.has(reference.from) ||
			!filePaths.has(reference.target)
		)
			continue;
		adjacent.get(reference.from)?.push(reference.target);
	}
	const indexByPath = new Map<string, number>();
	const lowLinkByPath = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const result = new Map<string, string>();
	let nextIndex = 0;
	const visit = (filePath: string) => {
		indexByPath.set(filePath, nextIndex);
		lowLinkByPath.set(filePath, nextIndex);
		nextIndex += 1;
		stack.push(filePath);
		onStack.add(filePath);
		for (const target of adjacent.get(filePath) ?? []) {
			if (!indexByPath.has(target)) {
				visit(target);
				lowLinkByPath.set(
					filePath,
					Math.min(
						lowLinkByPath.get(filePath) ?? 0,
						lowLinkByPath.get(target) ?? 0,
					),
				);
			} else if (onStack.has(target)) {
				lowLinkByPath.set(
					filePath,
					Math.min(
						lowLinkByPath.get(filePath) ?? 0,
						indexByPath.get(target) ?? 0,
					),
				);
			}
		}
		if (lowLinkByPath.get(filePath) !== indexByPath.get(filePath)) return;
		const component: string[] = [];
		while (stack.length > 0) {
			const member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			component.push(member);
			if (member === filePath) break;
		}
		if (component.length < 2) return;
		const prefix = commonDirectoryPrefix(component);
		for (const member of component) result.set(member, prefix);
	};
	for (const filePath of [...filePaths].sort((left, right) =>
		left.localeCompare(right),
	)) {
		if (!indexByPath.has(filePath)) visit(filePath);
	}
	return result;
}

function commonDirectoryPrefix(paths: string[]): string {
	const segments = paths.map((filePath) =>
		path.posix.dirname(filePath).split("/").filter(Boolean),
	);
	const prefix: string[] = [];
	for (let index = 0; ; index += 1) {
		const value = segments[0]?.[index];
		if (!value || !segments.every((parts) => parts[index] === value)) break;
		prefix.push(value);
	}
	return prefix.join("/") || "graph";
}

function moduleId(
	rootRef: string,
	boundaryKind: ProjectStructureModule["boundaryKind"],
	pathPrefix: string,
): string {
	return `module:${createHash("sha256")
		.update(`${rootRef}\0${boundaryKind}\0${pathPrefix}`)
		.digest("hex")
		.slice(0, 16)}`;
}

function isEntrypoint(file: ProjectStructureFile): boolean {
	return (
		file.tags.includes("route") ||
		file.tags.includes("handler") ||
		/(^|\/)(index|main|app|server)\.[^.]+$/.test(file.path)
	);
}
