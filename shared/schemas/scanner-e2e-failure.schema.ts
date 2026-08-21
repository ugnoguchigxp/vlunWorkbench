import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const scannerE2EFailureCaseIdSchema = z.enum([
	"FI-01",
	"FI-02",
	"FI-03",
	"FI-04",
	"FI-05",
	"FI-06",
	"FI-07",
	"FI-08",
	"FI-09",
	"FI-10",
	"FI-11",
]);

const observationSchema = z
	.object({
		profileOutcome: z.enum(["blocked", "failed", "incomplete", "terminal"]),
		reasonCodes: z.array(z.string().min(1).max(100)).min(1).max(8),
		scannerProcessCount: z.number().int().nonnegative(),
		toolRunCount: z.number().int().nonnegative(),
		requestCount: z.number().int().nonnegative(),
		artifactCount: z.number().int().nonnegative(),
		canonicalFinalReportCount: z.number().int().nonnegative(),
		terminalRowCount: z.number().int().nonnegative(),
		cleanupCount: z.number().int().nonnegative(),
		existingBytesUnchanged: z.boolean(),
		covered: z.boolean(),
		automaticDownloadCount: z.number().int().nonnegative(),
	})
	.strict();

export const scannerE2EFailureContractSchema = z
	.object({
		schemaVersion: z.literal(1),
		cases: z
			.array(
				z
					.object({
						id: scannerE2EFailureCaseIdSchema,
						injection: z.string().min(1).max(200),
						productionEntryPoint: z.string().min(1).max(300),
						testFile: z.string().min(1).max(300),
						testNamePattern: z.string().min(1).max(300),
						expected: observationSchema,
					})
					.strict(),
			)
			.length(11),
	})
	.strict()
	.superRefine((value, context) => {
		const expectedIds = scannerE2EFailureCaseIdSchema.options;
		const actualIds = value.cases.map((entry) => entry.id);
		if (
			new Set(actualIds).size !== expectedIds.length ||
			expectedIds.some((id) => !actualIds.includes(id))
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "failure case IDs must be the exact FI-01..FI-11 set",
				path: ["cases"],
			});
		}
	});

const failureCaseEvidenceSchema = z
	.object({
		caseId: scannerE2EFailureCaseIdSchema,
		productionEntryPoint: z.string().min(1).max(300),
		injectionPoint: z.string().min(1).max(200),
		testFile: z.string().min(1).max(300),
		testNamePattern: z.string().min(1).max(300),
		argv: z.array(z.string().min(1).max(500)).min(1).max(12),
		exitCode: z.literal(0),
		stdout: z
			.object({
				path: z
					.string()
					.regex(/^failure-logs\/FI-(?:0[1-9]|1[01])\.stdout\.log$/),
				sha256: sha256DigestSchema,
				sizeBytes: z.number().int().nonnegative(),
			})
			.strict(),
		stderr: z
			.object({
				path: z
					.string()
					.regex(/^failure-logs\/FI-(?:0[1-9]|1[01])\.stderr\.log$/),
				sha256: sha256DigestSchema,
				sizeBytes: z.number().int().nonnegative(),
			})
			.strict(),
		observed: observationSchema,
	})
	.strict();

export const scannerE2EFailureEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		applicationCommit: z.string().regex(/^[a-f0-9]{40}$/),
		contractHash: sha256DigestSchema,
		generatedAt: z.string().datetime(),
		cases: z.array(failureCaseEvidenceSchema).length(11),
	})
	.strict();

export type ScannerE2EFailureContract = z.infer<
	typeof scannerE2EFailureContractSchema
>;
export type ScannerE2EFailureEvidence = z.infer<
	typeof scannerE2EFailureEvidenceSchema
>;
