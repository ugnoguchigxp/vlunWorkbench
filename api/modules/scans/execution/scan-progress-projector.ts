type PlanStep = {
	stepId: string;
	applicability: "applicable" | "not_applicable" | "unknown";
};

type ProgressEvent = {
	seq: number;
	eventType: string;
	data: Record<string, unknown>;
};

export type ScanProgressSnapshotV2 = {
	schemaVersion: 2;
	runId: string;
	planHash: string;
	currentPhase:
		| "queued"
		| "resource_preparation"
		| "target_preparation"
		| "scanner_execution"
		| "evidence_persistence"
		| "cleanup"
		| "terminal";
	steps: Array<{
		stepId: string;
		status: "pending" | "running" | "completed" | "failed" | "not_applicable";
		completedUnits: number | null;
		totalUnits: number | null;
		safeMessage: string | null;
	}>;
	completedStepCount: number;
	totalStepCount: number;
	lastEventSeq: number;
};

type ProjectedStepStatus = ScanProgressSnapshotV2["steps"][number]["status"];

function phaseForEvent(
	eventType: string,
): ScanProgressSnapshotV2["currentPhase"] | null {
	if (eventType === "scan.queued") return "queued";
	if (eventType === "scan.started") return "resource_preparation";
	if (eventType === "scan.cleanup.started") return "cleanup";
	if (eventType === "scan.completed" || eventType === "scan.failed")
		return "terminal";
	if (
		eventType === "scan.step.started" ||
		eventType === "scan.step.progress" ||
		eventType === "scan.step.finished"
	)
		return "scanner_execution";
	return null;
}

/** Rebuilds UI progress entirely from an immutable plan and durable events. */
export function projectScanProgress(params: {
	runId: string;
	planHash: string;
	steps: PlanStep[];
	events: ProgressEvent[];
}): ScanProgressSnapshotV2 {
	if (params.steps.length === 0)
		throw new Error("scan_progress_plan_has_no_steps");
	const statuses = new Map<string, ProjectedStepStatus>(
		params.steps.map(
			(step) =>
				[
					step.stepId,
					step.applicability === "not_applicable"
						? "not_applicable"
						: "pending",
				] as const,
		),
	);
	const messages = new Map<string, string | null>();
	let currentPhase: ScanProgressSnapshotV2["currentPhase"] = "queued";
	let lastEventSeq = 0;
	for (const event of params.events) {
		lastEventSeq = Math.max(lastEventSeq, event.seq);
		const phase = phaseForEvent(event.eventType);
		if (phase) currentPhase = phase;
		const stepId =
			typeof event.data.stepId === "string" ? event.data.stepId : null;
		if (!stepId || !statuses.has(stepId)) continue;
		if (event.eventType === "scan.step.started")
			statuses.set(stepId, "running");
		if (event.eventType === "scan.step.finished") {
			const outcome = event.data.outcome;
			statuses.set(
				stepId,
				outcome === "completed"
					? "completed"
					: outcome === "not_applicable"
						? "not_applicable"
						: "failed",
			);
			messages.set(
				stepId,
				typeof event.data.reasonCode === "string"
					? event.data.reasonCode
					: null,
			);
		}
	}
	const steps = params.steps.map((step) => ({
		stepId: step.stepId,
		status: statuses.get(step.stepId) ?? "pending",
		completedUnits: null,
		totalUnits: null,
		safeMessage: messages.get(step.stepId) ?? null,
	}));
	return {
		schemaVersion: 2,
		runId: params.runId,
		planHash: params.planHash,
		currentPhase,
		steps,
		completedStepCount: steps.filter(
			(step) => step.status === "completed" || step.status === "not_applicable",
		).length,
		totalStepCount: steps.length,
		lastEventSeq,
	};
}
