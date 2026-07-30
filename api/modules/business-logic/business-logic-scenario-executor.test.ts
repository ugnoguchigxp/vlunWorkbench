import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	businessLogicScenarioSchema,
	type ScenarioAssertion,
} from "../../../shared/schemas/business-logic.schema";
import { executeBusinessLogicScenario } from "./business-logic-scenario-executor";

type Fixture = {
	id: string;
	controlId: string;
	category: string;
	invariant: ScenarioAssertion;
};
const fixtureCatalog = JSON.parse(
	await readFile(
		"tests/security-capability/business-logic/paired-fixtures.json",
		"utf8",
	),
) as { fixtures: Fixture[] };
const baselineHash = `sha256:${"a".repeat(64)}`;

describe("business logic scenario executor", () => {
	test("distinguishes all eight vulnerable/fixed paired fixtures", async () => {
		const outcomes = [];
		for (const fixture of fixtureCatalog.fixtures) {
			for (const mode of ["vulnerable", "fixed"] as const) {
				const scenario = businessLogicScenarioSchema.parse({
					id: `scenario:${fixture.id}`,
					hypothesisId: `threat:${fixture.id}`,
					controlId: fixture.controlId,
					engagementId: "00000000-0000-4000-8000-000000000001",
					targetConfigId: "00000000-0000-4000-8000-000000000002",
					actors: [
						{
							actorId: "actor:user",
							authContextId: "00000000-0000-4000-8000-000000000003",
						},
					],
					preconditions: [],
					seed: [],
					actions: [
						{
							actorId: "actor:user",
							method: "POST",
							path: `/fixtures/${fixture.id}`,
							headers: {},
							body: {},
							expectedStatus: [200, 403],
						},
					],
					invariants: [fixture.invariant],
					cleanup: [
						{
							actorId: "actor:user",
							method: "DELETE",
							path: `/fixtures/${fixture.id}`,
							headers: {},
							body: null,
							expectedStatus: [204],
						},
					],
					maxRequests: 2,
					timeoutSec: 30,
					expectedBaselineHash: baselineHash,
				});
				const result = await executeBusinessLogicScenario({
					scenario,
					execute: async (_request, context) => ({
						status:
							context.stage === "cleanup"
								? 204
								: mode === "vulnerable"
									? 200
									: 403,
						evidenceRef: `${fixture.id}:${mode}:${context.stage}`,
					}),
					observe: async (assertion, phase) =>
						phase === "baseline" ||
						assertion.kind === "fixture_hash" ||
						mode === "fixed",
				});
				outcomes.push({ fixture: fixture.id, mode, status: result.status });
			}
		}
		expect(outcomes).toHaveLength(16);
		expect(
			outcomes.filter(
				(outcome) =>
					outcome.mode === "vulnerable" && outcome.status === "observed",
			),
		).toHaveLength(8);
		expect(
			outcomes.filter(
				(outcome) =>
					outcome.mode === "fixed" && outcome.status === "not_observed",
			),
		).toHaveLength(8);
	});

	test("never treats cleanup failure as a passing or observed result", async () => {
		const fixture = fixtureCatalog.fixtures[0];
		const scenario = businessLogicScenarioSchema.parse({
			id: "scenario:cleanup",
			hypothesisId: "threat:cleanup",
			controlId: fixture.controlId,
			engagementId: "00000000-0000-4000-8000-000000000001",
			targetConfigId: "00000000-0000-4000-8000-000000000002",
			actors: [
				{
					actorId: "actor:user",
					authContextId: "00000000-0000-4000-8000-000000000003",
				},
			],
			preconditions: [],
			seed: [],
			actions: [
				{
					actorId: "actor:user",
					method: "POST",
					path: "/fixtures/cleanup",
					headers: {},
					body: {},
					expectedStatus: [200],
				},
			],
			invariants: [fixture.invariant],
			cleanup: [
				{
					actorId: "actor:user",
					method: "DELETE",
					path: "/fixtures/cleanup",
					headers: {},
					body: null,
					expectedStatus: [204],
				},
			],
			maxRequests: 2,
			timeoutSec: 30,
			expectedBaselineHash: baselineHash,
		});
		const result = await executeBusinessLogicScenario({
			scenario,
			execute: async (_request, context) => ({
				status: context.stage === "cleanup" ? 500 : 200,
				evidenceRef: context.stage,
			}),
			observe: async () => false,
		});
		expect(result.status).toBe("failed_cleanup");
		expect(result.cleanupSucceeded).toBe(false);
	});
});
