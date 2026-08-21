import {
	type ScanImprovementRequest,
	scanImprovementRequestSchema,
} from "../../../shared/schemas/scan.schema";
import { assertJapaneseTextFields } from "../llm-language";
import type { ScanReviewBundle } from "./scan-review-bundle";

const MAX_VISIBLE_TASKS = 20;
const MAX_IMPLEMENTATION_TASKS = 30;
const MAX_IDS_PER_FALLBACK_TASK = 5000;

export class StructuredImprovementRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StructuredImprovementRequestError";
	}
}

export function parseChunkImprovementRequest(
	content: string,
	bundle: ScanReviewBundle,
): ScanImprovementRequest {
	const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? content;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end < start) {
		throw new StructuredImprovementRequestError(
			"LLM response did not contain a valid JSON object.",
		);
	}
	let request: ScanImprovementRequest;
	try {
		request = scanImprovementRequestSchema.parse(
			JSON.parse(candidate.slice(start, end + 1)),
		);
	} catch (error) {
		throw new StructuredImprovementRequestError(
			error instanceof Error ? error.message : String(error),
		);
	}
	assertJapaneseRequest(request);
	assertFindingReferences(request, bundle);
	assertEvidenceReferences(request, bundle);
	return request;
}

function assertJapaneseRequest(request: ScanImprovementRequest): void {
	assertJapaneseTextFields(request as unknown as Record<string, unknown>, [
		"title",
		"objective",
		"scope",
		"acceptanceCriteria",
		"constraints",
		"nonGoals",
		"handoffPrompt",
	]);
	for (const item of request.priorityPlan) {
		assertJapaneseTextFields(item as unknown as Record<string, unknown>, [
			"rationale",
		]);
	}
	for (const item of request.implementationTasks) {
		assertJapaneseTextFields(item as unknown as Record<string, unknown>, [
			"title",
			"body",
		]);
	}
}

function assertFindingReferences(
	request: ScanImprovementRequest,
	bundle: ScanReviewBundle,
): void {
	const allowedIds = new Set(bundle.findings.map((finding) => finding.id));
	const referencedIds = [
		...request.priorityPlan.flatMap((item) => item.findingIds),
		...request.implementationTasks.flatMap((item) => item.findingIds),
	];
	const invalidIds = referencedIds.filter((id) => !allowedIds.has(id));
	if (invalidIds.length > 0) {
		throw new StructuredImprovementRequestError(
			`improvement request referenced finding IDs outside the saved bundle: ${[...new Set(invalidIds)].join(", ")}`,
		);
	}
}

function assertEvidenceReferences(
	request: ScanImprovementRequest,
	bundle: ScanReviewBundle,
): void {
	const allowedEvidenceIds = new Set([
		...bundle.artifacts.map((artifact) => artifact.id),
		...bundle.findings.flatMap((finding) =>
			finding.evidence.map((evidence) => evidence.id),
		),
	]);
	const allowedLocationRefs = new Set(
		bundle.findings.flatMap((finding) => [
			...locationReferences(finding.primaryLocation),
			...finding.evidence.flatMap((evidence) =>
				locationReferences(evidence.location),
			),
		]),
	);
	const invalidEvidenceIds = request.implementationTasks
		.flatMap((task) => task.evidenceRefs)
		.filter((reference) => {
			const normalized = reference.trim();
			return isUuid(normalized)
				? !allowedEvidenceIds.has(normalized)
				: !allowedLocationRefs.has(normalized);
		});
	if (invalidEvidenceIds.length > 0) {
		throw new StructuredImprovementRequestError(
			`improvement request referenced evidence IDs outside the saved bundle: ${[...new Set(invalidEvidenceIds)].join(", ")}`,
		);
	}
}

export function mergeScanImprovementRequests(
	bundles: ScanReviewBundle[],
	requests: ScanImprovementRequest[],
): ScanImprovementRequest {
	if (bundles.length !== requests.length || bundles.length === 0) {
		throw new Error("Improvement request chunks do not match their bundles.");
	}
	const findingIds = [
		...new Set(
			bundles.flatMap((bundle) => bundle.findings.map((finding) => finding.id)),
		),
	];
	const findingIdSet = new Set(findingIds);
	const projectName = bundles[0]?.project.name ?? "スキャン対象";
	const tasks = buildTasks(requests, findingIds, findingIdSet);
	const plans = buildPriorityPlans(requests, findingIds, findingIdSet);
	const acceptanceCriteria = uniqueStrings(
		requests.flatMap((request) => request.acceptanceCriteria),
		20,
	);
	const verificationCommands = uniqueStrings(
		requests.flatMap((request) => request.verificationCommands),
		20,
	);
	const constraints = uniqueStrings(
		[
			"使用してよい根拠は、このスキャンに保存された finding、evidence、artifact、verification context に限定します。",
			...requests.flatMap((request) => request.constraints),
		],
		20,
	);
	const nonGoals = uniqueStrings(
		[
			...(findingIds.length === 0
				? ["finding 0 件を安全の証明として扱わないこと。"]
				: []),
			...requests.flatMap((request) => request.nonGoals),
		],
		20,
	);
	const scope = uniqueStrings(
		[
			findingIds.length > 0
				? `選択したスキャンに保存された全 ${findingIds.length} 件の finding を対象にします。`
				: "finding 0 件のため、保存済みカバレッジと未確認領域を対象にします。",
			...requests.flatMap((request) => request.scope),
		],
		20,
	);
	const objective =
		findingIds.length > 0
			? `保存済みスキャン証跡に基づき、全 ${findingIds.length} 件の finding を修正方針ごとに整理し、実装修正と回帰検証を完了する。`
			: "finding 0 件を安全宣言にせず、保存済みカバレッジの不足と追加確認事項を明確にする。";
	return scanImprovementRequestSchema.parse({
		title: `${projectName} セキュリティ改修依頼`,
		objective,
		scope,
		priorityPlan: plans,
		implementationTasks: tasks,
		acceptanceCriteria,
		verificationCommands,
		constraints,
		nonGoals,
		handoffPrompt: buildHandoffPrompt({
			objective,
			scope,
			tasks,
			acceptanceCriteria,
			verificationCommands,
			constraints,
			nonGoals,
		}),
	});
}

function buildTasks(
	requests: ScanImprovementRequest[],
	findingIds: string[],
	findingIdSet: Set<string>,
): ScanImprovementRequest["implementationTasks"] {
	const flattened = requests.flatMap((request) =>
		request.implementationTasks
			.map((task) => ({
				...task,
				findingIds: [...new Set(task.findingIds)].filter((id) =>
					findingIdSet.has(id),
				),
			}))
			.filter((task) => findingIds.length === 0 || task.findingIds.length > 0),
	);
	const tasks = uniqueTasks(flattened).slice(0, MAX_VISIBLE_TASKS);
	const covered = new Set(tasks.flatMap((task) => task.findingIds));
	let missing = findingIds.filter((id) => !covered.has(id));
	if (
		tasks.length + Math.ceil(missing.length / MAX_IDS_PER_FALLBACK_TASK) >
		MAX_IMPLEMENTATION_TASKS
	) {
		tasks.length = 0;
		missing = [...findingIds];
	}
	if (
		Math.ceil(missing.length / MAX_IDS_PER_FALLBACK_TASK) >
		MAX_IMPLEMENTATION_TASKS
	) {
		throw new Error(
			`Improvement request cannot represent all ${findingIds.length} findings within the persisted task contract.`,
		);
	}
	for (
		let offset = 0;
		offset < missing.length;
		offset += MAX_IDS_PER_FALLBACK_TASK
	) {
		tasks.push({
			title: "残りの検出結果を確認して修正する",
			body: "個別タスクへ統合されなかった finding を保存済み証跡の範囲で確認し、同じルールまたは修正方針ごとに実装修正と回帰テストを行ってください。",
			findingIds: missing.slice(offset, offset + MAX_IDS_PER_FALLBACK_TASK),
			evidenceRefs: [],
		});
	}
	return tasks;
}

function locationReferences(location: unknown): string[] {
	if (!location || typeof location !== "object" || Array.isArray(location)) {
		return [];
	}
	const record = location as Record<string, unknown>;
	const path = typeof record.path === "string" ? record.path.trim() : "";
	if (!path) return [];
	const line =
		typeof record.startLine === "number" || typeof record.startLine === "string"
			? String(record.startLine).trim()
			: "";
	return line ? [path, `${path}:${line}`] : [path];
}

function buildPriorityPlans(
	requests: ScanImprovementRequest[],
	findingIds: string[],
	findingIdSet: Set<string>,
): ScanImprovementRequest["priorityPlan"] {
	const plans = requests
		.flatMap((request) => request.priorityPlan)
		.map((plan) => ({
			...plan,
			findingIds: [...new Set(plan.findingIds)].filter((id) =>
				findingIdSet.has(id),
			),
		}))
		.filter((plan) => findingIds.length === 0 || plan.findingIds.length > 0)
		.slice(0, 20);
	if (plans.length > 0) return plans;
	for (
		let offset = 0;
		offset < findingIds.length && plans.length < 20;
		offset += MAX_IDS_PER_FALLBACK_TASK
	) {
		plans.push({
			priority: "medium",
			rationale:
				"LLM が優先順位を返さなかったため、保存済み finding を未分類の改修対象として確認してください。",
			findingIds: findingIds.slice(offset, offset + MAX_IDS_PER_FALLBACK_TASK),
		});
	}
	return plans;
}

function buildHandoffPrompt(params: {
	objective: string;
	scope: string[];
	tasks: ScanImprovementRequest["implementationTasks"];
	acceptanceCriteria: string[];
	verificationCommands: string[];
	constraints: string[];
	nonGoals: string[];
}): string {
	const taskLines = params.tasks
		.slice(0, 12)
		.map(
			(task, index) =>
				`${index + 1}. ${task.title}: ${task.body}（対象 finding ${task.findingIds.length} 件）`,
		);
	return [
		"次の保存済みスキャン結果に基づき、セキュリティ上の指摘を修正してください。",
		`目的: ${params.objective}`,
		`対象範囲: ${params.scope.join(" / ")}`,
		`実装タスク:\n${taskLines.join("\n") || "保存済みカバレッジの不足を確認し、追加診断を行ってください。"}`,
		`受け入れ条件: ${params.acceptanceCriteria.join(" / ") || "対象 finding の修正と回帰確認が完了していること。"}`,
		`検証方法: ${params.verificationCommands.join(" / ") || "対象プロジェクトの既存テストと関連する回帰テストを実行してください。"}`,
		`制約: ${params.constraints.join(" / ")}`,
		`非ゴール: ${params.nonGoals.join(" / ")}`,
		"各 finding ID、証跡参照、詳細なタスクは同梱された改修依頼指示書の本文と付録を参照してください。",
	]
		.join("\n\n")
		.slice(0, 6000);
}

function uniqueTasks(
	tasks: ScanImprovementRequest["implementationTasks"],
): ScanImprovementRequest["implementationTasks"] {
	const seen = new Set<string>();
	return tasks.filter((task) => {
		const key = `${task.title.trim()}\0${task.body.trim()}\0${task.findingIds.join(",")}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function uniqueStrings(values: string[], max: number): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
		if (result.length >= max) break;
	}
	return result;
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value.trim(),
	);
}
