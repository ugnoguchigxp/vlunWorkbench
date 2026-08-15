import { describe, expect, test } from "bun:test";
import { detectSecurityProbe } from "../../api/modules/dast/security-probe-detector";
import { executeJuiceShopFixedControl } from "../../tests/security-capability/juice-shop/fixed-app";
import {
	JUICE_SHOP_PLAYBOOKS,
	loadAndValidateJuiceShopInputs,
	pathMatchesAllowedPrefix,
	validateJuiceShopCatalogAgainstUpstream,
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

	test("matches path prefixes on route boundaries", () => {
		expect(pathMatchesAllowedPrefix("/api/Users", "/api/Users")).toBe(true);
		expect(pathMatchesAllowedPrefix("/api/Users/1", "/api/Users")).toBe(true);
		expect(pathMatchesAllowedPrefix("/api/UsersEvil", "/api/Users")).toBe(
			false,
		);
	});

	test("binds catalog keys and names to the pinned upstream challenge data", async () => {
		const { catalog } = await loadAndValidateJuiceShopInputs();
		const yaml = catalog.scenarios
			.map(
				(scenario) =>
					`- key: ${scenario.challengeKey}\n  name: ${JSON.stringify(scenario.challengeName)}`,
			)
			.join("\n");
		expect(() =>
			validateJuiceShopCatalogAgainstUpstream(catalog, yaml),
		).not.toThrow();
		expect(() =>
			validateJuiceShopCatalogAgainstUpstream(
				catalog,
				yaml.replace("name: \"Admin Section\"", "name: \"Wrong name\""),
			),
		).toThrow("juice_shop_upstream_challenge_mismatch:juice-admin-section");
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
			expect(playbook.methods).toContain(execution.request.method as never);
			expect(
				playbook.allowedPathPrefixes.some((prefix) =>
					pathMatchesAllowedPrefix(execution.request.path, prefix),
				),
			).toBe(true);
			expect(
				detectSecurityProbe(execution.probe, {
					scenarioId: playbook.scenarioId,
					targetKind: "fixed",
				}),
			).toEqual([]);
		}
	});
});
