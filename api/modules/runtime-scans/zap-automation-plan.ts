import { z } from "zod";
import { relativeHttpPathSchema } from "../../../shared/schemas/http-target.schema";
import {
	ZAP_ACTIVE_ALLOWED_RULE_IDS,
	ZAP_ACTIVE_POLICY_ID,
} from "./zap-active-policy";

const activeRuleSchema = z.object({
	id: z.number().int().positive(),
	threshold: z.literal("Medium").default("Medium"),
	strength: z.literal("Low").default("Low"),
});

const inputSchema = z.object({
	contextName: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
	targetOrigin: z.string().url(),
	allowedPaths: z.array(relativeHttpPathSchema).min(1).max(200),
	openApiUrl: z.string().url().optional(),
	rules: z.array(activeRuleSchema).min(1).max(100),
	maxDurationMinutes: z.number().int().min(1).max(20),
	reportFilename: z.string().regex(/^[a-zA-Z0-9._-]+\.json$/),
});

export type ZapAutomationPlanInput = z.input<typeof inputSchema>;

export function buildZapAutomationPlan(raw: ZapAutomationPlanInput): {
	policyId: typeof ZAP_ACTIVE_POLICY_ID;
	enabledRuleIds: number[];
	jobs: Array<Record<string, unknown>>;
	yaml: string;
} {
	const input = inputSchema.parse(raw);
	const enabledRuleIds = input.rules.map((rule) => rule.id);
	if (new Set(enabledRuleIds).size !== enabledRuleIds.length)
		throw new Error("zap_active_duplicate_rule_id");
	for (const ruleId of enabledRuleIds)
		if (!ZAP_ACTIVE_ALLOWED_RULE_IDS.has(ruleId))
			throw new Error(`zap_active_rule_not_allowed:${ruleId}`);
	const jobs: Array<Record<string, unknown>> = [
		{
			type: "passiveScan-config",
			parameters: { maxAlertsPerRule: 10, scanOnlyInScope: true },
		},
		input.openApiUrl
			? {
					type: "openapi",
					parameters: {
						apiUrl: input.openApiUrl,
						targetUrl: input.targetOrigin,
					},
				}
			: {
					type: "spider",
					parameters: {
						context: input.contextName,
						url: input.targetOrigin,
						maxDuration: Math.min(input.maxDurationMinutes, 5),
					},
				},
		{
			type: "passiveScan-wait",
			parameters: { maxDuration: Math.min(input.maxDurationMinutes, 5) },
		},
		{
			type: "activeScan-config",
			parameters: {
				defaultThreshold: "Off",
				defaultStrength: "Low",
			},
			policyDefinition: {
				defaultThreshold: "Off",
				defaultStrength: "Low",
				rules: input.rules.map((rule) => ({
					id: rule.id,
					threshold: rule.threshold,
					strength: rule.strength,
				})),
			},
		},
		{
			type: "activeScan",
			parameters: {
				context: input.contextName,
				policy: ZAP_ACTIVE_POLICY_ID,
				maxScanDurationInMins: input.maxDurationMinutes,
			},
		},
		{
			type: "report",
			parameters: {
				template: "traditional-json",
				reportDir: "/zap/wrk",
				reportFile: input.reportFilename,
			},
		},
		{
			type: "exitStatus",
			parameters: { errorLevel: "High", warnLevel: "Medium" },
		},
	];
	const plan = {
		env: {
			contexts: [
				{
					name: input.contextName,
					urls: [input.targetOrigin],
					includePaths: input.allowedPaths.map(
						(path) =>
							`${escapeRegex(input.targetOrigin)}${escapeRegex(path)}.*`,
					),
				},
			],
			parameters: {
				failOnError: true,
				failOnWarning: false,
				progressToStdout: true,
			},
		},
		jobs,
	};
	return {
		policyId: ZAP_ACTIVE_POLICY_ID,
		enabledRuleIds,
		jobs,
		yaml: toYaml(plan),
	};
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toYaml(value: unknown, indent = 0): string {
	const prefix = " ".repeat(indent);
	if (Array.isArray(value))
		return value
			.map((item) => {
				if (isScalar(item)) return `${prefix}- ${scalar(item)}`;
				const nested = toYaml(item, indent + 2).trimStart();
				const [first, ...rest] = nested.split("\n");
				return `${prefix}- ${first}\n${rest.map((line) => `${prefix}  ${line}`).join("\n")}`;
			})
			.join("\n");
	if (value && typeof value === "object")
		return Object.entries(value)
			.map(([key, nested]) =>
				isScalar(nested)
					? `${prefix}${key}: ${scalar(nested)}`
					: `${prefix}${key}:\n${toYaml(nested, indent + 2)}`,
			)
			.join("\n");
	return `${prefix}${scalar(value)}`;
}

function isScalar(value: unknown): boolean {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function scalar(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	return String(value);
}
