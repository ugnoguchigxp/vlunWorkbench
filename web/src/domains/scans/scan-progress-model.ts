import {
	scanStepFinishedEventDataSchema,
	scanStepStartedEventDataSchema,
} from "../../../../shared/schemas/scan-progress.schema";
import { scanExecutionPlanSchema } from "../../../../shared/schemas/scan-execution-plan.schema";
import type { ScanEvent, ScanProfile, ScanRun } from "../../api";
import { getScanStepDisplay } from "./scan-profile-display";

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
	kind: NonNullable<ScanProfile["steps"]>[number]["kind"];
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
	statusLabel: "開始待ち" | "実行準備中" | "実行中";
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
	return runs.find(isActiveScanRun) ?? null;
}

function readExecutionPlan(scan: ScanRun) {
	const parsed = scanExecutionPlanSchema.safeParse(scan.metadata.executionPlan);
	return parsed.success && parsed.data.profileId === scan.profile
		? parsed.data
		: null;
}

function initialItems(
	scan: ScanRun,
	profile: ScanProfile | null,
): ScanProgressItem[] {
	const executionPlan = readExecutionPlan(scan);
	const profileSteps = new Map(
		(profile?.steps ?? []).map((step) => [step.stepId, step]),
	);
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
		: (profile?.steps ?? []);
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
	if (!params.scan || !isActiveScanRun(params.scan)) return null;
	const executionPlan = readExecutionPlan(params.scan);
	const items = initialItems(params.scan, params.profile);
	const itemIndex = new Map(items.map((item, index) => [item.stepId, index]));
	let latestUpdate: string | null = null;

	for (const event of [...params.events].sort((a, b) => a.seq - b.seq)) {
		if (event.scanRunId !== params.scan.id) continue;
		if (event.eventType === "scan.step.started") {
			const parsed = scanStepStartedEventDataSchema.safeParse(event.data);
			if (!parsed.success) continue;
			if (executionPlan && parsed.data.planHash !== executionPlan.planHash)
				continue;
			const index = itemIndex.get(parsed.data.stepId);
			if (index === undefined) continue;
			const item = items[index];
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
			params.scan.status === "queued"
				? "開始待ち"
				: current
					? "実行中"
					: "実行準備中",
		current,
		latestUpdate,
		loadingSteps: items.length === 0,
	};
}
