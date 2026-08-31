import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const todolistScannerBaselineSchema = z
	.object({
		schemaVersion: z.literal(1),
		reviewStatus: z.literal("reviewed"),
		reviewedAt: z.string().datetime(),
		reviewedEvidenceApplicationCommit: z.string().regex(/^[a-f0-9]{40}$/),
		sourceEvidenceSha256: sha256DigestSchema,
		target: z
			.object({
				repository: z.literal("todolist"),
				commit: z.string().regex(/^[a-f0-9]{40}$/),
				snapshotSha256: sha256DigestSchema,
			})
			.strict(),
		cases: z
			.array(
				z
					.object({
						caseId: z.string().min(1).max(100),
						findingCount: z.number().int().nonnegative(),
						normalizedEvidenceHash: sha256DigestSchema,
					})
					.strict(),
			)
			.length(13),
	})
	.strict()
	.superRefine((value, context) => {
		if (new Set(value.cases.map((entry) => entry.caseId)).size !== 13) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "baseline case IDs must be unique",
				path: ["cases"],
			});
		}
	});
