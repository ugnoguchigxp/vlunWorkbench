import { z } from "zod";

export const LlmProviderKindSchema = z.enum([
	"azure",
	"openai",
	"openai-compatible",
	"bedrock",
	"local",
	"codex",
]);

export const LlmTaskSchema = z.enum([
	"finding_review",
	"scan_review",
	"evidence_context",
	"agentic_search",
	"report_summary",
]);

export const LlmThinkingDepthSchema = z.enum([
	"",
	"low",
	"medium",
	"high",
	"very_high",
]);

export type LlmProviderKind = z.infer<typeof LlmProviderKindSchema>;
export type LlmTask = z.infer<typeof LlmTaskSchema>;
export type LlmThinkingDepth = z.infer<typeof LlmThinkingDepthSchema>;

export const LLM_TASKS = LlmTaskSchema.options;

export const LLM_TASK_POLICIES: Record<
	LlmTask,
	{
		allowProviderKinds: LlmProviderKind[];
		defaultAllowCodex: boolean;
		requiresStructuredJson: boolean;
	}
> = {
	finding_review: {
		allowProviderKinds: [
			"azure",
			"openai",
			"openai-compatible",
			"local",
			"codex",
		],
		defaultAllowCodex: true,
		requiresStructuredJson: true,
	},
	scan_review: {
		allowProviderKinds: [
			"azure",
			"openai",
			"openai-compatible",
			"local",
			"codex",
		],
		defaultAllowCodex: true,
		requiresStructuredJson: true,
	},
	evidence_context: {
		allowProviderKinds: ["azure", "openai", "openai-compatible", "local"],
		defaultAllowCodex: false,
		requiresStructuredJson: false,
	},
	agentic_search: {
		allowProviderKinds: ["openai", "openai-compatible", "local", "azure"],
		defaultAllowCodex: false,
		requiresStructuredJson: false,
	},
	report_summary: {
		allowProviderKinds: [
			"azure",
			"openai",
			"openai-compatible",
			"local",
			"codex",
		],
		defaultAllowCodex: true,
		requiresStructuredJson: true,
	},
};

const trimmedString = z.string().trim().min(1);
export const LlmModelCapabilitySchema = z.object({
	contextWindowTokens: z.number().int().positive().optional(),
	safePromptBudgetTokens: z.number().int().positive().optional(),
	reservedOutputTokens: z.number().int().positive().optional(),
	supportsProviderSideCompression: z.boolean().optional(),
	compressionProfile: z.string().optional(),
});

export const LlmModelTargetSchema = z
	.object({
		providerEndpointId: trimmedString,
		model: trimmedString,
		thinkingDepth: LlmThinkingDepthSchema.optional(),
	})
	.strict();

export type LlmModelTarget = z.infer<typeof LlmModelTargetSchema>;

export const LlmProviderEndpointSchema = z
	.object({
		id: trimmedString,
		name: trimmedString,
		kind: LlmProviderKindSchema,
		enabled: z.boolean().default(true),
		apiKey: z.string().optional().default(""),
		baseUrl: z.string().optional().default(""),
		endpoint: z.string().optional().default(""),
		apiVersion: z.string().optional().default(""),
		region: z.string().optional().default(""),
		models: z.array(trimmedString).default([]),
		modelDisplayNames: z.record(z.string(), z.string()).default({}),
		defaultModelCapability: LlmModelCapabilitySchema.optional(),
		modelCapabilities: z
			.record(z.string(), LlmModelCapabilitySchema)
			.optional()
			.default({}),
	})
	.strict()
	.superRefine((endpoint, ctx) => {
		if (endpoint.kind === "azure") {
			if (!endpoint.endpoint) {
				ctx.addIssue({
					code: "custom",
					path: ["endpoint"],
					message: "endpoint is required for Azure endpoints.",
				});
			}
			if (endpoint.models.length < 1) {
				ctx.addIssue({
					code: "custom",
					path: ["models"],
					message: "Azure endpoints require at least one deployment model.",
				});
			}
		}
		if (
			(endpoint.kind === "openai" ||
				endpoint.kind === "openai-compatible" ||
				endpoint.kind === "local") &&
			!endpoint.baseUrl
		) {
			ctx.addIssue({
				code: "custom",
				path: ["baseUrl"],
				message: `${endpoint.kind} endpoints require baseUrl.`,
			});
		}
	});

export type LlmProviderEndpointSettings = z.infer<
	typeof LlmProviderEndpointSchema
>;

export const LlmTaskRoutePolicySchema = z
	.object({
		allowCodex: z.boolean().optional(),
	})
	.strict();

export const LlmTaskRouteSchema = z
	.object({
		task: LlmTaskSchema,
		primaryTarget: LlmModelTargetSchema.nullable().optional(),
		fallbackTargets: z.array(LlmModelTargetSchema).default([]),
		policy: LlmTaskRoutePolicySchema.default({}),
	})
	.strict();

export type LlmTaskRouteSettings = z.infer<typeof LlmTaskRouteSchema>;

export const LlmSettingsDocumentSchema = z
	.object({
		providerEndpoints: z.array(LlmProviderEndpointSchema),
		taskRoutes: z.array(LlmTaskRouteSchema),
	})
	.strict()
	.superRefine((settings, ctx) => {
		const endpointIds = new Set<string>();
		for (const [index, endpoint] of settings.providerEndpoints.entries()) {
			if (endpointIds.has(endpoint.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["providerEndpoints", index, "id"],
					message: `Duplicate provider endpoint id: ${endpoint.id}`,
				});
			}
			endpointIds.add(endpoint.id);
		}

		const routeTasks = new Set<string>();
		for (const [index, route] of settings.taskRoutes.entries()) {
			if (routeTasks.has(route.task)) {
				ctx.addIssue({
					code: "custom",
					path: ["taskRoutes", index, "task"],
					message: `Duplicate task route: ${route.task}`,
				});
			}
			routeTasks.add(route.task);
			const targets = [
				...(route.primaryTarget ? [route.primaryTarget] : []),
				...route.fallbackTargets,
			];
			for (const target of targets) {
				if (!endpointIds.has(target.providerEndpointId)) {
					ctx.addIssue({
						code: "custom",
						path: ["taskRoutes", index],
						message: `Route ${route.task} references missing endpoint ${target.providerEndpointId}.`,
					});
				}
			}
		}
	});

export type LlmSettingsDocument = z.infer<typeof LlmSettingsDocumentSchema>;

export type LlmSettingsResponse = LlmSettingsDocument & {
	updatedAt: string | null;
};

export function validateLlmRouteTargets(settings: LlmSettingsDocument): void {
	const endpoints = new Map(
		settings.providerEndpoints.map((endpoint) => [endpoint.id, endpoint]),
	);

	for (const route of settings.taskRoutes) {
		const basePolicy = LLM_TASK_POLICIES[route.task];
		const targets = [
			...(route.primaryTarget ? [route.primaryTarget] : []),
			...route.fallbackTargets,
		];
		for (const target of targets) {
			const endpoint = endpoints.get(target.providerEndpointId);
			if (!endpoint) {
				throw new Error(
					`Route ${route.task} references missing endpoint ${target.providerEndpointId}.`,
				);
			}
			if (!endpoint.enabled) {
				throw new Error(
					`Route ${route.task} references disabled endpoint ${endpoint.id}.`,
				);
			}
			if (!basePolicy.allowProviderKinds.includes(endpoint.kind)) {
				throw new Error(
					`Provider kind ${endpoint.kind} is not allowed for task ${route.task}.`,
				);
			}
			if (!endpoint.models.includes(target.model)) {
				throw new Error(
					`Model ${target.model} is not configured on endpoint ${endpoint.id}.`,
				);
			}
		}
	}
}
