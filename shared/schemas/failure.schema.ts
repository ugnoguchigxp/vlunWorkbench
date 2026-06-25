import { z } from "zod";

export const FAILURE_KINDS = [
	"tool_missing",
	"tool_timeout",
	"tool_exit_nonzero",
	"tool_output_missing",
	"tool_output_invalid",
	"normalizer_failed",
	"artifact_write_failed",
	"artifact_read_failed",
	"path_validation_failed",
	"ownership_check_failed",
	"llm_provider_unconfigured",
	"llm_provider_failed",
	"llm_output_invalid",
	"decision_validation_failed",
	"report_generation_failed",
	"docker_unavailable",
	"docker_image_missing",
	"sandbox_profile_rejected",
	"sandbox_timeout",
	"dynamic_profile_rejected",
	"dynamic_timeout",
	"dast_target_rejected",
	"dast_target_unreachable",
	"dast_redirect_out_of_scope",
	"browser_unavailable",
	"browser_timeout",
	"unknown_error",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export const failureSchema = z.object({
	ok: z.literal(false),
	kind: z.enum(FAILURE_KINDS),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});

export type FailureResponse = z.infer<typeof failureSchema>;

export function makeFailure(
	kind: FailureKind,
	message: string,
	details?: Record<string, unknown>,
): FailureResponse {
	return {
		ok: false,
		kind,
		message,
		details,
	};
}
