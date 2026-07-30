import { z } from "zod";

export const verificationKindSchema = z.enum([
	"scanner_recheck",
	"runtime_observation",
	"exploit_reproduction",
]);
export const scannerObservationOutcomeSchema = z.enum([
	"observed",
	"not_observed",
	"inconclusive",
	"error",
]);
export const exploitReproductionOutcomeSchema = z.enum([
	"reproduced",
	"not_reproduced",
	"inconclusive",
	"error",
]);
export const evidenceStrengthSchema = z.enum([
	"scanner_signal",
	"runtime_observation",
	"impact_demonstrated",
]);

export const verificationResultSchema = z
	.object({
		kind: verificationKindSchema,
		outcome: z.string(),
		evidenceStrength: evidenceStrengthSchema,
		evidenceRefs: z.array(z.string().min(1).max(200)).min(1).max(100),
	})
	.superRefine((value, ctx) => {
		const valid =
			value.kind === "exploit_reproduction"
				? exploitReproductionOutcomeSchema.safeParse(value.outcome).success
				: scannerObservationOutcomeSchema.safeParse(value.outcome).success;
		if (!valid) {
			ctx.addIssue({
				code: "custom",
				path: ["outcome"],
				message: `Outcome is invalid for ${value.kind}`,
			});
		}
		const expectedStrength =
			value.kind === "scanner_recheck"
				? "scanner_signal"
				: value.kind === "runtime_observation"
					? "runtime_observation"
					: "impact_demonstrated";
		if (value.evidenceStrength !== expectedStrength) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceStrength"],
				message: `Evidence strength must be ${expectedStrength}`,
			});
		}
	});

export type VerificationKind = z.infer<typeof verificationKindSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export function legacyOutcomeToObservation(
	outcome: string | null,
): string | null {
	if (outcome === "reproduced") return "observed";
	if (outcome === "not_reproduced") return "not_observed";
	return outcome;
}

export function observationOutcomeToLegacy(
	outcome: string | null,
): string | null {
	if (outcome === "observed") return "reproduced";
	if (outcome === "not_observed") return "not_reproduced";
	return outcome;
}
