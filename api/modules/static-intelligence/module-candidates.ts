import { createHash } from "node:crypto";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	staticIntelligenceModuleCandidateSchema,
	type StaticIntelligenceModuleCandidate,
} from "../../../shared/schemas/static-intelligence-module.schema";
import { compareSeverity } from "./file-risk-index";

export function buildStaticIntelligenceModuleCandidates(params: {
	snapshot: CodeStructureSnapshot;
	exportPayload: StaticIntelligenceExportV1;
}): StaticIntelligenceModuleCandidate[] {
	const groups = new Map<string, typeof params.snapshot.files>();
	for (const file of params.snapshot.files) {
		const prefix = modulePrefix(file.path);
		const files = groups.get(prefix) ?? [];
		files.push(file);
		groups.set(prefix, files);
	}
	const moduleByFile = new Map<string, string>();
	for (const [prefix, files] of groups) {
		for (const file of files) moduleByFile.set(file.path, prefix);
	}

	return [...groups.entries()]
		.map(([pathPrefix, files]) => {
			const sortedFiles = [...files].sort((a, b) =>
				a.path.localeCompare(b.path),
			);
			const risks = params.exportPayload.fileRiskIndex.filter(
				(entry) =>
					entry.path === pathPrefix || entry.path.startsWith(`${pathPrefix}/`),
			);
			const dependencies = new Set<string>();
			for (const edge of params.snapshot.edges) {
				if (
					edge.kind !== "imports" ||
					moduleByFile.get(edge.from) !== pathPrefix
				)
					continue;
				const target = moduleByFile.get(edge.to);
				if (target && target !== pathPrefix) dependencies.add(target);
			}
			const maxSeverity =
				risks
					.map((risk) => risk.maxSeverity)
					.sort((a, b) => compareSeverity(b, a))[0] ?? "unknown";
			const qualities = risks.map((risk) => risk.evidenceQuality);
			const result: StaticIntelligenceModuleCandidate = {
				id: `module:${createHash("sha256").update(pathPrefix).digest("hex").slice(0, 16)}`,
				pathPrefix,
				label: pathPrefix.split("/").at(-1) ?? pathPrefix,
				fileCount: sortedFiles.length,
				entrypointFiles: sortedFiles
					.filter((file) => isEntrypoint(file.path, file.tags))
					.map((file) => file.path),
				roleTags: uniqueSorted(sortedFiles.flatMap((file) => file.tags)),
				exportedSymbols: uniqueSorted(
					sortedFiles.flatMap((file) => file.exportedSymbols),
				),
				internalDependencies: [...dependencies].sort(),
				packageDependencies: uniqueSorted(
					sortedFiles.flatMap((file) => file.packageImports),
				),
				risk: {
					findingCount: risks.reduce(
						(count, risk) => count + risk.findingCount,
						0,
					),
					maxSeverity,
					evidenceQuality: aggregateEvidenceQuality(qualities),
					fileRefs: uniqueSorted(risks.map((risk) => risk.path)),
					findingIds: uniqueSorted(risks.flatMap((risk) => risk.findingIds)),
				},
				confidence: moduleConfidence(pathPrefix, sortedFiles.length),
				reasons: moduleReasons(pathPrefix, sortedFiles.length),
			};
			return staticIntelligenceModuleCandidateSchema.parse(result);
		})
		.sort(
			(a, b) =>
				compareSeverity(b.risk.maxSeverity, a.risk.maxSeverity) ||
				b.risk.findingCount - a.risk.findingCount ||
				a.pathPrefix.localeCompare(b.pathPrefix),
		);
}

function modulePrefix(filePath: string): string {
	const parts = filePath.split("/").filter(Boolean);
	if (parts.length <= 1) return parts[0] ?? "unknown";
	if (["apps", "packages"].includes(parts[0] ?? "")) {
		return parts.slice(0, Math.min(2, parts.length)).join("/");
	}
	if (["api", "web", "shared", "src"].includes(parts[0] ?? "")) {
		return parts.slice(0, Math.min(2, parts.length)).join("/");
	}
	return parts[0] ?? "unknown";
}

function isEntrypoint(path: string, tags: string[]): boolean {
	return (
		tags.includes("route") ||
		tags.includes("handler") ||
		/(^|\/)(index|main|app|server)\.[^.]+$/.test(path)
	);
}

function moduleConfidence(pathPrefix: string, fileCount: number): number {
	const conventional = /^(apps|packages|api|web|shared|src)\//.test(pathPrefix);
	return conventional ? 0.95 : fileCount > 1 ? 0.8 : 0.65;
}

function moduleReasons(pathPrefix: string, fileCount: number): string[] {
	return [
		`deterministic path boundary: ${pathPrefix}`,
		`aggregated from ${fileCount} persisted structure file${fileCount === 1 ? "" : "s"}`,
	];
}

function aggregateEvidenceQuality(
	values: StaticIntelligenceModuleCandidate["risk"]["evidenceQuality"][],
): StaticIntelligenceModuleCandidate["risk"]["evidenceQuality"] {
	if (values.length === 0) return "none";
	if (values.every((value) => value === "none")) return "none";
	if (values.includes("unknown")) return "unknown";
	if (values.every((value) => value === "strong")) return "strong";
	if (values.some((value) => value === "strong" || value === "mixed"))
		return "mixed";
	return "weak";
}

function uniqueSorted<T extends string>(values: T[]): T[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
