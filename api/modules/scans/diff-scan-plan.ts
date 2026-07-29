import crypto from "node:crypto";
import type {
	DiffCoverage,
	DiffManifest,
	DiffScanPreview,
	DiffToolApplicability,
	ResolvedScanTarget,
} from "../../../shared/schemas/scan-target.schema";
import type { ProfileToolEntry } from "../../../shared/schemas/scan-profile.schema";
import { DEPENDENCY_MANIFEST_SCOPE } from "./profiles";
import { DIFF_SCAN_LIMITS, type ResolvedGitDiff } from "./git-diff-resolver";
import { matchesScopePath } from "./target-scope";

export type DiffScanPlan = {
	resolved: ResolvedGitDiff;
	target: ResolvedScanTarget;
	manifest: DiffManifest;
	tools: DiffToolApplicability[];
	scanPaths: string[];
	dependencyChanged: boolean;
};

const SEMGREP_MAX_EXPLICIT_TARGETS = 512;
const SEMGREP_MAX_ESTIMATED_ARG_BYTES = 96 * 1024;

export function shouldUseChangedWorkspaceForSemgrep(
	scanPaths: string[],
): boolean {
	if (scanPaths.length > SEMGREP_MAX_EXPLICIT_TARGETS) return true;
	const estimatedBytes = scanPaths.reduce(
		(total, scanPath) => total + Buffer.byteLength(scanPath, "utf8") + 256,
		0,
	);
	return estimatedBytes > SEMGREP_MAX_ESTIMATED_ARG_BYTES;
}

export function buildDiffScanPlan(params: {
	resolved: ResolvedGitDiff;
	tools: ProfileToolEntry[];
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
	const dependencyChanged = entries.some(
		(entry) =>
			entry.disposition === "scan" &&
			matchesScopePath(entry.path, DEPENDENCY_MANIFEST_SCOPE),
	);
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
		}),
	);
	const manifest: DiffManifest = {
		schemaVersion: 1,
		target,
		limits: { ...DIFF_SCAN_LIMITS },
		coverage,
		entries,
	};
	return {
		resolved: params.resolved,
		target,
		manifest,
		tools,
		scanPaths,
		dependencyChanged,
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
	};
}

function buildToolApplicability(params: {
	toolId: string;
	coverage: DiffCoverage;
	scanPaths: string[];
	dependencyChanged: boolean;
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
	return {
		toolId: params.toolId,
		applicability: applicable ? "applicable" : "not_applicable",
		reasonCode,
		coverageEffect: hasGaps ? "partial" : "covered",
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
