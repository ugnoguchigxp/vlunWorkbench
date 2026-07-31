import { z } from "zod";
import { relativeHttpPathSchema } from "./http-target.schema";

export const dastVerdictSchema = z.enum([
	"findings",
	"no_findings_observed",
	"inconclusive",
	"not_tested",
	"unknown_legacy",
]);
export type DastVerdict = z.infer<typeof dastVerdictSchema>;

export const dastCoverageStatusSchema = z.enum(["covered", "partial", "gap"]);
export type DastCoverageStatus = z.infer<typeof dastCoverageStatusSchema>;

export const dastRouteSourceSchema = z.enum([
	"configured",
	"readiness",
	"application_model",
	"openapi",
	"html_link",
	"html_form",
	"browser_network",
	"redirect",
	"common_probe",
]);
export type DastRouteSource = z.infer<typeof dastRouteSourceSchema>;

export const dastRouteStateSchema = z.enum([
	"discovered",
	"planned",
	"attempted",
	"succeeded",
	"denied_expected",
	"denied_unexpected",
	"blocked",
	"failed",
	"not_tested",
]);
export type DastRouteState = z.infer<typeof dastRouteStateSchema>;

export const dastRouteInventoryEntrySchema = z.object({
	method: z.enum(["GET", "HEAD", "OPTIONS"]),
	path: relativeHttpPathSchema,
	queryKeys: z.array(z.string().min(1).max(200)).max(50).default([]),
	queryShapeHash: z.string().min(1),
	sources: z.array(dastRouteSourceSchema).min(1),
	depth: z.number().int().min(0).max(3),
	required: z.boolean(),
	authMode: z.enum(["anonymous", "authenticated"]),
	state: dastRouteStateSchema,
	statusCode: z.number().int().min(100).max(599).nullable(),
	limitationCode: z.string().min(1).nullable(),
});
export type DastRouteInventoryEntry = z.infer<
	typeof dastRouteInventoryEntrySchema
>;

export const dastCoverageSummarySchema = z.object({
	knownRouteCount: z.number().int().min(0),
	actionableKnownRouteCount: z.number().int().min(0),
	plannedRouteCount: z.number().int().min(0),
	attemptedRouteCount: z.number().int().min(0),
	successfulRouteCount: z.number().int().min(0),
	failedRouteCount: z.number().int().min(0),
	blockedRouteCount: z.number().int().min(0),
	notTestedRouteCount: z.number().int().min(0),
	requiredSeedCoverage: z.number().min(0).max(1),
	actionableRouteCoverage: z.number().min(0).max(1),
	requestCount: z.number().int().min(0),
	responseBytesRead: z.number().int().min(0),
	maxDepthReached: z.number().int().min(0).max(3),
	transportErrorCount: z.number().int().min(0),
	timeoutCount: z.number().int().min(0),
	authFailureCount: z.number().int().min(0),
	budgetExhausted: z.boolean(),
	limitationCodes: z.array(z.string().min(1)),
});
export type DastCoverageSummary = z.infer<typeof dastCoverageSummarySchema>;

export const EMPTY_DAST_COVERAGE_SUMMARY: DastCoverageSummary = {
	knownRouteCount: 0,
	actionableKnownRouteCount: 0,
	plannedRouteCount: 0,
	attemptedRouteCount: 0,
	successfulRouteCount: 0,
	failedRouteCount: 0,
	blockedRouteCount: 0,
	notTestedRouteCount: 0,
	requiredSeedCoverage: 0,
	actionableRouteCoverage: 0,
	requestCount: 0,
	responseBytesRead: 0,
	maxDepthReached: 0,
	transportErrorCount: 0,
	timeoutCount: 0,
	authFailureCount: 0,
	budgetExhausted: false,
	limitationCodes: [],
};
