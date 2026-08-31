import { z } from "zod";

const providerIdSchema = z.enum([
	"focused-regressions",
	"scope-report",
	"individual-e2e",
	"repeatability-e2e",
	"full-profile-e2e",
	"failure-e2e",
	"qualification",
	"reviewed-baseline",
	"strict-verification",
	"closeout-receipt",
	"ci-receipt",
	"docs-closeout",
]);

const contractEntrySchema = z
	.object({
		id: z.string().min(1).max(20),
		condition: z.string().min(1).max(500),
		requiredProviderIds: z.array(providerIdSchema).min(1),
	})
	.strict();

const remediationCaseSchema = z
	.object({
		id: z.string().regex(/^A(?:10|[1-9])$/),
		condition: z.string().min(1).max(500),
		disposition: z.enum(["passed", "superseded"]),
		reason: z.string().min(1).max(200).nullable(),
		successorContract: z.string().min(1).max(300).nullable(),
		requiredProviderIds: z.array(providerIdSchema).min(1),
	})
	.strict();

export const scannerHardeningDodContractSchema = z
	.object({
		schemaVersion: z.literal(1),
		parentDod: z.array(contractEntrySchema).length(17),
		parentCloseout: z.array(contractEntrySchema).length(4),
		remediationDod: z.array(contractEntrySchema).length(21),
		remediationCases: z.array(remediationCaseSchema).length(10),
	})
	.strict()
	.superRefine((value, context) => {
		assertExactIds(
			value.parentDod.map((entry) => entry.id),
			ids("SH-DOD", 17),
			["parentDod"],
			context,
		);
		assertExactIds(
			value.parentCloseout.map((entry) => entry.id),
			ids("SH-CLOSE", 4),
			["parentCloseout"],
			context,
		);
		assertExactIds(
			value.remediationDod.map((entry) => entry.id),
			ids("RE-DOD", 21),
			["remediationDod"],
			context,
		);
		assertExactIds(
			value.remediationCases.map((entry) => entry.id),
			Array.from({ length: 10 }, (_, index) => `A${index + 1}`),
			["remediationCases"],
			context,
		);
		for (const entry of value.remediationCases) {
			const mayBeSuperseded = entry.id === "A1" || entry.id === "A3";
			if (
				mayBeSuperseded !== (entry.disposition === "superseded") ||
				(mayBeSuperseded &&
					(entry.reason !== "real_scan_target_fixed_to_todolist" ||
						entry.successorContract !==
							"spec/security-capability/todolist-scan-target.v1.json")) ||
				(!mayBeSuperseded &&
					(entry.reason !== null || entry.successorContract !== null))
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `invalid remediation disposition for ${entry.id}`,
					path: ["remediationCases", entry.id],
				});
			}
		}
	});

function ids(prefix: string, count: number) {
	return Array.from(
		{ length: count },
		(_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`,
	);
}

function assertExactIds(
	actual: string[],
	expected: string[],
	path: string[],
	context: z.RefinementCtx,
) {
	if (
		actual.length !== expected.length ||
		new Set(actual).size !== expected.length ||
		expected.some((id) => !actual.includes(id))
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: `required exact ID set: ${expected.join(",")}`,
			path,
		});
	}
}

export type ScannerHardeningDodContract = z.infer<
	typeof scannerHardeningDodContractSchema
>;

export const scannerExecutionRemediationCloseoutSchema = z
	.object({
		schemaVersion: z.literal(1),
		dod: z
			.array(
				z
					.object({
						id: z.string().regex(/^RE-DOD-(?:0[1-9]|1[0-9]|2[01])$/),
						requiredDisposition: z.literal("passed"),
					})
					.strict(),
			)
			.length(21),
		cases: z
			.array(
				z
					.object({
						id: z.string().regex(/^A(?:10|[1-9])$/),
						requiredDisposition: z.enum(["passed", "superseded"]),
						reason: z.string().min(1).max(200).nullable(),
						successorContract: z.string().min(1).max(300).nullable(),
					})
					.strict(),
			)
			.length(10),
	})
	.strict()
	.superRefine((value, context) => {
		assertExactIds(
			value.dod.map((entry) => entry.id),
			ids("RE-DOD", 21),
			["dod"],
			context,
		);
		assertExactIds(
			value.cases.map((entry) => entry.id),
			Array.from({ length: 10 }, (_, index) => `A${index + 1}`),
			["cases"],
			context,
		);
		for (const entry of value.cases) {
			const superseded = entry.id === "A1" || entry.id === "A3";
			if (
				superseded !== (entry.requiredDisposition === "superseded") ||
				(superseded &&
					(entry.reason !== "real_scan_target_fixed_to_todolist" ||
						entry.successorContract !==
							"spec/security-capability/todolist-scan-target.v1.json")) ||
				(!superseded &&
					(entry.reason !== null || entry.successorContract !== null))
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `invalid remediation closeout for ${entry.id}`,
					path: ["cases", entry.id],
				});
			}
		}
	});
