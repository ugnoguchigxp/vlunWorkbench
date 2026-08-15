import { describe, expect, test } from "bun:test";
import { detectSecurityProbe } from "../../api/modules/dast/security-probe-detector";
import { executeJuiceShopFixedControl } from "../../tests/security-capability/juice-shop/fixed-app";
import {
	JUICE_SHOP_PLAYBOOKS,
	loadAndValidateJuiceShopInputs,
} from "./juice-shop-playbooks";

describe("Juice Shop playbooks and fixed controls", () => {
	test("maps all 20 catalog scenarios to a typed executable control", async () => {
		const { catalog, playbooks } = await loadAndValidateJuiceShopInputs();
		expect(catalog.scenarios).toHaveLength(20);
		expect(playbooks).toHaveLength(20);
		expect(new Set(catalog.scenarios.map((scenario) => scenario.category)).size).toBe(
			9,
		);
		expect(new Set(playbooks.map((playbook) => playbook.controlId)).size).toBe(
			20,
		);
	});

	test("runs every fixed control through the production detector path", async () => {
		const { catalog } = await loadAndValidateJuiceShopInputs();
		const scenarioById = new Map(
			catalog.scenarios.map((scenario) => [scenario.id, scenario]),
		);
		for (const playbook of JUICE_SHOP_PLAYBOOKS) {
			const scenario = scenarioById.get(playbook.scenarioId);
			expect(scenario).toBeDefined();
			const execution = executeJuiceShopFixedControl({
				playbook,
				cwe: scenario?.cwe[0] ?? "CWE-20",
			});
			expect(execution.status).toBe("completed");
			expect(
				detectSecurityProbe(execution.probe, {
					scenarioId: playbook.scenarioId,
					targetKind: "fixed",
				}),
			).toEqual([]);
		}
	});
});
