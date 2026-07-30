import { describe, expect, test } from "bun:test";
import { buildApplicationModel } from "../threat-models/application-model-builder";
import { generateThreatHypotheses } from "../threat-models/threat-hypothesis-runner";
import { generateCatalogBusinessLogicScenario } from "./business-logic-scenario-generator";

const projectId = "00000000-0000-4000-8000-000000000001";
const engagementId = "00000000-0000-4000-8000-000000000002";
const targetConfigId = "00000000-0000-4000-8000-000000000003";
const authContextId = "00000000-0000-4000-8000-000000000004";

describe("catalog business logic scenario generator", () => {
	test("does not generate a state-changing scenario without explicit cleanup", async () => {
		const model = buildApplicationModel({
			projectId,
			sources: [
				{
					path: "routes.ts",
					content:
						'const app = new Hono(); app.post("/orders", createOrder); app.delete("/orders/:orderId", deleteOrder);',
				},
			],
		});
		const generated = await generateThreatHypotheses({ model });
		const hypothesis = generated.hypotheses.find((item) =>
			item.title.includes("POST /orders"),
		);
		const actor = model.actors[0];
		expect(hypothesis).toBeDefined();
		expect(actor).toBeDefined();
		expect(
			generateCatalogBusinessLogicScenario({
				model,
				hypothesis: hypothesis!,
				engagementId,
				targetConfigId,
				actorAuthContexts: [
					{ actorId: actor!.id, authContextId },
				],
			}),
		).toBeNull();
		const scenario = generateCatalogBusinessLogicScenario({
			model,
			hypothesis: hypothesis!,
			engagementId,
			targetConfigId,
			actorAuthContexts: [{ actorId: actor!.id, authContextId }],
			cleanupPath: "/orders/fixture-object",
			cleanupMethod: "DELETE",
		});
		expect(scenario?.cleanup[0]).toMatchObject({
			method: "DELETE",
			path: "/orders/fixture-object",
		});
	});
});
