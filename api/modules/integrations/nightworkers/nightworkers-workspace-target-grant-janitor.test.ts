import { afterEach, describe, expect, it, vi } from "vitest";
import { NightworkersWorkspaceTargetGrantJanitor } from "./nightworkers-workspace-target-grant-janitor";

afterEach(() => {
	vi.useRealTimers();
});

describe("NightworkersWorkspaceTargetGrantJanitor", () => {
	it("cleans on startup and periodically until stopped", async () => {
		vi.useFakeTimers();
		const clearExpiredWorkspacePaths = vi.fn(async () => undefined);
		const janitor = new NightworkersWorkspaceTargetGrantJanitor(
			{ clearExpiredWorkspacePaths },
			{
				intervalMs: 1_000,
				now: () => new Date("2026-08-15T00:00:00.000Z"),
			},
		);

		await janitor.start();
		expect(clearExpiredWorkspacePaths).toHaveBeenCalledTimes(1);
		await advanceTimers(1_000);
		await advanceTimers(1_000);
		expect(clearExpiredWorkspacePaths).toHaveBeenCalledTimes(3);

		await janitor.stop();
		await advanceTimers(2_000);
		expect(clearExpiredWorkspacePaths).toHaveBeenCalledTimes(3);
	});

	it("redacts cleanup failures and retries on the next interval", async () => {
		vi.useFakeTimers();
		const clearExpiredWorkspacePaths = vi
			.fn()
			.mockRejectedValueOnce(new Error("/private/workspace/secret"))
			.mockResolvedValue(undefined);
		const logError = vi.fn(() => {
			throw new Error("logger unavailable");
		});
		const janitor = new NightworkersWorkspaceTargetGrantJanitor(
			{ clearExpiredWorkspacePaths },
			{ intervalMs: 1_000, logError },
		);

		await janitor.start();
		expect(JSON.stringify(logError.mock.calls)).not.toContain(
			"/private/workspace/secret",
		);
		await advanceTimers(1_000);
		expect(clearExpiredWorkspacePaths).toHaveBeenCalledTimes(2);
		await janitor.stop();
	});
});

async function advanceTimers(milliseconds: number): Promise<void> {
	vi.advanceTimersByTime(milliseconds);
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}
