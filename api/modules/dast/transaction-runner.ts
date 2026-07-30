import type {
	ActiveRequest,
	ActiveTransaction,
} from "../../../shared/schemas/active-assessment.schema";

export type ActiveRequestExecutor = (
	request: ActiveRequest,
	context: { stage: "seed" | "request" | "cleanup"; index: number },
) => Promise<{ status: number; evidenceRef: string }>;

export type ActiveTransactionResult = {
	status: "completed" | "inconclusive" | "failed_cleanup";
	seedEvidenceRefs: string[];
	requestEvidenceRef: string | null;
	cleanupEvidenceRefs: string[];
	errors: string[];
};

export async function runActiveTransaction(params: {
	transaction: ActiveTransaction;
	execute: ActiveRequestExecutor;
}): Promise<ActiveTransactionResult> {
	let requestCount = 0;
	const seedEvidenceRefs: string[] = [];
	const cleanupEvidenceRefs: string[] = [];
	const errors: string[] = [];
	let requestEvidenceRef: string | null = null;
	let operationFailed = false;
	let cleanupFailed = false;

	const runStep = async (
		request: ActiveRequest,
		stage: "seed" | "request" | "cleanup",
		index: number,
	) => {
		requestCount++;
		if (requestCount > params.transaction.maxRequests) {
			throw new Error("active_transaction_request_budget_exhausted");
		}
		const result = await params.execute(request, { stage, index });
		if (!request.expectedStatus.includes(result.status)) {
			throw new Error(
				`unexpected_status:${request.method}:${request.path}:${result.status}`,
			);
		}
		return result.evidenceRef;
	};

	try {
		for (const [index, request] of params.transaction.seed.entries()) {
			seedEvidenceRefs.push(await runStep(request, "seed", index));
		}
		requestEvidenceRef = await runStep(
			params.transaction.request,
			"request",
			0,
		);
	} catch (error) {
		operationFailed = true;
		errors.push(error instanceof Error ? error.message : "transaction_failed");
	} finally {
		for (const [index, request] of params.transaction.cleanup.entries()) {
			try {
				cleanupEvidenceRefs.push(await runStep(request, "cleanup", index));
			} catch (error) {
				cleanupFailed = true;
				errors.push(error instanceof Error ? error.message : "cleanup_failed");
			}
		}
	}
	return {
		status: cleanupFailed
			? "failed_cleanup"
			: operationFailed
				? "inconclusive"
				: "completed",
		seedEvidenceRefs,
		requestEvidenceRef,
		cleanupEvidenceRefs,
		errors,
	};
}
