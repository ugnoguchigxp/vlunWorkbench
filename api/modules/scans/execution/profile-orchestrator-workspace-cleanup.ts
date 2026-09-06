import type { ScanRepository } from "../repositories";

export async function cleanupExecutionWorkspaces(params: {
	scanRepo: {
		createScanEvent: (
			input: Parameters<ScanRepository["createScanEvent"]>[0],
		) => Promise<unknown>;
		mergeScanRunMetadata: (
			scanRunId: string,
			metadata: Record<string, unknown>,
		) => Promise<unknown>;
	};
	scanRunId: string;
	workspaces: Array<{ kind: string; cleanup: () => Promise<void> }>;
}): Promise<void> {
	if (params.workspaces.length === 0) return;
	const receipts: Array<{
		kind: string;
		status: "completed" | "failed";
		completedAt: string;
		failureCode?: string;
	}> = [];
	const failureCodes: string[] = [];
	for (const workspace of params.workspaces) {
		const completedAt = new Date().toISOString();
		try {
			await workspace.cleanup();
			receipts.push({
				kind: workspace.kind,
				status: "completed",
				completedAt,
			});
		} catch {
			const failureCode = `${workspace.kind}_cleanup_failed`;
			failureCodes.push(failureCode);
			receipts.push({
				kind: workspace.kind,
				status: "failed",
				completedAt,
				failureCode,
			});
			try {
				await params.scanRepo.createScanEvent({
					scanRunId: params.scanRunId,
					level: "error",
					eventType: `${workspace.kind}.cleanup_failed`,
					message: `Temporary ${workspace.kind} cleanup failed.`,
				});
			} catch {
				// Continue cleanup; the persisted receipt remains the source of truth.
			}
		}
	}
	try {
		await params.scanRepo.mergeScanRunMetadata(params.scanRunId, {
			workspaceCleanupReceipts: receipts,
		});
	} catch {
		throw new Error("workspace_cleanup_receipt_not_persisted");
	}
	if (failureCodes.length > 0) {
		throw new Error(failureCodes.sort().join(","));
	}
}
