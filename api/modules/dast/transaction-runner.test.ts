import { describe, expect, it } from "bun:test";
import type { ActiveTransaction } from "../../../shared/schemas/active-assessment.schema";
import { runActiveTransaction } from "./transaction-runner";

const transaction: ActiveTransaction = {
	id: "bounded-write",
	seed: [
		{
			method: "POST",
			path: "/fixtures",
			headers: {},
			body: null,
			expectedStatus: [201],
		},
	],
	request: {
		method: "PATCH",
		path: "/fixtures/a",
		headers: {},
		body: null,
		expectedStatus: [200],
	},
	cleanup: [
		{
			method: "DELETE",
			path: "/fixtures/a",
			headers: {},
			body: null,
			expectedStatus: [204],
		},
	],
	maxRequests: 3,
};

describe("runActiveTransaction", () => {
	it("always runs cleanup after an operation failure", async () => {
		const calls: string[] = [];
		const result = await runActiveTransaction({
			transaction,
			execute: async (request) => {
				calls.push(request.method);
				return {
					status: request.method === "PATCH" ? 500 : request.expectedStatus[0],
					evidenceRef: `evidence-${request.method}`,
				};
			},
		});
		expect(calls).toEqual(["POST", "PATCH", "DELETE"]);
		expect(result.status).toBe("inconclusive");
	});

	it("marks cleanup failure explicitly", async () => {
		const result = await runActiveTransaction({
			transaction,
			execute: async (request) => ({
				status: request.method === "DELETE" ? 500 : request.expectedStatus[0],
				evidenceRef: `evidence-${request.method}`,
			}),
		});
		expect(result.status).toBe("failed_cleanup");
	});

	it("attempts every cleanup step after an earlier cleanup failure", async () => {
		const cleanupCalls: string[] = [];
		const result = await runActiveTransaction({
			transaction: {
				...transaction,
				cleanup: [
					...transaction.cleanup,
					{
						method: "DELETE",
						path: "/fixtures/b",
						headers: {},
						body: null,
						expectedStatus: [204],
					},
				],
				maxRequests: 4,
			},
			execute: async (request, context) => {
				if (context.stage === "cleanup") cleanupCalls.push(request.path);
				return {
					status:
						context.stage === "cleanup" && context.index === 0
							? 500
							: request.expectedStatus[0],
					evidenceRef: `evidence-${context.stage}-${context.index}`,
				};
			},
		});
		expect(result.status).toBe("failed_cleanup");
		expect(cleanupCalls).toEqual(["/fixtures/a", "/fixtures/b"]);
		expect(result.cleanupEvidenceRefs).toEqual(["evidence-cleanup-1"]);
	});
});
