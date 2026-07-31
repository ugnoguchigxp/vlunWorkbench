import { isBuiltin } from "node:module";
import path from "node:path";
import type {
	ProjectStructureDiagnostic,
	ProjectStructureReference,
} from "../../../../../shared/schemas/project-structure.schema";
import { structureDiagnostic } from "../diagnostics";
import type { ProjectInventoryEntry } from "../inventory";
import type { UnresolvedStructureReference } from "../analyzers/registry";

import { relativeResolutionCandidates } from "./resolution-candidates";
import {
	aliasCandidates,
	loadResolverConfig,
	type ResolverConfig,
	workspaceCandidates,
} from "./resolver-config";

export async function resolveStructureReferences(input: {
	references: UnresolvedStructureReference[];
	inventoryEntries: ProjectInventoryEntry[];
}): Promise<{
	references: ProjectStructureReference[];
	diagnostics: ProjectStructureDiagnostic[];
}> {
	const entriesByPath = new Map(
		input.inventoryEntries.map((entry) => [entry.path, entry]),
	);
	const entriesByLowerPath = new Map(
		input.inventoryEntries.map((entry) => [
			entry.path.toLocaleLowerCase("en-US"),
			entry,
		]),
	);
	const config = await loadResolverConfig(input.inventoryEntries);
	const diagnostics: ProjectStructureDiagnostic[] = [];
	const references = input.references.map((reference) => {
		const resolved = resolveReference(
			reference,
			entriesByPath,
			entriesByLowerPath,
			config,
		);
		if (resolved.status === "unresolved" || resolved.status === "ambiguous") {
			diagnostics.push(
				structureDiagnostic({
					code:
						resolved.diagnosticCodes[0] ??
						(resolved.status === "unresolved"
							? "resolution_target_missing"
							: "resolution_target_ambiguous"),
					scope: "resolution",
					impact: "degraded",
					path: reference.from,
					specifier: reference.specifier,
				}),
			);
		}
		if (resolved.status === "blocked") {
			diagnostics.push(
				structureDiagnostic({
					code: "resolution_target_outside_root",
					scope: "resolution",
					impact: "degraded",
					path: reference.from,
					specifier: reference.specifier,
				}),
			);
		}
		return resolved;
	});
	return {
		references: uniqueReferences(references),
		diagnostics: diagnostics.sort(compareDiagnostics),
	};
}

function resolveReference(
	reference: UnresolvedStructureReference,
	entriesByPath: Map<string, ProjectInventoryEntry>,
	entriesByLowerPath: Map<string, ProjectInventoryEntry>,
	config: ResolverConfig,
): ProjectStructureReference {
	const base = {
		from: reference.from,
		specifier: reference.specifier,
		kind: kindForReference(reference),
	};
	if (isRemoteOrInline(reference.specifier)) {
		return {
			...base,
			kind: "remote_url",
			status: "external",
			resolverId: "inline-url",
			confidence: 1,
			diagnosticCodes: [],
		};
	}
	if (
		reference.specifier.startsWith("node:") ||
		isBuiltin(reference.specifier)
	) {
		return {
			...base,
			kind: "runtime_builtin",
			status: "external",
			resolverId: "node-builtin",
			confidence: 1,
			diagnosticCodes: [],
		};
	}
	if (isVirtualModule(reference.specifier)) {
		return {
			...base,
			kind: "virtual_module",
			status: "external",
			resolverId: "virtual-module",
			confidence: 0.9,
			diagnosticCodes: [],
		};
	}
	if (!isRelativeSpecifier(reference.specifier)) {
		const aliasMatches = aliasCandidates(reference, config)
			.map((candidate) => entriesByPath.get(candidate))
			.filter((entry): entry is ProjectInventoryEntry => Boolean(entry));
		if (aliasMatches.length === 1) {
			const [target] = aliasMatches;
			if (!target) throw new Error("Alias target unexpectedly missing.");
			return {
				...base,
				status:
					target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
				target: target.path,
				resolverId: "tsconfig-paths",
				confidence: 0.95,
				diagnosticCodes: [],
			};
		}
		if (aliasMatches.length > 1) {
			return {
				...base,
				status: "ambiguous",
				resolverId: "tsconfig-paths",
				confidence: 0.5,
				diagnosticCodes: ["resolution_target_ambiguous"],
			};
		}
		const workspaceMatches = workspaceCandidates(reference.specifier, config)
			.map((candidate) => entriesByPath.get(candidate))
			.filter((entry): entry is ProjectInventoryEntry => Boolean(entry));
		if (workspaceMatches.length === 1) {
			const [target] = workspaceMatches;
			if (!target) throw new Error("Workspace target unexpectedly missing.");
			return {
				...base,
				kind: "workspace_package",
				status:
					target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
				target: target.path,
				resolverId: "workspace-package",
				confidence: 0.95,
				diagnosticCodes: [],
			};
		}
		return {
			...base,
			kind: "external_package",
			status: "external",
			resolverId: "external-package",
			confidence: 0.8,
			diagnosticCodes: [],
		};
	}

	const normalized = path.posix.normalize(
		path.posix.join(path.posix.dirname(reference.from), reference.specifier),
	);
	if (normalized === ".." || normalized.startsWith("../")) {
		return {
			...base,
			status: "blocked",
			resolverId: "relative-path",
			confidence: 1,
			diagnosticCodes: ["resolution_target_outside_root"],
		};
	}
	if (normalized === "node_modules" || normalized.startsWith("node_modules/")) {
		return {
			...base,
			status: "external",
			resolverId: "excluded-dependency",
			confidence: 0.9,
			diagnosticCodes: [],
		};
	}
	const candidates = relativeResolutionCandidates(
		normalized,
		reference.kindHint,
	);
	const matches = candidates
		.map((candidate) => entriesByPath.get(candidate))
		.filter((entry): entry is ProjectInventoryEntry => Boolean(entry));
	if (matches.length === 0) {
		const caseMismatch = candidates
			.map((candidate) =>
				entriesByLowerPath.get(candidate.toLocaleLowerCase("en-US")),
			)
			.find((entry): entry is ProjectInventoryEntry => Boolean(entry));
		if (caseMismatch) {
			return {
				...base,
				status: "unresolved",
				resolverId: "relative-path",
				confidence: 1,
				diagnosticCodes: ["resolution_case_mismatch"],
			};
		}
		return {
			...base,
			status: "unresolved",
			resolverId: "relative-path",
			confidence: 1,
			diagnosticCodes: ["resolution_target_missing"],
		};
	}
	if (matches.length > 1) {
		return {
			...base,
			status: "ambiguous",
			resolverId: "relative-path",
			confidence: 0.5,
			diagnosticCodes: ["resolution_target_ambiguous"],
		};
	}
	const [target] = matches;
	if (!target) throw new Error("Resolved target unexpectedly missing.");
	return {
		...base,
		status: target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
		target: target.path,
		resolverId: "relative-path",
		confidence: 1,
		diagnosticCodes: [],
	};
}

function kindForReference(
	reference: UnresolvedStructureReference,
): ProjectStructureReference["kind"] {
	if (reference.kindHint === "stylesheet") return "stylesheet";
	if (reference.kindHint === "asset") return "asset";
	if (reference.kindHint === "manifest") return "manifest";
	if (/\.(?:css)$/i.test(reference.specifier)) return "stylesheet";
	if (
		/\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|wasm)$/i.test(
			reference.specifier,
		)
	) {
		return "asset";
	}
	return "code_module";
}

function isRelativeSpecifier(value: string): boolean {
	return value.startsWith("./") || value.startsWith("../");
}

function isRemoteOrInline(value: string): boolean {
	return (
		value.startsWith("#") ||
		value.startsWith("data:") ||
		value.startsWith("http:") ||
		value.startsWith("https:") ||
		value.startsWith("//")
	);
}

function isVirtualModule(value: string): boolean {
	return (
		value.startsWith("\0") ||
		value.startsWith("virtual:") ||
		value.startsWith("vite:")
	);
}

function uniqueReferences(
	references: ProjectStructureReference[],
): ProjectStructureReference[] {
	const byKey = new Map<string, ProjectStructureReference>();
	for (const reference of references) {
		const key = `${reference.from}\0${reference.specifier}\0${reference.kind}`;
		byKey.set(key, reference);
	}
	return [...byKey.values()].sort(
		(left, right) =>
			left.from.localeCompare(right.from) ||
			left.specifier.localeCompare(right.specifier) ||
			left.kind.localeCompare(right.kind),
	);
}

function compareDiagnostics(
	left: ProjectStructureDiagnostic,
	right: ProjectStructureDiagnostic,
): number {
	return (
		left.code.localeCompare(right.code) ||
		(left.path ?? "").localeCompare(right.path ?? "") ||
		(left.specifier ?? "").localeCompare(right.specifier ?? "")
	);
}
