import type { NightworkersWorkspaceTargetGrantRepository } from "./nightworkers-workspace-target-grant.repository";

const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

type CleanupRepository = Pick<
	NightworkersWorkspaceTargetGrantRepository,
	"clearExpiredWorkspacePaths"
>;

export class NightworkersWorkspaceTargetGrantJanitor {
	private timer: ReturnType<typeof setInterval> | null = null;
	private cleanupPromise: Promise<void> | null = null;
	private startPromise: Promise<void> | null = null;

	constructor(
		private readonly repository: CleanupRepository,
		private readonly options: {
			intervalMs?: number;
			now?: () => Date;
			logError?: (record: Record<string, unknown>) => void;
		} = {},
	) {}

	async start(): Promise<void> {
		if (this.timer) return;
		if (this.startPromise) return await this.startPromise;
		const start = this.startOnce();
		this.startPromise = start;
		try {
			await start;
		} finally {
			if (this.startPromise === start) this.startPromise = null;
		}
	}

	async stop(): Promise<void> {
		if (this.startPromise) await this.startPromise;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.cleanupPromise) await this.cleanupPromise;
	}

	async runOnce(): Promise<void> {
		if (this.cleanupPromise) return await this.cleanupPromise;
		const cleanup = this.repository
			.clearExpiredWorkspacePaths(this.options.now?.() ?? new Date())
			.catch((error) => {
				try {
					(this.options.logError ?? defaultLogError)({
						version: 1,
						level: "error",
						event: "nightworkers.workspace_grant_path_cleanup_failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
					});
				} catch {
					// Logging must not interrupt retention cleanup scheduling.
				}
			})
			.finally(() => {
				if (this.cleanupPromise === cleanup) this.cleanupPromise = null;
			});
		this.cleanupPromise = cleanup;
		await cleanup;
	}

	private async startOnce(): Promise<void> {
		await this.runOnce();
		if (this.timer) return;
		const intervalMs = this.options.intervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
		if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
			throw new Error("Workspace grant cleanup interval must be positive.");
		}
		this.timer = setInterval(() => void this.runOnce(), intervalMs);
		this.timer.unref?.();
	}
}

function defaultLogError(record: Record<string, unknown>): void {
	console.error(JSON.stringify(record));
}
