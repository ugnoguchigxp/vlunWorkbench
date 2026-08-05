import { describe, expect, it } from "vitest";
import { createSingleWriterClient } from "./client";

describe("createSingleWriterClient", () => {
	it("serializes write operations in FIFO order", async () => {
		const events: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstCanFinish = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const writer = createSingleWriterClient({ name: "database" });

		const first = writer.execute(async () => {
			events.push("first:start");
			await firstCanFinish;
			events.push("first:end");
		});
		const second = writer.execute(() => {
			events.push("second");
		});

		await Promise.resolve();
		expect(events).toEqual(["first:start"]);

		releaseFirst?.();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second"]);
	});

	it("continues after a failed write operation", async () => {
		const writer = createSingleWriterClient({ value: 1 });

		await expect(
			writer.execute(() => {
				throw new Error("write failed");
			}),
		).rejects.toThrow("write failed");
		await expect(writer.execute((database) => database.value)).resolves.toBe(1);
	});

	it("drains queued writes and rejects new writes when closed", async () => {
		const writer = createSingleWriterClient({ value: 1 });
		const pending = writer.execute(async (database) => database.value);

		await writer.close();
		await expect(pending).resolves.toBe(1);
		await expect(writer.execute(() => 2)).rejects.toThrow(
			"Database writer is closed.",
		);
	});
});
