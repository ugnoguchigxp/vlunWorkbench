import { z } from "zod";

export const scanReasonCodeCategorySchema = z.enum([
	"applicability",
	"readiness",
	"policy",
	"execution",
	"cleanup",
	"coverage",
]);
export type ScanReasonCodeCategory = z.infer<
	typeof scanReasonCodeCategorySchema
>;

export const scanReasonCodeSchema = z.enum([
	"schema_not_found",
	"authentication_required",
	"auth_context_missing",
	"image_input_not_provided",
	"image_source_unreachable",
	"target_start_not_supported",
	"target_unreachable_from_container",
	"preflight_failed",
	"tool_unavailable",
	"policy_rejected",
	"roe_not_approved",
	"invalid_structured_output",
	"timed_out",
	"execution_failed",
	"cleanup_failed",
	"resource_quarantined",
	"crawl_budget_exhausted",
	"role_matrix_partial",
	"source_sast_not_executed",
	"source_sast_no_supported_files",
	"source_sast_ruleset_unavailable",
	"source_sast_adapter_unavailable",
	"capability_not_integrated",
	"no_changed_files",
	"no_relevant_files",
	"no_dependency_manifest_changed",
	"diff_target_not_supported",
]);
export type ScanReasonCode = z.infer<typeof scanReasonCodeSchema>;

export const scanReasonCodeDefinitionSchema = z.object({
	category: scanReasonCodeCategorySchema,
	coverageEffect: z.enum(["covered", "partial", "gap"]),
	action: z.string().min(1).max(100),
	messageKey: z.string().regex(/^[a-z][a-z0-9_]{2,99}$/),
});
export type ScanReasonCodeDefinition = z.infer<
	typeof scanReasonCodeDefinitionSchema
>;

export const scanReasonCodeRegistry = {
	schema_not_found: {
		category: "applicability",
		coverageEffect: "gap",
		action: "configure_api_schema",
		messageKey: "schema_not_found",
	},
	authentication_required: {
		category: "readiness",
		coverageEffect: "gap",
		action: "provide_auth_context",
		messageKey: "authentication_required",
	},
	auth_context_missing: {
		category: "readiness",
		coverageEffect: "gap",
		action: "provide_auth_context",
		messageKey: "auth_context_missing",
	},
	image_input_not_provided: {
		category: "readiness",
		coverageEffect: "gap",
		action: "provide_image_input",
		messageKey: "image_input_not_provided",
	},
	image_source_unreachable: {
		category: "readiness",
		coverageEffect: "gap",
		action: "make_image_source_reachable",
		messageKey: "image_source_unreachable",
	},
	target_start_not_supported: {
		category: "applicability",
		coverageEffect: "gap",
		action: "configure_target_start_plan",
		messageKey: "target_start_not_supported",
	},
	target_unreachable_from_container: {
		category: "readiness",
		coverageEffect: "gap",
		action: "configure_container_target_gateway",
		messageKey: "target_unreachable_from_container",
	},
	preflight_failed: {
		category: "readiness",
		coverageEffect: "gap",
		action: "resolve_preflight_blockers",
		messageKey: "preflight_failed",
	},
	tool_unavailable: {
		category: "readiness",
		coverageEffect: "gap",
		action: "install_or_pin_tool",
		messageKey: "tool_unavailable",
	},
	policy_rejected: {
		category: "policy",
		coverageEffect: "gap",
		action: "review_scan_policy",
		messageKey: "policy_rejected",
	},
	roe_not_approved: {
		category: "policy",
		coverageEffect: "gap",
		action: "approve_rules_of_engagement",
		messageKey: "roe_not_approved",
	},
	invalid_structured_output: {
		category: "execution",
		coverageEffect: "gap",
		action: "inspect_tool_output",
		messageKey: "invalid_structured_output",
	},
	timed_out: {
		category: "execution",
		coverageEffect: "gap",
		action: "review_timeout_and_budget",
		messageKey: "timed_out",
	},
	execution_failed: {
		category: "execution",
		coverageEffect: "gap",
		action: "inspect_execution_failure",
		messageKey: "execution_failed",
	},
	cleanup_failed: {
		category: "cleanup",
		coverageEffect: "gap",
		action: "run_manual_cleanup",
		messageKey: "cleanup_failed",
	},
	resource_quarantined: {
		category: "cleanup",
		coverageEffect: "gap",
		action: "recover_quarantined_resource",
		messageKey: "resource_quarantined",
	},
	crawl_budget_exhausted: {
		category: "coverage",
		coverageEffect: "partial",
		action: "review_crawl_budget",
		messageKey: "crawl_budget_exhausted",
	},
	role_matrix_partial: {
		category: "coverage",
		coverageEffect: "partial",
		action: "provide_missing_roles",
		messageKey: "role_matrix_partial",
	},
	source_sast_not_executed: {
		category: "coverage",
		coverageEffect: "gap",
		action: "run_source_sast",
		messageKey: "source_sast_not_executed",
	},
	source_sast_no_supported_files: {
		category: "applicability",
		coverageEffect: "covered",
		action: "provide_supported_source_files",
		messageKey: "source_sast_no_supported_files",
	},
	source_sast_ruleset_unavailable: {
		category: "readiness",
		coverageEffect: "gap",
		action: "install_or_pin_ruleset",
		messageKey: "source_sast_ruleset_unavailable",
	},
	source_sast_adapter_unavailable: {
		category: "readiness",
		coverageEffect: "gap",
		action: "install_or_pin_tool",
		messageKey: "source_sast_adapter_unavailable",
	},
	capability_not_integrated: {
		category: "coverage",
		coverageEffect: "gap",
		action: "integrate_capability",
		messageKey: "capability_not_integrated",
	},
	no_changed_files: {
		category: "applicability",
		coverageEffect: "covered",
		action: "select_changed_files",
		messageKey: "no_changed_files",
	},
	no_relevant_files: {
		category: "applicability",
		coverageEffect: "covered",
		action: "select_relevant_files",
		messageKey: "no_relevant_files",
	},
	no_dependency_manifest_changed: {
		category: "applicability",
		coverageEffect: "covered",
		action: "select_dependency_manifest",
		messageKey: "no_dependency_manifest_changed",
	},
	diff_target_not_supported: {
		category: "applicability",
		coverageEffect: "gap",
		action: "select_supported_target",
		messageKey: "diff_target_not_supported",
	},
} as const satisfies Record<ScanReasonCode, ScanReasonCodeDefinition>;

export function getScanReasonCodeDefinition(
	code: ScanReasonCode,
): ScanReasonCodeDefinition {
	return scanReasonCodeRegistry[code];
}
