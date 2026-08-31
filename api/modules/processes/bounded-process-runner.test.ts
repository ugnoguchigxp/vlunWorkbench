import { afterEach, describe, expect, it, vi } from "vitest";
import { recordScannerE2EFailureObservation } from "../../testing/scanner-e2e-failure-observation";
import { runBoundedProcess } from "./bounded-process-runner";

function emptyStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.close();
		},
	});
}

describe("runBoundedProcess", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("terminates and truncates a child that exceeds its output limit", async () => {
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
					controller.enqueue(new TextEncoder().encode("12345"));
				},
			}),
			stderr: emptyStream(),
			exited,
			kill,
		} as never);

		const result = await runBoundedProcess({
			argv: [process.execPath, "noop"],
			timeoutMs: 1_000,
			outputLimitBytes: 4,
		});

		expect(result).toMatchObject({
			exitCode: null,
			stdout: "1234",
			terminationReason: "stdout_limit",
		});
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		recordScannerE2EFailureObservation("FI-05", {
			profileOutcome: "failed",
			reasonCodes: [result.terminationReason ?? "unknown"],
			scannerProcessCount: 1,
			toolRunCount: 1,
		});
	});

	it("rejects invalid bounds before spawning", async () => {
		const spawn = vi.spyOn(Bun, "spawn");

		await expect(
			runBoundedProcess({
				argv: [process.execPath, "noop"],
				timeoutMs: Number.NaN,
				outputLimitBytes: 1_024,
			}),
		).rejects.toThrow("positive safe integer");
		expect(spawn).not.toHaveBeenCalled();
	});

	it("does not spawn when the caller is already aborted", async () => {
		const spawn = vi.spyOn(Bun, "spawn");
		const controller = new AbortController();
		controller.abort();

		await expect(
			runBoundedProcess({
				argv: [process.execPath, "noop"],
				timeoutMs: 1_000,
				outputLimitBytes: 1_024,
				signal: controller.signal,
			}),
		).resolves.toMatchObject({ terminationReason: "aborted" });
		expect(spawn).not.toHaveBeenCalled();
	});

	it("returns after the hard-stop deadline when the exit promise never settles", async () => {
		vi.useFakeTimers();
		const kill = vi.fn();
		vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: emptyStream(),
			stderr: emptyStream(),
			exited: new Promise<number>(() => {}),
			kill,
		} as never);
		const pending = runBoundedProcess({
			argv: [process.execPath, "noop"],
			timeoutMs: 10,
			outputLimitBytes: 1_024,
		});

		vi.advanceTimersByTime(3_010);
		for (let index = 0; index < 5; index += 1) await Promise.resolve();

		await expect(pending).resolves.toMatchObject({
			exitCode: null,
			terminationReason: "timeout",
		});
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(kill).toHaveBeenCalledWith("SIGKILL");
	});
});
