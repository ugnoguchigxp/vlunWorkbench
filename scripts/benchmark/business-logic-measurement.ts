import { readFile } from "node:fs/promises";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";
import { executeBusinessLogicScenario } from "../../api/modules/business-logic/business-logic-scenario-executor";
import {
	businessLogicScenarioSchema,
	type ScenarioAssertion,
} from "../../shared/schemas/business-logic.schema";
import { startBusinessLogicFixture } from "../../tests/security-capability/business-logic/stateful-app";
import { sha256, sha256Tree } from "./benchmark-input-provenance";

const fixturePath =
	"tests/security-capability/business-logic/paired-fixtures.json";
type Fixture = {
	id: string;
	category: string;
	controlId: string;
	invariant: ScenarioAssertion;
};

export async function measureBusinessLogicPairs(
	executeScenario = executeBusinessLogicScenario,
) {
	const bytes = await readFile(fixturePath);
	const { fixtures } = JSON.parse(bytes.toString()) as { fixtures: Fixture[] };
	if (
		fixtures.length < 8 ||
		new Set(fixtures.map((f) => f.id)).size !== fixtures.length
	)
		throw new Error("business_logic_fixture_coverage_invalid");
	const observations = [];
	const groundTruth = [];
	const executions = [];
	for (const fixture of fixtures) {
		for (const mode of ["vulnerable", "fixed"] as const) {
			const testId = mode === "fixed" ? `${fixture.id}:fixed` : fixture.id;
			groundTruth.push({
				testId,
				category: fixture.category,
				cwe: "CWE-841",
				vulnerable: mode === "vulnerable",
			});
			const app = startBusinessLogicFixture(
				fixture.controlId,
				mode === "fixed",
			);
			const baselineHash = sha256(JSON.stringify(app.baseline));
			const requests: Array<{
				stage: string;
				status: number;
				responseHash: string;
			}> = [];
			const action = {
				actorId: "actor:user",
				method: "POST",
				path: "/action",
				headers: {},
				body: {
					actor: "other",
					role: "user",
					previousState: "created",
					quantity: -1,
					total: 1,
					nonce: "owned-once",
				},
				expectedStatus: [200, 403],
			};
			const repeated = [
				"duplicate-submission",
				"one-time-token-reuse",
				"rate-quota-bypass",
			].includes(fixture.controlId);
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
				actions: repeated ? [action, action] : [action],
				invariants: [fixture.invariant],
				cleanup: [
					{
						...action,
						method: "DELETE",
						path: "/reset",
						body: null,
						expectedStatus: [204],
					},
				],
				maxRequests: 3,
				timeoutSec: 30,
				expectedBaselineHash: baselineHash,
			});
			try {
				const result = await executeScenario({
					scenario,
					execute: async (request, context) => {
						const response = await fetch(`${app.origin}${request.path}`, {
							method: request.method,
							headers: { "Content-Type": "application/json" },
							body:
								request.body === null
									? undefined
									: JSON.stringify(request.body),
							signal: AbortSignal.timeout(5000),
							redirect: "error",
						});
						const responseHash = sha256(await response.text());
						requests.push({
							stage: context.stage,
							status: response.status,
							responseHash,
						});
						return { status: response.status, evidenceRef: responseHash };
					},
					observe: async (assertion) => {
						const state = app.snapshot();
						if (assertion.kind === "fixture_hash")
							return sha256(JSON.stringify(state)) === assertion.expectedHash;
						if (assertion.kind === "duplicate_side_effect_count")
							return state.effects <= assertion.max;
						if (assertion.kind === "numeric_delta") {
							const delta = state.total - app.baseline.total;
							return delta >= assertion.min && delta <= assertion.max;
						}
						if (assertion.kind === "count_delta")
							return (
								state.quota >= assertion.min && state.quota <= assertion.max
							);
						throw new Error(
							`business_fixture_unsupported_assertion:${assertion.kind}`,
						);
					},
				});
				if (result.status === "observed")
					observations.push({
						testId,
						category: fixture.category,
						cwe: "CWE-841",
					});
				executions.push({
					testId,
					mode,
					...result,
					requests,
					restoredBaselineHash: sha256(JSON.stringify(app.snapshot())),
				});
			} finally {
				await app.stop();
			}
		}
	}
	const completed = executions.every(
		(e) =>
			["observed", "not_observed"].includes(e.status) &&
			e.cleanupSucceeded &&
			e.requestCount === e.requests.length &&
			e.requests.length >= 2,
	);
	return {
		schemaVersion: 2,
		corpusId: "owned-business-logic-pairs-v1",
		generatedAt: new Date().toISOString(),
		measurementKind: "owned_stateful_http_pairs",
		measurementStatus: completed ? "completed" : "incomplete",
		pairCount: fixtures.length,
		fixtureHash: sha256(bytes),
		implementationHash: await sha256Tree([
			"scripts/benchmark/business-logic-measurement.ts",
			"tests/security-capability/business-logic/stateful-app.ts",
			"api/modules/business-logic/business-logic-scenario-executor.ts",
		]),
		executions,
		...scoreBenchmark(groundTruth, observations),
	};
}
