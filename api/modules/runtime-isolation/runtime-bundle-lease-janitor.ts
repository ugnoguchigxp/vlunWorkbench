import { ScanResourceLeaseReaper } from "../scans/execution/lifecycle/scan-resource-lease-reaper";
import type { ScanResourceLeaseRepository } from "../scans/execution/lifecycle/scan-resource-lease-repository";
import { createDockerRuntimeCommandRunner } from "./docker-runtime-command-runner";
import { cleanupExpiredRuntimeBundle } from "./runtime-bundle-lease-cleanup";

/** Periodically reclaims bundle resources left behind by a terminated worker. */
export class RuntimeBundleLeaseJanitor {
	private timer: ReturnType<typeof setInterval> | null = null;
	private running: Promise<void> | null = null;
	constructor(
		repository: ScanResourceLeaseRepository,
		private readonly options: { intervalMs?: number; dockerBin?: string } = {},
	) {
		this.reaper = new ScanResourceLeaseReaper(
			repository,
			async (lease) =>
				await cleanupExpiredRuntimeBundle({
					dockerBin: this.options.dockerBin,
					runner: createDockerRuntimeCommandRunner(),
					lease,
				}),
			"docker-runtime-isolation",
		);
	}
	private readonly reaper: ScanResourceLeaseReaper;

	async start(): Promise<void> {
		if (this.timer) return;
		await this.runOnce();
		const intervalMs = this.options.intervalMs ?? 60_000;
		if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)
			throw new Error("Runtime bundle cleanup interval must be positive.");
		this.timer = setInterval(() => void this.runOnce(), intervalMs);
		this.timer.unref?.();
	}

	async stop(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		await this.running;
	}

	async runOnce(): Promise<void> {
		if (this.running) return await this.running;
		const running = this.reaper
			.reap()
			.then(() => undefined)
			.catch((error) => {
				console.error(
					JSON.stringify({
						version: 1,
						level: "error",
						event: "runtime_bundle_lease_reap_failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
					}),
				);
			})
			.finally(() => {
				if (this.running === running) this.running = null;
			});
		this.running = running;
		await running;
	}
}
