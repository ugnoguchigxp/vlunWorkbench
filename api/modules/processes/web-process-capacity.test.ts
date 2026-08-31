import { describe, expect, it } from "vitest";
import {
	ProcessCapacityExceededError,
	WebProcessCapacity,
} from "./web-process-capacity";

describe("WebProcessCapacity", () => {
	it("queues permits in FIFO order and enforces the queue limit", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const first = capacity.tryAcquire();
		expect(first).not.toBeNull();
		const second = capacity.acquire();
		expect(() => capacity.acquire()).toThrow(ProcessCapacityExceededError);

		first?.();
		const releaseSecond = await second;
		expect(capacity.stats).toEqual({ active: 1, queued: 0 });
		releaseSecond();
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});

	it("removes an aborted waiter without consuming capacity", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 2,
		}));
		const first = capacity.tryAcquire();
		const controller = new AbortController();
		const waiting = capacity.acquire(controller.signal);
		controller.abort();
		await expect(waiting).rejects.toThrow("cancelled");
		first?.();
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});

	it("does not exceed a concurrency limit that is lowered at runtime", async () => {
		let concurrency = 2;
		const capacity = new WebProcessCapacity(() => ({
			concurrency,
			queueLimit: 2,
		}));
		const first = capacity.tryAcquire();
		const second = capacity.tryAcquire();
		const waiting = capacity.acquire();
		concurrency = 1;

		first?.();
		expect(capacity.stats).toEqual({ active: 1, queued: 1 });
		second?.();
		const releaseWaiting = await waiting;
		expect(capacity.stats).toEqual({ active: 1, queued: 0 });
		releaseWaiting();
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});

	it("fails closed when a runtime limit resolver returns non-finite values", () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: Number.NaN,
			queueLimit: Number.POSITIVE_INFINITY,
		}));
		const first = capacity.tryAcquire();
		expect(first).not.toBeNull();
		expect(capacity.tryAcquire()).toBeNull();
		const waiting = capacity.acquire();
		expect(() => capacity.acquire()).toThrow(ProcessCapacityExceededError);

		first?.();
		return waiting.then((release) => release());
	});
});
