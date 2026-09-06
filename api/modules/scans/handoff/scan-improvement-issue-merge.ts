import type { ScanImprovementRequest } from "../../../../shared/schemas/scan.schema";

const MAX_VISIBLE_TASKS = 20;
const MAX_IMPLEMENTATION_TASKS = 30;
const MAX_IDS_PER_FALLBACK_TASK = 5000;

export function shouldKeepGeneratedConstraint(value: string): boolean {
	const normalized = value.replaceAll(/\s+/g, " ").trim();
	if (
		/(scanner|スキャナー).*(命令|リンク|コマンド).*(実装指示|実行しない|扱わない)/i.test(
			normalized,
		)
	) {
		return false;
	}
	if (
		/(現行コード|repository|リポジトリ).*(manifest|lockfile|既存テスト).*(正|判断|確認)/i.test(
			normalized,
		)
	) {
		return false;
	}
	if (
		/(根拠|主張).*(issue bundle|bundle|保存済み.*evidence).*(限定|基づ)/i.test(
			normalized,
		)
	) {
		return false;
	}
	return true;
}

export function buildIssueTasks(
	requests: ScanImprovementRequest[],
	issueIds: string[],
	findingIdsByIssueId: Map<string, string[]>,
): ScanImprovementRequest["implementationTasks"] {
	const allowed = new Set(issueIds);
	const expand = (ids: string[]) => expandIssueIds(ids, findingIdsByIssueId);
	const candidates = requests
		.flatMap((request) => request.implementationTasks)
		.map((task) => ({
			...task,
			issueIds: [...new Set(task.issueIds ?? [])].filter((id) =>
				allowed.has(id),
			),
		}))
		.filter((task) => issueIds.length === 0 || task.issueIds.length > 0);
	const tasks = selectEvenly(
		mergeIssueTasksByRemediation(candidates),
		MAX_VISIBLE_TASKS,
	);
	const covered = new Set(tasks.flatMap((task) => task.issueIds ?? []));
	let missing = issueIds.filter((id) => !covered.has(id));
	if (
		tasks.length + Math.ceil(missing.length / MAX_IDS_PER_FALLBACK_TASK) >
		MAX_IMPLEMENTATION_TASKS
	) {
		tasks.length = 0;
		missing = [...issueIds];
	}
	if (
		Math.ceil(missing.length / MAX_IDS_PER_FALLBACK_TASK) >
		MAX_IMPLEMENTATION_TASKS
	) {
		throw new Error(
			`Improvement request cannot represent all ${issueIds.length} issues within the persisted task contract.`,
		);
	}
	for (
		let offset = 0;
		offset < missing.length;
		offset += MAX_IDS_PER_FALLBACK_TASK
	) {
		tasks.push({
			title: "残りの issue を確認して修正する",
			body: "個別タスクへ統合されなかった issue を保存済み証跡の範囲で確認し、同じ修正方針ごとに実装修正と回帰テストを行ってください。",
			issueIds: missing.slice(offset, offset + MAX_IDS_PER_FALLBACK_TASK),
			findingIds: [],
			evidenceRefs: [],
		});
	}
	return tasks.map((task) => ({
		...task,
		issueIds: task.issueIds ?? [],
		findingIds: expand(task.issueIds ?? []),
	}));
}

export function buildIssuePriorityPlans(
	requests: ScanImprovementRequest[],
	issueIds: string[],
	findingIdsByIssueId: Map<string, string[]>,
): ScanImprovementRequest["priorityPlan"] {
	const allowed = new Set(issueIds);
	const candidates = requests
		.flatMap((request) => request.priorityPlan)
		.map((plan) => ({
			...plan,
			issueIds: [...new Set(plan.issueIds ?? [])].filter((id) =>
				allowed.has(id),
			),
		}))
		.filter((plan) => issueIds.length === 0 || plan.issueIds.length > 0);
	const plans = selectEvenly(mergeIssuePriorityPlans(candidates), 20).map(
		(plan) => ({
			...plan,
			findingIds: expandIssueIds(plan.issueIds ?? [], findingIdsByIssueId),
		}),
	);
	if (plans.length > 0) return plans;
	for (
		let offset = 0;
		offset < issueIds.length && plans.length < 20;
		offset += MAX_IDS_PER_FALLBACK_TASK
	) {
		const fallbackIssueIds = issueIds.slice(
			offset,
			offset + MAX_IDS_PER_FALLBACK_TASK,
		);
		plans.push({
			priority: "medium",
			rationale:
				"LLM が優先順位を返さなかったため、保存済み issue を未分類の改修対象として確認してください。",
			issueIds: fallbackIssueIds,
			findingIds: expandIssueIds(fallbackIssueIds, findingIdsByIssueId),
		});
	}
	return plans;
}

function expandIssueIds(
	issueIds: string[],
	findingIdsByIssueId: Map<string, string[]>,
): string[] {
	return [
		...new Set(issueIds.flatMap((id) => findingIdsByIssueId.get(id) ?? [])),
	];
}

function mergeIssueTasksByRemediation(
	tasks: ScanImprovementRequest["implementationTasks"],
): ScanImprovementRequest["implementationTasks"] {
	const merged = new Map<
		string,
		ScanImprovementRequest["implementationTasks"][number]
	>();
	for (const task of tasks) {
		const key = `${normalizeGeneratedText(task.title)}\0${normalizeGeneratedText(task.body)}`;
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, {
				...task,
				issueIds: uniqueLimited(task.issueIds ?? [], 5000),
				findingIds: uniqueLimited(task.findingIds, 5000),
				evidenceRefs: uniqueLimited(task.evidenceRefs, 50),
				...(task.warningGroupIds
					? { warningGroupIds: uniqueLimited(task.warningGroupIds, 5000) }
					: {}),
			});
			continue;
		}
		const warningGroupIds = uniqueLimited(
			[...(existing.warningGroupIds ?? []), ...(task.warningGroupIds ?? [])],
			5000,
		);
		merged.set(key, {
			...existing,
			issueIds: uniqueLimited(
				[...(existing.issueIds ?? []), ...(task.issueIds ?? [])],
				5000,
			),
			findingIds: uniqueLimited(
				[...existing.findingIds, ...task.findingIds],
				5000,
			),
			evidenceRefs: uniqueLimited(
				[...existing.evidenceRefs, ...task.evidenceRefs],
				50,
			),
			...(warningGroupIds.length > 0 ? { warningGroupIds } : {}),
		});
	}
	return [...merged.values()];
}

function mergeIssuePriorityPlans(
	plans: ScanImprovementRequest["priorityPlan"],
): ScanImprovementRequest["priorityPlan"] {
	const merged = new Map<
		string,
		ScanImprovementRequest["priorityPlan"][number]
	>();
	for (const plan of plans) {
		const key = `${plan.priority}\0${normalizeGeneratedText(plan.rationale)}`;
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, {
				...plan,
				issueIds: uniqueLimited(plan.issueIds ?? [], 5000),
				findingIds: uniqueLimited(plan.findingIds, 5000),
				...(plan.warningGroupIds
					? { warningGroupIds: uniqueLimited(plan.warningGroupIds, 5000) }
					: {}),
			});
			continue;
		}
		const warningGroupIds = uniqueLimited(
			[...(existing.warningGroupIds ?? []), ...(plan.warningGroupIds ?? [])],
			5000,
		);
		merged.set(key, {
			...existing,
			issueIds: uniqueLimited(
				[...(existing.issueIds ?? []), ...(plan.issueIds ?? [])],
				5000,
			),
			findingIds: uniqueLimited(
				[...existing.findingIds, ...plan.findingIds],
				5000,
			),
			...(warningGroupIds.length > 0 ? { warningGroupIds } : {}),
		});
	}
	return [...merged.values()];
}

function selectEvenly<T>(values: T[], maximum: number): T[] {
	if (values.length <= maximum) return values;
	if (maximum <= 1) return values.slice(0, maximum);
	return Array.from({ length: maximum }, (_, index) => {
		const sourceIndex = Math.round(
			(index * (values.length - 1)) / (maximum - 1),
		);
		return values[sourceIndex] as T;
	});
}

function normalizeGeneratedText(value: string): string {
	return value.replaceAll(/\s+/g, " ").trim();
}

function uniqueLimited(values: string[], maximum: number): string[] {
	return [...new Set(values)].slice(0, maximum);
}
