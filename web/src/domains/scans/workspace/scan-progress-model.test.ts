import { describe, expect, it } from "vitest";
import type { ScanEvent, ScanProfile, ScanRun } from "../../../api";
import {
	buildScanProgressModel,
	selectProgressScanRun,
} from "./scan-progress-model";

const scan = (status: ScanRun["status"] = "running"): ScanRun => ({
	id: "scan-1",
	projectId: "project-1",
	profile: "baseline",
	status,
	startedAt: "2026-08-21T08:04:00.000Z",
	completedAt: null,
	createdByUserId: null,
	summary: null,
	metadata: {},
	createdAt: "2026-08-21T08:04:00.000Z",
	updatedAt: "2026-08-21T08:04:00.000Z",
});

const profile: ScanProfile = {
	id: "baseline",
	name: "標準スキャン",
	description: "baseline",
	enabled: true,
	defaultTimeoutSec: 600,
	tools: [],
	steps: [
		{
			stepId: "gitleaks",
			kind: "static_tool",
			adapter: "gitleaks",
			displayName: "Gitleaks Secret Detection",
			required: true,
			failurePolicy: "fail_profile",
		},
		{
			stepId: "osv",
			kind: "static_tool",
			adapter: "osv",
			displayName: "OSV Dependency Scanner",
			required: true,
			failurePolicy: "fail_profile",
		},
	],
};

function event(
	seq: number,
	eventType: string,
	data: Record<string, unknown>,
): ScanEvent {
	return {
		id: `event-${seq}`,
		scanRunId: "scan-1",
		seq,
		level: "info",
		eventType,
		message: eventType,
		data,
		createdAt: `2026-08-21T08:04:0${seq}.000Z`,
	};
}

const startedData = {
	schemaVersion: 1,
	stepId: "gitleaks",
	kind: "static_tool",
	adapter: "gitleaks",
	displayName: "Gitleaks Secret Detection",
	position: 1,
	totalSteps: 2,
	required: true,
	planHash: "sha256:test",
};

const scannerStates = (model: ReturnType<typeof buildScanProgressModel>) =>
	model?.items
		.filter(
			(item) =>
				item.kind !== "preparation" && item.kind !== "finalization",
		)
		.map((item) => item.state);

describe("scan progress model", () => {
	it("uses the active selected scan, otherwise the newest active scan", () => {
		const running = scan();
		const completed = { ...scan("completed"), id: "scan-2" };
		expect(selectProgressScanRun([running, completed], "scan-2")?.id).toBe(
			"scan-1",
		);
		expect(selectProgressScanRun([running, completed], "scan-1")?.id).toBe(
			"scan-1",
		);
		expect(selectProgressScanRun([completed], "scan-2")?.id).toBe("scan-2");
	});

	it("does not retain a previous project's active scan during navigation", () => {
		const previousProjectScan = scan();
		const currentProjectScan = {
			...scan("completed"),
			id: "scan-2",
			projectId: "project-2",
		};
		expect(
			selectProgressScanRun(
				[previousProjectScan, currentProjectScan],
				previousProjectScan.id,
				"project-2",
			),
		).toBeNull();
	});

	it("changes only from lifecycle events and accepts zero findings as completed", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				event(1, "scan.step.started", startedData),
				event(2, "scan.step.finished", {
					...startedData,
					outcome: "completed",
					findingCount: 0,
					reasonCode: null,
					durationMs: 20,
				}),
			],
		});
		expect(scannerStates(model)).toEqual([
			"completed",
			"waiting",
		]);
		expect(model?.terminalCount).toBe(2);
		expect(model?.percentage).toBe(50);
	});

	it("shows an active scanner and ignores invalid or unknown events", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				event(1, "scan.step.started", { invalid: true }),
				event(2, "scan.step.started", {
					...startedData,
					stepId: "unknown",
				}),
				event(3, "scan.step.started", startedData),
			],
		});
		expect(model?.current?.stepId).toBe("gitleaks");
		expect(model?.current?.purpose).toHaveLength(1);
	});

	it("ignores events that belong to a different scan during a polling handoff", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				{
					...event(1, "scan.step.finished", {
						...startedData,
						outcome: "completed",
						findingCount: 3,
						reasonCode: null,
						durationMs: 20,
					}),
					scanRunId: "scan-from-previous-poll",
				},
			],
		});
		expect(
			model?.items.find((item) => item.stepId === "gitleaks")?.state,
		).toBe("waiting");
		expect(model?.terminalCount).toBe(0);
	});

	it("keeps the final 100% state available after completion", () => {
		const model = buildScanProgressModel({
			scan: {
				...scan("completed"),
				completedAt: "2026-08-21T08:04:04.000Z",
			},
			profile,
			events: [
				event(1, "scan.step.finished", {
					...startedData,
					outcome: "completed",
					findingCount: 0,
					reasonCode: null,
					durationMs: 20,
				}),
				event(2, "scan.step.finished", {
					...startedData,
					stepId: "osv",
					adapter: "osv",
					displayName: "OSV Dependency Scanner",
					position: 2,
					outcome: "completed",
					findingCount: 0,
					reasonCode: null,
					durationMs: 20,
				}),
			],
		});
		expect(model?.statusLabel).toBe("完了");
		expect(model?.terminalCount).toBe(4);
		expect(model?.percentage).toBe(100);
		expect(model?.current).toBeNull();
	});

	it("does not complete preparation from unknown, mismatched, or malformed events", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				event(1, "scan.preflight_completed", { status: "corrupted" }),
				event(2, "scan.step.started", {
					...startedData,
					stepId: "unknown",
				}),
				event(3, "scan.step.started", {
					...startedData,
					adapter: "different-adapter",
				}),
			],
		});
		expect(
			model?.items.find((item) => item.kind === "preparation")?.state,
		).toBe("running");
		expect(model?.terminalCount).toBe(0);
	});

	it("completes preparation when preflight is ready with optional gaps", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				event(1, "scan.preflight_completed", {
					status: "ready_with_gaps",
				}),
			],
		});
		expect(
			model?.items.find((item) => item.kind === "preparation")?.state,
		).toBe("completed");
	});

	it("shows a changed preflight binding as blocked", () => {
		const model = buildScanProgressModel({
			scan: scan("failed"),
			profile,
			events: [event(1, "scan.preflight_changed", {})],
		});
		expect(
			model?.items.find((item) => item.kind === "preparation")?.state,
		).toBe("blocked");
		expect(model?.statusLabel).toBe("失敗");
	});

	it("does not regress blocked preparation on a duplicate started event", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				event(1, "scan.preflight_changed", {}),
				event(2, "scan.started", {}),
			],
		});
		expect(
			model?.items.find((item) => item.kind === "preparation")?.state,
		).toBe("blocked");
	});

	it("does not leave a failed terminal scan in a running state", () => {
		const model = buildScanProgressModel({
			scan: scan("failed"),
			profile: null,
			events: [],
		});
		expect(model?.current).toBeNull();
		expect(model?.items[0]?.state).toBe("failed");
		expect(model?.loadingSteps).toBe(false);
	});

	it("labels a queued scan as waiting to start", () => {
		const model = buildScanProgressModel({
			scan: scan("queued"),
			profile,
			events: [],
		});
		expect(model?.statusLabel).toBe("開始待ち");
		expect(model?.current).toBeNull();
	});

	it("records failed, blocked, and not-applicable outcomes from lifecycle events", () => {
		const model = buildScanProgressModel({
			scan: scan(),
			profile,
			events: [
				event(1, "scan.step.started", startedData),
				event(2, "scan.step.finished", {
					...startedData,
					outcome: "failed",
					findingCount: 0,
					reasonCode: "execution_failed",
					durationMs: 5,
				}),
				event(3, "scan.step.finished", {
					...startedData,
					stepId: "osv",
					adapter: "osv",
					displayName: "OSV Dependency Scanner",
					position: 2,
					outcome: "blocked",
					findingCount: 0,
					reasonCode: "preflight_failed",
					durationMs: null,
				}),
			],
		});
		expect(scannerStates(model)).toEqual([
			"failed",
			"blocked",
		]);
		expect(model?.current?.kind).toBe("finalization");
		expect(model?.latestUpdate).toContain("集計と完了処理");
	});

	it("uses an execution plan whose resolved profile differs from the launch alias", () => {
		const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
		const aliasedScan: ScanRun = {
			...scan(),
			id: "11111111-1111-4111-8111-111111111111",
			projectId: "22222222-2222-4222-8222-222222222222",
			profile: "runtime-passive",
			metadata: {
				executionPlan: {
					schemaVersion: 1,
					scanRunId: "11111111-1111-4111-8111-111111111111",
					projectId: "22222222-2222-4222-8222-222222222222",
					profileId: "runtime-web-safe",
					createdAt: "2026-08-21T08:04:00.000Z",
					profileVersion: 1,
					strictness: "strict",
					sourceRevision: null,
					sourceRevisionHash: null,
					sourceSnapshotDigest: null,
					sourceState: "clean",
					resolvedProfileHash: hash("a"),
					scannerManifestHash: null,
					scannerVersionsHash: hash("b"),
					dockerImagesHash: null,
					targetPlanHash: null,
					technologyRegistryDigest: null,
					orchestrator: {
						id: "profile-orchestrator",
						version: 1,
						runner: "docker",
					},
					preflightBindingHash: hash("c"),
					preflightHash: hash("d"),
					planHash: hash("e"),
					qualificationHash: null,
					blockerCodes: [],
					warningCodes: [],
					steps: [
						{
							stepId: "runtime_scanner:zap-baseline",
							kind: "runtime_scanner",
							adapter: "zap-baseline",
							required: true,
							applicability: "applicable",
							readiness: "ready",
							requirement: "required_if_applicable",
							reasonCodes: [],
							evidenceRefs: [],
						},
					],
				},
			},
		};
		const model = buildScanProgressModel({
			scan: aliasedScan,
			profile: null,
			events: [],
		});
		expect(model?.loadingSteps).toBe(false);
		expect(model?.items.map((item) => item.stepId)).toEqual([
			"scan:preparation",
			"runtime_scanner:zap-baseline",
			"scan:finalization",
		]);
	});

	it("shows the admitted step inventory before the immutable plan is persisted", () => {
		const model = buildScanProgressModel({
			scan: {
				...scan(),
				status: "queued",
				metadata: {
					queuedProgressSteps: [
						{
							stepId: "runtime_scanner:nuclei-safe",
							kind: "runtime_scanner",
							adapter: "nuclei-safe",
							displayName: "Nuclei",
							required: true,
						},
					],
				},
			},
			profile: null,
			events: [],
		});
		expect(model?.loadingSteps).toBe(false);
		expect(model?.items).toHaveLength(3);
		expect(model?.items.map((item) => item.stepId)).toEqual([
			"scan:preparation",
			"runtime_scanner:nuclei-safe",
			"scan:finalization",
		]);
	});
});
