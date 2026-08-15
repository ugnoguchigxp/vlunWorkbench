import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const relativeEvidencePathSchema = z
	.string()
	.min(1)
	.max(500)
	.refine((value) => {
		const segments = value.split("/");
		return (
			!path.isAbsolute(value) &&
			!value.includes("\\") &&
			segments.every(
				(segment) => segment !== "" && segment !== "." && segment !== "..",
			)
		);
	}, "Expected a normalized relative evidence path");

export const juiceShopRunnerFamilySchema = z.enum([
	"authorization",
	"business_logic",
	"zap",
	"browser",
	"bounded_http",
	"outbound_canary",
]);

export const juiceShopExecutionSchema = z
	.object({
		executionStatus: z.enum(["completed", "inconclusive", "blocked", "failed"]),
		detection: z.enum(["detected", "not_detected", "not_scored"]),
		evidencePath: relativeEvidencePathSchema.nullable(),
		evidenceHash: sha256Schema.nullable(),
		normalizedFindingRefs: z
			.array(z.string().min(1).max(300))
			.max(100)
			.default([]),
	})
	.superRefine((value, ctx) => {
		const completed = value.executionStatus === "completed";
		if (completed && value.detection === "not_scored") {
			ctx.addIssue({
				code: "custom",
				path: ["detection"],
				message: "A completed execution must have a scored detection state",
			});
		}
		if (!completed && value.detection !== "not_scored") {
			ctx.addIssue({
				code: "custom",
				path: ["detection"],
				message: "An incomplete execution cannot be scored",
			});
		}
		if (completed && (!value.evidencePath || !value.evidenceHash)) {
			ctx.addIssue({
				code: "custom",
				path: ["evidencePath"],
				message: "A completed execution requires evidence",
			});
		}
		if (Boolean(value.evidencePath) !== Boolean(value.evidenceHash)) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceHash"],
				message: "Evidence path and hash must be supplied together",
			});
		}
		if (
			value.detection === "detected" &&
			value.normalizedFindingRefs.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["normalizedFindingRefs"],
				message: "A detected execution requires a normalized finding reference",
			});
		}
	});

export const juiceShopObservationSchema = z
	.object({
		schemaVersion: z.literal(2),
		scenarioId: z.string().regex(/^juice-[a-z0-9-]+$/),
		runnerFamily: juiceShopRunnerFamilySchema,
		scenarioStatus: z.enum([
			"completed",
			"inconclusive",
			"blocked",
			"failed_cleanup",
		]),
		vulnerable: juiceShopExecutionSchema,
		fixed: juiceShopExecutionSchema,
		lifecycle: z.object({
			targetRequestCount: z.number().int().nonnegative(),
			externalNetworkRequests: z.number().int().nonnegative(),
			publicProductionRequests: z.number().int().nonnegative(),
			prepareBaselineHash: sha256Schema.nullable(),
			cleanupBaselineHash: sha256Schema.nullable(),
			cleanupSucceeded: z.boolean(),
			credentialCanaryLeakage: z.boolean().default(false),
		}),
		limitationCodes: z
			.array(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/))
			.max(50)
			.default([]),
	})
	.superRefine((value, ctx) => {
		if (value.scenarioStatus === "completed") {
			if (
				value.vulnerable.executionStatus !== "completed" ||
				value.fixed.executionStatus !== "completed"
			) {
				ctx.addIssue({
					code: "custom",
					path: ["scenarioStatus"],
					message: "A completed scenario requires both executions",
				});
			}
			if (
				!value.lifecycle.cleanupSucceeded ||
				!value.lifecycle.prepareBaselineHash ||
				value.lifecycle.prepareBaselineHash !==
					value.lifecycle.cleanupBaselineHash
			) {
				ctx.addIssue({
					code: "custom",
					path: ["lifecycle"],
					message:
						"A completed scenario requires successful cleanup to the prepared baseline",
				});
			}
			if (
				value.lifecycle.externalNetworkRequests !== 0 ||
				value.lifecycle.publicProductionRequests !== 0 ||
				value.lifecycle.credentialCanaryLeakage
			) {
				ctx.addIssue({
					code: "custom",
					path: ["lifecycle"],
					message:
						"A completed scenario cannot contain a safety boundary violation",
				});
			}
		}
		if (
			value.scenarioStatus === "failed_cleanup" &&
			value.lifecycle.cleanupSucceeded
		) {
			ctx.addIssue({
				code: "custom",
				path: ["lifecycle", "cleanupSucceeded"],
				message: "A failed_cleanup scenario cannot report cleanup success",
			});
		}
	});

export const juiceShopObservationsSchema = z
	.array(juiceShopObservationSchema)
	.max(100);

export type JuiceShopExecution = z.infer<typeof juiceShopExecutionSchema>;
export type JuiceShopObservation = z.infer<typeof juiceShopObservationSchema>;

export const juiceShopRunReportSchema = z.object({
	schemaVersion: z.literal(2),
	evidenceKind: z.literal("juice_shop_benchmark_run"),
	generatedAt: z.string().datetime(),
	measurementStatus: z.enum([
		"completed",
		"incomplete",
		"not_executed",
		"blocked",
		"failed_cleanup",
	]),
	measurementReason: z.string().nullable(),
	provenance: z.object({
		gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
		corpusVersion: z.string().min(1),
		corpusDigest: sha256Schema,
		upstreamGroundTruthHash: sha256Schema,
		benchmarkPolicyVersion: z.string().min(1),
		benchmarkPolicyHash: sha256Schema,
		catalogHash: sha256Schema,
		playbookHash: sha256Schema,
		fixedFixtureHash: sha256Schema,
		detectorImplementationHash: sha256Schema,
		scannerManifestHash: sha256Schema,
		observationsHash: sha256Schema,
		evidenceBundleHash: sha256Schema,
		fixtureImageDigest: z.string().regex(/@sha256:[a-f0-9]{64}$/),
	}),
	counts: z.object({
		eligibleScenarioCount: z.number().int().nonnegative(),
		categoryCount: z.number().int().nonnegative(),
		observationCount: z.number().int().nonnegative(),
		executedScenarioCount: z.number().int().nonnegative(),
		detectedScenarioCount: z.number().int().nonnegative(),
		blockedScenarioCount: z.number().int().nonnegative(),
		inconclusiveScenarioCount: z.number().int().nonnegative(),
		failedCleanupScenarioCount: z.number().int().nonnegative(),
		targetRequestCount: z.number().int().nonnegative(),
		externalNetworkRequests: z.number().int().nonnegative(),
		publicProductionRequests: z.number().int().nonnegative(),
		credentialCanaryLeakageCount: z.number().int().nonnegative(),
	}),
	preflight: z.object({
		status: z.enum(["passed", "blocked"]),
		platform: z.string().min(1),
		fixtureId: z.string().min(1),
		image: z.string().min(1),
		targetOrigin: z.string().url(),
		authoritativeLinux: z.boolean(),
		errorCode: z.string().nullable(),
	}),
	metricsGenerated: z.boolean(),
	gatePassed: z.boolean(),
	observations: juiceShopObservationsSchema,
});

export type JuiceShopRunReport = z.infer<typeof juiceShopRunReportSchema>;

export const historicalJuiceShopObservationV1Schema = z.object({
	scenarioId: z.string(),
	vulnerableDetected: z.boolean(),
	fixedDetected: z.boolean(),
	evidencePath: z.string().min(1).max(500),
	evidenceHash: sha256Schema,
});

export function isCompletedJuiceShopObservation(
	observation: JuiceShopObservation,
): boolean {
	return (
		observation.scenarioStatus === "completed" &&
		observation.vulnerable.executionStatus === "completed" &&
		observation.fixed.executionStatus === "completed" &&
		observation.lifecycle.cleanupSucceeded &&
		observation.lifecycle.prepareBaselineHash !== null &&
		observation.lifecycle.prepareBaselineHash ===
			observation.lifecycle.cleanupBaselineHash &&
		observation.lifecycle.externalNetworkRequests === 0 &&
		observation.lifecycle.publicProductionRequests === 0 &&
		!observation.lifecycle.credentialCanaryLeakage
	);
}

export function validateJuiceShopObservations(
	observations: JuiceShopObservation[],
	eligibleScenarioIds: Iterable<string>,
): Map<string, JuiceShopObservation> {
	const eligible = new Set(eligibleScenarioIds);
	const byScenario = new Map<string, JuiceShopObservation>();
	const evidenceHashes = new Set<string>();
	for (const rawObservation of observations) {
		const observation = juiceShopObservationSchema.parse(rawObservation);
		if (!eligible.has(observation.scenarioId))
			throw new Error(
				`juice_shop_observation_unknown:${observation.scenarioId}`,
			);
		if (byScenario.has(observation.scenarioId))
			throw new Error(
				`juice_shop_observation_duplicate:${observation.scenarioId}`,
			);
		for (const execution of [observation.vulnerable, observation.fixed]) {
			if (!execution.evidenceHash) continue;
			if (evidenceHashes.has(execution.evidenceHash))
				throw new Error(`juice_shop_evidence_reused:${execution.evidenceHash}`);
			evidenceHashes.add(execution.evidenceHash);
		}
		byScenario.set(observation.scenarioId, observation);
	}
	return byScenario;
}

export async function verifyJuiceShopEvidenceFiles(
	observations: Iterable<JuiceShopObservation>,
	evidenceRoot: string,
): Promise<void> {
	const canonicalRoot = path.resolve(evidenceRoot);
	for (const observation of observations) {
		for (const [targetKind, execution] of [
			["vulnerable", observation.vulnerable],
			["fixed", observation.fixed],
		] as const) {
			if (!execution.evidencePath || !execution.evidenceHash) continue;
			const evidencePath = path.resolve(canonicalRoot, execution.evidencePath);
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
			if (actualHash !== execution.evidenceHash)
				throw new Error(
					`juice_shop_evidence_hash_mismatch:${observation.scenarioId}:${targetKind}`,
				);
		}
	}
}
