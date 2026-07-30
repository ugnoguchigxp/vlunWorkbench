import { describe, expect, test } from "bun:test";
import { readBoundedDiagnostic } from "./process-diagnostics";

const streamText = (text: string) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});

describe("readBoundedDiagnostic", () => {
	test("retains diagnostics within the limit", async () => {
		expect(await readBoundedDiagnostic(streamText("ok"), 2)).toEqual({
			text: "ok",
			bytesRead: 2,
			truncated: false,
		});
	});

	test("bounds noisy child process output", async () => {
		expect(await readBoundedDiagnostic(streamText("12345"), 4)).toEqual({
			text: "1234",
			bytesRead: 5,
			truncated: true,
		});
	});
});
