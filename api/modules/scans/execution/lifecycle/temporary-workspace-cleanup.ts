export type TemporaryWorkspaceCleanupReceipt = {
	status: "completed" | "failed";
	completedAt: string;
	failureCode?: string;
};

type PersistedRun = {
	status: string;
	metadata: unknown;
};

type UpdateRunOptions = {
	outcome?: "error";
	errorMessage?: string;
	metadata: Record<string, unknown>;
};

export async function finalizeTemporaryWorkspace(params: {
	remove: () => Promise<void>;
	loadRun: () => Promise<PersistedRun | null>;
	updateRun: (status: string, options: UpdateRunOptions) => Promise<unknown>;
	failureCode: string;
	now?: () => Date;
}): Promise<TemporaryWorkspaceCleanupReceipt> {
	const completedAt = (params.now ?? (() => new Date()))().toISOString();
	let removalFailed = false;
	try {
		await params.remove();
	} catch {
		removalFailed = true;
	}

	let run: PersistedRun | null = null;
	try {
		run = await params.loadRun();
	} catch {
		throw new Error(`${params.failureCode}_receipt_not_persisted`);
	}
	if (!run) throw new Error(`${params.failureCode}_run_not_found`);

	const metadata = asMetadata(run.metadata);
	if (removalFailed) {
		const receipt: TemporaryWorkspaceCleanupReceipt = {
			status: "failed",
			completedAt,
			failureCode: params.failureCode,
		};
		try {
			await params.updateRun("failed", {
				outcome: "error",
				errorMessage: params.failureCode,
				metadata: { ...metadata, cleanupReceipt: receipt },
			});
		} catch {
			throw new Error(`${params.failureCode}_receipt_not_persisted`);
		}
		throw new Error(params.failureCode);
	}

	const receipt: TemporaryWorkspaceCleanupReceipt = {
		status: "completed",
		completedAt,
	};
	try {
		await params.updateRun(run.status, {
			metadata: { ...metadata, cleanupReceipt: receipt },
		});
	} catch {
		try {
			await params.updateRun("failed", {
				outcome: "error",
				errorMessage: `${params.failureCode}_receipt_not_persisted`,
				metadata: {
					...metadata,
					cleanupReceipt: {
						status: "failed",
						completedAt,
						failureCode: `${params.failureCode}_receipt_not_persisted`,
					},
				},
			});
		} catch {
			// The caller still receives a failure and must fail the parent scan.
		}
		throw new Error(`${params.failureCode}_receipt_not_persisted`);
	}
	return receipt;
}

function asMetadata(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
