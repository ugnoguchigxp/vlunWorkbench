import { randomUUID } from "node:crypto";
import {
	ProcessCapacityExceededError,
	type ProcessCapacityRelease,
	WebProcessCapacity,
} from "../processes/web-process-capacity";
import type { ScanRepository } from "./repositories";
import { readBoundedProcessText } from "./tools/bounded-process-output";

const SUPERVISOR_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 2_000;

type PendingScanProcess = {
	scanRunId: string;
	argv: string[];
	controller: AbortController;
};

type OwnedScanProcess = {
	scanRunId: string;
	launchToken: string;
	proc: ReturnType<typeof Bun.spawn>;
	cancelling: boolean;
	releaseCapacity: ProcessCapacityRelease;
	wallClockTimeoutSec: number;
	wallClockTimer?: ReturnType<typeof setTimeout>;
	killTimer?: ReturnType<typeof setTimeout>;
	monitorCompletion?: Promise<void>;
	terminationReason?:
		| "scan.wall_clock_timeout"
		| "scan.child_output_limit"
		| "scan.child_monitor_failed";
};

const isActiveStatus = (status: string) =>
	status === "queued" || status === "running";

export class ScanProcessSupervisor {
	readonly runtimeInstanceId = randomUUID();
	private readonly owned = new Map<string, OwnedScanProcess>();
	private readonly pending = new Map<string, PendingScanProcess>();
	private readonly monitoring = new Set<Promise<void>>();
	private readonly postProcessing = new Set<Promise<void>>();
	private readonly fallbackCapacity = new WebProcessCapacity(() => ({
		concurrency: 2,
		queueLimit: 32,
	}));

	constructor(
		private readonly scanRepository: ScanRepository,
		private readonly deps: {
			onCompletedScan?: (scanRunId: string) => Promise<void>;
			processCapacity?: WebProcessCapacity;
			wallClockTimeoutSec?: number | (() => number);
			spawn?: typeof Bun.spawn;
		} = {},
	) {}

	private get processCapacity(): WebProcessCapacity {
		return this.deps.processCapacity ?? this.fallbackCapacity;
	}

	private wallClockTimeoutSec(): number {
		const configured =
			typeof this.deps.wallClockTimeoutSec === "function"
				? this.deps.wallClockTimeoutSec()
				: this.deps.wallClockTimeoutSec;
		return Math.max(300, Math.min(configured ?? 21_600, 86_400));
	}

	async recoverStaleWebScans(): Promise<number> {
		const active = await this.scanRepository.listActiveScanRuns();
		let recovered = 0;
		for (const scan of active) {
			const metadata = scan.metadata as Record<string, unknown>;
			if (
				metadata.launchSource !== "web" ||
				metadata.runtimeInstanceId === this.runtimeInstanceId
			) {
				continue;
			}
			const updated = await this.scanRepository.updateScanRunStatus(
				scan.id,
				"failed",
				{
					summary: "Web scan was left active by a previous server runtime.",
					metadata: {
						...metadata,
						terminationReason: "stale_runtime_recovery",
					},
					returnNullIfNotUpdated: true,
				},
			);
			if (!updated) continue;
			await this.scanRepository.createScanEvent({
				scanRunId: scan.id,
				level: "error",
				eventType: "scan.stale_recovered",
				message: "Stale Web scan was marked failed during server startup.",
			});
			recovered += 1;
		}
		return recovered;
	}

	async launch(scanRunId: string, argv: string[]): Promise<void> {
		if (this.owned.has(scanRunId) || this.pending.has(scanRunId)) return;
		const pending: PendingScanProcess = {
			scanRunId,
			argv: [...argv],
			controller: new AbortController(),
		};
		let lease: Promise<ProcessCapacityRelease>;
		try {
			lease = this.processCapacity.acquire(pending.controller.signal);
		} catch (error) {
			if (error instanceof ProcessCapacityExceededError) {
				await this.failNonTerminal(
					scanRunId,
					"scan.queue_capacity_exceeded",
					"Web scan queue is full. Retry after an active scan completes.",
				);
			}
			throw error;
		}
		this.pending.set(scanRunId, pending);
		void this.startWhenCapacityIsAvailable(pending, lease);
	}

	private async startWhenCapacityIsAvailable(
		pending: PendingScanProcess,
		leasePromise: Promise<ProcessCapacityRelease>,
	): Promise<void> {
		let releaseCapacity: ProcessCapacityRelease | undefined;
		try {
			releaseCapacity = await leasePromise;
			if (this.pending.get(pending.scanRunId) !== pending) {
				releaseCapacity();
				return;
			}
			const launched = await this.launchOnce(pending, releaseCapacity);
			if (launched) releaseCapacity = undefined;
		} catch (error) {
			if (!pending.controller.signal.aborted) {
				await this.failNonTerminal(
					pending.scanRunId,
					"scan.spawn_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		} finally {
			if (this.pending.get(pending.scanRunId) === pending) {
				this.pending.delete(pending.scanRunId);
			}
			releaseCapacity?.();
		}
	}

	private async launchOnce(
		pending: PendingScanProcess,
		releaseCapacity: ProcessCapacityRelease,
	): Promise<boolean> {
		const { scanRunId, argv, controller } = pending;
		if (controller.signal.aborted) return false;
		const queuedScan = await this.scanRepository.findById(scanRunId);
		if (
			controller.signal.aborted ||
			!queuedScan ||
			!isActiveStatus(queuedScan.status)
		) {
			return false;
		}
		const launchToken = randomUUID();
		await this.scanRepository.mergeScanRunMetadata(scanRunId, {
			launchSource: "web",
			launchToken,
			runtimeInstanceId: this.runtimeInstanceId,
			automaticDiagnosticRequested: true,
		});
		if (controller.signal.aborted) return false;
		const currentScan = await this.scanRepository.findById(scanRunId);
		if (
			controller.signal.aborted ||
			!currentScan ||
			!isActiveStatus(currentScan.status)
		) {
			return false;
		}

		const proc = (this.deps.spawn ?? Bun.spawn)(argv, {
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});

		const wallClockTimeoutSec = this.wallClockTimeoutSec();
		const owned: OwnedScanProcess = {
			scanRunId,
			launchToken,
			proc,
			cancelling: false,
			releaseCapacity,
			wallClockTimeoutSec,
		};
		owned.wallClockTimer = setTimeout(() => {
			this.terminateOwnedProcess(owned, "scan.wall_clock_timeout");
		}, wallClockTimeoutSec * 1000);
		this.owned.set(scanRunId, owned);
		if (this.pending.get(scanRunId) === pending) {
			this.pending.delete(scanRunId);
		}
		const monitorCompletion = this.monitor(owned)
			.catch((error) => {
				console.error(`Failed to monitor Web scan ${scanRunId}:`, error);
			})
			.finally(() => {
				this.monitoring.delete(monitorCompletion);
			});
		owned.monitorCompletion = monitorCompletion;
		this.monitoring.add(monitorCompletion);
		return true;
	}

	async cancel(
		scanRunId: string,
		reason = "user_requested",
	): Promise<{ cancelled: boolean; reason?: string }> {
		const scan = await this.scanRepository.findById(scanRunId);
		if (!scan) {
			return { cancelled: false, reason: "scan_not_active" };
		}
		const metadata = scan.metadata as Record<string, unknown>;
		const pending = this.pending.get(scanRunId);
		if (pending) {
			this.pending.delete(scanRunId);
			pending.controller.abort();
			if (isActiveStatus(scan.status)) {
				await this.persistCancellation(scanRunId, metadata, reason, true);
			}
			return { cancelled: true };
		}

		const owned = this.owned.get(scanRunId);
		if (owned) {
			const currentScan = await this.scanRepository.findById(scanRunId);
			const currentMetadata = (currentScan?.metadata ?? {}) as Record<
				string,
				unknown
			>;
			const ownsCurrentRecord =
				currentMetadata.launchToken === owned.launchToken;
			owned.cancelling = true;
			try {
				if (
					currentScan &&
					isActiveStatus(currentScan.status) &&
					ownsCurrentRecord
				) {
					await this.persistCancellation(
						scanRunId,
						currentMetadata,
						reason,
						false,
					);
				}
			} finally {
				this.kill(owned, "SIGTERM");
				owned.killTimer = setTimeout(
					() => this.kill(owned, "SIGKILL"),
					TERMINATION_GRACE_MS,
				);
			}
			if (
				currentScan &&
				isActiveStatus(currentScan.status) &&
				!ownsCurrentRecord
			) {
				await this.recordCancelRejected(scanRunId);
				return { cancelled: false, reason: "process_not_owned" };
			}
			return { cancelled: true };
		}

		if (!isActiveStatus(scan.status)) {
			return { cancelled: false, reason: "scan_not_active" };
		}
		await this.recordCancelRejected(scanRunId);
		return { cancelled: false, reason: "process_not_owned" };
	}

	private async recordCancelRejected(scanRunId: string): Promise<void> {
		await this.scanRepository.createScanEvent({
			scanRunId,
			level: "warn",
			eventType: "scan.cancel_rejected",
			message:
				"Cancel was rejected because this runtime does not own the scan process.",
			data: { reason: "process_not_owned" },
		});
	}

	private async persistCancellation(
		scanRunId: string,
		metadata: Record<string, unknown>,
		reason: string,
		beforeStart: boolean,
	): Promise<boolean> {
		const updated = await this.scanRepository.updateScanRunStatus(
			scanRunId,
			"cancelled",
			{
				summary: `Scan cancelled (${reason}).`,
				metadata: { ...metadata, terminationReason: reason },
				returnNullIfNotUpdated: true,
			},
		);
		if (!updated) return false;
		await this.scanRepository.createScanEvent({
			scanRunId,
			level: "warn",
			eventType: "scan.cancelled",
			message: `Scan ${beforeStart ? "queue entry" : "process"} was cancelled (${reason}).`,
		});
		return true;
	}

	async shutdown(): Promise<void> {
		const pendingJobs = [...this.pending.values()];
		for (const pending of pendingJobs) {
			this.pending.delete(pending.scanRunId);
			pending.controller.abort();
		}
		await Promise.allSettled(
			pendingJobs.map(async (pending) => {
				const scan = await this.scanRepository.findById(pending.scanRunId);
				if (!scan || !isActiveStatus(scan.status)) return;
				await this.persistCancellation(
					pending.scanRunId,
					scan.metadata as Record<string, unknown>,
					"server_shutdown",
					true,
				);
			}),
		);
		const jobs = [...this.owned.values()];
		await Promise.allSettled(
			jobs.map((job) => this.cancel(job.scanRunId, "server_shutdown")),
		);
		for (const job of jobs) {
			job.cancelling = true;
			this.kill(job, "SIGTERM");
		}
		await Promise.all(
			jobs.map(async (job) => {
				let exited = await this.waitForExit(job, TERMINATION_GRACE_MS);
				if (!exited) {
					this.kill(job, "SIGKILL");
					exited = await this.waitForExit(job, 1_000);
					if (!exited) {
						this.releaseOwnership(job);
						if (job.monitorCompletion) {
							this.monitoring.delete(job.monitorCompletion);
						}
					}
				}
			}),
		);
		await Promise.allSettled([...this.monitoring]);
		await Promise.allSettled([...this.postProcessing]);
	}

	private terminateOwnedProcess(
		job: OwnedScanProcess,
		reason: OwnedScanProcess["terminationReason"],
	): void {
		if (job.cancelling || job.terminationReason) return;
		job.terminationReason = reason;
		this.kill(job, "SIGTERM");
		job.killTimer = setTimeout(
			() => this.kill(job, "SIGKILL"),
			TERMINATION_GRACE_MS,
		);
	}

	private kill(job: OwnedScanProcess, signal: "SIGTERM" | "SIGKILL"): void {
		try {
			job.proc.kill(signal);
		} catch {
			// The process may have exited between the state check and signal delivery.
		}
	}

	private async waitForExit(
		job: OwnedScanProcess,
		timeoutMs: number,
	): Promise<boolean> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				job.proc.exited.then(
					() => true,
					() => true,
				),
				new Promise<false>((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private releaseOwnership(job: OwnedScanProcess): void {
		if (job.wallClockTimer) clearTimeout(job.wallClockTimer);
		if (job.killTimer) clearTimeout(job.killTimer);
		if (this.owned.get(job.scanRunId) === job) {
			this.owned.delete(job.scanRunId);
		}
		job.releaseCapacity();
	}

	private async monitor(job: OwnedScanProcess): Promise<void> {
		const stdoutPipe = job.proc.stdout as ReadableStream<Uint8Array>;
		const stderrPipe = job.proc.stderr as ReadableStream<Uint8Array>;
		let exitCode = -1;
		let stdout = "";
		let stderr = "";
		let monitorError: unknown;
		try {
			const [code, stdoutResult, stderrResult] = await Promise.all([
				job.proc.exited,
				readBoundedProcessText(stdoutPipe, SUPERVISOR_OUTPUT_LIMIT_BYTES, () =>
					this.terminateOwnedProcess(job, "scan.child_output_limit"),
				),
				readBoundedProcessText(stderrPipe, SUPERVISOR_OUTPUT_LIMIT_BYTES, () =>
					this.terminateOwnedProcess(job, "scan.child_output_limit"),
				),
			]);
			exitCode = code;
			stdout = stdoutResult.text;
			stderr = stderrResult.text;
		} catch (error) {
			monitorError = error;
			this.terminateOwnedProcess(job, "scan.child_monitor_failed");
			if (!(await this.waitForExit(job, TERMINATION_GRACE_MS + 1_000))) {
				this.kill(job, "SIGKILL");
			}
		} finally {
			this.releaseOwnership(job);
		}
		const scan = await this.scanRepository.findById(job.scanRunId);
		if (!scan) return;
		if (!isActiveStatus(scan.status)) {
			if (scan.status === "completed" && this.deps.onCompletedScan) {
				const postProcessing = this.deps.onCompletedScan(job.scanRunId);
				this.postProcessing.add(postProcessing);
				try {
					await postProcessing;
				} catch (error) {
					await this.scanRepository.createScanEvent({
						scanRunId: job.scanRunId,
						level: "error",
						eventType: "scan.post_processing_failed",
						message:
							"Completed scan post-processing did not finish successfully.",
						data: {
							error: error instanceof Error ? error.message : String(error),
						},
					});
				} finally {
					this.postProcessing.delete(postProcessing);
				}
			}
			return;
		}
		if (job.terminationReason) {
			const message =
				job.terminationReason === "scan.wall_clock_timeout"
					? `Web scan exceeded the ${job.wallClockTimeoutSec} second wall-clock timeout.`
					: job.terminationReason === "scan.child_output_limit"
						? `Web scan child output exceeded ${SUPERVISOR_OUTPUT_LIMIT_BYTES} bytes.`
						: `Web scan process monitoring failed: ${monitorError instanceof Error ? monitorError.message : String(monitorError)}`;
			await this.failNonTerminal(job.scanRunId, job.terminationReason, message);
			return;
		}
		if (monitorError) {
			await this.failNonTerminal(
				job.scanRunId,
				"scan.child_monitor_failed",
				`Web scan process monitoring failed: ${monitorError instanceof Error ? monitorError.message : String(monitorError)}`,
			);
			return;
		}
		const detail = stderr.trim() || stdout.trim();
		const message =
			exitCode === 0
				? "Scan child exited without persisting a terminal scan state."
				: `Scan child exited with code ${exitCode}${detail ? `: ${detail.slice(0, 500)}` : ""}`;
		await this.failNonTerminal(
			job.scanRunId,
			"scan.child_contract_failed",
			message,
		);
	}

	private async failNonTerminal(
		scanRunId: string,
		eventType: string,
		message: string,
	): Promise<void> {
		const scan = await this.scanRepository.findById(scanRunId);
		if (!scan || !isActiveStatus(scan.status)) return;
		const updated = await this.scanRepository.updateScanRunStatus(
			scanRunId,
			"failed",
			{
				summary: message,
				metadata: {
					...(scan.metadata as Record<string, unknown>),
					terminationReason: eventType,
				},
				returnNullIfNotUpdated: true,
			},
		);
		if (!updated) return;
		await this.scanRepository.createScanEvent({
			scanRunId,
			level: "error",
			eventType,
			message,
		});
	}
}
