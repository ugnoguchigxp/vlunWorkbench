import { randomUUID } from "node:crypto";
import type { ScanRepository } from "./repositories";

type OwnedScanProcess = {
	scanRunId: string;
	launchToken: string;
	proc: ReturnType<typeof Bun.spawn>;
	cancelling: boolean;
};

const isActiveStatus = (status: string) =>
	status === "queued" || status === "running";

export class ScanProcessSupervisor {
	readonly runtimeInstanceId = randomUUID();
	private readonly owned = new Map<string, OwnedScanProcess>();

	constructor(private readonly scanRepository: ScanRepository) {}

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
			await this.scanRepository.updateScanRunStatus(scan.id, "failed", {
				summary: "Web scan was left active by a previous server runtime.",
				metadata: {
					...metadata,
					terminationReason: "stale_runtime_recovery",
				},
			});
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
		if (this.owned.has(scanRunId)) {
			throw new Error(`Scan process is already owned: ${scanRunId}`);
		}
		const launchToken = randomUUID();
		await this.scanRepository.mergeScanRunMetadata(scanRunId, {
			launchSource: "web",
			launchToken,
			runtimeInstanceId: this.runtimeInstanceId,
		});

		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn(argv, {
				stdout: "pipe",
				stderr: "pipe",
				env: process.env,
			});
		} catch (error) {
			await this.failNonTerminal(
				scanRunId,
				"scan.spawn_failed",
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		}

		const owned: OwnedScanProcess = {
			scanRunId,
			launchToken,
			proc,
			cancelling: false,
		};
		this.owned.set(scanRunId, owned);
		void this.monitor(owned);
	}

	async cancel(
		scanRunId: string,
		reason = "user_requested",
	): Promise<{ cancelled: boolean; reason?: string }> {
		const scan = await this.scanRepository.findById(scanRunId);
		if (!scan || !isActiveStatus(scan.status)) {
			return { cancelled: false, reason: "scan_not_active" };
		}
		const owned = this.owned.get(scanRunId);
		const metadata = scan.metadata as Record<string, unknown>;
		if (!owned || metadata.launchToken !== owned.launchToken) {
			await this.scanRepository.createScanEvent({
				scanRunId,
				level: "warn",
				eventType: "scan.cancel_rejected",
				message:
					"Cancel was rejected because this runtime does not own the scan process.",
				data: { reason: "process_not_owned" },
			});
			return { cancelled: false, reason: "process_not_owned" };
		}

		owned.cancelling = true;
		await this.scanRepository.updateScanRunStatus(scanRunId, "cancelled", {
			summary: `Scan cancelled (${reason}).`,
			metadata: { ...metadata, terminationReason: reason },
		});
		await this.scanRepository.createScanEvent({
			scanRunId,
			level: "warn",
			eventType: "scan.cancelled",
			message: `Scan process was cancelled (${reason}).`,
		});
		owned.proc.kill("SIGTERM");
		return { cancelled: true };
	}

	async shutdown(): Promise<void> {
		const jobs = [...this.owned.values()];
		await Promise.all(
			jobs.map((job) => this.cancel(job.scanRunId, "server_shutdown")),
		);
		await Promise.all(
			jobs.map(async (job) => {
				const exited = job.proc.exited.then(() => true);
				const timedOut = new Promise<false>((resolve) =>
					setTimeout(() => resolve(false), 2_000),
				);
				if (!(await Promise.race([exited, timedOut]))) {
					job.proc.kill("SIGKILL");
				}
			}),
		);
	}

	private async monitor(job: OwnedScanProcess): Promise<void> {
		const stdoutPipe = job.proc.stdout as ReadableStream<Uint8Array>;
		const stderrPipe = job.proc.stderr as ReadableStream<Uint8Array>;
		const [exitCode, stdout, stderr] = await Promise.all([
			job.proc.exited,
			new Response(stdoutPipe).text(),
			new Response(stderrPipe).text(),
		]);
		this.owned.delete(job.scanRunId);
		const scan = await this.scanRepository.findById(job.scanRunId);
		if (!scan || !isActiveStatus(scan.status)) return;
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
		await this.scanRepository.updateScanRunStatus(scanRunId, "failed", {
			summary: message,
			metadata: {
				...(scan.metadata as Record<string, unknown>),
				terminationReason: eventType,
			},
		});
		await this.scanRepository.createScanEvent({
			scanRunId,
			level: "error",
			eventType,
			message,
		});
	}
}
