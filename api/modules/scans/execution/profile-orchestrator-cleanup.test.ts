import { describe, expect, it } from "bun:test";
import { cleanupExecutionWorkspaces } from "./profile-orchestrator";

describe("cleanupExecutionWorkspaces", () => {
	it("attempts every cleanup and rejects after persisting a failed receipt", async () => {
		const attempted: string[] = [];
		const events: Array<Record<string, unknown>> = [];
		let metadata: Record<string, unknown> = {};
		const scanRepo = {
			createScanEvent: async (event: Record<string, unknown>) => {
				events.push(event);
				return event;
			},
			mergeScanRunMetadata: async (
				_scanRunId: string,
				update: Record<string, unknown>,
			) => {
				metadata = update;
				return null;
			},
		};

		await expect(
			cleanupExecutionWorkspaces({
				scanRepo,
				scanRunId: "scan-id",
				workspaces: [
					{
						kind: "first",
						cleanup: async () => {
							attempted.push("first");
							throw new Error("busy");
						},
					},
					{
						kind: "second",
						cleanup: async () => {
							attempted.push("second");
						},
					},
				],
			}),
		).rejects.toThrow("first_cleanup_failed");
		expect(attempted).toEqual(["first", "second"]);
		expect(events).toHaveLength(1);
		expect(metadata.workspaceCleanupReceipts).toEqual([
			expect.objectContaining({
				kind: "first",
				status: "failed",
				failureCode: "first_cleanup_failed",
			}),
			expect.objectContaining({ kind: "second", status: "completed" }),
		]);
	});

	it("continues cleanup when the failure event cannot be persisted", async () => {
		const attempted: string[] = [];
		let metadata: Record<string, unknown> = {};
		await expect(
			cleanupExecutionWorkspaces({
				scanRepo: {
					createScanEvent: async () => {
						throw new Error("database unavailable");
					},
					mergeScanRunMetadata: async (_scanRunId, update) => {
						metadata = update;
						return null;
					},
				},
				scanRunId: "scan-id",
				workspaces: [
					{
						kind: "first",
						cleanup: async () => {
							attempted.push("first");
							throw new Error("busy");
						},
					},
					{
						kind: "second",
						cleanup: async () => {
							attempted.push("second");
						},
					},
				],
			}),
		).rejects.toThrow("first_cleanup_failed");
		expect(attempted).toEqual(["first", "second"]);
		expect(metadata.workspaceCleanupReceipts).toHaveLength(2);
	});
});
