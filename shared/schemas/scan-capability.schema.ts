import { z } from "zod";

export const scanCapabilityIdSchema = z.enum([
	"secret_detection",
	"source_sast",
	"cicd_workflow_integrity",
	"sca",
	"iac_config",
	"sbom",
	"provenance_integrity",
	"artifact_container",
	"dynamic_tests",
	"sanitizer_fuzz",
	"passive_dast",
	"browser_client",
	"authentication_session",
	"api_schema_contract",
	"authorization_matrix",
	"active_dast",
	"business_logic",
	"remediation_retest",
]);
export type ScanCapabilityId = z.infer<typeof scanCapabilityIdSchema>;

export const scanCapabilityRequirementSchema = z.enum([
	"required",
	"required_if_applicable",
	"advisory",
]);
export type ScanCapabilityRequirement = z.infer<
	typeof scanCapabilityRequirementSchema
>;

export const scanCapabilityApplicabilitySchema = z.enum([
	"applicable",
	"not_applicable",
	"unknown",
]);
export type ScanCapabilityApplicability = z.infer<
	typeof scanCapabilityApplicabilitySchema
>;

export const scanCapabilityExecutionSchema = z.enum([
	"completed",
	"failed",
	"blocked",
	"not_executed",
	"cancelled",
]);
export type ScanCapabilityExecution = z.infer<
	typeof scanCapabilityExecutionSchema
>;

export const scanCapabilityRequirementEntrySchema = z.object({
	capabilityId: scanCapabilityIdSchema,
	requirement: scanCapabilityRequirementSchema,
});
export type ScanCapabilityRequirementEntry = z.infer<
	typeof scanCapabilityRequirementEntrySchema
>;

/** A profile may declare a capability only once. */
export const scanCapabilityRequirementsSchema = z
	.array(scanCapabilityRequirementEntrySchema)
	.max(18)
	.superRefine((entries, context) => {
		const seen = new Set<string>();
		for (const [index, entry] of entries.entries()) {
			if (seen.has(entry.capabilityId)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [index, "capabilityId"],
					message: "Capability requirements must not contain duplicates.",
				});
			}
			seen.add(entry.capabilityId);
		}
	});
export type ScanCapabilityRequirements = z.infer<
	typeof scanCapabilityRequirementsSchema
>;
