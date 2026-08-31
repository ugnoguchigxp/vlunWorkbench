import { eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../../db";
import {
	findingEvidences,
	findingIssueGroupMembers,
	findings,
	scanRuns,
} from "../../../db/schema";
import { buildDeterministicFindingGroups } from "./finding-grouping-engine";
import {
	canonicalJsonHash,
	GROUPING_ALGORITHM_VERSION,
	projectFindingDedupeIdentity,
} from "./finding-dedupe-identity";
import {
	FindingGroupingRepository,
	type StoredFindingGroup,
	type StoredGroupingSnapshot,
} from "./finding-grouping-repository";

const ACTIVE_WAIT_MS = 5_000;
const ACTIVE_POLL_MS = 100;

export type GroupingSnapshotResult = {
	grouping: {
		runId: string | null;
		runStatus: "completed" | null;
		mode: "deterministic" | "singleton_fallback";
		algorithmVersion: string;
		findingSetHash: string | null;
		snapshotHash: string | null;
		rawFindingCount: number;
		issueCount: number;
		suppressedCount: number;
		ambiguousCount: number;
		limitations: string[];
	};
	groups: StoredFindingGroup[];
};

export type GroupingDetailResult = {
	grouping: GroupingSnapshotResult["grouping"];
	group: StoredFindingGroup;
	members: Array<{
		finding: typeof findings.$inferSelect;
		evidence: (typeof findingEvidences.$inferSelect)[];
		provenance: typeof findingIssueGroupMembers.$inferSelect | null;
	}>;
};

export class FindingGroupingRunner {
	private readonly repository: FindingGroupingRepository;

	constructor(private readonly db: AppDatabase) {
		this.repository = new FindingGroupingRepository(db);
	}

	async ensureCurrentDeterministic(
		scanRunId: string,
	): Promise<GroupingSnapshotResult> {
		const [scan, rawFindings] = await Promise.all([
			this.db.query.scanRuns.findFirst({ where: eq(scanRuns.id, scanRunId) }),
			this.db.select().from(findings).where(eq(findings.scanRunId, scanRunId)),
		]);
		if (!scan) throw new Error(`Scan run not found: ${scanRunId}`);
		if (!isTerminalScanStatus(scan.status)) {
			return singletonSnapshot(rawFindings, ["scan_not_terminal"]);
		}
		const currentFindingSetHash = findingSetHash(scanRunId, rawFindings);
		await this.repository.recoverStaleRuns(scanRunId);
		const current = await this.repository.findCurrentDeterministic({
			scanRunId,
			algorithmVersion: GROUPING_ALGORITHM_VERSION,
			findingSetHash: currentFindingSetHash,
		});
		if (current) return storedSnapshot(current);

		const running = await this.repository.createRunning({
			scanRunId,
			algorithmVersion: GROUPING_ALGORITHM_VERSION,
			findingSetHash: currentFindingSetHash,
		});
		if (!running.created) {
			return await this.waitForCurrent({
				scanRunId,
				findingSetHash: currentFindingSetHash,
				rawFindings,
			});
		}
		try {
			const built = buildDeterministicFindingGroups(rawFindings);
			const published = await this.repository.publish({
				runId: running.id,
				algorithmVersion: GROUPING_ALGORITHM_VERSION,
				findingSetHash: currentFindingSetHash,
				rawFindingCount: rawFindings.length,
				built,
			});
			return storedSnapshot(published);
		} catch (error) {
			await this.repository.fail(running.id, error).catch(() => undefined);
			return singletonSnapshot(rawFindings, ["grouping_failed"]);
		}
	}

	async getCurrentGroupDetail(
		scanRunId: string,
		groupId: string,
	): Promise<GroupingDetailResult | null> {
		const snapshot = await this.ensureCurrentDeterministic(scanRunId);
		const group = snapshot.groups.find((item) => item.id === groupId);
		if (!group) return null;
		const rawFindings = await this.db
			.select()
			.from(findings)
			.where(eq(findings.scanRunId, scanRunId));
		const byFindingId = new Map(
			rawFindings.map((finding) => [finding.id, finding]),
		);
		const memberFindings = group.findingIds.map((id) => byFindingId.get(id));
		if (memberFindings.some((finding) => !finding)) return null;
		const findingIds = group.findingIds;
		const [evidenceRows, provenanceRows] = await Promise.all([
			findingIds.length === 0
				? Promise.resolve([] as (typeof findingEvidences.$inferSelect)[])
				: this.db
						.select()
						.from(findingEvidences)
						.where(inArray(findingEvidences.findingId, findingIds)),
			snapshot.grouping.runId
				? this.db
						.select()
						.from(findingIssueGroupMembers)
						.where(eq(findingIssueGroupMembers.groupId, group.id))
				: Promise.resolve(
						[] as (typeof findingIssueGroupMembers.$inferSelect)[],
					),
		]);
		const evidenceByFindingId = new Map<string, typeof evidenceRows>();
		for (const evidence of evidenceRows) {
			evidenceByFindingId.set(evidence.findingId, [
				...(evidenceByFindingId.get(evidence.findingId) ?? []),
				evidence,
			]);
		}
		const provenanceByFindingId = new Map(
			provenanceRows.map((row) => [row.findingId, row]),
		);
		return {
			grouping: snapshot.grouping,
			group,
			members: group.findingIds.map((findingId) => ({
				finding: byFindingId.get(findingId) as typeof findings.$inferSelect,
				evidence: evidenceByFindingId.get(findingId) ?? [],
				provenance: provenanceByFindingId.get(findingId) ?? null,
			})),
		};
	}

	private async waitForCurrent(params: {
		scanRunId: string;
		findingSetHash: string;
		rawFindings: (typeof findings.$inferSelect)[];
	}): Promise<GroupingSnapshotResult> {
		const deadline = Date.now() + ACTIVE_WAIT_MS;
		while (Date.now() < deadline) {
			const current = await this.repository.findCurrentDeterministic({
				scanRunId: params.scanRunId,
				algorithmVersion: GROUPING_ALGORITHM_VERSION,
				findingSetHash: params.findingSetHash,
			});
			if (current) return storedSnapshot(current);
			await delay(ACTIVE_POLL_MS);
		}
		return singletonSnapshot(params.rawFindings, ["grouping_in_progress"]);
	}
}

export function findingSetHash(
	scanRunId: string,
	rawFindings: (typeof findings.$inferSelect)[],
): string {
	return canonicalJsonHash({
		scanRunId,
		algorithmVersion: GROUPING_ALGORITHM_VERSION,
		findings: rawFindings
			.map((finding) => {
				const identity = projectFindingDedupeIdentity(finding);
				const content =
					identity.issueKind === "secret"
						? { title: "secret", description: "" }
						: { title: finding.title, description: finding.description };
				return {
					id: finding.id,
					fingerprint: finding.fingerprint,
					sourceTool: finding.sourceTool,
					ruleId: finding.ruleId,
					severity: finding.severity,
					confidence: finding.confidence,
					primaryLocation: finding.primaryLocation,
					identity,
					titleHash: canonicalJsonHash(content.title),
					descriptionHash: canonicalJsonHash(content.description),
				};
			})
			.sort((left, right) => left.id.localeCompare(right.id)),
	});
}

function storedSnapshot(
	snapshot: StoredGroupingSnapshot,
): GroupingSnapshotResult {
	return {
		grouping: {
			runId: snapshot.run.id,
			runStatus: "completed",
			mode: "deterministic",
			algorithmVersion: snapshot.run.algorithmVersion,
			findingSetHash: snapshot.run.findingSetHash,
			snapshotHash: snapshot.run.snapshotHash,
			rawFindingCount: snapshot.run.rawFindingCount,
			issueCount: snapshot.run.issueCount,
			suppressedCount: snapshot.run.suppressedCount,
			ambiguousCount: snapshot.run.ambiguousCount,
			limitations: snapshot.run.limitations,
		},
		groups: snapshot.groups,
	};
}

function singletonSnapshot(
	rawFindings: (typeof findings.$inferSelect)[],
	limitations: string[],
): GroupingSnapshotResult {
	const groups = [...rawFindings]
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((finding) => {
			const identity = projectFindingDedupeIdentity(finding);
			return {
				id: `singleton:${finding.id}`,
				groupKey: `singleton:${finding.id}`,
				title: finding.title,
				description: finding.description,
				severity: finding.severity.toLowerCase(),
				representativeFindingId: finding.id,
				findingIds: [finding.id],
				sourceTools: [finding.sourceTool],
				primaryLocation: finding.primaryLocation ?? {},
				matchConfidence: "singleton" as const,
				reasonCodes: ["singleton"],
				metadata: {
					strategy: identity.issueKind,
					algorithmVersion: GROUPING_ALGORITHM_VERSION,
				},
			};
		});
	return {
		grouping: {
			runId: null,
			runStatus: null,
			mode: "singleton_fallback",
			algorithmVersion: GROUPING_ALGORITHM_VERSION,
			findingSetHash: null,
			snapshotHash: null,
			rawFindingCount: rawFindings.length,
			issueCount: rawFindings.length,
			suppressedCount: 0,
			ambiguousCount: 0,
			limitations,
		},
		groups,
	};
}

function isTerminalScanStatus(status: string): boolean {
	return (
		status === "completed" || status === "failed" || status === "cancelled"
	);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
