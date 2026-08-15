import { createHash } from "node:crypto";
import type {
	AuthorizationBoundary,
	AuthorizationBoundaryChange,
	AuthorizationBoundaryDiff,
	AuthorizationBoundarySnapshot,
} from "../../../shared/schemas/security-intelligence-authorization.schema";
import {
	deriveAuthorizationDiffDigest,
	parseAuthorizationBoundaryDiff,
	parseAuthorizationBoundarySnapshot,
} from "../../../shared/schemas/security-intelligence-authorization.schema";
import { canonicalJson } from "../scans/diff-scan-plan";

export function diffAuthorizationBoundaries(
	beforeInput: AuthorizationBoundarySnapshot,
	afterInput: AuthorizationBoundarySnapshot,
): AuthorizationBoundaryDiff {
	const before = parseAuthorizationBoundarySnapshot(beforeInput);
	const after = parseAuthorizationBoundarySnapshot(afterInput);
	if (before.projectRef !== after.projectRef) {
		throw new Error(
			"security_intelligence:authorization_diff_project_mismatch",
		);
	}
	const analyzerCompatible = before.analyzer.version === after.analyzer.version;
	const ready =
		before.analyzer.status === "ready" && after.analyzer.status === "ready";
	const afterCoverageLost =
		before.analyzer.status === "ready" && after.analyzer.status !== "ready";
	const status: AuthorizationBoundaryDiff["analyzer"]["status"] =
		after.analyzer.status === "unavailable"
			? "unavailable"
			: ready && analyzerCompatible
				? "ready"
				: "degraded";
	const limitations = canonicalStrings([
		...before.limitationCodes,
		...after.limitationCodes,
		...(!analyzerCompatible ? ["authorization_analyzer_contract_changed"] : []),
		...(afterCoverageLost ? ["authorization_after_coverage_lost"] : []),
	]);

	const changes = afterCoverageLost
		? before.boundaries.map((boundary) =>
				change({
					classification: "coverage_lost",
					before: boundary,
					limitations: canonicalStrings([
						...boundary.limitationCodes,
						"authorization_after_coverage_lost",
					]),
				}),
			)
		: compareBoundaries(before.boundaries, after.boundaries, {
				comparable: ready && analyzerCompatible,
				limitations,
			});
	const semantic = {
		schemaVersion: 1 as const,
		projectRef: before.projectRef,
		target: {
			baseRevision: before.target.sourceRevision,
			baseTargetDigest: before.target.targetDigest,
			sourceRevision: after.target.sourceRevision,
			targetDigest: after.target.targetDigest,
		},
		analyzer: {
			name: before.analyzer.name,
			beforeVersion: before.analyzer.version,
			afterVersion: after.analyzer.version,
			status,
		},
		beforeSnapshotDigest: before.snapshotDigest,
		afterSnapshotDigest: after.snapshotDigest,
		changes: changes.sort((left, right) =>
			compare(left.changeRef, right.changeRef),
		),
		limitationCodes: limitations,
	};
	return parseAuthorizationBoundaryDiff({
		...semantic,
		diffDigest: deriveAuthorizationDiffDigest(semantic),
	});
}

function compareBoundaries(
	before: readonly AuthorizationBoundary[],
	after: readonly AuthorizationBoundary[],
	context: { comparable: boolean; limitations: readonly string[] },
): AuthorizationBoundaryChange[] {
	const beforeByRef = new Map(
		before.map((boundary) => [boundary.boundaryRef, boundary]),
	);
	const afterByRef = new Map(
		after.map((boundary) => [boundary.boundaryRef, boundary]),
	);
	const changes: AuthorizationBoundaryChange[] = [];
	const consumedBefore = new Set<string>();
	const consumedAfter = new Set<string>();

	for (const [boundaryRef, beforeBoundary] of beforeByRef) {
		const afterBoundary = afterByRef.get(boundaryRef);
		if (!afterBoundary) continue;
		consumedBefore.add(boundaryRef);
		consumedAfter.add(boundaryRef);
		changes.push(classifyPair(beforeBoundary, afterBoundary, context));
	}

	const unmatchedBefore = before.filter(
		(boundary) => !consumedBefore.has(boundary.boundaryRef),
	);
	const unmatchedAfter = after.filter(
		(boundary) => !consumedAfter.has(boundary.boundaryRef),
	);
	const renameKeys = canonicalStrings([
		...unmatchedBefore.flatMap((boundary) => renameKey(boundary) ?? []),
		...unmatchedAfter.flatMap((boundary) => renameKey(boundary) ?? []),
	]);
	for (const key of renameKeys) {
		const beforeCandidates = unmatchedBefore.filter(
			(boundary) => renameKey(boundary) === key,
		);
		const afterCandidates = unmatchedAfter.filter(
			(boundary) => renameKey(boundary) === key,
		);
		if (beforeCandidates.length === 0 || afterCandidates.length === 0) continue;
		const unique =
			beforeCandidates.length === 1 && afterCandidates.length === 1;
		const identityLimitation = unique
			? "authorization_boundary_identity_changed"
			: "authorization_boundary_identity_ambiguous";
		for (const boundary of beforeCandidates) {
			consumedBefore.add(boundary.boundaryRef);
			changes.push(
				change({
					classification: "unknown",
					before: boundary,
					...(unique ? { after: afterCandidates[0] } : {}),
					limitations: canonicalStrings([
						...context.limitations,
						identityLimitation,
					]),
				}),
			);
		}
		for (const boundary of afterCandidates) {
			consumedAfter.add(boundary.boundaryRef);
			if (unique) continue;
			changes.push(
				change({
					classification: "unknown",
					after: boundary,
					limitations: canonicalStrings([
						...context.limitations,
						identityLimitation,
					]),
				}),
			);
		}
	}

	for (const beforeBoundary of unmatchedBefore) {
		if (consumedBefore.has(beforeBoundary.boundaryRef)) continue;
		changes.push(
			change({
				classification: context.comparable ? "removed" : "unknown",
				before: beforeBoundary,
				limitations: context.comparable ? [] : [...context.limitations],
			}),
		);
	}
	for (const afterBoundary of unmatchedAfter) {
		if (consumedAfter.has(afterBoundary.boundaryRef)) continue;
		const observable =
			context.comparable &&
			afterBoundary.identityConfidence === "stable" &&
			afterBoundary.supportLevel === "supported" &&
			afterBoundary.guardState !== "unknown";
		changes.push(
			change({
				classification: observable ? "introduced" : "unknown",
				after: afterBoundary,
				limitations: observable
					? afterBoundary.limitationCodes
					: canonicalStrings([
							...context.limitations,
							...afterBoundary.limitationCodes,
							"authorization_introduced_boundary_not_observable",
						]),
			}),
		);
	}
	return changes;
}

function classifyPair(
	before: AuthorizationBoundary,
	after: AuthorizationBoundary,
	context: { comparable: boolean; limitations: readonly string[] },
): AuthorizationBoundaryChange {
	const stable =
		context.comparable &&
		before.identityConfidence === "stable" &&
		after.identityConfidence === "stable" &&
		before.supportLevel === "supported" &&
		after.supportLevel === "supported";
	const sourceEvidencePresent =
		sourceEvidence(before).length > 0 && sourceEvidence(after).length > 0;
	let classification: AuthorizationBoundaryChange["classification"] = "unknown";
	if (
		stable &&
		sourceEvidencePresent &&
		before.guardState === "guarded" &&
		after.guardState === "unguarded"
	) {
		classification = "worsened";
	} else if (
		stable &&
		before.guardState === "unguarded" &&
		after.guardState === "guarded"
	) {
		classification = "resolved";
	} else if (
		stable &&
		before.guardState === after.guardState &&
		before.guardState !== "unknown"
	) {
		classification = "unchanged";
	}
	return change({
		classification,
		before,
		after,
		limitations:
			classification === "unknown"
				? canonicalStrings([
						...context.limitations,
						...before.limitationCodes,
						...after.limitationCodes,
						...(sourceEvidencePresent
							? []
							: ["authorization_source_evidence_incomplete"]),
					])
				: [],
	});
}

function change(params: {
	classification: AuthorizationBoundaryChange["classification"];
	before?: AuthorizationBoundary;
	after?: AuthorizationBoundary;
	limitations: readonly string[];
}): AuthorizationBoundaryChange {
	const representative = params.after ?? params.before;
	if (!representative) {
		throw new Error(
			"security_intelligence:authorization_change_boundary_required",
		);
	}
	const semanticIdentity = {
		classification: params.classification,
		beforeBoundaryRef: params.before?.boundaryRef ?? null,
		afterBoundaryRef: params.after?.boundaryRef ?? null,
	};
	return {
		changeRef: `auth-change:v1:${hash(canonicalJson(semanticIdentity))}`,
		classification: params.classification,
		framework: representative.framework,
		method: representative.method,
		routePattern: representative.routePattern,
		...(params.before ? { beforeBoundaryRef: params.before.boundaryRef } : {}),
		...(params.after ? { afterBoundaryRef: params.after.boundaryRef } : {}),
		...(params.before ? { beforeGuardState: params.before.guardState } : {}),
		...(params.after ? { afterGuardState: params.after.guardState } : {}),
		beforeEvidenceRefs: params.before ? sourceEvidence(params.before) : [],
		afterEvidenceRefs: params.after ? sourceEvidence(params.after) : [],
		limitationCodes: canonicalStrings(params.limitations),
	};
}

function sourceEvidence(boundary: AuthorizationBoundary): string[] {
	return canonicalStrings(
		boundary.evidenceRefs
			.filter((evidence) => evidence.kind === "source_location")
			.map((evidence) => evidence.ref),
	);
}

function renameKey(boundary: AuthorizationBoundary): string | null {
	return boundary.handlerIdentity
		? `${boundary.framework}:${boundary.handlerIdentity}`
		: null;
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compare);
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
