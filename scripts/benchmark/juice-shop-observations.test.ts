import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	isCompletedJuiceShopObservation,
	juiceShopObservationsSchema,
	type JuiceShopObservation,
	validateJuiceShopObservations,
	verifyJuiceShopEvidenceFiles,
} from "./juice-shop-observations";

const hash = (value: string) =>
	`sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const baselineHash = hash("baseline");

function observation(
	scenarioId = "juice-eligible",
): JuiceShopObservation {
	return {
		schemaVersion: 2,
		scenarioId,
		runnerFamily: "bounded_http",
		scenarioStatus: "completed",
		vulnerable: {
			executionStatus: "completed",
			detection: "detected",
			evidencePath: `${scenarioId}-vulnerable.json`,
			evidenceHash: hash(`${scenarioId}:vulnerable`),
			normalizedFindingRefs: [`${scenarioId}:finding`],
		},
		fixed: {
			executionStatus: "completed",
			detection: "not_detected",
			evidencePath: `${scenarioId}-fixed.json`,
			evidenceHash: hash(`${scenarioId}:fixed`),
			normalizedFindingRefs: [],
		},
		lifecycle: {
			targetRequestCount: 2,
			externalNetworkRequests: 0,
			publicProductionRequests: 0,
			prepareBaselineHash: baselineHash,
			cleanupBaselineHash: baselineHash,
			cleanupSucceeded: true,
			credentialCanaryLeakage: false,
		},
		limitationCodes: [],
	};
}

describe("Juice Shop benchmark observations", () => {
	test("rejects duplicate and unknown scenarios", () => {
		const eligible = observation();
		expect(() =>
			validateJuiceShopObservations(
				[
					eligible,
					{
						...eligible,
						vulnerable: {
							...eligible.vulnerable,
							evidenceHash: hash("duplicate:vulnerable"),
						},
						fixed: {
							...eligible.fixed,
							evidenceHash: hash("duplicate:fixed"),
						},
					},
				],
				["juice-eligible"],
			),
		).toThrow("juice_shop_observation_duplicate:juice-eligible");
		expect(() =>
			validateJuiceShopObservations(
				[observation("juice-unknown")],
				["juice-eligible"],
			),
		).toThrow("juice_shop_observation_unknown:juice-unknown");
	});

	test("does not allow one evidence artifact to prove multiple targets", () => {
		const first = observation("juice-first");
		const second = observation("juice-second");
		second.fixed.evidenceHash = first.vulnerable.evidenceHash;
		expect(() =>
			validateJuiceShopObservations(
				[first, second],
				["juice-first", "juice-second"],
			),
		).toThrow("juice_shop_evidence_reused:");
	});

	test("fails closed for incomplete executions, cleanup, and network violations", () => {
		const blocked = observation();
		blocked.scenarioStatus = "blocked";
		blocked.vulnerable = {
			executionStatus: "blocked",
			detection: "not_scored",
			evidencePath: null,
			evidenceHash: null,
			normalizedFindingRefs: [],
		};
		blocked.fixed = { ...blocked.vulnerable };
		blocked.lifecycle.cleanupSucceeded = false;
		blocked.lifecycle.prepareBaselineHash = null;
		blocked.lifecycle.cleanupBaselineHash = null;
		expect(juiceShopObservationsSchema.parse([blocked])).toHaveLength(1);
		expect(isCompletedJuiceShopObservation(blocked)).toBe(false);

		const cleanupMismatch = observation();
		cleanupMismatch.lifecycle.cleanupBaselineHash = hash("changed");
		expect(() =>
			juiceShopObservationsSchema.parse([cleanupMismatch]),
		).toThrow();

		const publicRequest = observation();
		publicRequest.lifecycle.publicProductionRequests = 1;
		expect(() => juiceShopObservationsSchema.parse([publicRequest])).toThrow();
	});

	test("binds vulnerable and fixed observations to bounded evidence files", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "juice-evidence-"));
		try {
			const eligible = observation();
			await writeFile(
				path.join(root, eligible.vulnerable.evidencePath as string),
				"juice-eligible:vulnerable",
			);
			await writeFile(
				path.join(root, eligible.fixed.evidencePath as string),
				"juice-eligible:fixed",
			);
			await expect(
				verifyJuiceShopEvidenceFiles([eligible], root),
			).resolves.toBeUndefined();
			await expect(
				verifyJuiceShopEvidenceFiles(
					[
						{
							...eligible,
							fixed: {
								...eligible.fixed,
								evidencePath: "../outside.json",
							},
						},
					],
					root,
				),
			).rejects.toThrow("juice_shop_evidence_path_invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
