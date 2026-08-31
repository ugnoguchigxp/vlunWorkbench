import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const scannerHardeningCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const scannerHardeningRepositoryPathSchema = z
	.string()
	.min(1)
	.max(500)
	.superRefine((value, context) => {
		if (
			value.startsWith("/") ||
			value.includes("\\") ||
			value.split("/").some((segment) => segment === "" || segment === "..")
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "path must be a normalized repository-relative path",
			});
		}
	});

export const scannerHardeningScopePatternSchema = z
	.string()
	.min(1)
	.max(500)
	.superRefine((value, context) => {
		const exact = value.endsWith("/**") ? value.slice(0, -3) : value;
		if (
			exact.length === 0 ||
			exact.includes("*") ||
			exact.startsWith("/") ||
			exact.includes("\\") ||
			exact.split("/").some((segment) => segment === "" || segment === "..")
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"pattern must be an exact repository-relative path or end with /**",
			});
		}
	});

export const scannerHardeningScopeClassificationSchema = z.enum([
	"scanner_hardening",
	"separate_ui",
	"generated",
]);

export const scannerHardeningScopeReasonCodeSchema = z.enum([
	"archive_move",
	"generated_security_capability",
	"phase_56_ui_contract",
	"scanner_contract",
	"scanner_documentation",
	"scanner_evidence",
	"scanner_production",
	"scanner_test",
]);

const inventoryBaseSchema = z
	.object({
		path: scannerHardeningRepositoryPathSchema,
		classification: scannerHardeningScopeClassificationSchema,
		reasonCode: scannerHardeningScopeReasonCodeSchema,
	})
	.strict();

export const scannerHardeningScopeInventoryEntrySchema = z.discriminatedUnion(
	"status",
	[
		inventoryBaseSchema.extend({
			status: z.enum(["added", "modified", "deleted"]),
		}),
		inventoryBaseSchema.extend({
			status: z.literal("renamed"),
			previousPath: scannerHardeningRepositoryPathSchema,
			similarity: z.number().int().min(0).max(100),
		}),
	],
);

const generatedPathSchema = z
	.object({
		path: scannerHardeningRepositoryPathSchema,
		command: z.array(z.string().min(1).max(200)).min(1).max(16),
	})
	.strict();

export const scannerHardeningCloseoutScopeContractSchema = z
	.object({
		schemaVersion: z.literal(1),
		changeSetBaseCommit: scannerHardeningCommitSchema,
		planningBaselineCommit: scannerHardeningCommitSchema,
		expectedBaselineChangeCount: z.number().int().positive(),
		baselineInventory: z
			.array(scannerHardeningScopeInventoryEntrySchema)
			.min(1)
			.max(500),
		allowedResidualPatterns: z
			.array(scannerHardeningScopePatternSchema)
			.min(1)
			.max(256),
		excludedResidualPatterns: z
			.array(scannerHardeningScopePatternSchema)
			.min(1)
			.max(64),
		generatedPaths: z.array(generatedPathSchema).max(32),
		requiredResidualPaths: z
			.array(scannerHardeningRepositoryPathSchema)
			.min(1)
			.max(128),
	})
	.strict()
	.superRefine((value, context) => {
		const inventoryKeys = value.baselineInventory.map(inventoryEntryKey);
		if (
			new Set(inventoryKeys).size !== inventoryKeys.length ||
			value.baselineInventory.length !== value.expectedBaselineChangeCount
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"baseline inventory must be unique and match its declared count",
			});
		}
		for (const [name, paths] of [
			["allowedResidualPatterns", value.allowedResidualPatterns],
			["excludedResidualPatterns", value.excludedResidualPatterns],
			["requiredResidualPaths", value.requiredResidualPaths],
		] as const) {
			if (new Set(paths).size !== paths.length) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `${name} must not contain duplicates`,
				});
			}
		}
		const generated = value.generatedPaths.map((entry) => entry.path);
		if (new Set(generated).size !== generated.length) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "generated paths must not contain duplicates",
			});
		}
	});

export const scannerHardeningCloseoutScopeReportSchema = z
	.object({
		schemaVersion: z.literal(1),
		changeSetBaseCommit: scannerHardeningCommitSchema,
		planningBaselineCommit: scannerHardeningCommitSchema,
		candidateCommit: scannerHardeningCommitSchema,
		contractHash: sha256DigestSchema,
		baselineChangeCount: z.number().int().nonnegative(),
		residualChangeCount: z.number().int().nonnegative(),
		scannerPathCount: z.number().int().nonnegative(),
		separatePathCount: z.number().int().nonnegative(),
		generatedPathCount: z.number().int().nonnegative(),
		baselineMismatches: z.array(z.string().min(1).max(1_100)).max(1_000),
		unknownPaths: z.array(scannerHardeningRepositoryPathSchema).max(500),
		missingRequiredPaths: z
			.array(scannerHardeningRepositoryPathSchema)
			.max(128),
		scannerScopeDigest: sha256DigestSchema,
		separateScopeDigest: sha256DigestSchema,
		generatedScopeDigest: sha256DigestSchema,
		cleanCheckout: z.boolean(),
		ok: z.boolean(),
	})
	.strict();

export type ScannerHardeningCloseoutScopeContract = z.infer<
	typeof scannerHardeningCloseoutScopeContractSchema
>;
export type ScannerHardeningScopeInventoryEntry = z.infer<
	typeof scannerHardeningScopeInventoryEntrySchema
>;
export type ScannerHardeningCloseoutScopeReport = z.infer<
	typeof scannerHardeningCloseoutScopeReportSchema
>;

export function inventoryEntryKey(
	entry: ScannerHardeningScopeInventoryEntry,
): string {
	return entry.status === "renamed"
		? `${entry.status}:${entry.previousPath}:${entry.path}:${entry.similarity}`
		: `${entry.status}:${entry.path}`;
}
