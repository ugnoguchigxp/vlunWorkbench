import { describe, expect, it } from "bun:test";
import { finalizeTemporaryWorkspace } from "./temporary-workspace-cleanup";

const completedAt = new Date("2026-08-21T00:00:00.000Z");

describe("finalizeTemporaryWorkspace", () => {
	it("persists a completed cleanup receipt without changing the run status", async () => {
		const updates: Array<{ status: string; options: unknown }> = [];
		await expect(
			finalizeTemporaryWorkspace({
				remove: async () => undefined,
				loadRun: async () => ({ status: "completed", metadata: { prior: true } }),
				updateRun: async (status, options) => {
					updates.push({ status, options });
				},
				failureCode: "workspace_cleanup_failed",
				now: () => completedAt,
			}),
		).resolves.toEqual({
			status: "completed",
			completedAt: completedAt.toISOString(),
		});
		expect(updates).toEqual([
			{
				status: "completed",
				options: {
					metadata: {
						prior: true,
						cleanupReceipt: {
							status: "completed",
							completedAt: completedAt.toISOString(),
						},
					},
				},
			},
		]);
	});

	it("marks the run failed and rejects when removal fails", async () => {
		const updates: Array<{ status: string; options: unknown }> = [];
		await expect(
			finalizeTemporaryWorkspace({
				remove: async () => {
					throw new Error("busy");
				},
				loadRun: async () => ({ status: "completed", metadata: {} }),
				updateRun: async (status, options) => {
					updates.push({ status, options });
				},
				failureCode: "workspace_cleanup_failed",
				now: () => completedAt,
			}),
		).rejects.toThrow("workspace_cleanup_failed");
		expect(updates[0]).toMatchObject({
			status: "failed",
			options: {
				outcome: "error",
				errorMessage: "workspace_cleanup_failed",
				metadata: {
					cleanupReceipt: {
						status: "failed",
						failureCode: "workspace_cleanup_failed",
					},
				},
			},
		});
	});

	it("rejects when the cleanup receipt cannot be persisted", async () => {
		await expect(
			finalizeTemporaryWorkspace({
				remove: async () => undefined,
				loadRun: async () => ({ status: "completed", metadata: {} }),
				updateRun: async () => {
					throw new Error("database unavailable");
				},
				failureCode: "workspace_cleanup_failed",
			}),
		).rejects.toThrow("workspace_cleanup_failed_receipt_not_persisted");
	});
});
