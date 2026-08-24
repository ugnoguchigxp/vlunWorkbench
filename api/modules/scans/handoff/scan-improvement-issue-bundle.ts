import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
	IMPROVEMENT_PROMPT_HARD_CHARS,
	IMPROVEMENT_PROMPT_TARGET_CHARS,
	IMPROVEMENT_WARNING_ROLLUP_THRESHOLD,
	IMPROVEMENT_WARNING_ROLLUP_VERSION,
	MAX_EVIDENCE_PER_ISSUE,
	MAX_EVIDENCE_SNIPPET_CHARS,
	MAX_ISSUE_DESCRIPTION_CHARS,
	MAX_SCANNER_SIGNALS_PER_ISSUE,
} from "../../../../shared/schemas/finding-group.schema";
import type { AppDatabase } from "../../../db";
import { findingEvidences, findings } from "../../../db/schema";
import { bindImprovementRequestUserMessage } from "../../../system-context/bindings";
import { projectFindingDedupeIdentity } from "../findings/finding-dedupe-identity";
import { redactSecrets } from "../findings/normalizers/redaction";
import {
	FindingGroupingRunner,
	type GroupingSnapshotResult,
} from "../findings/finding-grouping-runner";
import {
	ImprovementRequestPromptBudgetError,
	packImprovementWarningGroups,
} from "./scan-improvement-prompt-budget";
import {
	buildImprovementWarningGroups,
	type ImprovementWarningGroupManifestEntry,
	type ImprovementWarningGroupPrompt,
	toImprovementWarningGroupPrompt,
} from "./scan-improvement-warning-group";
import { buildScanReviewBundle } from "./scan-review-bundle";

type FindingRow = typeof findings.$inferSelect;
type EvidenceRow = typeof findingEvidences.$inferSelect;

export class GroupingSnapshotUnavailableError extends Error {
	constructor(message = "grouping_snapshot_unavailable") {
		super(message);
		this.name = "GroupingSnapshotUnavailableError";
	}
}

export type ImprovementRequestIssueBundle = {
	scanRun: {
		id: string;
		projectId: string;
		profile: string;
		status: string;
		profileOutcome: string;
		summary: string | null;
	};
	project: {
		id: string;
		name: string;
		defaultBranch: string;
	};
	summary: {
		totals: Record<string, unknown>;
	};
	tools: Array<{
		id: string;
		toolName: string;
		toolVersion: string | null;
		status: string;
		exitCode: number | null;
	}>;
	artifacts: Array<{
		id: string;
		toolRunId: string | null;
		kind: string;
		format: string;
	}>;
	verification: {
		reproductions: VerificationSummary;
		dynamicRuns: VerificationSummary;
		dastRuns: VerificationSummary;
	};
	grouping: {
		runId: string;
		findingSetHash: string;
		snapshotHash: string;
		algorithmVersion: string;
		rawFindingCount: number;
		issueCount: number;
		chunkOffset: number;
		chunkCount: number;
		warningGroupOffset: number;
		warningGroupCount: number;
		totalWarningGroupCount: number;
	};
	/** Persisted audit only. It is deliberately omitted from the LLM prompt. */
	issueManifest: Array<{ issueId: string; memberFindingIds: string[] }>;
	/** Persisted audit only. It is deliberately omitted from the LLM prompt. */
	warningGroupManifest: ImprovementWarningGroupManifestEntry[];
	/** Server-side validation only. It is deliberately omitted from the LLM prompt. */
	issues: ImprovementRequestIssue[];
	warningGroups: ImprovementWarningGroupPrompt[];
	rollup: {
		version: string;
		threshold: number;
		warningGroupCount: number;
		rollupParentCount: number;
		singletonCount: number;
		locationChildCount: number;
		manifestHash: string;
	};
	promptBudget: {
		targetChars: number;
		hardChars: number;
		renderedChars: number;
		maxCompressionTier: number;
	};
	limitations: string[];
};

type VerificationSummary = {
	total: number;
	statusCounts: Record<string, number>;
	outcomeCounts: Record<string, number>;
};

export type ImprovementRequestIssue = {
	issueId: string;
	representativeFindingId: string;
	rawFindingCount: number;
	title: string;
	description: string;
	severity: string;
	location: Record<string, unknown>;
	familyKeys: string[];
	scannerSignals: Array<{
		sourceTool: string;
		ruleId: string;
		severity: string;
	}>;
	evidence: Array<{
		id: string;
		kind: string;
		artifactId: string | null;
		location: Record<string, unknown> | null;
		snippet: string | null;
	}>;
	identity: {
		issueKind: ReturnType<typeof projectFindingDedupeIdentity>["issueKind"];
		packageKey: string | null;
		advisoryIds: string[];
	};
	grouping: {
		confidence: "exact" | "high" | "singleton";
		reasonCodes: string[];
	};
};

/**
 * Creates prompt-sized warning-group chunks from one immutable grouping snapshot.
 * A raw finding or location child is never used as a chunk boundary, so one
 * warning parent cannot be split across provider calls.
 */
export async function buildImprovementRequestIssueBundles(
	db: AppDatabase,
	scanRunId: string,
): Promise<ImprovementRequestIssueBundle[]> {
	const snapshot = await new FindingGroupingRunner(
		db,
	).ensureCurrentDeterministic(scanRunId);
	if (
		snapshot.grouping.runId === null ||
		snapshot.grouping.snapshotHash === null ||
		snapshot.grouping.findingSetHash === null
	) {
		throw new GroupingSnapshotUnavailableError();
	}
	const allFindingIds = snapshot.groups.flatMap((group) => group.findingIds);
	const [rawFindings, evidenceRows, base] = await Promise.all([
		allFindingIds.length > 0
			? db.select().from(findings).where(inArray(findings.id, allFindingIds))
			: Promise.resolve([] as FindingRow[]),
		allFindingIds.length > 0
			? db
					.select()
					.from(findingEvidences)
					.where(inArray(findingEvidences.findingId, allFindingIds))
			: Promise.resolve([] as EvidenceRow[]),
		buildScanReviewBundle(db, scanRunId, {
			maxFindings: 0,
			findingFilter: "all",
		}),
	]);
	const byFindingId = new Map(
		rawFindings.map((finding) => [finding.id, finding]),
	);
	const evidenceByFindingId = new Map<string, EvidenceRow[]>();
	for (const evidence of evidenceRows) {
		evidenceByFindingId.set(evidence.findingId, [
			...(evidenceByFindingId.get(evidence.findingId) ?? []),
			evidence,
		]);
	}
	const issues = snapshot.groups.map((group) =>
		buildIssue(group, byFindingId, evidenceByFindingId),
	);
	const orderedIssues = [...issues].sort(compareIssues);
	const allIssueManifest = snapshot.groups.map((group) => ({
		issueId: group.id,
		memberFindingIds: group.findingIds,
	}));
	const memberFindingIdsByIssueId = new Map(
		allIssueManifest.map((entry) => [entry.issueId, entry.memberFindingIds]),
	);
	const warningGroupResult = buildImprovementWarningGroups(
		orderedIssues,
		memberFindingIdsByIssueId,
	);
	const warningGroups = warningGroupResult.groups.map(
		toImprovementWarningGroupPrompt,
	);
	const sharedContext = compactSharedContext(base);
	const rollup = {
		version: IMPROVEMENT_WARNING_ROLLUP_VERSION,
		threshold: IMPROVEMENT_WARNING_ROLLUP_THRESHOLD,
		warningGroupCount: warningGroups.length,
		rollupParentCount: warningGroupResult.rollupParentCount,
		singletonCount: warningGroupResult.singletonCount,
		locationChildCount: warningGroupResult.locationChildCount,
		manifestHash: warningGroupResult.manifestHash,
	};
	const render = (
		chunkGroups: ImprovementWarningGroupPrompt[],
		warningGroupOffset: number,
		_chunkIndex: number,
		chunkCount: number,
	) =>
		bindImprovementRequestUserMessage({
			...sharedContext,
			grouping: {
				runId: snapshot.grouping.runId,
				findingSetHash: snapshot.grouping.findingSetHash,
				snapshotHash: snapshot.grouping.snapshotHash,
				algorithmVersion: snapshot.grouping.algorithmVersion,
				rawFindingCount: snapshot.grouping.rawFindingCount,
				issueCount: snapshot.grouping.issueCount,
				chunkOffset: 999_999,
				chunkCount,
				warningGroupOffset,
				warningGroupCount: chunkGroups.length,
				totalWarningGroupCount: warningGroups.length,
			},
			warningGroups: chunkGroups,
			rollup,
			promptBudget: {
				targetChars: IMPROVEMENT_PROMPT_TARGET_CHARS,
				hardChars: IMPROVEMENT_PROMPT_HARD_CHARS,
				renderedChars: 999_999,
				maxCompressionTier: maximumCompressionTier(chunkGroups),
			},
			limitations: snapshot.grouping.limitations,
		}).content.text;
	const packed = packImprovementWarningGroups({ warningGroups, render });
	const issueById = new Map(
		orderedIssues.map((issue) => [issue.issueId, issue]),
	);
	const issueManifestById = new Map(
		allIssueManifest.map((entry) => [entry.issueId, entry]),
	);
	let issueOffset = 0;
	return packed.map((chunk, index) => {
		const warningGroupIds = new Set(
			chunk.warningGroups.map((group) => group.warningGroupId),
		);
		const warningGroupManifest = warningGroupResult.manifest.filter((entry) =>
			warningGroupIds.has(entry.warningGroupId),
		);
		const issueIds = warningGroupManifest.flatMap((entry) => entry.issueIds);
		const chunkIssues = issueIds.map((issueId) => {
			const issue = issueById.get(issueId);
			if (!issue) throw new Error(`warning_group_issue_missing:${issueId}`);
			return issue;
		});
		const issueManifest = issueIds.map((issueId) => {
			const entry = issueManifestById.get(issueId);
			if (!entry)
				throw new Error(`warning_group_issue_manifest_missing:${issueId}`);
			return entry;
		});
		const bundle = withStableRenderedChars({
			...sharedContext,
			grouping: {
				runId: snapshot.grouping.runId as string,
				findingSetHash: snapshot.grouping.findingSetHash as string,
				snapshotHash: snapshot.grouping.snapshotHash as string,
				algorithmVersion: snapshot.grouping.algorithmVersion,
				rawFindingCount: snapshot.grouping.rawFindingCount,
				issueCount: snapshot.grouping.issueCount,
				chunkOffset: issueOffset,
				chunkCount: packed.length,
				warningGroupOffset: chunk.warningGroupOffset,
				warningGroupCount: chunk.warningGroups.length,
				totalWarningGroupCount: warningGroups.length,
			},
			issueManifest,
			warningGroupManifest,
			issues: chunkIssues,
			warningGroups: chunk.warningGroups,
			rollup,
			promptBudget: {
				targetChars: IMPROVEMENT_PROMPT_TARGET_CHARS,
				hardChars: IMPROVEMENT_PROMPT_HARD_CHARS,
				renderedChars: 0,
				maxCompressionTier: maximumCompressionTier(chunk.warningGroups),
			},
			limitations: snapshot.grouping.limitations,
		});
		issueOffset += issueIds.length;
		if (bundle.promptBudget.renderedChars > IMPROVEMENT_PROMPT_HARD_CHARS) {
			throw new ImprovementRequestPromptBudgetError({
				chunk: index,
				renderedChars: bundle.promptBudget.renderedChars,
				hardLimit: IMPROVEMENT_PROMPT_HARD_CHARS,
				largestWarningGroupLocations: Math.max(
					0,
					...bundle.warningGroups.map((group) => group.locationSummary.total),
				),
				compressionTier: bundle.promptBudget.maxCompressionTier,
			});
		}
		return bundle;
	});
}

/** Removes server-side raw finding membership before binding untrusted prompt JSON. */
export function toImprovementRequestPromptBundle(
	bundle: ImprovementRequestIssueBundle,
): Omit<
	ImprovementRequestIssueBundle,
	"issueManifest" | "warningGroupManifest" | "issues"
> {
	const {
		issueManifest: _issueManifest,
		warningGroupManifest: _warningGroupManifest,
		issues: _issues,
		...promptBundle
	} = bundle;
	return promptBundle;
}

function compactSharedContext(
	base: Awaited<ReturnType<typeof buildScanReviewBundle>>,
): Pick<
	ImprovementRequestIssueBundle,
	"scanRun" | "project" | "summary" | "tools" | "artifacts" | "verification"
> {
	return {
		scanRun: {
			id: base.scanRun.id,
			projectId: base.scanRun.projectId,
			profile: base.scanRun.profile,
			status: base.scanRun.status,
			profileOutcome: base.scanRun.profileOutcome,
			summary: truncate(base.scanRun.summary, 500) || null,
		},
		project: base.project,
		summary: { totals: base.summary.totals as Record<string, unknown> },
		tools: base.tools.map((tool) => ({
			id: tool.id,
			toolName: tool.toolName,
			toolVersion: tool.toolVersion,
			status: tool.status,
			exitCode: tool.exitCode,
		})),
		artifacts: base.artifacts.map((artifact) => ({
			id: artifact.id,
			toolRunId: artifact.toolRunId,
			kind: artifact.kind,
			format: artifact.format,
		})),
		verification: {
			reproductions: summarizeVerification(base.verification.reproductions),
			dynamicRuns: summarizeVerification(base.verification.dynamicRuns),
			dastRuns: summarizeVerification(base.verification.dastRuns),
		},
	};
}

function summarizeVerification(
	rows: Array<{ status: string; outcome?: string | null }>,
): VerificationSummary {
	const statusCounts: Record<string, number> = {};
	const outcomeCounts: Record<string, number> = {};
	for (const row of rows) {
		statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
		if (row.outcome) {
			outcomeCounts[row.outcome] = (outcomeCounts[row.outcome] ?? 0) + 1;
		}
	}
	return { total: rows.length, statusCounts, outcomeCounts };
}

function maximumCompressionTier(
	groups: ImprovementWarningGroupPrompt[],
): number {
	return groups.reduce(
		(maximum, group) => Math.max(maximum, group.compressionTier),
		0,
	);
}

function withStableRenderedChars(
	bundle: ImprovementRequestIssueBundle,
): ImprovementRequestIssueBundle {
	let renderedChars = 0;
	let candidate = bundle;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		candidate = {
			...bundle,
			promptBudget: { ...bundle.promptBudget, renderedChars },
		};
		const next = bindImprovementRequestUserMessage(
			toImprovementRequestPromptBundle(candidate),
		).content.text.length;
		if (next === renderedChars) return candidate;
		renderedChars = next;
	}
	return {
		...bundle,
		promptBudget: { ...bundle.promptBudget, renderedChars },
	};
}

function buildIssue(
	group: GroupingSnapshotResult["groups"][number],
	byFindingId: Map<string, FindingRow>,
	evidenceByFindingId: Map<string, EvidenceRow[]>,
): ImprovementRequestIssue {
	const representative = byFindingId.get(group.representativeFindingId);
	if (!representative) {
		throw new Error(`grouping_representative_finding_missing:${group.id}`);
	}
	const identity = projectFindingDedupeIdentity(representative);
	const memberFindings = group.findingIds.map((id) => {
		const finding = byFindingId.get(id);
		if (!finding) throw new Error(`grouping_member_finding_missing:${id}`);
		return finding;
	});
	const isSecret = identity.issueKind === "secret";
	return {
		issueId: group.id,
		representativeFindingId: representative.id,
		rawFindingCount: group.findingIds.length,
		title: isSecret ? "認証情報らしき値の検出" : group.title,
		description: isSecret
			? "保存済みの検出結果で認証情報らしき値が示されました。実値はこの依頼には含めません。"
			: redactSecrets(truncate(group.description, MAX_ISSUE_DESCRIPTION_CHARS)),
		severity: group.severity,
		location: group.primaryLocation,
		familyKeys: identity.familyKeys,
		scannerSignals: uniqueScannerSignals(memberFindings),
		evidence: uniqueEvidence(
			memberFindings.flatMap((finding) =>
				(evidenceByFindingId.get(finding.id) ?? []).map((evidence) => ({
					...evidence,
					isSecret,
				})),
			),
		),
		identity: {
			issueKind: identity.issueKind,
			packageKey: identity.packageKey,
			advisoryIds: identity.advisoryIds,
		},
		grouping: {
			confidence: group.matchConfidence,
			reasonCodes: group.reasonCodes,
		},
	};
}

function uniqueScannerSignals(findingsForIssue: FindingRow[]) {
	const seen = new Set<string>();
	return [...findingsForIssue]
		.sort((left, right) =>
			`${left.sourceTool}\0${left.ruleId}\0${left.id}`.localeCompare(
				`${right.sourceTool}\0${right.ruleId}\0${right.id}`,
			),
		)
		.flatMap((finding) => {
			const signal = {
				sourceTool: finding.sourceTool,
				ruleId: finding.ruleId,
				severity: finding.severity,
			};
			const key = JSON.stringify(signal);
			if (seen.has(key)) return [];
			seen.add(key);
			return [signal];
		})
		.slice(0, MAX_SCANNER_SIGNALS_PER_ISSUE);
}

function uniqueEvidence(
	evidenceRows: Array<EvidenceRow & { isSecret: boolean }>,
): ImprovementRequestIssue["evidence"] {
	const seen = new Set<string>();
	return [...evidenceRows]
		.sort((left, right) => {
			const kindRank = (value: string) =>
				value === "source-location" ? 0 : value === "tool-output" ? 2 : 1;
			const rank = kindRank(left.kind) - kindRank(right.kind);
			return rank !== 0 ? rank : left.id.localeCompare(right.id);
		})
		.flatMap((evidence) => {
			const snippet = evidence.isSecret
				? null
				: redactSecrets(truncate(evidence.snippet, MAX_EVIDENCE_SNIPPET_CHARS));
			const key = JSON.stringify({
				kind: evidence.kind,
				artifactId: evidence.artifactId,
				location: evidence.location,
				snippetHash: sha256(snippet ?? ""),
			});
			if (seen.has(key)) return [];
			seen.add(key);
			return [
				{
					id: evidence.id,
					kind: evidence.kind,
					artifactId: evidence.artifactId,
					location: evidence.location,
					snippet,
				},
			];
		})
		.slice(0, MAX_EVIDENCE_PER_ISSUE);
}

function compareIssues(
	left: ImprovementRequestIssue,
	right: ImprovementRequestIssue,
) {
	const rank = (severity: string) =>
		({ critical: 0, high: 1, medium: 2, low: 3, info: 4, unknown: 5 })[
			severity.toLowerCase() as "critical"
		] ?? 5;
	const severity = rank(left.severity) - rank(right.severity);
	if (severity !== 0) return severity;
	const leftPath = String(left.location.path ?? "");
	const rightPath = String(right.location.path ?? "");
	const path = leftPath.localeCompare(rightPath);
	return path !== 0 ? path : left.issueId.localeCompare(right.issueId);
}

function truncate(value: string | null | undefined, max: number): string {
	const text = value?.trim() ?? "";
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n[truncated]`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
