import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type JuiceShopObservation = {
	scenarioId: string;
	vulnerableDetected: boolean;
	fixedDetected: boolean;
	evidencePath: string;
	evidenceHash: string;
};

export const juiceShopObservationsSchema = z.array(
	z.object({
		scenarioId: z.string(),
		vulnerableDetected: z.boolean(),
		fixedDetected: z.boolean(),
		evidencePath: z.string().min(1).max(500),
		evidenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	}),
);

export function validateJuiceShopObservations(
	observations: JuiceShopObservation[],
	eligibleScenarioIds: Iterable<string>,
): Map<string, JuiceShopObservation> {
	const eligible = new Set(eligibleScenarioIds);
	const byScenario = new Map<string, JuiceShopObservation>();
	const evidenceHashes = new Set<string>();
	for (const observation of observations) {
		if (!eligible.has(observation.scenarioId))
			throw new Error(
				`juice_shop_observation_unknown:${observation.scenarioId}`,
			);
		if (byScenario.has(observation.scenarioId))
			throw new Error(
				`juice_shop_observation_duplicate:${observation.scenarioId}`,
			);
		if (evidenceHashes.has(observation.evidenceHash))
			throw new Error(`juice_shop_evidence_reused:${observation.evidenceHash}`);
		byScenario.set(observation.scenarioId, observation);
		evidenceHashes.add(observation.evidenceHash);
	}
	return byScenario;
}

export async function verifyJuiceShopEvidenceFiles(
	observations: Iterable<JuiceShopObservation>,
	evidenceRoot: string,
): Promise<void> {
	const canonicalRoot = path.resolve(evidenceRoot);
	for (const observation of observations) {
		const evidencePath = path.resolve(canonicalRoot, observation.evidencePath);
		const relative = path.relative(canonicalRoot, evidencePath);
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
			throw new Error("juice_shop_evidence_path_invalid");
		const fileStat = await stat(evidencePath);
		if (!fileStat.isFile() || fileStat.size > 16 * 1024 * 1024)
			throw new Error("juice_shop_evidence_file_invalid");
		const actualHash = `sha256:${crypto
			.createHash("sha256")
			.update(await readFile(evidencePath))
			.digest("hex")}`;
		if (actualHash !== observation.evidenceHash)
			throw new Error(
				`juice_shop_evidence_hash_mismatch:${observation.scenarioId}`,
			);
	}
}
