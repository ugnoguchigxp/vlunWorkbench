import crypto from "node:crypto";
import type { ProfileToolEntry } from "../../../../../shared/schemas/scan-profile.schema";
import type {
	DiffCoverage,
	DiffManifest,
	DiffScanPreview,
	DiffToolApplicability,
	PluginDiffContext,
	ResolvedScanTarget,
} from "../../../../../shared/schemas/scan-target.schema";
import { matchesAnyPluginGlob } from "../../../project-capabilities/path-patterns";
import {
	dependencyProvidersForPaths,
	detectAffectedPluginsFromPaths,
} from "../../../project-capabilities/plugin-detector";
import { DIFF_SCAN_LIMITS, type ResolvedGitDiff } from "./git-diff-resolver";
import { DEPENDENCY_MANIFEST_SCOPE } from "../../profiles";
import { matchesScopePath } from "../../target-scope";

export type DiffScanPlan = {
	resolved: ResolvedGitDiff;
	target: ResolvedScanTarget;
	manifest: DiffManifest;
	tools: DiffToolApplicability[];
	scanPaths: string[];
	dependencyChanged: boolean;
	pluginContext: PluginDiffContext;
};

export function buildDiffScanPlan(params: {
	resolved: ResolvedGitDiff;
	tools: ProfileToolEntry[];
	detectedPluginIds?: readonly string[];
	projectInventoryPaths?: readonly string[];
}): DiffScanPlan {
	const entries = params.resolved.entries;
	const coverage: DiffCoverage = {
		changed: entries.length,
		scannable: entries.filter((entry) => entry.disposition === "scan").length,
		deleted: entries.filter((entry) => entry.disposition === "deleted").length,
		excluded: entries.filter((entry) => entry.disposition === "excluded")
			.length,
		unsupported: entries.filter((entry) => entry.disposition === "unsupported")
			.length,
		tooLarge: entries.filter((entry) => entry.disposition === "too_large")
			.length,
	};
	const scanPaths = entries
		.filter((entry) => entry.disposition === "scan")
		.map((entry) => entry.path)
		.sort((left, right) => left.localeCompare(right));
	const affectedPluginIds = detectAffectedPluginsFromPaths(scanPaths);
	const dependencyProviders = dependencyProvidersForPaths(scanPaths);
	const dependencyChanged = dependencyProviders.length > 0;
	const lockStateChanged = dependencyProviders.some((provider) =>
		scanPaths.some((candidate) =>
			matchesAnyPluginGlob(candidate, provider.lockGlobs),
		),
	);
	const dependencyCoverage = dependencyDiffCoverage(
		params.projectInventoryPaths ?? scanPaths,
		dependencyProviders,
	);
	const pluginContext: PluginDiffContext = {
		detectedPluginIds: [...new Set(params.detectedPluginIds ?? [])].sort(
			(left, right) => left.localeCompare(right),
		),
		affectedPluginIds,
		dependencyStateChanged: dependencyChanged,
		lockStateChanged,
		limitationCodes: dependencyCoverage.limitationCodes,
	};
	const targetIdentity = {
		schemaVersion: 1,
		kind: params.resolved.requested.kind,
		projectPrefix: params.resolved.projectPrefix,
		baseSha: params.resolved.baseSha,
		headSha: params.resolved.headSha,
		mergeBaseSha: params.resolved.mergeBaseSha,
		includeUntracked: params.resolved.includeUntracked,
		entries: entries.map((entry) => ({
			status: entry.status,
			path: entry.path,
			oldPath: entry.oldPath ?? null,
			contentSha256: entry.contentSha256 ?? null,
			sizeBytes: entry.sizeBytes ?? null,
			disposition: entry.disposition,
			reasonCode: entry.reasonCode,
		})),
	};
	const targetDigest = sha256(canonicalJson(targetIdentity));
	const target: ResolvedScanTarget = {
		schemaVersion: 1,
		kind: params.resolved.requested.kind,
		requested: params.resolved.requested,
		projectPrefix: params.resolved.projectPrefix,
		baseSha: params.resolved.baseSha,
		headSha: params.resolved.headSha,
		mergeBaseSha: params.resolved.mergeBaseSha,
		includeUntracked: params.resolved.includeUntracked,
		targetDigest,
		snapshotDigest: null,
		changedFileCount: coverage.changed,
		scannableFileCount: coverage.scannable,
	};
	const tools = params.tools.map((tool) =>
		buildToolApplicability({
			toolId: tool.toolId,
			coverage,
			scanPaths,
			dependencyChanged,
			dependencyCoverageEffect: dependencyCoverage.coverageEffect,
		}),
	);
	const manifest: DiffManifest = {
		schemaVersion: 1,
		target,
		limits: { ...DIFF_SCAN_LIMITS },
		coverage,
		entries,
		pluginContext,
	};
	return {
		resolved: params.resolved,
		target,
		manifest,
		tools,
		scanPaths,
		dependencyChanged,
		pluginContext,
	};
}

export function toDiffScanPreview(plan: DiffScanPlan): DiffScanPreview {
	return {
		target: plan.target,
		coverage: plan.manifest.coverage,
		entries: plan.manifest.entries.map((entry) => ({
			status: entry.status,
			path: entry.path,
			...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
			binary: entry.binary,
			inProfileScope: entry.inProfileScope,
			disposition: entry.disposition,
			reasonCode: entry.reasonCode,
		})),
		tools: plan.tools,
		pluginContext: plan.pluginContext,
	};
}

function buildToolApplicability(params: {
	toolId: string;
	coverage: DiffCoverage;
	scanPaths: string[];
	dependencyChanged: boolean;
	dependencyCoverageEffect: DiffToolApplicability["coverageEffect"];
}): DiffToolApplicability {
	const hasGaps =
		params.coverage.unsupported > 0 || params.coverage.tooLarge > 0;
	const noChanges = params.coverage.changed === 0;
	const dependencyTool = params.toolId === "osv";
	const applicable =
		!noChanges &&
		params.scanPaths.length > 0 &&
		(!dependencyTool || params.dependencyChanged);
	const reasonCode = applicable
		? null
		: noChanges
			? "no_changed_files"
			: dependencyTool && !params.dependencyChanged
				? "no_dependency_manifest_changed"
				: "no_relevant_files";
	const coverageEffect = dependencyTool
		? worstCoverageEffect(
				params.dependencyCoverageEffect,
				hasGaps ? "partial" : "covered",
			)
		: hasGaps
			? "partial"
			: "covered";
	return {
		toolId: params.toolId,
		applicability: applicable ? "applicable" : "not_applicable",
		reasonCode,
		coverageEffect,
		changedFileCount: applicable
			? dependencyTool
				? params.scanPaths.filter((path) =>
						matchesScopePath(path, DEPENDENCY_MANIFEST_SCOPE),
					).length
				: params.scanPaths.length
			: 0,
		contextFileCount: 0,
	};
}

function dependencyDiffCoverage(
	projectInventoryPaths: readonly string[],
	providers: ReturnType<typeof dependencyProvidersForPaths>,
): {
	coverageEffect: DiffToolApplicability["coverageEffect"];
	limitationCodes: string[];
} {
	const limitations = new Set<string>();
	let coverageEffect: DiffToolApplicability["coverageEffect"] = "covered";
	for (const provider of providers) {
		const coverage = provider.coverage(projectInventoryPaths);
		coverageEffect = worstCoverageEffect(
			coverageEffect,
			coverage.coverageEffect,
		);
		if (coverage.reasonCode) limitations.add(coverage.reasonCode);
		for (const limitation of coverage.limitationCodes) {
			limitations.add(limitation);
		}
	}
	return {
		coverageEffect,
		limitationCodes: [...limitations].sort((left, right) =>
			left.localeCompare(right),
		),
	};
}

function worstCoverageEffect(
	left: DiffToolApplicability["coverageEffect"],
	right: DiffToolApplicability["coverageEffect"],
): DiffToolApplicability["coverageEffect"] {
	const rank = { covered: 0, partial: 1, gap: 2 } as const;
	return rank[left] >= rank[right] ? left : right;
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonicalize(item)]),
		);
	}
	return value;
}

function sha256(value: string | Buffer): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}
