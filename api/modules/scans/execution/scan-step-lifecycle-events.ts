import type { ScanExecutionPlan } from "../../../../shared/schemas/scan-execution-plan.schema";
import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import type {
	ScanProgressStepOutcome,
	ScanStepFinishedEventData,
	ScanStepStartedEventData,
} from "../../../../shared/schemas/scan-progress.schema";
import type { ScanRepository } from "../repositories";

type PlannedStep = ScanExecutionPlan["steps"][number];

export type ScanStepLifecycleContext = {
	scanRunId: string;
	step: ScanProfileStep;
	planned: PlannedStep;
	position: number;
	totalSteps: number;
	planHash: string;
};

function baseEventData(
	context: ScanStepLifecycleContext,
): ScanStepStartedEventData {
	return {
		schemaVersion: 1,
		stepId: context.planned.stepId,
		kind: context.planned.kind,
		adapter: context.planned.adapter,
		displayName: context.step.displayName,
		position: context.position,
		totalSteps: context.totalSteps,
		required: context.planned.required,
		planHash: context.planHash,
	};
}

function eventLevelForOutcome(
	outcome: ScanProgressStepOutcome,
): "info" | "warn" | "error" {
	if (outcome === "failed") return "error";
	if (outcome === "skipped" || outcome === "blocked") return "warn";
	return "info";
}

export async function emitScanStepStarted(
	scanRepo: Pick<ScanRepository, "createScanEvent">,
	context: ScanStepLifecycleContext,
): Promise<void> {
	await scanRepo.createScanEvent({
		scanRunId: context.scanRunId,
		level: "info",
		eventType: "scan.step.started",
		message: `${context.planned.stepId} started.`,
		data: baseEventData(context),
	});
}

export async function emitScanStepFinished(
	scanRepo: Pick<ScanRepository, "createScanEvent">,
	context: ScanStepLifecycleContext,
	params: {
		outcome: ScanProgressStepOutcome;
		findingCount: number;
		reasonCode: string | null;
		durationMs: number | null;
	},
): Promise<void> {
	const data: ScanStepFinishedEventData = {
		...baseEventData(context),
		...params,
	};
	await scanRepo.createScanEvent({
		scanRunId: context.scanRunId,
		level: eventLevelForOutcome(params.outcome),
		eventType: "scan.step.finished",
		message: `${context.planned.stepId} finished with outcome ${params.outcome}.`,
		data,
	});
}
