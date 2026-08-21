import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ProcessCapacityExceededError,
	WebProcessCapacity,
} from "../../processes/web-process-capacity";
import { ScanProcessSupervisor } from "./scan-process-supervisor";

function streamText(text = ""): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

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
	afterEach(() => {
		vi.useRealTimers();
	});

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
		let resolvePostProcessing!: () => void;
		const postProcessingMayFinish = new Promise<void>((resolve) => {
			resolvePostProcessing = resolve;
		});
		const onCompletedScan = vi.fn(async () => {
			resolveCompleted();
			await postProcessingMayFinish;
		});
		let notifySpawned!: () => void;
		const spawned = new Promise<void>((resolve) => {
			notifySpawned = resolve;
		});
		let resolveExit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const spawn = vi.fn(() => {
			notifySpawned();
			return {
				stdout: streamText(),
				stderr: streamText(),
				exited,
				kill: vi.fn(),
			};
		});
		const supervisor = new ScanProcessSupervisor(repository as never, {
			onCompletedScan,
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-4", [
			process.execPath,
			"scan",
		]);
		await spawned;
		repository.setStatus("completed");
		resolveExit(0);

		await completed;
		expect(onCompletedScan).toHaveBeenCalledWith("scan-4");
		expect(repository.scan.metadata.automaticDiagnosticRequested).toBe(true);
		let shutdownCompleted = false;
		const shutdown = supervisor.shutdown().then(() => {
			shutdownCompleted = true;
		});
		await flushMicrotasks();
		expect(shutdownCompleted).toBe(false);
		resolvePostProcessing();
		await shutdown;
		expect(shutdownCompleted).toBe(true);
	});

	it("waits for completed-scan lookup before shutdown finishes", async () => {
		const repository = createRepository({
			id: "scan-post-processing-race",
			status: "queued",
			metadata: {},
		});
		let notifyLookupStarted!: () => void;
		const lookupStarted = new Promise<void>((resolve) => {
			notifyLookupStarted = resolve;
		});
		let resolveLookup!: () => void;
		const lookupMayFinish = new Promise<void>((resolve) => {
			resolveLookup = resolve;
		});
		const originalFind = repository.findById.getMockImplementation()!;
		repository.findById.mockImplementation(async (id: string) => {
			if (repository.scan.status === "completed") {
				notifyLookupStarted();
				await lookupMayFinish;
			}
			return originalFind(id);
		});
		let resolveExit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const onCompletedScan = vi.fn(async () => undefined);
		const supervisor = new ScanProcessSupervisor(repository as never, {
			onCompletedScan,
			spawn: vi.fn(() => ({
				stdout: streamText(),
				stderr: streamText(),
				exited,
				kill: vi.fn(),
			})) as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-post-processing-race", [
			process.execPath,
			"scan",
		]);
		await flushMicrotasks();
		repository.setStatus("completed");
		resolveExit(0);
		await lookupStarted;
		let shutdownCompleted = false;
		const shutdown = supervisor.shutdown().then(() => {
			shutdownCompleted = true;
		});
		await flushMicrotasks();
		expect(shutdownCompleted).toBe(false);

		resolveLookup();
		await shutdown;
		expect(onCompletedScan).toHaveBeenCalledWith("scan-post-processing-race");
	});

	it("cancels a queued scan before spawning it", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const occupied = capacity.tryAcquire();
		const repository = createRepository({
			id: "scan-queued",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		const spawn = vi.fn();
		const supervisor = new ScanProcessSupervisor(repository as never, {
			processCapacity: capacity,
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-queued", [process.execPath, "scan"]);
		expect(capacity.stats).toEqual({ active: 1, queued: 1 });
		expect(await supervisor.cancel("scan-queued")).toEqual({
			cancelled: true,
		});
		await flushMicrotasks();

		expect(spawn).not.toHaveBeenCalled();
		expect(repository.scan.status).toBe("cancelled");
		expect(capacity.stats).toEqual({ active: 1, queued: 0 });
		occupied?.();
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});

	it("does not spawn a queued scan after its repository state becomes terminal", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const occupied = capacity.tryAcquire();
		const repository = createRepository({
			id: "scan-terminal-while-waiting",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		const spawn = vi.fn();
		const supervisor = new ScanProcessSupervisor(repository as never, {
			processCapacity: capacity,
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-terminal-while-waiting", [
			process.execPath,
			"scan",
		]);
		repository.setStatus("completed");
		occupied?.();
		await flushMicrotasks();

		expect(spawn).not.toHaveBeenCalled();
		expect(repository.scan.status).toBe("completed");
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});

	it("keeps metadata admission cancellable until the child is owned", async () => {
		const repository = createRepository({
			id: "scan-cancel-during-admission",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		let notifyMergeStarted!: () => void;
		const mergeStarted = new Promise<void>((resolve) => {
			notifyMergeStarted = resolve;
		});
		let resumeMerge!: () => void;
		const mergeMayFinish = new Promise<void>((resolve) => {
			resumeMerge = resolve;
		});
		const originalMerge =
			repository.mergeScanRunMetadata.getMockImplementation()!;
		repository.mergeScanRunMetadata.mockImplementationOnce(
			async (...args: [string, Record<string, unknown>]) => {
				notifyMergeStarted();
				await mergeMayFinish;
				return originalMerge(...args);
			},
		);
		const spawn = vi.fn();
		const supervisor = new ScanProcessSupervisor(repository as never, {
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-cancel-during-admission", [
			process.execPath,
			"scan",
		]);
		await mergeStarted;
		expect(await supervisor.cancel("scan-cancel-during-admission")).toEqual({
			cancelled: true,
		});
		resumeMerge();
		await flushMicrotasks();

		expect(spawn).not.toHaveBeenCalled();
		expect(repository.scan.status).toBe("cancelled");
	});

	it("fails a scan admission when the shared Web process queue is full", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const occupied = capacity.tryAcquire();
		const queuedRepository = createRepository({
			id: "scan-waiting",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		const rejectedRepository = createRepository({
			id: "scan-rejected",
			status: "queued",
			metadata: { launchSource: "web" },
		});
		const queuedSupervisor = new ScanProcessSupervisor(
			queuedRepository as never,
			{ processCapacity: capacity },
		);
		const rejectedSupervisor = new ScanProcessSupervisor(
			rejectedRepository as never,
			{ processCapacity: capacity },
		);

		await queuedSupervisor.launch("scan-waiting", [process.execPath, "scan"]);
		await expect(
			rejectedSupervisor.launch("scan-rejected", [process.execPath, "scan"]),
		).rejects.toBeInstanceOf(ProcessCapacityExceededError);

		expect(rejectedRepository.scan.status).toBe("failed");
		expect(rejectedRepository.events).toEqual([
			expect.objectContaining({ eventType: "scan.queue_capacity_exceeded" }),
		]);
		await queuedSupervisor.cancel("scan-waiting");
		occupied?.();
	});

	it("terminates and fails a scan that exceeds its wall-clock timeout", async () => {
		vi.useFakeTimers();
		const repository = createRepository({
			id: "scan-timeout",
			status: "running",
			metadata: { launchSource: "web" },
		});
		let resolveExit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const kill = vi.fn((signal: string) => {
			if (signal === "SIGTERM") resolveExit(143);
		});
		const spawn = vi.fn(() => ({
			stdout: streamText(),
			stderr: streamText(),
			exited,
			kill,
		}));
		const supervisor = new ScanProcessSupervisor(repository as never, {
			wallClockTimeoutSec: 300,
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-timeout", [process.execPath, "scan"]);
		await flushMicrotasks();
		expect(spawn).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300_000);
		await flushMicrotasks();

		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(repository.scan.status).toBe("failed");
		expect(repository.scan.metadata.terminationReason).toBe(
			"scan.wall_clock_timeout",
		);
	});

	it("force-kills an owned scan that ignores cancellation", async () => {
		vi.useFakeTimers();
		const repository = createRepository({
			id: "scan-force-cancel",
			status: "running",
			metadata: { launchSource: "web" },
		});
		let resolveExit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const kill = vi.fn((signal: string) => {
			if (signal === "SIGKILL") resolveExit(137);
		});
		const spawn = vi.fn(() => ({
			stdout: streamText(),
			stderr: streamText(),
			exited,
			kill,
		}));
		const supervisor = new ScanProcessSupervisor(repository as never, {
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-force-cancel", [process.execPath, "scan"]);
		await flushMicrotasks();
		expect(await supervisor.cancel("scan-force-cancel")).toEqual({
			cancelled: true,
		});
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		vi.advanceTimersByTime(2_000);
		await flushMicrotasks();

		expect(kill).toHaveBeenCalledWith("SIGKILL");
		expect(repository.scan.status).toBe("cancelled");
	});

	it("releases capacity during shutdown even if exit notification never settles", async () => {
		vi.useFakeTimers();
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const repository = createRepository({
			id: "scan-stubborn-shutdown",
			status: "running",
			metadata: { launchSource: "web" },
		});
		const kill = vi.fn();
		const spawn = vi.fn(() => ({
			stdout: streamText(),
			stderr: streamText(),
			exited: new Promise<number>(() => {}),
			kill,
		}));
		const supervisor = new ScanProcessSupervisor(repository as never, {
			processCapacity: capacity,
			spawn: spawn as unknown as typeof Bun.spawn,
		});

		await supervisor.launch("scan-stubborn-shutdown", [process.execPath, "scan"]);
		await flushMicrotasks();
		expect(capacity.stats.active).toBe(1);
		const shutdown = supervisor.shutdown();
		await flushMicrotasks();
		vi.advanceTimersByTime(2_000);
		await flushMicrotasks();
		vi.advanceTimersByTime(1_000);
		await flushMicrotasks();
		await shutdown;

		expect(kill).toHaveBeenCalledWith("SIGKILL");
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});
});
