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
	eventType: "scan.step.started" | "scan.step.finished",
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
		expect(model?.items.map((item) => item.state)).toEqual([
			"completed",
			"waiting",
		]);
		expect(model?.terminalCount).toBe(1);
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
		expect(model?.items[0]?.state).toBe("waiting");
		expect(model?.terminalCount).toBe(0);
	});

	it("does not build a panel for terminal scans", () => {
		expect(
			buildScanProgressModel({
				scan: scan("completed"),
				profile,
				events: [],
			}),
		).toBeNull();
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
		expect(model?.items.map((item) => item.state)).toEqual([
			"failed",
			"blocked",
		]);
		expect(model?.latestUpdate).toContain("停止しました");
	});
});
