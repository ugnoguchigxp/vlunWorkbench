import type { AppDatabase } from "../../../db";
import { FindingGroupingRunner } from "./finding-grouping-runner";

export interface FindingGroup {
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
	metadata: {
		strategy: string;
		algorithmVersion: string;
	};
}

export interface GroupedFindingsResult {
	grouping?: {
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
	groups: FindingGroup[];
}

/**
 * Compatibility facade for existing callers. Grouping is no longer derived
 * separately by each consumer: all callers observe the same persisted snapshot.
 */
export async function buildGroupedFindings(
	db: AppDatabase,
	scanRunId: string,
): Promise<GroupedFindingsResult> {
	const snapshot = await new FindingGroupingRunner(
		db,
	).ensureCurrentDeterministic(scanRunId);
	return snapshot;
}
