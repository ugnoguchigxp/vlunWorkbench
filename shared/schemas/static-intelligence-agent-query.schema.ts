import { z } from "zod";
import { staticIntelligenceExportV1Schema } from "./static-intelligence.schema";
import { staticIntelligenceSemanticQueryResultSchema } from "./static-intelligence-search.schema";
import {
	riskCommunitySchema,
	securityLandscapeSchema,
} from "./static-intelligence-landscape.schema";

export const staticIntelligenceAgentQueryKindSchema = z.enum([
	"project_overview",
	"risk_context",
	"related_findings",
	"evidence_bundle",
	"verification_commands",
	"export_static_intelligence",
]);
export type StaticIntelligenceAgentQueryKind = z.infer<
	typeof staticIntelligenceAgentQueryKindSchema
>;

export const staticIntelligenceAgentQueryInputSchema = z
	.object({
		scanRunId: z.string().min(1),
		queryKind: staticIntelligenceAgentQueryKindSchema,
		query: z.string().trim().min(1).optional(),
		findingId: z.string().trim().min(1).optional(),
		file: z.string().trim().min(1).optional(),
		ruleId: z.string().trim().min(1).optional(),
		scanner: z.string().trim().min(1).optional(),
		includeSemantic: z.boolean().default(false),
		includeCommunities: z.boolean().optional(),
		includeLandscape: z.boolean().optional(),
		includeMarkdown: z.boolean().default(false),
		topK: z.number().int().min(1).max(50).default(10),
	})
	.superRefine((input, ctx) => {
		const hasFocus = Boolean(
			input.query ||
				input.findingId ||
				input.file ||
				input.ruleId ||
				input.scanner,
		);
		if (input.queryKind === "risk_context" && !hasFocus) {
			ctx.addIssue({
				code: "custom",
				message:
					"risk_context requires query, findingId, file, ruleId, or scanner.",
				path: ["queryKind"],
			});
		}
		if (input.queryKind === "related_findings" && !hasFocus) {
			ctx.addIssue({
				code: "custom",
				message:
					"related_findings requires findingId, file, ruleId, scanner, or query.",
				path: ["queryKind"],
			});
		}
		if (input.queryKind === "evidence_bundle" && !input.findingId) {
			ctx.addIssue({
				code: "custom",
				message: "evidence_bundle requires findingId.",
				path: ["findingId"],
			});
		}
	});
export type StaticIntelligenceAgentQueryInput = {
	scanRunId: string;
	queryKind: StaticIntelligenceAgentQueryKind;
	query?: string;
	findingId?: string;
	file?: string;
	ruleId?: string;
	scanner?: string;
	includeSemantic?: boolean;
	includeCommunities?: boolean;
	includeLandscape?: boolean;
	includeMarkdown?: boolean;
	topK?: number;
};
export type ParsedStaticIntelligenceAgentQueryInput = z.output<
	typeof staticIntelligenceAgentQueryInputSchema
>;

export const staticIntelligenceAgentQueryItemKindSchema = z.enum([
	"finding",
	"file_risk",
	"evidence",
	"artifact",
	"community",
	"landscape",
	"verification_command",
	"semantic_candidate",
]);
export type StaticIntelligenceAgentQueryItemKind = z.infer<
	typeof staticIntelligenceAgentQueryItemKindSchema
>;

export const staticIntelligenceAgentQueryItemSchema = z.object({
	id: z.string(),
	kind: staticIntelligenceAgentQueryItemKindSchema,
	title: z.string(),
	score: z.number().optional(),
	candidateOnly: z.literal(true),
	findingIds: z.array(z.string()),
	evidenceRefs: z.array(z.string()),
	artifactRefs: z.array(z.string()),
	fileRefs: z.array(z.string()),
	sourceRefs: z.array(z.string()).min(1),
	metadata: z.record(z.string(), z.unknown()),
});
export type StaticIntelligenceAgentQueryItem = z.infer<
	typeof staticIntelligenceAgentQueryItemSchema
>;

export const staticIntelligenceAgentQueryResultSchema = z.object({
	ok: z.literal(true),
	status: z.literal("completed"),
	version: z.literal("v1"),
	generatedAt: z.string(),
	scanRunId: z.string(),
	queryKind: staticIntelligenceAgentQueryKindSchema,
	summary: z.object({
		title: z.string(),
		body: z.string(),
		candidateOnly: z.literal(true),
	}),
	refs: z.object({
		findingIds: z.array(z.string()),
		evidenceRefs: z.array(z.string()),
		artifactRefs: z.array(z.string()),
		fileRefs: z.array(z.string()),
		sourceRefs: z.array(z.string()),
	}),
	results: z.array(staticIntelligenceAgentQueryItemSchema),
	bundles: z.object({
		export: staticIntelligenceExportV1Schema.optional(),
		semantic: staticIntelligenceSemanticQueryResultSchema.optional(),
		communities: z.array(riskCommunitySchema).optional(),
		landscape: securityLandscapeSchema.optional(),
		markdown: z.string().optional(),
	}),
	degradedReasons: z.array(z.string()),
});
export type StaticIntelligenceAgentQueryResult = z.infer<
	typeof staticIntelligenceAgentQueryResultSchema
>;

export const staticIntelligenceAgentQueryFailureSchema = z.object({
	ok: z.literal(false),
	status: z.literal("failed"),
	message: z.string(),
	degradedReasons: z.array(z.string()).optional(),
});
export type StaticIntelligenceAgentQueryFailure = z.infer<
	typeof staticIntelligenceAgentQueryFailureSchema
>;
