import { describe, expect, it, vi } from "vitest";
import { readBoundedProcessText } from "./bounded-process-output";

const streamChunks = (...chunks: Uint8Array[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});

describe("readBoundedProcessText", () => {
	it("collects output at the limit", async () => {
		const result = await readBoundedProcessText(
			streamChunks(new TextEncoder().encode("1234")),
			4,
		);
		expect(result).toEqual({
			text: "1234",
			bytesRead: 4,
			exceeded: false,
		});
	});

	it("retains only bounded diagnostics and signals overflow", async () => {
		const onLimit = vi.fn();
		const result = await readBoundedProcessText(
			streamChunks(
				new TextEncoder().encode("123"),
				new TextEncoder().encode("456"),
			),
			4,
			onLimit,
		);
		expect(result).toEqual({
			text: "1234",
			bytesRead: 6,
			exceeded: true,
		});
		expect(onLimit).toHaveBeenCalledOnce();
	});

	it("counts UTF-8 bytes rather than JavaScript characters", async () => {
		const result = await readBoundedProcessText(
			streamChunks(new TextEncoder().encode("あい")),
			5,
		);
		expect(result.exceeded).toBe(true);
		expect(result.bytesRead).toBe(6);
		expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(
			5,
		);
	});
});
