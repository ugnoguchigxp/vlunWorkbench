import { describe, expect, it } from "bun:test";
import { WriterQueue } from "./queue";

describe("WriterQueue", () => {
	it("bounds pending work while preserving the active request", async () => {
		const queue = new WriterQueue(1);
		let releaseActive: (() => void) | undefined;
		const active = queue.enqueue(
			() =>
				new Promise<string>((resolve) => {
					releaseActive = () => resolve("active");
				}),
		);
		const pending = queue.enqueue(() => "pending");

		expect(queue.depth).toBe(2);
		await expect(queue.enqueue(() => "overflow")).rejects.toThrow(
			"queue is full",
		);
		releaseActive?.();
		expect(await active).toBe("active");
		expect(await pending).toBe("pending");
		await queue.whenIdle();
		expect(queue.depth).toBe(0);
	});

	it("rejects new work after shutdown starts and drains accepted work", async () => {
		const queue = new WriterQueue();
		const accepted = queue.enqueue(() => 42);
		queue.stopAccepting();
		await expect(queue.enqueue(() => 0)).rejects.toThrow("shutting down");
		expect(await accepted).toBe(42);
		await queue.whenIdle();
	});
});
