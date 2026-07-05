import { z } from "zod";
import {
	staticIntelligenceEvidenceQualitySchema,
	staticIntelligenceRiskBandSchema,
	staticIntelligenceSeveritySchema,
} from "./static-intelligence.schema";

export const riskCommunityBasisSchema = z.enum([
	"same_file",
	"same_scanner_rule",
	"same_scanner",
	"same_cwe",
	"same_cve",
	"same_dependency",
	"graph_connected",
	"semantic",
]);
export type RiskCommunityBasis = z.infer<typeof riskCommunityBasisSchema>;

export const riskCommunityConfidenceSchema = z.enum(["low", "medium", "high"]);
export type RiskCommunityConfidence = z.infer<
	typeof riskCommunityConfidenceSchema
>;

export const riskCommunitySchema = z.object({
	id: z.string(),
	title: z.string(),
	basis: z.array(riskCommunityBasisSchema),
	confidence: riskCommunityConfidenceSchema,
	candidateOnly: z.literal(true),
	summary: z.string(),
	suggestedReviewFocus: z.array(z.string()),
	findingIds: z.array(z.string()),
	evidenceRefs: z.array(z.string()),
	artifactRefs: z.array(z.string()),
	fileRefs: z.array(z.string()),
	scannerRefs: z.array(z.string()),
	ruleIds: z.array(z.string()),
	maxSeverity: staticIntelligenceSeveritySchema,
	evidenceQuality: staticIntelligenceEvidenceQualitySchema,
	degradedReasons: z.array(z.string()),
});
export type RiskCommunity = z.infer<typeof riskCommunitySchema>;

export const staticIntelligenceCommunitiesResultSchema = z.object({
	ok: z.literal(true),
	status: z.literal("completed"),
	version: z.literal("v1"),
	generatedAt: z.string(),
	projectId: z.string(),
	scanRunId: z.string(),
	communities: z.array(riskCommunitySchema),
	degradedReasons: z.array(z.string()),
});
export type StaticIntelligenceCommunitiesResult = z.infer<
	typeof staticIntelligenceCommunitiesResultSchema
>;

export const securityLandscapeSchema = z.object({
	risk: z.object({
		band: staticIntelligenceRiskBandSchema,
		findingCount: z.number().int().nonnegative(),
		bySeverity: z.record(z.string(), z.number().int().nonnegative()),
		byScanner: z.record(z.string(), z.number().int().nonnegative()),
		byFile: z.array(
			z.object({
				path: z.string(),
				findingCount: z.number().int().nonnegative(),
				maxSeverity: staticIntelligenceSeveritySchema,
				evidenceQuality: staticIntelligenceEvidenceQualitySchema,
				findingIds: z.array(z.string()),
				evidenceRefs: z.array(z.string()),
			}),
		),
	}),
	coverage: z.object({
		status: z.enum(["covered", "partial", "unknown"]),
		scannedToolCount: z.number().int().nonnegative(),
		artifactCount: z.number().int().nonnegative(),
		unknownFileCount: z.number().int().nonnegative(),
		degradedReasons: z.array(z.string()),
	}),
	evidence: z.object({
		quality: staticIntelligenceEvidenceQualitySchema,
		missingEvidenceFindingIds: z.array(z.string()),
		weakEvidenceFindingIds: z.array(z.string()),
		artifactBackedEvidenceRefs: z.array(z.string()),
	}),
	remediation: z.object({
		reviewStatus: z.enum(["completed", "failed", "missing"]),
		hasImprovementRequest: z.boolean(),
		acceptanceCriteriaCount: z.number().int().nonnegative(),
		verificationCommandCount: z.number().int().nonnegative(),
		openFocus: z.array(z.string()),
	}),
});
export type SecurityLandscape = z.infer<typeof securityLandscapeSchema>;

export const staticIntelligenceLandscapeResultSchema = z.object({
	ok: z.literal(true),
	status: z.literal("completed"),
	version: z.literal("v1"),
	generatedAt: z.string(),
	projectId: z.string(),
	scanRunId: z.string(),
	landscape: securityLandscapeSchema,
	communities: z.array(riskCommunitySchema).optional(),
	degradedReasons: z.array(z.string()),
});
export type StaticIntelligenceLandscapeResult = z.infer<
	typeof staticIntelligenceLandscapeResultSchema
>;
