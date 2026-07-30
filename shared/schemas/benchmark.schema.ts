import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const benchmarkRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"inconclusive",
]);

export const benchmarkMetricSchema = z.object({
	category: z.string().min(1).max(200),
	truePositive: z.number().int().min(0),
	falseNegative: z.number().int().min(0),
	trueNegative: z.number().int().min(0),
	falsePositive: z.number().int().min(0),
	recall: z.number().min(0).max(1).nullable(),
	precision: z.number().min(0).max(1).nullable(),
	falsePositiveRate: z.number().min(0).max(1).nullable(),
	score: z.number().min(-1).max(1).nullable(),
});

export const benchmarkRunInputSchema = z.object({
	corpusId: z.enum([
		"owasp-benchmark-java",
		"owasp-juice-shop",
		"business-logic",
	]),
	corpusVersion: z.string().min(1),
	corpusDigest: sha256DigestSchema,
	gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
	toolboxImageDigest: sha256DigestSchema,
	scannerManifestHash: sha256DigestSchema,
	benchmarkPolicyVersion: z.string().min(1),
	inputHash: sha256DigestSchema,
});

export type BenchmarkMetric = z.infer<typeof benchmarkMetricSchema>;
export type BenchmarkRunInput = z.infer<typeof benchmarkRunInputSchema>;
