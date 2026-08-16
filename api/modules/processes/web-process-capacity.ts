export type ProcessCapacityRelease = () => void;

export class ProcessCapacityExceededError extends Error {
	readonly code = "WEB_PROCESS_CAPACITY_EXCEEDED";
}

type CapacityLimits = {
	concurrency: number;
	queueLimit: number;
};

type Waiter = {
	resolve: (release: ProcessCapacityRelease) => void;
	reject: (error: Error) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
	aborted: boolean;
};

function boundedLimit(value: number, maximum: number): number {
	if (!Number.isSafeInteger(value)) return 1;
	return Math.max(1, Math.min(value, maximum));
}

export class WebProcessCapacity {
	private active = 0;
	private readonly waiters: Waiter[] = [];

	constructor(private readonly resolveLimits: () => CapacityLimits) {}

	get stats() {
		return { active: this.active, queued: this.liveWaiters().length };
	}

	tryAcquire(): ProcessCapacityRelease | null {
		this.compactWaiters();
		this.dispatchWaiters();
		const { concurrency } = this.limits();
		if (this.waiters.length > 0 || this.active >= concurrency) return null;
		this.active += 1;
		return this.createRelease();
	}

	acquire(signal?: AbortSignal): Promise<ProcessCapacityRelease> {
		if (signal?.aborted) {
			return Promise.reject(
				new Error("Process capacity request was cancelled."),
			);
		}
		const immediate = this.tryAcquire();
		if (immediate) return Promise.resolve(immediate);
		this.compactWaiters();
		const { queueLimit } = this.limits();
		if (this.waiters.length >= queueLimit) {
			throw new ProcessCapacityExceededError("Web process queue is full.");
		}
		return new Promise<ProcessCapacityRelease>((resolve, reject) => {
			const waiter: Waiter = { resolve, reject, signal, aborted: false };
			if (signal) {
				waiter.onAbort = () => {
					if (waiter.aborted) return;
					waiter.aborted = true;
					reject(new Error("Process capacity request was cancelled."));
				};
				signal.addEventListener("abort", waiter.onAbort, { once: true });
			}
			this.waiters.push(waiter);
		});
	}

	private limits(): CapacityLimits {
		const limits = this.resolveLimits();
		return {
			concurrency: boundedLimit(limits.concurrency, 8),
			queueLimit: boundedLimit(limits.queueLimit, 256),
		};
	}

	private liveWaiters(): Waiter[] {
		return this.waiters.filter((waiter) => !waiter.aborted);
	}

	private compactWaiters(): void {
		for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
			const waiter = this.waiters[index];
			if (!waiter?.aborted) continue;
			if (waiter.signal && waiter.onAbort) {
				waiter.signal.removeEventListener("abort", waiter.onAbort);
			}
			this.waiters.splice(index, 1);
		}
	}

	private createRelease(): ProcessCapacityRelease {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.release();
		};
	}

	private release(): void {
		this.active = Math.max(0, this.active - 1);
		this.compactWaiters();
		this.dispatchWaiters();
	}

	private dispatchWaiters(): void {
		const { concurrency } = this.limits();
		while (this.active < concurrency && this.waiters.length > 0) {
			const waiter = this.waiters.shift();
			if (!waiter || waiter.aborted) continue;
			if (waiter.signal && waiter.onAbort) {
				waiter.signal.removeEventListener("abort", waiter.onAbort);
			}
			this.active += 1;
			waiter.resolve(this.createRelease());
		}
	}
}
