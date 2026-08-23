import { scanExecutionPlanSchema } from "../../../../../shared/schemas/scan-execution-plan.schema";
import { scanPreflightStatusSchema } from "../../../../../shared/schemas/scan-preflight.schema";
import {
	scanStepFinishedEventDataSchema,
	scanStepStartedEventDataSchema,
	type ScanProgressStepKind,
} from "../../../../../shared/schemas/scan-progress.schema";
import type { ScanEvent, ScanProfile, ScanRun } from "../../../api";
import { getScanStepDisplay } from "../scan-profile-display";

export type ScanProgressStepState =
	| "waiting"
	| "running"
	| "completed"
	| "failed"
	| "skipped"
	| "not_applicable"
	| "blocked";

export type ScanProgressItem = {
	stepId: string;
	kind: ScanProgressStepKind | "preparation" | "finalization";
	adapter: string;
	displayName: string;
	required: boolean;
	name: string;
	purpose: readonly string[];
	state: ScanProgressStepState;
	startedAt: string | null;
	finishedAt: string | null;
	findingCount: number | null;
	reasonCode: string | null;
	lastEventSeq: number;
};

export type ScanProgressModel = {
	scan: ScanRun;
	items: ScanProgressItem[];
	terminalCount: number;
	percentage: number;
	statusLabel:
		| "開始待ち"
		| "実行準備中"
		| "実行中"
		| "結果集計中"
		| "完了"
		| "失敗"
		| "キャンセル済み";
	current: ScanProgressItem | null;
	latestUpdate: string | null;
	loadingSteps: boolean;
};

const terminalStepStates = new Set<ScanProgressStepState>([
	"completed",
	"failed",
	"skipped",
	"not_applicable",
	"blocked",
]);

export function isActiveScanRun(scan: Pick<ScanRun, "status">): boolean {
	return scan.status === "queued" || scan.status === "running";
}

export function selectProgressScanRun(
	scanRuns: readonly ScanRun[],
	selectedScanRunId: string,
	projectId?: string,
): ScanRun | null {
	const runs = projectId
		? scanRuns.filter((scan) => scan.projectId === projectId)
		: scanRuns;
	const selected = runs.find((scan) => scan.id === selectedScanRunId);
	if (selected && isActiveScanRun(selected)) return selected;
	return runs.find(isActiveScanRun) ?? selected ?? null;
}

function readExecutionPlan(scan: ScanRun) {
	const parsed = scanExecutionPlanSchema.safeParse(scan.metadata.executionPlan);
	return parsed.success &&
		parsed.data.scanRunId === scan.id &&
		parsed.data.projectId === scan.projectId
		? parsed.data
		: null;
}

function lifecycleItem(params: {
	stepId: string;
	kind: "preparation" | "finalization";
	name: string;
	purpose: readonly string[];
	state: ScanProgressStepState;
	startedAt?: string | null;
}): ScanProgressItem {
	return {
		stepId: params.stepId,
		kind: params.kind,
		adapter: "profile-orchestrator",
		displayName: params.name,
		required: true,
		name: params.name,
		purpose: params.purpose,
		state: params.state,
		startedAt: params.startedAt ?? null,
		finishedAt: null,
		findingCount: null,
		reasonCode: null,
		lastEventSeq: 0,
	};
}

function initialItems(
	scan: ScanRun,
	profile: ScanProfile | null,
): ScanProgressItem[] {
	const executionPlan = readExecutionPlan(scan);
	const profileSteps = new Map(
		(profile?.steps ?? []).map((step) => [step.stepId, step]),
	);
	const queuedProgressSteps = Array.isArray(scan.metadata.queuedProgressSteps)
		? scan.metadata.queuedProgressSteps.flatMap((value) => {
				if (!value || typeof value !== "object" || Array.isArray(value))
					return [];
				const step = value as Record<string, unknown>;
				if (
					typeof step.stepId !== "string" ||
					typeof step.kind !== "string" ||
					typeof step.adapter !== "string" ||
					typeof step.displayName !== "string" ||
					typeof step.required !== "boolean"
				) {
					return [];
				}
				return [
					{
						stepId: step.stepId,
						kind: step.kind as ScanProgressStepKind,
						adapter: step.adapter,
						displayName: step.displayName,
						required: step.required,
					},
				];
			})
		: [];
	const definitions = executionPlan
		? executionPlan.steps.map((step) => {
				const profileStep = profileSteps.get(step.stepId);
				return {
					stepId: step.stepId,
					kind: step.kind,
					adapter: step.adapter,
					displayName: profileStep?.displayName ?? step.adapter,
					required: step.required,
				};
			})
		: (profile?.steps ?? queuedProgressSteps);
	return definitions.map((step) => {
		const display = getScanStepDisplay(
			step.stepId,
			step.adapter,
			step.displayName,
		);
		return {
			stepId: step.stepId,
			kind: step.kind,
			adapter: step.adapter,
			displayName: step.displayName,
			required: step.required,
			name: display.name,
			purpose: display.purpose,
			state: "waiting",
			startedAt: null,
			finishedAt: null,
			findingCount: null,
			reasonCode: null,
			lastEventSeq: 0,
		};
	});
}

function updateMessage(params: {
	name: string;
	eventType: string;
	findingCount?: number;
	outcome?: string;
}): string {
	if (params.eventType === "scan.step.started") {
		return `${params.name} を開始しました`;
	}
	switch (params.outcome) {
		case "completed":
			return `${params.name} が完了しました（検出 ${params.findingCount ?? 0} 件）`;
		case "failed":
			return `${params.name} が失敗しました`;
		case "not_applicable":
			return `${params.name} は対象外です`;
		case "blocked":
			return `${params.name} は実行前チェックで停止しました`;
		default:
			return `${params.name} をスキップしました`;
	}
}

export function buildScanProgressModel(params: {
	scan: ScanRun | null;
	profile: ScanProfile | null;
	events: readonly ScanEvent[];
}): ScanProgressModel | null {
	if (!params.scan) return null;
	const executionPlan = readExecutionPlan(params.scan);
	const scannerItems = initialItems(params.scan, params.profile);
	const preparation = lifecycleItem({
		stepId: "scan:preparation",
		kind: "preparation",
		name: "実行前チェックと隔離環境の準備",
		purpose: [
			"ソースsnapshotとローカル対象の起動方法を確定します",
			"Docker・スキャナーイメージ・隔離設定を検証します",
			"実行する工程と安全上限を固定します",
		],
		state: params.scan.status === "queued" ? "waiting" : "running",
		startedAt: params.scan.startedAt,
	});
	const finalization = lifecycleItem({
		stepId: "scan:finalization",
		kind: "finalization",
		name: "結果の集計と完了処理",
		purpose: [
			"各スキャナーの結果とカバレッジを集計します",
			"検出結果と実行証跡を保存して後片付けを確認します",
		],
		state: "waiting",
	});
	const items = [preparation, ...scannerItems, finalization];
	const itemIndex = new Map(items.map((item, index) => [item.stepId, index]));
	let latestUpdate: string | null = null;
	let latestEventSeq = 0;
	const finishPreparation = (
		event: ScanEvent,
		state: "completed" | "blocked",
	) => {
		if (terminalStepStates.has(preparation.state)) return;
		preparation.state = state;
		preparation.startedAt ??= params.scan?.startedAt ?? event.createdAt;
		preparation.finishedAt = event.createdAt;
		preparation.lastEventSeq = event.seq;
		preparation.reasonCode =
			state === "blocked" ? "scan_preflight_blocked" : null;
		latestUpdate =
			state === "completed"
				? `${preparation.name} が完了しました`
				: `${preparation.name} で停止しました`;
	};

	for (const event of [...params.events].sort((a, b) => a.seq - b.seq)) {
		if (event.scanRunId !== params.scan.id) continue;
		latestEventSeq = Math.max(latestEventSeq, event.seq);
		if (event.eventType === "scan.started") {
			if (terminalStepStates.has(preparation.state)) continue;
			preparation.state = "running";
			preparation.startedAt ??= event.createdAt;
			preparation.lastEventSeq = event.seq;
			latestUpdate = `${preparation.name} を開始しました`;
			continue;
		}
		if (event.eventType === "scan.preflight_completed") {
			const status = scanPreflightStatusSchema.safeParse(event.data.status);
			if (!status.success) continue;
			if (status.data === "ready" || status.data === "ready_with_gaps") {
				finishPreparation(event, "completed");
			} else {
				finishPreparation(event, "blocked");
			}
			continue;
		}
		if (
			event.eventType === "scan.plan_changed" ||
			event.eventType === "scan.preflight_changed"
		) {
			finishPreparation(event, "blocked");
			continue;
		}
		if (event.eventType === "scan.step.started") {
			const parsed = scanStepStartedEventDataSchema.safeParse(event.data);
			if (!parsed.success) continue;
			if (executionPlan && parsed.data.planHash !== executionPlan.planHash)
				continue;
			const index = itemIndex.get(parsed.data.stepId);
			if (index === undefined) continue;
			const item = items[index];
			if (
				item.kind !== parsed.data.kind ||
				item.adapter !== parsed.data.adapter ||
				item.required !== parsed.data.required
			) {
				continue;
			}
			// A known scanner cannot start before preparation has completed. This
			// also repairs history written before preflight events were persisted.
			finishPreparation(event, "completed");
			if (terminalStepStates.has(item.state)) continue;
			item.state = "running";
			item.startedAt ??= event.createdAt;
			item.lastEventSeq = event.seq;
			latestUpdate = updateMessage({
				name: item.name,
				eventType: event.eventType,
			});
			continue;
		}
		if (event.eventType !== "scan.step.finished") continue;
		const parsed = scanStepFinishedEventDataSchema.safeParse(event.data);
		if (!parsed.success) continue;
		if (executionPlan && parsed.data.planHash !== executionPlan.planHash)
			continue;
		const index = itemIndex.get(parsed.data.stepId);
		if (index === undefined) continue;
		const item = items[index];
		if (
			item.kind !== parsed.data.kind ||
			item.adapter !== parsed.data.adapter ||
			item.required !== parsed.data.required
		) {
			continue;
		}
		finishPreparation(event, "completed");
		if (terminalStepStates.has(item.state)) continue;
		item.state = parsed.data.outcome;
		item.finishedAt = event.createdAt;
		item.findingCount = parsed.data.findingCount;
		item.reasonCode = parsed.data.reasonCode;
		item.lastEventSeq = event.seq;
		latestUpdate = updateMessage({
			name: item.name,
			eventType: event.eventType,
			outcome: parsed.data.outcome,
			findingCount: parsed.data.findingCount,
		});
	}

	if (
		preparation.state === "completed" &&
		scannerItems.length > 0 &&
		scannerItems.every((item) => terminalStepStates.has(item.state))
	) {
		finalization.state = "running";
		finalization.startedAt =
			[...scannerItems]
				.map((item) => item.finishedAt)
				.filter((value): value is string => value !== null)
				.sort()
				.at(-1) ?? params.scan.startedAt;
		finalization.lastEventSeq = Math.max(
			preparation.lastEventSeq,
			...scannerItems.map((item) => item.lastEventSeq),
		);
		latestUpdate = `${finalization.name} を開始しました`;
	}

	const terminalAt = params.scan.completedAt ?? params.scan.updatedAt;
	if (params.scan.status === "completed") {
		if (!terminalStepStates.has(preparation.state)) {
			preparation.state = "completed";
			preparation.finishedAt = terminalAt;
		}
		if (
			scannerItems.length === 0 ||
			scannerItems.every((item) => terminalStepStates.has(item.state))
		) {
			finalization.state = "completed";
			finalization.startedAt ??= terminalAt;
			finalization.finishedAt = terminalAt;
			finalization.lastEventSeq = latestEventSeq;
			latestUpdate = `${finalization.name} が完了しました`;
		}
	} else if (params.scan.status === "failed") {
		for (const item of items) {
			if (item.state !== "running") continue;
			item.state = "failed";
			item.finishedAt = terminalAt;
			item.reasonCode = "scan_failed";
			latestUpdate = `${item.name} が失敗しました`;
		}
	} else if (params.scan.status === "cancelled") {
		for (const item of items) {
			if (terminalStepStates.has(item.state)) continue;
			item.state = "skipped";
			item.finishedAt = terminalAt;
			item.reasonCode = "scan_cancelled";
		}
		latestUpdate = "スキャンがキャンセルされました";
	}

	const terminalCount = items.filter((item) =>
		terminalStepStates.has(item.state),
	).length;
	const current =
		[...items]
			.filter((item) => item.state === "running")
			.sort((a, b) => b.lastEventSeq - a.lastEventSeq)[0] ?? null;
	return {
		scan: params.scan,
		items,
		terminalCount,
		percentage:
			items.length === 0 ? 0 : Math.round((terminalCount / items.length) * 100),
		statusLabel:
			params.scan.status === "completed"
				? "完了"
				: params.scan.status === "failed"
					? "失敗"
					: params.scan.status === "cancelled"
						? "キャンセル済み"
						: params.scan.status === "queued"
							? "開始待ち"
							: current?.kind === "preparation"
								? "実行準備中"
								: current?.kind === "finalization"
									? "結果集計中"
									: current
										? "実行中"
										: "実行準備中",
		current,
		latestUpdate,
		loadingSteps: isActiveScanRun(params.scan) && scannerItems.length === 0,
	};
}
