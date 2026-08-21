import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
	type AppDatabase,
	runInProcessDbTransaction,
	writerClientForDatabase,
} from "../../../db";
import {
	GROUPING_RUNNING_STALE_MS,
	GROUPING_WRITE_BATCH_SIZE,
} from "../../../../shared/schemas/finding-group.schema";
import {
	findingGroupingPairDecisions,
	findingGroupingRuns,
	findingIssueGroupMembers,
	findingIssueGroups,
} from "../../../db/schema";
import type {
	BuiltFindingGroup,
	BuiltGroupingSnapshot,
} from "./finding-grouping-engine";
import { canonicalJsonHash } from "./finding-dedupe-identity";

export type StoredFindingGroup = {
	id: string;
	groupKey: string;
	title: string;
	description: string;
	severity: string;
	representativeFindingId: string;
	findingIds: string[];
	sourceTools: string[];
	primaryLocation: Record<string, unknown>;
	matchConfidence: "exact" | "high" | "singleton";
	reasonCodes: string[];
	metadata: { strategy: string; algorithmVersion: string };
};

export type StoredGroupingSnapshot = {
	run: {
		id: string;
		algorithmVersion: string;
		findingSetHash: string;
		snapshotHash: string;
		rawFindingCount: number;
		issueCount: number;
		suppressedCount: number;
		ambiguousCount: number;
		limitations: string[];
	};
	groups: StoredFindingGroup[];
};

export class FindingGroupingRepository {
	constructor(private readonly db: AppDatabase) {}

	async recoverStaleRuns(scanRunId: string): Promise<void> {
		const staleBefore = new Date(Date.now() - GROUPING_RUNNING_STALE_MS);
		await this.db
			.update(findingGroupingRuns)
			.set({
				status: "failed",
				error: "grouping_run_stale",
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(findingGroupingRuns.scanRunId, scanRunId),
					eq(findingGroupingRuns.status, "running"),
					lt(findingGroupingRuns.startedAt, staleBefore),
				),
			);
	}

	async findCurrentDeterministic(params: {
		scanRunId: string;
		algorithmVersion: string;
		findingSetHash: string;
	}): Promise<StoredGroupingSnapshot | null> {
		const run = await this.db.query.findingGroupingRuns.findFirst({
			where: and(
				eq(findingGroupingRuns.scanRunId, params.scanRunId),
				eq(findingGroupingRuns.status, "completed"),
				eq(findingGroupingRuns.mode, "deterministic"),
				eq(findingGroupingRuns.algorithmVersion, params.algorithmVersion),
				eq(findingGroupingRuns.findingSetHash, params.findingSetHash),
			),
			orderBy: [
				desc(findingGroupingRuns.completedAt),
				desc(findingGroupingRuns.id),
			],
		});
		return run ? await this.readSnapshot(run.id) : null;
	}

	async findRunning(params: {
		scanRunId: string;
		algorithmVersion: string;
		findingSetHash: string;
	}) {
		return (
			(await this.db.query.findingGroupingRuns.findFirst({
				where: and(
					eq(findingGroupingRuns.scanRunId, params.scanRunId),
					eq(findingGroupingRuns.status, "running"),
					eq(findingGroupingRuns.mode, "deterministic"),
					eq(findingGroupingRuns.algorithmVersion, params.algorithmVersion),
					eq(findingGroupingRuns.findingSetHash, params.findingSetHash),
				),
			})) ?? null
		);
	}

	async createRunning(params: {
		scanRunId: string;
		algorithmVersion: string;
		findingSetHash: string;
	}): Promise<{ id: string; created: boolean }> {
		const now = new Date();
		const id = randomUUID();
		const [created] = await this.db
			.insert(findingGroupingRuns)
			.values({
				id,
				scanRunId: params.scanRunId,
				status: "running",
				mode: "deterministic",
				algorithmVersion: params.algorithmVersion,
				findingSetHash: params.findingSetHash,
				semanticDecisionHash: "",
				limitations: [],
				startedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning({ id: findingGroupingRuns.id });
		if (created) return { id: created.id, created: true };
		const running = await this.findRunning(params);
		if (running) return { id: running.id, created: false };
		const current = await this.findCurrentDeterministic(params);
		if (current) return { id: current.run.id, created: false };
		throw new Error("grouping_run_create_conflict");
	}

	async publish(params: {
		runId: string;
		algorithmVersion: string;
		findingSetHash: string;
		rawFindingCount: number;
		built: BuiltGroupingSnapshot;
	}): Promise<StoredGroupingSnapshot> {
		validateBuiltSnapshot(params.built, params.rawFindingCount);
		const snapshotHash = groupingSnapshotHash(
			params.built.groups,
			params.algorithmVersion,
		);
		const rows = buildRows(params.runId, params.built.groups);
		await this.insertRows(rows);
		const issueCount = params.built.groups.length;
		const suppressedCount = params.rawFindingCount - issueCount;
		await this.completeRun({
			runId: params.runId,
			snapshotHash,
			rawFindingCount: params.rawFindingCount,
			issueCount,
			suppressedCount,
			ambiguousCount: params.built.ambiguousCount,
			limitations: params.built.limitations,
		});
		const snapshot = await this.readSnapshot(params.runId);
		if (!snapshot) throw new Error("grouping_snapshot_publish_missing");
		return snapshot;
	}

	async fail(runId: string, error: unknown): Promise<void> {
		await this.db
			.update(findingGroupingRuns)
			.set({
				status: "failed",
				error: formatError(error),
				updatedAt: new Date(),
			})
			.where(eq(findingGroupingRuns.id, runId));
	}

	async readSnapshot(runId: string): Promise<StoredGroupingSnapshot | null> {
		const run = await this.db.query.findingGroupingRuns.findFirst({
			where: and(
				eq(findingGroupingRuns.id, runId),
				eq(findingGroupingRuns.status, "completed"),
			),
		});
		if (!run?.snapshotHash) return null;
		const groups = await this.db
			.select()
			.from(findingIssueGroups)
			.where(eq(findingIssueGroups.groupingRunId, run.id));
		const groupIds = groups.map((group) => group.id);
		const members =
			groupIds.length === 0
				? []
				: await this.db
						.select()
						.from(findingIssueGroupMembers)
						.where(inArray(findingIssueGroupMembers.groupId, groupIds));
		const membersByGroup = new Map<string, typeof members>();
		for (const member of members) {
			const current = membersByGroup.get(member.groupId) ?? [];
			current.push(member);
			membersByGroup.set(member.groupId, current);
		}
		const storedGroups = groups
			.map((group) => {
				const groupMembers = [...(membersByGroup.get(group.id) ?? [])].sort(
					(left, right) => left.findingId.localeCompare(right.findingId),
				);
				if (!group.representativeFindingId) return null;
				return {
					id: group.id,
					groupKey: group.stableKey,
					title: group.title,
					description: group.description,
					severity: group.severity,
					representativeFindingId: group.representativeFindingId,
					findingIds: groupMembers.map((member) => member.findingId),
					sourceTools: group.sourceTools,
					primaryLocation: group.primaryLocation,
					matchConfidence: group.matchConfidence as FindingMatchConfidence,
					reasonCodes: group.reasonCodes,
					metadata: {
						strategy: group.issueKind,
						algorithmVersion: run.algorithmVersion,
					},
				};
			})
			.filter((group): group is StoredFindingGroup => group !== null)
			.sort(compareStoredGroups);
		return {
			run: {
				id: run.id,
				algorithmVersion: run.algorithmVersion,
				findingSetHash: run.findingSetHash,
				snapshotHash: run.snapshotHash,
				rawFindingCount: run.rawFindingCount,
				issueCount: run.issueCount,
				suppressedCount: run.suppressedCount,
				ambiguousCount: run.ambiguousCount,
				limitations: run.limitations,
			},
			groups: storedGroups,
		};
	}

	private async insertRows(rows: ReturnType<typeof buildRows>): Promise<void> {
		const writer = writerClientForDatabase(this.db);
		if (writer) {
			const queries = [
				...rows.groups.map((row) =>
					this.db.insert(findingIssueGroups).values(row),
				),
				...rows.members.map((row) =>
					this.db.insert(findingIssueGroupMembers).values(row),
				),
				...rows.proofs.map((row) =>
					this.db.insert(findingGroupingPairDecisions).values(row),
				),
			];
			for (
				let offset = 0;
				offset < queries.length;
				offset += GROUPING_WRITE_BATCH_SIZE
			) {
				await writer.atomicDrizzleBatch(
					queries.slice(offset, offset + GROUPING_WRITE_BATCH_SIZE),
				);
			}
			return;
		}
		runInProcessDbTransaction(this.db, (transaction) => {
			for (const row of rows.groups)
				transaction.insert(findingIssueGroups).values(row).run();
			for (const row of rows.members)
				transaction.insert(findingIssueGroupMembers).values(row).run();
			for (const row of rows.proofs)
				transaction.insert(findingGroupingPairDecisions).values(row).run();
		});
	}

	private async completeRun(params: {
		runId: string;
		snapshotHash: string;
		rawFindingCount: number;
		issueCount: number;
		suppressedCount: number;
		ambiguousCount: number;
		limitations: string[];
	}): Promise<void> {
		const now = new Date();
		const query = this.db
			.update(findingGroupingRuns)
			.set({
				status: "completed",
				snapshotHash: params.snapshotHash,
				rawFindingCount: params.rawFindingCount,
				issueCount: params.issueCount,
				suppressedCount: params.suppressedCount,
				ambiguousCount: params.ambiguousCount,
				limitations: params.limitations,
				completedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(findingGroupingRuns.id, params.runId),
					eq(findingGroupingRuns.status, "running"),
				),
			);
		const writer = writerClientForDatabase(this.db);
		if (writer) {
			await writer.atomicDrizzleBatch([query]);
			return;
		}
		const updated = query.returning({ id: findingGroupingRuns.id }).get();
		if (!updated) throw new Error("grouping_run_publish_conflict");
	}
}

type FindingMatchConfidence = "exact" | "high" | "singleton";

function buildRows(runId: string, groups: BuiltFindingGroup[]) {
	const now = new Date();
	const persistedGroups = groups.map((group) => ({
		id: randomUUID(),
		groupingRunId: runId,
		stableKey: group.stableKey,
		representativeFindingId: group.representativeFindingId,
		issueKind: group.issueKind,
		title: group.title,
		description: group.description,
		severity: group.severity,
		primaryLocation: group.primaryLocation,
		matchConfidence: group.matchConfidence,
		sourceTools: group.sourceTools,
		reasonCodes: group.reasonCodes,
		metadata: {},
		createdAt: now,
	}));
	const groupIdByStableKey = new Map(
		persistedGroups.map((group) => [group.stableKey, group.id]),
	);
	const members = groups.flatMap((group) =>
		group.members.map((member) => {
			return {
				id: randomUUID(),
				groupId: groupIdByStableKey.get(group.stableKey) as string,
				groupingRunId: runId,
				findingId: member.finding.id,
				role: member.role,
				matchMethod:
					group.matchConfidence === "singleton" ? "singleton" : "deterministic",
				matchConfidence: member.matchConfidence,
				reasonCodes: member.reasonCodes,
				comparisonHash: member.comparisonHash,
				identity: member.identity,
				createdAt: now,
			};
		}),
	);
	const proofs = groups.flatMap((group) =>
		group.members.flatMap((member) => {
			if (member.role === "representative" || !member.comparisonHash) {
				return [];
			}
			const [leftFindingId, rightFindingId] = [
				member.finding.id,
				group.representativeFindingId,
			].sort();
			return [
				{
					id: randomUUID(),
					groupingRunId: runId,
					leftFindingId,
					rightFindingId,
					verdict: "same" as const,
					confidence: member.matchConfidence === "exact" ? "exact" : "high",
					method: "deterministic",
					reasonCodes: member.reasonCodes,
					rationale: null,
					comparisonHash: member.comparisonHash,
					provider: null,
					model: null,
					promptSequenceHash: null,
					responseContentSha256: null,
					createdAt: now,
				},
			];
		}),
	);
	return { groups: persistedGroups, members, proofs: uniqueProofRows(proofs) };
}

function validateBuiltSnapshot(
	built: BuiltGroupingSnapshot,
	rawFindingCount: number,
): void {
	const findingIds = built.groups.flatMap((group) => group.memberFindingIds);
	if (
		findingIds.length !== rawFindingCount ||
		new Set(findingIds).size !== rawFindingCount
	) {
		throw new Error("grouping_membership_invariant_failed");
	}
	for (const group of built.groups) {
		if (!group.memberFindingIds.includes(group.representativeFindingId)) {
			throw new Error("grouping_representative_membership_failed");
		}
	}
}

function groupingSnapshotHash(
	groups: BuiltFindingGroup[],
	algorithmVersion: string,
): string {
	return canonicalJsonHash({
		algorithmVersion,
		groups: groups
			.map((group) => ({
				stableKey: group.stableKey,
				representativeFindingId: group.representativeFindingId,
				memberFindingIds: [...group.memberFindingIds].sort(),
				severity: group.severity,
				issueKind: group.issueKind,
			}))
			.sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
	});
}

function compareStoredGroups(
	left: StoredFindingGroup,
	right: StoredFindingGroup,
): number {
	const severity = (value: string) =>
		({ critical: 0, high: 1, medium: 2, low: 3, info: 4, unknown: 5 })[
			value.toLowerCase() as "critical"
		] ?? 5;
	const severityDiff = severity(left.severity) - severity(right.severity);
	if (severityDiff !== 0) return severityDiff;
	const pathDiff = String(left.primaryLocation.path ?? "").localeCompare(
		String(right.primaryLocation.path ?? ""),
	);
	return pathDiff !== 0
		? pathDiff
		: left.groupKey.localeCompare(right.groupKey);
}

function uniqueProofRows<
	T extends { leftFindingId: string; rightFindingId: string },
>(rows: T[]): T[] {
	const keys = new Set<string>();
	return rows.filter((row) => {
		const key = `${row.leftFindingId}\0${row.rightFindingId}`;
		if (keys.has(key)) return false;
		keys.add(key);
		return true;
	});
}

function formatError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(
			/(?:token|secret|password|authorization)\s*[:=]\s*\S+/gi,
			"[redacted]",
		)
		.slice(0, 1000);
}
