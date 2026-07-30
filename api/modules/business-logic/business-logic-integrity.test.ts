import { describe, expect, test } from "bun:test";
import type { ScenarioRequest } from "../../../shared/schemas/business-logic.schema";
import { businessLogicPlanHash } from "../../routes/business-logic.route";
import { requestEvidenceHash } from "./business-logic-runner";

const scenario = {
	id: "scenario-1",
	hypothesisId: "hypothesis-1",
	controlId: "workflow-ordering",
	engagementId: "00000000-0000-4000-8000-000000000001",
	targetConfigId: "00000000-0000-4000-8000-000000000002",
	actors: [
		{
			actorId: "user",
			authContextId: "00000000-0000-4000-8000-000000000003",
		},
	],
	preconditions: [],
	seed: [],
	actions: [
		{
			actorId: "user",
			method: "POST" as const,
			path: "/orders",
			headers: {},
			body: null,
			expectedStatus: [200],
		},
	],
	invariants: [
		{ kind: "status_class" as const, requestIndex: 0, expectedClass: 2 },
	],
	cleanup: [
		{
			actorId: "user",
			method: "DELETE" as const,
			path: "/orders/fixture",
			headers: {},
			body: null,
			expectedStatus: [204],
		},
	],
	maxRequests: 2,
	timeoutSec: 10,
	expectedBaselineHash: null,
};

describe("business logic integrity hashes", () => {
	test("scopes plan hashes to the owning project and hypothesis", () => {
		const common = {
			ownerUserId: "00000000-0000-4000-8000-000000000004",
			hypothesisRecordId: "00000000-0000-4000-8000-000000000005",
			scenario,
		};
		expect(
			businessLogicPlanHash({
				...common,
				projectId: "00000000-0000-4000-8000-000000000006",
			}),
		).not.toBe(
			businessLogicPlanHash({
				...common,
				projectId: "00000000-0000-4000-8000-000000000007",
			}),
		);
	});

	test("binds evidence hashes to header values without exposing them", () => {
		const request = {
			actorId: "user",
			method: "POST",
			path: "/orders",
			headers: { "x-workflow-state": "first-secret-value" },
			body: null,
			expectedStatus: [200],
		} satisfies ScenarioRequest;
		const first = requestEvidenceHash(request);
		const second = requestEvidenceHash({
			...request,
			headers: { "x-workflow-state": "second-secret-value" },
		});
		expect(first).not.toBe(second);
		expect(first).not.toContain("first-secret-value");
	});
});
