import { z } from "zod";

export const securityOracleStatusSchema = z.enum([
	"completed",
	"security_action_required",
	"inconclusive",
	"config_error",
	"runtime_error",
]);

export const securityOracleResultSchema = z
	.object({
		ok: z.boolean(),
		status: securityOracleStatusSchema,
		project: z
			.object({
				id: z.string(),
				repoPath: z.string(),
				created: z.boolean(),
			})
			.strict()
			.nullable(),
		scan: z
			.object({
				scanRunId: z.string(),
				profile: z.string(),
				findingCount: z.number().int().nonnegative(),
				highOrCriticalCount: z.number().int().nonnegative(),
				severityCounts: z
					.object({
						critical: z.number().int().nonnegative(),
						high: z.number().int().nonnegative(),
						medium: z.number().int().nonnegative(),
						low: z.number().int().nonnegative(),
						info: z.number().int().nonnegative(),
						unknown: z.number().int().nonnegative(),
					})
					.strict()
					.optional(),
				coverage: z
					.object({
						completed: z.number().int().nonnegative(),
						skipped: z.number().int().nonnegative(),
						failed: z.number().int().nonnegative(),
						gaps: z.array(
							z
								.object({
									code: z.string().min(1).max(64),
									message: z.string().min(1).max(512),
								})
								.strict(),
						),
					})
					.strict()
					.optional(),
				findingsTruncated: z.boolean(),
				blockingFingerprints: z.array(z.string()),
				findings: z.array(
					z
						.object({
							id: z.string(),
							fingerprint: z.string(),
							severity: z.string(),
							tool: z.string(),
							ruleId: z.string(),
							title: z.string(),
							location: z
								.object({
									path: z.string(),
									line: z.number().int().nullable(),
								})
								.strict()
								.nullable(),
							recommendation: z.string(),
						})
						.strict(),
				),
			})
			.strict()
			.nullable(),
		review: z
			.object({
				status: z.enum(["not_requested", "completed", "failed", "skipped"]),
				reviewId: z.string().optional(),
				improvementRequest: z.string().optional(),
				error: z.string().optional(),
			})
			.strict(),
		nextAction: z.enum([
			"none",
			"apply_security_fix",
			"run_scan_review",
			"configure_provider",
			"inspect_diagnostic_failure",
		]),
		error: z
			.object({ code: z.string(), message: z.string() })
			.strict()
			.optional(),
	})
	.strict();
export type SecurityOracleResult = z.infer<typeof securityOracleResultSchema>;
