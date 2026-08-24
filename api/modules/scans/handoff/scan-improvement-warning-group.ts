import type { FindingIssueKind } from "../../../../shared/schemas/finding-group.schema";
import {
	IMPROVEMENT_WARNING_ROLLUP_THRESHOLD,
	IMPROVEMENT_WARNING_ROLLUP_VERSION,
	MAX_WARNING_GROUP_EVIDENCE,
} from "../../../../shared/schemas/finding-group.schema";
import type { FindingSeverity } from "../../../../shared/schemas/scan.schema";
import { canonicalJsonHash } from "../findings/finding-dedupe-identity";
import { redactSecrets } from "../findings/normalizers/redaction";

export type ImprovementWarningLocation = {
	ref: string;
	path: string | null;
	startLine: number | null;
	endLine: number | null;
	startCol: number | null;
	endCol: number | null;
	resource: string | null;
	method: string | null;
	parameter: string | null;
	severity: FindingSeverity;
};

export type ImprovementWarningEvidence = {
	id: string;
	kind: string;
	artifactId: string | null;
	snippet: string | null;
};

export type ImprovementWarningGroup = {
	warningGroupId: string;
	stableKey: string;
	kind: "rollup" | "singleton";
	issueKind: FindingIssueKind;
	title: string;
	description: string;
	severity: FindingSeverity;
	severityCounts: Partial<Record<FindingSeverity, number>>;
	occurrenceCount: number;
	rawFindingCount: number;
	scannerSignals: Array<{
		sourceTool: string;
		ruleId: string;
		severity: string;
	}>;
	familyKeys: string[];
	representativeEvidence: ImprovementWarningEvidence[];
	locations: ImprovementWarningLocation[];
	locationSummary: {
		total: number;
		included: number;
		omitted: number;
		digest: string;
	};
	compressionTier: 0 | 1 | 2;
};

export type ImprovementWarningGroupPrompt = Omit<
	ImprovementWarningGroup,
	"stableKey"
>;

export type ImprovementWarningGroupManifestEntry = {
	warningGroupId: string;
	stableKey: string;
	issueIds: string[];
	memberFindingIds: string[];
	evidenceIds: string[];
	locations: ImprovementWarningLocation[];
	severity: FindingSeverity;
};

export type ImprovementWarningGroupSourceIssue = {
	issueId: string;
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
		issueKind: FindingIssueKind;
		packageKey: string | null;
		advisoryIds: string[];
	};
};

export type BuiltImprovementWarningGroups = {
	groups: ImprovementWarningGroup[];
	manifest: ImprovementWarningGroupManifestEntry[];
	rollupParentCount: number;
	singletonCount: number;
	locationChildCount: number;
	manifestHash: string;
};

type GroupCandidate = {
	stableKey: string;
	kind: "rollup" | "singleton";
	issues: ImprovementWarningGroupSourceIssue[];
};

const severityRank: Record<FindingSeverity, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

export function buildImprovementWarningGroups(
	issues: ImprovementWarningGroupSourceIssue[],
	memberFindingIdsByIssueId: ReadonlyMap<string, readonly string[]>,
): BuiltImprovementWarningGroups {
	const buckets = new Map<string, ImprovementWarningGroupSourceIssue[]>();
	const singletonIssues: ImprovementWarningGroupSourceIssue[] = [];
	for (const issue of [...issues].sort((left, right) =>
		left.issueId.localeCompare(right.issueId),
	)) {
		const key = warningRollupKey(issue);
		if (!key) {
			singletonIssues.push(issue);
			continue;
		}
		buckets.set(key, [...(buckets.get(key) ?? []), issue]);
	}

	const candidates: GroupCandidate[] = singletonIssues.map((issue) =>
		singletonCandidate(issue),
	);
	for (const [key, bucket] of [...buckets.entries()].sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		if (bucket.length >= IMPROVEMENT_WARNING_ROLLUP_THRESHOLD) {
			candidates.push({
				stableKey: canonicalJsonHash({
					version: IMPROVEMENT_WARNING_ROLLUP_VERSION,
					warningKey: key,
				}),
				kind: "rollup",
				issues: bucket,
			});
			continue;
		}
		candidates.push(...bucket.map((issue) => singletonCandidate(issue)));
	}

	const ordered = candidates.sort(compareCandidates);
	const groups = ordered.map((candidate, index) =>
		buildGroup(candidate, `wg-${String(index + 1).padStart(6, "0")}`),
	);
	const candidateByStableKey = new Map(
		ordered.map((candidate) => [candidate.stableKey, candidate]),
	);
	const manifest = groups.map((group) => {
		const candidate = candidateByStableKey.get(group.stableKey);
		if (!candidate) throw new Error("warning_group_candidate_missing");
		return {
			warningGroupId: group.warningGroupId,
			stableKey: group.stableKey,
			issueIds: candidate.issues.map((issue) => issue.issueId).sort(),
			memberFindingIds: uniqueSorted(
				candidate.issues.flatMap(
					(issue) => memberFindingIdsByIssueId.get(issue.issueId) ?? [],
				),
			),
			evidenceIds: uniqueSorted(
				candidate.issues.flatMap((issue) =>
					issue.evidence.map((evidence) => evidence.id),
				),
			),
			locations: group.locations,
			severity: group.severity,
		};
	});
	assertCompleteMembership(issues, manifest, memberFindingIdsByIssueId);
	return {
		groups,
		manifest,
		rollupParentCount: groups.filter((group) => group.kind === "rollup").length,
		singletonCount: groups.filter((group) => group.kind === "singleton").length,
		locationChildCount: groups.reduce(
			(total, group) => total + group.locationSummary.total,
			0,
		),
		manifestHash: canonicalJsonHash(manifest),
	};
}

export function toImprovementWarningGroupPrompt(
	group: ImprovementWarningGroup,
): ImprovementWarningGroupPrompt {
	const { stableKey: _stableKey, ...promptGroup } = group;
	return promptGroup;
}

function singletonCandidate(
	issue: ImprovementWarningGroupSourceIssue,
): GroupCandidate {
	return {
		stableKey: canonicalJsonHash({
			version: IMPROVEMENT_WARNING_ROLLUP_VERSION,
			singletonIssueId: issue.issueId,
		}),
		kind: "singleton",
		issues: [issue],
	};
}

function warningRollupKey(
	issue: ImprovementWarningGroupSourceIssue,
): string | null {
	const { issueKind, packageKey, advisoryIds } = issue.identity;
	if (
		issueKind === "web" ||
		issueKind === "api" ||
		issueKind === "business_logic" ||
		issueKind === "unknown"
	) {
		return null;
	}
	if (issueKind === "dependency") {
		if (!packageKey || advisoryIds.length === 0) return null;
		return canonicalJsonHash({
			version: IMPROVEMENT_WARNING_ROLLUP_VERSION,
			issueKind,
			packageKey,
			advisoryIds: uniqueSorted(
				advisoryIds.map((value) => value.toUpperCase()),
			),
		});
	}
	const scannerRules = uniqueSorted(
		issue.scannerSignals.map(
			(signal) =>
				`${signal.sourceTool.trim().toLowerCase()}:${signal.ruleId.trim().toLowerCase()}`,
		),
	);
	const families = uniqueSorted(
		issue.familyKeys.filter((key) => key !== "family:unknown"),
	);
	if (scannerRules.length === 0 || families.length === 0) return null;
	return canonicalJsonHash({
		version: IMPROVEMENT_WARNING_ROLLUP_VERSION,
		issueKind,
		scannerRules,
		families,
	});
}

function compareCandidates(
	left: GroupCandidate,
	right: GroupCandidate,
): number {
	const leftSeverity = maximumSeverity(left.issues);
	const rightSeverity = maximumSeverity(right.issues);
	const severity = severityRank[leftSeverity] - severityRank[rightSeverity];
	if (severity !== 0) return severity;
	const kind = left.issues[0]?.identity.issueKind.localeCompare(
		right.issues[0]?.identity.issueKind ?? "unknown",
	);
	return kind !== 0 ? kind : left.stableKey.localeCompare(right.stableKey);
}

function buildGroup(
	candidate: GroupCandidate,
	warningGroupId: string,
): ImprovementWarningGroup {
	const representative = [...candidate.issues].sort(compareRepresentative)[0];
	if (!representative) throw new Error("warning_group_representative_missing");
	const locations = uniqueLocations(candidate.issues);
	const severity = maximumSeverity(candidate.issues);
	const isSecret = representative.identity.issueKind === "secret";
	return {
		warningGroupId,
		stableKey: candidate.stableKey,
		kind: candidate.kind,
		issueKind: representative.identity.issueKind,
		title: isSecret
			? "認証情報らしき値の検出"
			: redactSecrets(representative.title),
		description: isSecret
			? "保存済みの検出結果で認証情報らしき値が示されました。実値はこの依頼には含めません。"
			: redactSecrets(representative.description),
		severity,
		severityCounts: severityCounts(candidate.issues),
		occurrenceCount: candidate.issues.length,
		rawFindingCount: candidate.issues.reduce(
			(total, issue) => total + issue.rawFindingCount,
			0,
		),
		scannerSignals: uniqueScannerSignals(candidate.issues),
		familyKeys: uniqueSorted(
			candidate.issues.flatMap((issue) => issue.familyKeys),
		),
		representativeEvidence: uniqueEvidence(candidate.issues),
		locations,
		locationSummary: {
			total: locations.length,
			included: locations.length,
			omitted: 0,
			digest: canonicalJsonHash(locations),
		},
		compressionTier: 0,
	};
}

function compareRepresentative(
	left: ImprovementWarningGroupSourceIssue,
	right: ImprovementWarningGroupSourceIssue,
): number {
	const severity =
		severityRank[asSeverity(left.severity)] -
		severityRank[asSeverity(right.severity)];
	if (severity !== 0) return severity;
	const completeness = (issue: ImprovementWarningGroupSourceIssue) =>
		issue.description.length + issue.evidence.length * 100;
	const complete = completeness(right) - completeness(left);
	return complete !== 0 ? complete : left.issueId.localeCompare(right.issueId);
}

function maximumSeverity(
	issues: ImprovementWarningGroupSourceIssue[],
): FindingSeverity {
	return (
		issues
			.map((issue) => asSeverity(issue.severity))
			.sort((left, right) => severityRank[left] - severityRank[right])[0] ??
		"unknown"
	);
}

function severityCounts(
	issues: ImprovementWarningGroupSourceIssue[],
): Partial<Record<FindingSeverity, number>> {
	const counts: Partial<Record<FindingSeverity, number>> = {};
	for (const issue of issues) {
		const severity = asSeverity(issue.severity);
		counts[severity] = (counts[severity] ?? 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(counts).sort(
			([left], [right]) =>
				severityRank[left as FindingSeverity] -
				severityRank[right as FindingSeverity],
		),
	) as Partial<Record<FindingSeverity, number>>;
}

function uniqueScannerSignals(issues: ImprovementWarningGroupSourceIssue[]) {
	const seen = new Set<string>();
	return issues
		.flatMap((issue) => issue.scannerSignals)
		.sort((left, right) =>
			`${left.sourceTool}\0${left.ruleId}\0${left.severity}`.localeCompare(
				`${right.sourceTool}\0${right.ruleId}\0${right.severity}`,
			),
		)
		.filter((signal) => {
			const key = JSON.stringify(signal);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

function uniqueEvidence(
	issues: ImprovementWarningGroupSourceIssue[],
): ImprovementWarningEvidence[] {
	const seen = new Set<string>();
	return issues
		.flatMap((issue) =>
			issue.evidence.map((evidence) => ({
				...evidence,
				isSecret: issue.identity.issueKind === "secret",
			})),
		)
		.sort((left, right) => {
			const rank = (kind: string) =>
				kind === "source-location" ? 0 : kind === "tool-output" ? 2 : 1;
			return (
				rank(left.kind) - rank(right.kind) || left.id.localeCompare(right.id)
			);
		})
		.flatMap((evidence) => {
			const snippet = evidence.isSecret
				? null
				: evidence.snippet === null
					? null
					: redactSecrets(evidence.snippet);
			const key = canonicalJsonHash({
				kind: evidence.kind,
				artifactId: evidence.artifactId,
				location: evidence.location,
				snippet,
			});
			if (seen.has(key)) return [];
			seen.add(key);
			return [
				{
					id: evidence.id,
					kind: evidence.kind,
					artifactId: evidence.artifactId,
					snippet,
				},
			];
		})
		.slice(0, MAX_WARNING_GROUP_EVIDENCE);
}

function uniqueLocations(
	issues: ImprovementWarningGroupSourceIssue[],
): ImprovementWarningLocation[] {
	const locations = issues.map((issue) =>
		toWarningLocation(
			issue.location,
			asSeverity(issue.severity),
			issue.identity.issueKind === "secret",
		),
	);
	const seen = new Set<string>();
	return locations
		.sort((left, right) =>
			`${left.ref}\0${left.severity}`.localeCompare(
				`${right.ref}\0${right.severity}`,
			),
		)
		.filter((location) => {
			const key = `${location.ref}\0${location.severity}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

function toWarningLocation(
	location: Record<string, unknown>,
	severity: FindingSeverity,
	isSecret: boolean,
): ImprovementWarningLocation {
	const path = stringValue(location.path) ?? stringValue(location.url);
	const resource = isSecret ? null : stringValue(location.resource);
	const startLine = integerValue(location.startLine);
	const endLine = integerValue(location.endLine);
	const startCol = integerValue(location.startCol ?? location.column);
	const endCol = integerValue(location.endCol);
	const method = isSecret
		? null
		: (stringValue(location.method)?.toUpperCase() ?? null);
	const parameter = isSecret ? null : stringValue(location.parameter);
	return {
		ref: buildLocationRef({
			path,
			resource,
			startLine,
			endLine,
			method,
			parameter,
		}),
		path,
		startLine,
		endLine,
		startCol,
		endCol,
		resource,
		method,
		parameter,
		severity,
	};
}

function buildLocationRef(location: {
	path: string | null;
	resource: string | null;
	startLine: number | null;
	endLine: number | null;
	method: string | null;
	parameter: string | null;
}): string {
	const base = location.path ?? location.resource ?? "unknown-location";
	const lines = location.startLine
		? location.endLine && location.endLine !== location.startLine
			? `:${location.startLine}-${location.endLine}`
			: `:${location.startLine}`
		: "";
	const method = location.method ? `${location.method} ` : "";
	const parameter = location.parameter ? ` [${location.parameter}]` : "";
	return `${method}${base}${lines}${parameter}`;
}

function assertCompleteMembership(
	issues: ImprovementWarningGroupSourceIssue[],
	manifest: ImprovementWarningGroupManifestEntry[],
	memberFindingIdsByIssueId: ReadonlyMap<string, readonly string[]>,
): void {
	const expected = issues.map((issue) => issue.issueId).sort();
	const actual = manifest.flatMap((entry) => entry.issueIds).sort();
	if (
		new Set(expected).size !== expected.length ||
		expected.length !== actual.length ||
		expected.some((issueId, index) => issueId !== actual[index])
	) {
		throw new Error("warning_group_issue_membership_mismatch");
	}
	const allFindingIds: string[] = [];
	for (const issue of issues) {
		const memberFindingIds = memberFindingIdsByIssueId.get(issue.issueId);
		if (
			!memberFindingIds ||
			memberFindingIds.length !== issue.rawFindingCount ||
			new Set(memberFindingIds).size !== memberFindingIds.length
		) {
			throw new Error("warning_group_finding_membership_mismatch");
		}
		allFindingIds.push(...memberFindingIds);
	}
	if (new Set(allFindingIds).size !== allFindingIds.length) {
		throw new Error("warning_group_finding_membership_overlap");
	}
}

function asSeverity(value: string): FindingSeverity {
	return value === "critical" ||
		value === "high" ||
		value === "medium" ||
		value === "low" ||
		value === "info" ||
		value === "unknown"
		? value
		: "unknown";
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim()
		? redactSecrets(value.trim())
		: null;
}

function integerValue(value: unknown): number | null {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isInteger(number) && number > 0 ? number : null;
}

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
