import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
	IMPROVEMENT_ISSUE_CHUNK_SIZE,
	MAX_EVIDENCE_PER_ISSUE,
	MAX_EVIDENCE_SNIPPET_CHARS,
	MAX_ISSUE_DESCRIPTION_CHARS,
	MAX_SCANNER_SIGNALS_PER_ISSUE,
} from "../../../../shared/schemas/finding-group.schema";
import type { AppDatabase } from "../../../db";
import { findingEvidences, findings } from "../../../db/schema";
import { projectFindingDedupeIdentity } from "../finding-dedupe-identity";
import { redactSecrets } from "../findings/normalizers/redaction";
import {
	FindingGroupingRunner,
	type GroupingSnapshotResult,
} from "../finding-grouping-runner";
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
	scanRun: Awaited<ReturnType<typeof buildScanReviewBundle>>["scanRun"];
	project: Awaited<ReturnType<typeof buildScanReviewBundle>>["project"];
	summary: Awaited<ReturnType<typeof buildScanReviewBundle>>["summary"];
	tools: Awaited<ReturnType<typeof buildScanReviewBundle>>["tools"];
	artifacts: Awaited<ReturnType<typeof buildScanReviewBundle>>["artifacts"];
	verification: Awaited<ReturnType<typeof buildScanReviewBundle>>["verification"];
	grouping: {
		runId: string;
		findingSetHash: string;
		snapshotHash: string;
		algorithmVersion: string;
		rawFindingCount: number;
		issueCount: number;
		chunkOffset: number;
		chunkCount: number;
	};
	/** Persisted audit only. It is deliberately omitted from the LLM prompt. */
	issueManifest: Array<{ issueId: string; memberFindingIds: string[] }>;
	issues: ImprovementRequestIssue[];
	limitations: string[];
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
	grouping: {
		confidence: "exact" | "high" | "singleton";
		reasonCodes: string[];
	};
};

/**
 * Creates prompt-sized, issue-first chunks from one immutable grouping snapshot.
 * A raw finding is never used as the chunk boundary, so a group cannot be split.
 */
export async function buildImprovementRequestIssueBundles(
	db: AppDatabase,
	scanRunId: string,
): Promise<ImprovementRequestIssueBundle[]> {
	const snapshot = await new FindingGroupingRunner(db).ensureCurrentDeterministic(
		scanRunId,
	);
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
	const byFindingId = new Map(rawFindings.map((finding) => [finding.id, finding]));
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
	const chunks = chunk(orderedIssues, IMPROVEMENT_ISSUE_CHUNK_SIZE);
	const { findings: _rawFindings, limits: _rawLimits, ...sharedContext } = base;
	return chunks.map((chunkIssues, index) => ({
		...sharedContext,
		grouping: {
			runId: snapshot.grouping.runId as string,
			findingSetHash: snapshot.grouping.findingSetHash as string,
			snapshotHash: snapshot.grouping.snapshotHash as string,
			algorithmVersion: snapshot.grouping.algorithmVersion,
			rawFindingCount: snapshot.grouping.rawFindingCount,
			issueCount: snapshot.grouping.issueCount,
			chunkOffset: index * IMPROVEMENT_ISSUE_CHUNK_SIZE,
			chunkCount: chunks.length,
		},
		issueManifest: chunkIssues.map((issue) => ({
			issueId: issue.issueId,
			memberFindingIds: snapshot.groups.find((group) => group.id === issue.issueId)
				?.findingIds ?? [],
		})),
		issues: chunkIssues,
		limitations: snapshot.grouping.limitations,
	}));
}

/** Removes server-side raw finding membership before binding untrusted prompt JSON. */
export function toImprovementRequestPromptBundle(
	bundle: ImprovementRequestIssueBundle,
): Omit<ImprovementRequestIssueBundle, "issueManifest"> {
	const { issueManifest: _issueManifest, ...promptBundle } = bundle;
	return promptBundle;
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
				: redactSecrets(
						truncate(evidence.snippet, MAX_EVIDENCE_SNIPPET_CHARS),
					);
			const key = JSON.stringify({
				kind: evidence.kind,
				artifactId: evidence.artifactId,
				location: evidence.location,
				snippetHash: sha256(snippet ?? ""),
			});
			if (seen.has(key)) return [];
			seen.add(key);
			return [{
				id: evidence.id,
				kind: evidence.kind,
				artifactId: evidence.artifactId,
				location: evidence.location,
				snippet,
			}];
		})
		.slice(0, MAX_EVIDENCE_PER_ISSUE);
}

function compareIssues(left: ImprovementRequestIssue, right: ImprovementRequestIssue) {
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

function chunk<T>(values: T[], size: number): T[][] {
	if (values.length === 0) return [[]];
	return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
		values.slice(index * size, (index + 1) * size),
	);
}

function truncate(value: string | null | undefined, max: number): string {
	const text = value?.trim() ?? "";
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n[truncated]`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
