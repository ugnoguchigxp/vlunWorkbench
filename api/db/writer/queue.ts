type QueueJob<T> = {
	run: () => T | Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
};

export class WriterQueue {
	private readonly jobs: QueueJob<unknown>[] = [];
	private active = false;
	private accepting = true;

	constructor(private readonly maxDepth = 10_000) {}

	get depth(): number {
		return this.jobs.length + (this.active ? 1 : 0);
	}

	enqueue<T>(run: () => T | Promise<T>): Promise<T> {
		if (!this.accepting) {
			return Promise.reject(new Error("Writer is shutting down."));
		}
		if (this.jobs.length >= this.maxDepth) {
			return Promise.reject(new Error("Writer queue is full."));
		}
		return new Promise<T>((resolve, reject) => {
			this.jobs.push({ run, resolve, reject } as QueueJob<unknown>);
			void this.drain();
		});
	}

	stopAccepting(): void {
		this.accepting = false;
	}

	async whenIdle(): Promise<void> {
		while (this.active || this.jobs.length > 0) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
	}

	private async drain(): Promise<void> {
		if (this.active) return;
		this.active = true;
		try {
			while (this.jobs.length > 0) {
				const job = this.jobs.shift();
				if (!job) continue;
				try {
					job.resolve(await job.run());
				} catch (error) {
					job.reject(error);
				}
			}
		} finally {
			this.active = false;
		}
	}
}
