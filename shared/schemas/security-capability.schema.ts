import { z } from "zod";

export const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const scannerDataBundleSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["ruleset", "vulnerability-db", "add-on", "template"]),
	sourceRef: z.string().min(1),
	sourceCommit: z.string().min(1).nullable(),
	license: z.string().min(1),
	generatedAt: z.string().datetime(),
	maxAgeHours: z.number().positive(),
	digest: sha256DigestSchema,
	coverage: z.array(z.string().min(1)),
	recordCount: z.number().int().positive().optional(),
	path: z.string().min(1).nullable().optional(),
});

const scannerToolV2Schema = z.object({
	version: z.string().min(1),
	binaryDigest: sha256DigestSchema.nullable(),
	runtimePath: z.string().min(1).nullable().optional(),
	state: z.enum(["ready", "missing", "stale"]).default("ready"),
	dataBundles: z.array(scannerDataBundleSchema),
});

export const scannerDataManifestV2Schema = z.object({
	version: z.literal(2),
	generatedAt: z.string().datetime(),
	manifestHash: sha256DigestSchema,
	tools: z.record(z.string(), scannerToolV2Schema),
});

export const measuredCapabilityClaimSchema = z
	.object({
		claimId: z.literal("measured-automated-web-api-assessment-v1"),
		status: z.enum(["met", "not_met"]),
		scopeCatalogVersion: z.string().min(1),
		benchmarkPolicyVersion: z.string().min(1),
		passingBenchmarkRunId: z.string().uuid().nullable(),
		unsupportedCapabilities: z.array(z.string().min(1)),
	})
	.superRefine((value, ctx) => {
		if (value.status === "met" && value.passingBenchmarkRunId === null) {
			ctx.addIssue({
				code: "custom",
				path: ["passingBenchmarkRunId"],
				message:
					"A met capability claim must reference a passing benchmark run",
			});
		}
	});

export const capabilityRolloutSchema = z.enum([
	"disabled",
	"shadow",
	"measured",
	"enforced",
]);

export type ScannerDataManifestV2 = z.infer<typeof scannerDataManifestV2Schema>;
export type MeasuredCapabilityClaim = z.infer<
	typeof measuredCapabilityClaimSchema
>;
