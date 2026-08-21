import { z } from "zod";
import {
	scanCapabilityIdSchema,
	scanCapabilityRequirementSchema,
} from "./scan-capability.schema";
import { sha256DigestSchema } from "./security-capability.schema";

export const professionalRunGroupChildKindSchema = z.enum([
	"profile",
	"dynamic",
	"dast",
	"active",
	"authorization",
	"business",
	"reproduction",
	"attestation",
]);
export type ProfessionalRunGroupChildKind = z.infer<
	typeof professionalRunGroupChildKindSchema
>;

export const professionalRunGroupPlanSchema = z
	.object({
		schemaVersion: z.literal(1),
		parentScanRunId: z.string().uuid(),
		executionPlanHash: sha256DigestSchema,
		catalogEntryHash: sha256DigestSchema,
		createdAt: z.string().datetime(),
		children: z
			.array(
				z.object({
					childId: z.string().min(1).max(160),
					kind: professionalRunGroupChildKindSchema,
					capabilityId: scanCapabilityIdSchema,
					requirement: scanCapabilityRequirementSchema,
					inputBindingHash: sha256DigestSchema,
					policyHash: sha256DigestSchema,
					cleanupRequired: z.boolean(),
				}),
			)
			.min(1)
			.max(17),
		humanReview: z.object({
			required: z.literal(true),
			status: z.literal("pending"),
		}),
		planHash: sha256DigestSchema,
	})
	.superRefine((value, context) => {
		const ids = new Set<string>();
		for (const [index, child] of value.children.entries()) {
			if (ids.has(child.childId)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["children", index, "childId"],
					message: "Professional run group child IDs must be unique.",
				});
			}
			ids.add(child.childId);
		}
	});
export type ProfessionalRunGroupPlan = z.infer<
	typeof professionalRunGroupPlanSchema
>;

export const professionalRunGroupAssessmentSchema = z.object({
	schemaVersion: z.literal(1),
	parentScanRunId: z.string().uuid(),
	planHash: sha256DigestSchema,
	ledgerHash: sha256DigestSchema,
	technicalCompletion: z.boolean(),
	humanApproval: z.literal("pending"),
	blockingCapabilityIds: z.array(scanCapabilityIdSchema),
	cleanupIncompleteChildIds: z.array(z.string().min(1).max(160)),
});
export type ProfessionalRunGroupAssessment = z.infer<
	typeof professionalRunGroupAssessmentSchema
>;
