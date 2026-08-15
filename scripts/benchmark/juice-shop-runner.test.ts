import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ActiveResetExecutor } from "../../api/modules/runtime-scans/zap-active-runner";
import { responseShapeHash } from "./juice-shop-evidence";
import { loadAndValidateJuiceShopInputs } from "./juice-shop-playbooks";
import { runJuiceShopScenarios } from "./juice-shop-runner";

const baseline = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
	await rm(".artifacts/benchmark/juice-shop.lock", { force: true });
});

describe("Juice Shop scenario runner", () => {
	test("binds vulnerable and fixed executions to separate evidence", async () => {
		const { catalog, playbooks } = await loadAndValidateJuiceShopInputs();
		const evidenceRoot = await mkdtemp(
			path.join(os.tmpdir(), "juice-runner-evidence-"),
		);
		roots.push(evidenceRoot);
		const result = await runJuiceShopScenarios({
			catalog,
			playbooks: playbooks.slice(0, 1),
			evidenceRoot,
			resetExecutor: successfulReset(),
			executeProbe: async (playbook) => {
				const probe = {
					kind: "authorization" as const,
					cwe: "CWE-284",
					status: 200,
					expectedDenied: true,
					actorRole: "customer",
					ownerRole: "admin",
					protectedObjectPresent: true,
				};
				return {
					status: "completed",
					probe,
					findings: [
						{
							id: `finding:${playbook.scenarioId}`,
							ruleId: "AUTHORIZATION_BYPASS",
							cwe: "CWE-284",
							title: "bypass",
						},
					],
					requests: [
						{
							method: "GET",
							path: "/administration",
							queryKeys: [],
							status: 200,
							responseBytes: 10,
							responseShapeHash: responseShapeHash({ data: [] }),
						},
					],
				};
			},
		});
		expect(result.preflight.status).toBe("passed");
		expect(result.observations).toHaveLength(1);
		const observation = result.observations[0];
		expect(observation.scenarioStatus).toBe("completed");
		expect(observation.vulnerable.detection).toBe("detected");
		expect(observation.fixed.detection).toBe("not_detected");
		expect(observation.vulnerable.evidenceHash).not.toBe(
			observation.fixed.evidenceHash,
		);
	});

	test("turns a missing runtime dependency into typed blocked observations", async () => {
		const { catalog, playbooks } = await loadAndValidateJuiceShopInputs();
		const evidenceRoot = await mkdtemp(
			path.join(os.tmpdir(), "juice-runner-blocked-"),
		);
		roots.push(evidenceRoot);
		const reset: ActiveResetExecutor = {
			prepare: async () => {
				throw new Error("docker_image_missing");
			},
			reset: async () => ({ ok: false, baselineHash: null }),
		};
		const result = await runJuiceShopScenarios({
			catalog,
			playbooks: playbooks.slice(0, 2),
			evidenceRoot,
			resetExecutor: reset,
		});
		expect(result.preflight.status).toBe("blocked");
		expect(result.observations).toHaveLength(2);
		expect(
			result.observations.every(
				(observation) =>
					observation.scenarioStatus === "blocked" &&
					observation.vulnerable.detection === "not_scored",
			),
		).toBe(true);
	});
});

function successfulReset(): ActiveResetExecutor {
	return {
		prepare: async () => ({ baselineHash: baseline }),
		reset: async () => ({ ok: true, baselineHash: baseline }),
	};
}
