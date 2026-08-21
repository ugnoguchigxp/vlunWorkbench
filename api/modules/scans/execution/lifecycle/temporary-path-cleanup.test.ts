import { describe, expect, it, mock } from "bun:test";
import { cleanupTemporaryPaths } from "./temporary-path-cleanup";

describe("cleanupTemporaryPaths", () => {
	it("attempts every unique path and fails closed", async () => {
		const remove = mock(async (target: string) => {
			if (target === "/tmp/first") throw new Error("busy");
		});

		await expect(
			cleanupTemporaryPaths(
				["/tmp/first", "/tmp/second", "/tmp/second"],
				"scanner_cleanup_failed",
				remove,
			),
		).rejects.toThrow("scanner_cleanup_failed");
		expect(remove).toHaveBeenCalledTimes(2);
	});
});
