import { afterEach, describe, expect, it, vi } from "vitest";
import { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import {
	parseCliJsonObject,
	runBoundedCliProcess,
} from "./cli-process-bridge";

function emptyStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.close();
		},
	});
}

afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
});

describe("runBoundedCliProcess", () => {
	it("returns 429 without spawning when shared capacity is occupied", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const occupied = capacity.tryAcquire();
		const spawn = vi.spyOn(Bun, "spawn");

		await expect(
			runBoundedCliProcess({
				argv: [process.execPath, "noop"],
				processCapacity: capacity,
				timeoutMs: 1_000,
				outputLimitBytes: 1_024,
				label: "Test CLI",
			}),
		).rejects.toMatchObject({ status: 429 });

		expect(spawn).not.toHaveBeenCalled();
		occupied?.();
	});

	it("terminates a CLI process when its deadline expires", async () => {
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		let resolveExit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const kill = vi.fn((signal: string) => {
			if (signal === "SIGTERM") resolveExit(143);
		});
		vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: emptyStream(),
			stderr: emptyStream(),
			exited,
			kill,
		} as never);

		await expect(
			runBoundedCliProcess({
				argv: [process.execPath, "noop"],
				processCapacity: capacity,
				timeoutMs: 10,
				outputLimitBytes: 1_024,
				label: "Test CLI",
			}),
		).rejects.toThrow("timed out");

		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(capacity.stats).toEqual({ active: 0, queued: 0 });
	});

	it("terminates a process when output monitoring fails", async () => {
		let resolveExit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const kill = vi.fn((signal: string) => {
			if (signal === "SIGTERM") resolveExit(143);
		});
		vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: new ReadableStream({
				start(controller) {
					controller.error(new Error("stream failed"));
				},
			}),
			stderr: emptyStream(),
			exited,
			kill,
		} as never);

		await expect(
			runBoundedCliProcess({
				argv: [process.execPath, "noop"],
				timeoutMs: 1_000,
				outputLimitBytes: 1_024,
				label: "Test CLI",
			}),
		).rejects.toThrow("process monitoring failed.");

		expect(kill).toHaveBeenCalledWith("SIGTERM");
	});
});

	describe("parseCliJsonObject", () => {
	it("rejects non-object output without reflecting child stderr", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const stderr = "secret child diagnostic";

		expect(() =>
			parseCliJsonObject(
				{ stdout: "null", stderr, exitCode: 1 },
				"Test CLI",
			),
		).toThrow("Test CLI returned an invalid response.");
		try {
			parseCliJsonObject(
				{ stdout: "not-json", stderr, exitCode: 1 },
				"Test CLI",
			);
		} catch (error) {
			expect((error as Error).message).not.toContain(stderr);
		}
		expect(JSON.stringify(log.mock.calls)).not.toContain(stderr);
	});
});
