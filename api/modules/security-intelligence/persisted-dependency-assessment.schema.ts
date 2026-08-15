import { z } from "zod";
import {
	diffToolApplicabilitySchema,
	resolvedScanTargetSchema,
} from "../../../shared/schemas/scan-target.schema";

export const DEPENDENCY_TOOL_IDS = ["osv", "trivy"] as const;

export const persistedDependencyToolResultSchema = z
	.object({
		toolId: z.enum(DEPENDENCY_TOOL_IDS),
		toolRunId: z.string().nullable(),
		required: z.boolean(),
		status: z.enum(["completed", "failed", "skipped"]),
		findingCount: z.number().int().nonnegative(),
		applicability: z.enum(["applicable", "not_applicable"]).optional(),
		reasonCode: z.string().nullable().optional(),
		coverageEffect: z.enum(["covered", "partial", "gap"]).optional(),
		artifactIds: z.array(z.string()).optional(),
	})
	.passthrough();
export type PersistedDependencyToolResult = z.infer<
	typeof persistedDependencyToolResultSchema
>;

export const persistedDependencyScanMetadataSchema = z
	.object({
		target: resolvedScanTargetSchema,
		diffManifestArtifactId: z.string(),
		diffToolApplicability: z.array(diffToolApplicabilitySchema),
		toolResults: z.array(z.unknown()),
	})
	.passthrough();

export const persistedDependencyFindingMetadataSchema = z
	.object({
		scanTarget: z
			.object({ targetDigest: z.string().regex(/^[a-f0-9]{64}$/) })
			.passthrough(),
		diffRelation: z.object({ kind: z.string() }).passthrough(),
	})
	.passthrough();

export const persistedDependencyToolRunMetadataSchema = z
	.object({
		scanTarget: z
			.object({ targetDigest: z.string().regex(/^[a-f0-9]{64}$/) })
			.passthrough(),
	})
	.passthrough();

export class SecurityAssessmentInputError extends Error {
	constructor(
		readonly code: string,
		message = code,
	) {
		super(message);
		this.name = "SecurityAssessmentInputError";
	}
}

export function parseDependencyToolResults(
	values: readonly unknown[],
): PersistedDependencyToolResult[] {
	return values.flatMap((value) => {
		const candidate = z
			.object({ toolId: z.string().optional() })
			.passthrough()
			.safeParse(value);
		if (
			!candidate.success ||
			candidate.data.toolId === undefined ||
			!DEPENDENCY_TOOL_IDS.includes(
				candidate.data.toolId as (typeof DEPENDENCY_TOOL_IDS)[number],
			)
		) {
			return [];
		}
		return [
			parseSecurityAssessmentInput(
				persistedDependencyToolResultSchema,
				value,
				"dependency_tool_result_invalid",
			),
		];
	});
}

export function parseSecurityAssessmentJson(
	value: string,
	code: string,
): unknown {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new SecurityAssessmentInputError(
			code,
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function parseSecurityAssessmentInput<T extends z.ZodType>(
	schema: T,
	value: unknown,
	code: string,
): z.infer<T> {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new SecurityAssessmentInputError(code, result.error.message);
	}
	return result.data;
}

export function failSecurityAssessmentInput(code: string): never {
	throw new SecurityAssessmentInputError(code);
}
