import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectStructureReference } from "../../../../../shared/schemas/project-structure.schema";
import type { UnresolvedStructureReference } from "../analyzers/registry";
import type { ProjectInventoryEntry } from "../inventory";

export type GoModuleBoundary = {
	root: string;
	modulePath: string;
	replacementModulePaths: string[];
};

const GO_STANDARD_LIBRARY_ROOTS = new Set([
	"C",
	"archive",
	"bufio",
	"builtin",
	"bytes",
	"cmp",
	"compress",
	"container",
	"context",
	"crypto",
	"database",
	"debug",
	"embed",
	"encoding",
	"errors",
	"expvar",
	"flag",
	"fmt",
	"go",
	"hash",
	"html",
	"image",
	"index",
	"io",
	"iter",
	"log",
	"maps",
	"math",
	"mime",
	"net",
	"os",
	"path",
	"plugin",
	"reflect",
	"regexp",
	"runtime",
	"slices",
	"sort",
	"strconv",
	"strings",
	"structs",
	"sync",
	"syscall",
	"testing",
	"text",
	"time",
	"unicode",
	"unique",
	"unsafe",
	"weak",
]);

export function resolvePythonImport(
	reference: UnresolvedStructureReference,
	entriesByPath: Map<string, ProjectInventoryEntry>,
): ProjectStructureReference {
	const base = {
		from: reference.from,
		specifier: reference.specifier,
		kind: "code_module" as const,
	};
	const relativeMatch = reference.specifier.match(/^(\.+)(.*)$/);
	const candidates: string[] = [];
	if (relativeMatch) {
		const levels = relativeMatch[1]?.length ?? 0;
		const directoryParts = path.posix
			.dirname(reference.from)
			.split("/")
			.filter((part) => part && part !== ".");
		const ascents = Math.max(0, levels - 1);
		if (ascents > directoryParts.length) {
			return {
				...base,
				status: "blocked",
				resolverId: "python-import",
				confidence: 1,
				diagnosticCodes: ["resolution_target_outside_root"],
			};
		}
		const directory =
			directoryParts.slice(0, directoryParts.length - ascents).join("/") || ".";
		const suffix = (relativeMatch[2] ?? "").replaceAll(".", "/");
		const importBase = suffix ? path.posix.join(directory, suffix) : directory;
		candidates.push(...pythonModuleCandidates(importBase));
	} else {
		const importBase = reference.specifier.replaceAll(".", "/");
		candidates.push(...pythonModuleCandidates(importBase));
		candidates.push(
			...pythonModuleCandidates(path.posix.join("src", importBase)),
		);
	}
	const matches = uniqueEntries(candidates, entriesByPath);
	if (matches.length === 1) {
		const target = matches[0];
		if (!target) throw new Error("Python import target unexpectedly missing.");
		return {
			...base,
			status: target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
			target: target.path,
			resolverId: "python-import",
			confidence: relativeMatch ? 0.95 : 0.9,
			diagnosticCodes: [],
		};
	}
	if (matches.length > 1) {
		return {
			...base,
			status: "ambiguous",
			resolverId: "python-import",
			confidence: 0.5,
			diagnosticCodes: ["resolution_target_ambiguous"],
		};
	}
	return {
		...base,
		kind: relativeMatch ? "code_module" : "external_package",
		status: relativeMatch ? "unresolved" : "external",
		resolverId: "python-import",
		confidence: relativeMatch ? 0.8 : 0.75,
		diagnosticCodes: relativeMatch ? ["resolution_target_missing"] : [],
	};
}

export function resolveGoImport(
	reference: UnresolvedStructureReference,
	entriesByPath: Map<string, ProjectInventoryEntry>,
	goModules: GoModuleBoundary[],
): ProjectStructureReference {
	const base = {
		from: reference.from,
		specifier: reference.specifier,
		kind: "code_module" as const,
	};
	const boundary = goModules
		.filter(
			(module) =>
				module.root === "." ||
				reference.from === module.root ||
				reference.from.startsWith(`${module.root}/`),
		)
		.sort((left, right) => right.root.length - left.root.length)[0];
	const insideCurrentModule =
		boundary !== undefined &&
		(reference.specifier === boundary.modulePath ||
			reference.specifier.startsWith(`${boundary.modulePath}/`));
	const replacedModule = boundary?.replacementModulePaths.find(
		(modulePath) =>
			reference.specifier === modulePath ||
			reference.specifier.startsWith(`${modulePath}/`),
	);
	if (replacedModule) {
		return {
			...base,
			status: "ambiguous",
			resolverId: "go-module-import",
			confidence: 0.5,
			diagnosticCodes: ["resolution_go_replace_not_applied"],
		};
	}
	const otherRepositoryModule = goModules.find(
		(module) =>
			module.root !== boundary?.root &&
			(reference.specifier === module.modulePath ||
				reference.specifier.startsWith(`${module.modulePath}/`)),
	);
	if (!insideCurrentModule && otherRepositoryModule) {
		return {
			...base,
			status: "ambiguous",
			resolverId: "go-module-import",
			confidence: 0.5,
			diagnosticCodes: ["resolution_go_cross_module_boundary"],
		};
	}
	const importRoot = reference.specifier.split("/")[0] ?? "";
	if (!insideCurrentModule && GO_STANDARD_LIBRARY_ROOTS.has(importRoot)) {
		return {
			...base,
			kind: "runtime_builtin",
			status: "external",
			resolverId: "go-standard-library",
			confidence: 0.9,
			diagnosticCodes: [],
		};
	}
	if (
		!boundary ||
		(reference.specifier !== boundary.modulePath &&
			!reference.specifier.startsWith(`${boundary.modulePath}/`))
	) {
		return {
			...base,
			kind: "external_package",
			status: "external",
			resolverId: "go-module-import",
			confidence: 0.9,
			diagnosticCodes: [],
		};
	}
	const suffix = reference.specifier
		.slice(boundary.modulePath.length)
		.replace(/^\//, "");
	const directory = path.posix.normalize(
		path.posix.join(boundary.root === "." ? "" : boundary.root, suffix),
	);
	if (directory === ".." || directory.startsWith("../")) {
		return {
			...base,
			status: "blocked",
			resolverId: "go-module-import",
			confidence: 1,
			diagnosticCodes: ["resolution_target_outside_root"],
		};
	}
	const crossedModuleBoundary = goModules.some(
		(module) =>
			module.root !== boundary.root &&
			module.root !== "." &&
			(directory === module.root || directory.startsWith(`${module.root}/`)),
	);
	if (crossedModuleBoundary) {
		return {
			...base,
			status: "ambiguous",
			resolverId: "go-module-import",
			confidence: 0.5,
			diagnosticCodes: ["resolution_go_nested_module_boundary"],
		};
	}
	const matches = [...entriesByPath.values()]
		.filter(
			(entry) =>
				path.posix.dirname(entry.path) === (directory || ".") &&
				entry.path.endsWith(".go") &&
				!entry.path.endsWith("_test.go"),
		)
		.sort((left, right) => left.path.localeCompare(right.path));
	const target = matches[0];
	if (target) {
		return {
			...base,
			status: target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
			target: target.path,
			resolverId: "go-module-import",
			confidence: matches.length === 1 ? 0.95 : 0.9,
			diagnosticCodes: [],
		};
	}
	return {
		...base,
		status: "unresolved",
		resolverId: "go-module-import",
		confidence: 0.85,
		diagnosticCodes: ["resolution_target_missing"],
	};
}

export async function loadGoModules(
	entries: ProjectInventoryEntry[],
): Promise<GoModuleBoundary[]> {
	const output: GoModuleBoundary[] = [];
	for (const entry of entries.filter(
		(candidate) => path.posix.basename(candidate.path) === "go.mod",
	)) {
		try {
			if (entry.sizeBytes > 1024 * 1024) continue;
			const content = await fs.readFile(entry.absolutePath, "utf8");
			const modulePath = content.match(/^\s*module\s+([^\s]+)\s*$/m)?.[1];
			if (
				!modulePath ||
				modulePath.includes("\\") ||
				modulePath.startsWith("/")
			)
				continue;
			output.push({
				root: path.posix.dirname(entry.path),
				modulePath,
				replacementModulePaths: goReplacementModulePaths(content),
			});
		} catch {
			// The inventory/resolution diagnostics handle files that became unreadable.
		}
	}
	return output.sort(
		(left, right) =>
			right.root.length - left.root.length ||
			left.modulePath.localeCompare(right.modulePath),
	);
}

function goReplacementModulePaths(content: string): string[] {
	const paths = new Set<string>();
	const addReplacement = (line: string) => {
		const match = line.trim().match(/^([^\s]+)(?:\s+v[^\s]+)?\s+=>\s+[^\s]+/);
		if (match?.[1]) paths.add(match[1]);
	};
	for (const match of content.matchAll(/^\s*replace\s+([^\s(][^\n]*)$/gm)) {
		addReplacement(match[1] ?? "");
	}
	for (const block of content.matchAll(/^\s*replace\s*\(([\s\S]*?)^\s*\)/gm)) {
		for (const line of (block[1] ?? "").split(/\r?\n/)) addReplacement(line);
	}
	return [...paths].sort();
}

function pythonModuleCandidates(base: string): string[] {
	return [`${base}.py`, path.posix.join(base, "__init__.py")];
}

function uniqueEntries(
	candidates: readonly string[],
	entriesByPath: Map<string, ProjectInventoryEntry>,
): ProjectInventoryEntry[] {
	return [
		...new Map(
			candidates
				.map((candidate) => entriesByPath.get(candidate))
				.filter((entry): entry is ProjectInventoryEntry => Boolean(entry))
				.map((entry) => [entry.path, entry]),
		).values(),
	];
}
