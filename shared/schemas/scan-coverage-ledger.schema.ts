import { z } from "zod";
import {
	scanCapabilityApplicabilitySchema,
	scanCapabilityExecutionSchema,
	scanCapabilityIdSchema,
	scanCapabilityRequirementSchema,
} from "./scan-capability.schema";
import { scanReasonCodeSchema } from "./scan-reason-code.schema";
import { sha256DigestSchema } from "./security-capability.schema";

export const coverageEffectSchema = z.enum(["covered", "partial", "gap"]);
export type CoverageEffect = z.infer<typeof coverageEffectSchema>;

const evidenceRefSchema = z.string().min(1).max(200);

export const coverageLedgerEntrySchema = z
	.object({
		capabilityId: scanCapabilityIdSchema,
		requirement: scanCapabilityRequirementSchema,
		applicability: scanCapabilityApplicabilitySchema,
		execution: scanCapabilityExecutionSchema,
		coverageEffect: coverageEffectSchema,
		reasonCodes: z.array(scanReasonCodeSchema).max(32),
		evidenceRefs: z.array(evidenceRefSchema).max(32),
		limitations: z.array(z.string().min(1).max(200)).max(32),
	})
	.superRefine((entry, context) => {
		if (
			entry.applicability === "not_applicable" &&
			entry.evidenceRefs.length === 0
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["evidenceRefs"],
				message: "Not-applicable coverage requires evidence.",
			});
		}
	});
export type CoverageLedgerEntry = z.infer<typeof coverageLedgerEntrySchema>;

export const coverageLedgerSchema = z
	.object({
		schemaVersion: z.literal(1),
		planHash: sha256DigestSchema,
		derivedAt: z.string().datetime(),
		entries: z.array(coverageLedgerEntrySchema).max(17),
		summary: z.object({
			covered: z.number().int().nonnegative(),
			partial: z.number().int().nonnegative(),
			gap: z.number().int().nonnegative(),
		}),
		ledgerHash: sha256DigestSchema,
	})
	.superRefine((ledger, context) => {
		const seen = new Set<string>();
		for (const [index, entry] of ledger.entries.entries()) {
			if (seen.has(entry.capabilityId)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["entries", index, "capabilityId"],
					message: "Coverage ledger entries must not contain duplicates.",
				});
			}
			seen.add(entry.capabilityId);
		}
		const summary = ledger.entries.reduce(
			(total, entry) => ({
				...total,
				[entry.coverageEffect]: total[entry.coverageEffect] + 1,
			}),
			{ covered: 0, partial: 0, gap: 0 },
		);
		if (
			summary.covered !== ledger.summary.covered ||
			summary.partial !== ledger.summary.partial ||
			summary.gap !== ledger.summary.gap
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["summary"],
				message: "Coverage ledger summary must match its entries.",
			});
		}
	});
export type CoverageLedger = z.infer<typeof coverageLedgerSchema>;
