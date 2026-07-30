import { describe, expect, test } from "bun:test";
import { buildApplicationModel } from "./application-model-builder";
import { generateThreatHypotheses } from "./threat-hypothesis-runner";
import { validateThreatHypothesisOutput } from "./threat-output-validator";

const model = buildApplicationModel({
	projectId: "00000000-0000-4000-8000-000000000001",
	sources: [
		{
			path: "routes.ts",
			content: `import { Hono } from "hono"; app.get("/items/:id", handler);`,
		},
	],
});

describe("threat hypothesis pipeline", () => {
	test("completes deterministically when the LLM is unavailable", async () => {
		const result = await generateThreatHypotheses({ model });
		expect(result.status).toBe("completed_with_limitations");
		expect(result.llmAvailable).toBe(false);
		expect(result.hypotheses).toHaveLength(1);
		expect(result.hypotheses[0]).toMatchObject({
			status: "hypothesis",
			criticality: "unknown",
		});
	});

	test("rejects arbitrary model IDs and external evidence references", () => {
		const valid = {
			id: "threat:test",
			modelSnapshotHash: model.snapshotHash,
			title: "Test authorization",
			category: "information_disclosure",
			actorIds: [model.actors[0].id],
			assetIds: [],
			entrypointIds: [model.entrypoints[0].id],
			preconditions: ["In scope"],
			expectedImpact: "Protected data disclosure",
			evidenceRefs: model.entrypoints[0].evidenceRefs,
			confidence: "medium",
			criticality: "unknown",
			validationKind: "authorization_matrix",
			status: "hypothesis",
		};
		expect(validateThreatHypothesisOutput(valid, model)).toBeDefined();
		expect(() =>
			validateThreatHypothesisOutput(
				{ ...valid, entrypointIds: ["entrypoint:invented"] },
				model,
			),
		).toThrow("external_entrypoint");
		expect(() =>
			validateThreatHypothesisOutput(
				{
					...valid,
					evidenceRefs: [
						{ kind: "runtime_route", ref: "https://outside.invalid" },
					],
				},
				model,
			),
		).toThrow("external_evidence");
	});
});
