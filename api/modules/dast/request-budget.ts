export class DastRequestBudget {
	private usedRequests = 0;
	private usedResponseBytes = 0;

	constructor(
		readonly maxRequests: number,
		readonly maxResponseBytes: number,
	) {
		if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
			throw new Error("dast_request_budget_invalid");
		if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
			throw new Error("dast_response_budget_invalid");
	}

	tryReserveRequest(): boolean {
		if (this.usedRequests >= this.maxRequests) return false;
		this.usedRequests += 1;
		return true;
	}

	remainingResponseBytes(perResponseLimit: number): number {
		return Math.max(
			0,
			Math.min(
				perResponseLimit,
				this.maxResponseBytes - this.usedResponseBytes,
			),
		);
	}

	recordResponseBytes(bytes: number): void {
		if (!Number.isSafeInteger(bytes) || bytes < 0)
			throw new Error("dast_response_byte_count_invalid");
		this.usedResponseBytes += bytes;
	}

	get requestCount(): number {
		return this.usedRequests;
	}

	get responseBytes(): number {
		return this.usedResponseBytes;
	}

	get exhausted(): boolean {
		return (
			this.usedRequests >= this.maxRequests ||
			this.usedResponseBytes >= this.maxResponseBytes
		);
	}
}
