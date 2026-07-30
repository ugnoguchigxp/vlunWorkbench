import { z } from "zod";
import {
	httpOriginSchema,
	relativeHttpPathSchema,
	relativePathMatchesPrefix,
} from "./http-target.schema";

export const assessmentPurposeSchema = z.enum(["internal", "external"]);
export const assessmentEnvironmentSchema = z.enum([
	"local",
	"ephemeral",
	"staging",
	"production",
]);
export type AssessmentEnvironment = z.infer<typeof assessmentEnvironmentSchema>;
export const assessmentEngagementStatusSchema = z.enum([
	"draft",
	"active",
	"completed",
	"expired",
	"revoked",
]);

export const assessmentScopeSchema = z.object({
	origins: z.array(httpOriginSchema).max(50).default([]),
	paths: z.array(relativeHttpPathSchema).max(200).default([]),
	methods: z
		.array(z.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]))
		.max(7)
		.default(["GET", "HEAD", "OPTIONS"]),
});

export const rulesOfEngagementSchema = z.object({
	reference: z.string().min(1).max(500),
	allowedPaths: z.array(relativeHttpPathSchema).min(1).max(200),
	allowedMethods: z
		.array(z.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]))
		.min(1)
		.max(7),
	requestBudget: z.number().int().positive().max(100_000),
	rateLimitPerSec: z.number().positive().max(100),
	cleanupContract: z.string().min(1).max(2000),
	expiresAt: z.string().datetime(),
	attestation: z.string().min(1).max(2000),
});

export const createAssessmentEngagementSchema = z
	.object({
		projectId: z.string().uuid(),
		purpose: assessmentPurposeSchema,
		environment: assessmentEnvironmentSchema,
		scope: assessmentScopeSchema,
		rulesOfEngagement: rulesOfEngagementSchema.nullable().default(null),
		startsAt: z.string().datetime(),
		expiresAt: z.string().datetime(),
	})
	.superRefine((value, ctx) => {
		if (Date.parse(value.expiresAt) <= Date.parse(value.startsAt)) {
			ctx.addIssue({
				code: "custom",
				path: ["expiresAt"],
				message: "expiresAt must be later than startsAt",
			});
		}
		if (
			value.environment === "production" &&
			value.rulesOfEngagement?.allowedMethods.some(
				(method) => !["GET", "HEAD", "OPTIONS"].includes(method),
			)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["rulesOfEngagement", "allowedMethods"],
				message: "Production engagements cannot authorize active methods",
			});
		}
		const roe = value.rulesOfEngagement;
		if (!roe) return;
		if (Date.parse(roe.expiresAt) > Date.parse(value.expiresAt)) {
			ctx.addIssue({
				code: "custom",
				path: ["rulesOfEngagement", "expiresAt"],
				message: "Rules of engagement cannot outlive the engagement",
			});
		}
		for (const [index, method] of roe.allowedMethods.entries()) {
			if (!value.scope.methods.includes(method)) {
				ctx.addIssue({
					code: "custom",
					path: ["rulesOfEngagement", "allowedMethods", index],
					message: "Rules of engagement methods must be within scope",
				});
			}
		}
		for (const [index, allowedPath] of roe.allowedPaths.entries()) {
			if (
				!value.scope.paths.some((scopePath) =>
					relativePathMatchesPrefix(allowedPath, scopePath),
				)
			) {
				ctx.addIssue({
					code: "custom",
					path: ["rulesOfEngagement", "allowedPaths", index],
					message: "Rules of engagement paths must be within scope",
				});
			}
		}
	});

export const coverageStatusSchema = z.enum([
	"tested_passed",
	"tested_failed",
	"inconclusive",
	"not_tested",
	"blocked",
	"unsupported",
]);
export const coverageMethodSchema = z.enum([
	"automated",
	"manual",
	"unsupported",
]);
export const coverageEvidenceRefSchema = z.object({
	kind: z.enum([
		"tool_run",
		"scan_artifact",
		"finding",
		"dast_run",
		"verification",
		"active_assessment",
	]),
	id: z.string().min(1).max(200),
});
export const scanCoverageResultSchema = z
	.object({
		controlId: z.string().min(1).max(100),
		status: coverageStatusSchema,
		method: coverageMethodSchema,
		reasonCode: z.string().min(1).max(100),
		evidenceRefs: z.array(coverageEvidenceRefSchema).max(100),
	})
	.superRefine((value, ctx) => {
		if (value.status.startsWith("tested_") && value.evidenceRefs.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceRefs"],
				message: "tested coverage requires persisted evidence",
			});
		}
		if (value.method === "unsupported" && value.status !== "unsupported") {
			ctx.addIssue({
				code: "custom",
				path: ["status"],
				message: "unsupported method requires unsupported status",
			});
		}
	});

export type CreateAssessmentEngagementInput = z.infer<
	typeof createAssessmentEngagementSchema
>;
export type ScanCoverageResult = z.infer<typeof scanCoverageResultSchema>;
