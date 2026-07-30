import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	validateJuiceShopObservations,
	verifyJuiceShopEvidenceFiles,
} from "./juice-shop-observations";

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

describe("Juice Shop benchmark observations", () => {
	test("rejects duplicate and unknown scenarios", () => {
		const observation = {
			scenarioId: "eligible",
			vulnerableDetected: true,
			fixedDetected: false,
			evidencePath: "eligible.json",
			evidenceHash: hash("a"),
		};
		expect(() =>
			validateJuiceShopObservations(
				[observation, { ...observation, evidenceHash: hash("b") }],
				["eligible"],
			),
		).toThrow("juice_shop_observation_duplicate:eligible");
		expect(() =>
			validateJuiceShopObservations(
				[{ ...observation, scenarioId: "unknown" }],
				["eligible"],
			),
		).toThrow("juice_shop_observation_unknown:unknown");
	});

	test("does not allow one evidence artifact to prove multiple scenarios", () => {
		expect(() =>
			validateJuiceShopObservations(
				[
					{
						scenarioId: "first",
						vulnerableDetected: true,
						fixedDetected: false,
						evidencePath: "first.json",
						evidenceHash: hash("a"),
					},
					{
						scenarioId: "second",
						vulnerableDetected: true,
						fixedDetected: false,
						evidencePath: "second.json",
						evidenceHash: hash("a"),
					},
				],
				["first", "second"],
			),
		).toThrow("juice_shop_evidence_reused:");
	});

	test("binds observations to bounded evidence files below the evidence root", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "juice-evidence-"));
		try {
			await writeFile(path.join(root, "observation.json"), "evidence");
			const observation = {
				scenarioId: "eligible",
				vulnerableDetected: true,
				fixedDetected: false,
				evidencePath: "observation.json",
				evidenceHash:
					"sha256:ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e",
			};
			await expect(
				verifyJuiceShopEvidenceFiles([observation], root),
			).resolves.toBeUndefined();
			await expect(
				verifyJuiceShopEvidenceFiles(
					[{ ...observation, evidencePath: "../outside.json" }],
					root,
				),
			).rejects.toThrow("juice_shop_evidence_path_invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
