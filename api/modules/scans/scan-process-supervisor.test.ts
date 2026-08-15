import { describe, expect, it, vi } from "vitest";
import { ScanProcessSupervisor } from "./scan-process-supervisor";

function createRepository(initial: {
	id: string;
	status: string;
	metadata: Record<string, unknown>;
}) {
	let scan = { ...initial, metadata: { ...initial.metadata } };
	const events: Array<Record<string, unknown>> = [];
	return {
		get scan() {
			return scan;
		},
		setStatus(status: string) {
			scan = { ...scan, status };
		},
		events,
		findById: vi.fn(async (id: string) => (id === scan.id ? scan : null)),
		listActiveScanRuns: vi.fn(async () => [scan]),
		mergeScanRunMetadata: vi.fn(
			async (_id: string, metadata: Record<string, unknown>) => {
				scan = { ...scan, metadata: { ...scan.metadata, ...metadata } };
				return scan;
			},
		),
		updateScanRunStatus: vi.fn(
			async (
				_id: string,
				status: string,
				options?: { metadata?: Record<string, unknown> },
			) => {
				scan = {
					...scan,
					status,
					metadata: options?.metadata ?? scan.metadata,
				};
				return scan;
			},
		),
		createScanEvent: vi.fn(async (event: Record<string, unknown>) => {
			events.push(event);
			return event;
		}),
	};
}

describe("ScanProcessSupervisor", () => {
	it("cancels only a process launched and tokened by the current runtime", async () => {
		const repository = createRepository({
			id: "scan-1",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		const supervisor = new ScanProcessSupervisor(repository as never);
		await supervisor.launch("scan-1", [
			process.execPath,
			"-e",
			"setInterval(() => {}, 1000)",
		]);

		const result = await supervisor.cancel("scan-1");
		expect(result).toEqual({ cancelled: true });
		expect(repository.scan.status).toBe("cancelled");
		expect(repository.scan.metadata.terminationReason).toBe("user_requested");
		expect(repository.events).toEqual([
			expect.objectContaining({ eventType: "scan.cancelled" }),
		]);
		await supervisor.shutdown();
	});

	it("deduplicates concurrent and repeated launch requests for an owned scan", async () => {
		const repository = createRepository({
			id: "scan-deduplicated",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		const supervisor = new ScanProcessSupervisor(repository as never);
		const argv = [process.execPath, "-e", "setInterval(() => {}, 1000)"];

		await Promise.all([
			supervisor.launch("scan-deduplicated", argv),
			supervisor.launch("scan-deduplicated", argv),
		]);
		await supervisor.launch("scan-deduplicated", argv);

		expect(repository.mergeScanRunMetadata).toHaveBeenCalledTimes(1);
		await supervisor.shutdown();
	});

	it("rejects cancellation when this runtime does not own the process", async () => {
		const repository = createRepository({
			id: "scan-2",
			status: "running",
			metadata: { launchSource: "web", launchToken: "other-runtime" },
		});
		const supervisor = new ScanProcessSupervisor(repository as never);

		expect(await supervisor.cancel("scan-2")).toEqual({
			cancelled: false,
			reason: "process_not_owned",
		});
		expect(repository.scan.status).toBe("running");
		expect(repository.events).toEqual([
			expect.objectContaining({ eventType: "scan.cancel_rejected" }),
		]);
	});

	it("recovers only stale Web-owned active scans", async () => {
		const repository = createRepository({
			id: "scan-3",
			status: "running",
			metadata: { launchSource: "web", runtimeInstanceId: "old-runtime" },
		});
		const supervisor = new ScanProcessSupervisor(repository as never);

		expect(await supervisor.recoverStaleWebScans()).toBe(1);
		expect(repository.scan.status).toBe("failed");
		expect(repository.scan.metadata.terminationReason).toBe(
			"stale_runtime_recovery",
		);
	});

	it("dispatches a completed owned scan to automated diagnosis", async () => {
		const repository = createRepository({
			id: "scan-4",
			status: "queued",
			metadata: {},
		});
		let resolveCompleted!: () => void;
		const completed = new Promise<void>((resolve) => {
			resolveCompleted = resolve;
		});
		const onCompletedScan = vi.fn(async () => {
			resolveCompleted();
		});
		const supervisor = new ScanProcessSupervisor(repository as never, {
			onCompletedScan,
		});

		await supervisor.launch("scan-4", [
			process.execPath,
			"-e",
			"setTimeout(() => process.exit(0), 20)",
		]);
		repository.setStatus("completed");

		await completed;
		expect(onCompletedScan).toHaveBeenCalledWith("scan-4");
		expect(repository.scan.metadata.automaticDiagnosticRequested).toBe(true);
	});
});
