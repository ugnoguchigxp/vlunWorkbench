import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

	test("preserves opaque CAPTCHA answers across identity, replay, and boundary probes", async () => {
		const { catalog, playbooks } = await loadAndValidateJuiceShopInputs();
		const evidenceRoot = await mkdtemp(
			path.join(os.tmpdir(), "juice-runner-captcha-"),
		);
		roots.push(evidenceRoot);
		const selected = playbooks.filter((playbook) =>
			["forged_feedback", "captcha_replay", "zero_stars"].includes(
				playbook.probeVariant,
			),
		);
		const token = `header.${Buffer.from(
			JSON.stringify({ data: { id: 2, email: "actor@example.test" } }),
		).toString("base64url")}.signature`;
		const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(
				input instanceof Request ? input.url : input.toString(),
			);
			if (url.pathname === "/rest/user/login") {
				return Response.json({ authentication: { token, bid: 1 } });
			}
			if (url.pathname === "/rest/captcha/") {
				return Response.json({ captchaId: 7, answer: "-4" });
			}
			if (url.pathname === "/api/Feedbacks") {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				if (body.captcha !== "-4") {
					return new Response("Wrong CAPTCHA", { status: 401 });
				}
				return Response.json(
					{
						data: {
							UserId: body.UserId ?? null,
							rating: body.rating,
						},
					},
					{ status: 201 },
				);
			}
			return new Response("Not found", { status: 404 });
		};
		const result = await runJuiceShopScenarios({
			catalog,
			playbooks: selected,
			evidenceRoot,
			resetExecutor: successfulReset(),
			fetchImpl,
		});
		expect(result.preflight.status).toBe("passed");
		expect(result.observations).toHaveLength(3);
		expect(
			result.observations.every(
				(observation) =>
					observation.scenarioStatus === "completed" &&
					observation.vulnerable.detection === "detected" &&
					observation.fixed.detection === "not_detected",
			),
		).toBe(true);
	});

	test("keeps a live shared-fixture lock and recovers an abandoned one", async () => {
		const { catalog, playbooks } = await loadAndValidateJuiceShopInputs();
		const evidenceRoot = await mkdtemp(
			path.join(os.tmpdir(), "juice-runner-lock-"),
		);
		roots.push(evidenceRoot);
		const lockPath = ".artifacts/benchmark/juice-shop.lock";
		await mkdir(path.dirname(lockPath), { recursive: true });
		await writeFile(
			lockPath,
			`${JSON.stringify({ pid: process.pid, token: "live" })}\n`,
		);
		const blocked = await runJuiceShopScenarios({
			catalog,
			playbooks: playbooks.slice(0, 1),
			evidenceRoot,
			resetExecutor: successfulReset(),
		});
		expect(blocked.preflight.errorCode).toBe("shared_fixture_busy");
		expect(await stat(lockPath).then(() => true)).toBe(true);

		await writeFile(
			lockPath,
			`${JSON.stringify({ pid: 2_147_483_647, token: "abandoned" })}\n`,
		);
		const recovered = await runJuiceShopScenarios({
			catalog,
			playbooks: playbooks.slice(0, 1),
			evidenceRoot,
			resetExecutor: successfulReset(),
			executeProbe: async () => ({
				status: "completed",
				probe: {
					kind: "observation_only",
					cwe: "CWE-284",
					status: 200,
					reliable: true,
				},
				findings: [],
				requests: [
					{
						method: "GET",
						path: "/administration",
						queryKeys: [],
						status: 200,
						responseBytes: 0,
						responseShapeHash: responseShapeHash({}),
					},
				],
			}),
		});
		expect(recovered.preflight.status).toBe("passed");
		expect(await stat(lockPath).catch(() => null)).toBeNull();
	});
});

function successfulReset(): ActiveResetExecutor {
	return {
		prepare: async () => ({ baselineHash: baseline }),
		reset: async () => ({ ok: true, baselineHash: baseline }),
	};
}
