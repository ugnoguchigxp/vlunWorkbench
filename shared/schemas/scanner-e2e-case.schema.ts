import { z } from "zod";

/** Shared release contract: adding a scanner case requires an explicit review. */
export const SCANNER_E2E_CASE_IDS = [
	"gitleaks-source",
	"osv-manifest",
	"osv-installed-tree",
	"trivy-filesystem",
	"semgrep-source",
	"trivy-sbom",
	"trivy-image",
	"passive-dast",
	"nuclei-safe",
	"zap-baseline",
	"schemathesis-not-applicable",
	"schemathesis-readonly",
] as const;

export const scannerE2EModeSchema = z.enum([
	"source",
	"manifest",
	"installed_tree",
	"filesystem",
	"sbom",
	"image",
	"passive_dast",
	"runtime",
	"schema_not_applicable",
	"schema_readonly",
]);

export const scannerE2ECaseSchema = z.object({
	id: z
		.string()
		.regex(/^[a-z0-9][a-z0-9-]*$/)
		.max(100),
	scannerId: z.string().min(1).max(80),
	mode: scannerE2EModeSchema,
	profileId: z.string().min(1).max(120),
	stepId: z.string().min(1).max(160).nullable(),
	expectedArtifactRoles: z.array(z.string().min(1).max(80)).max(12),
	expectedVerdict: z.enum(["passed", "not_applicable"]),
});

export const scannerE2ECaseRegistrySchema = z.object({
	schemaVersion: z.literal(1),
	cases: z.array(scannerE2ECaseSchema).length(12),
});

export type ScannerE2ECase = z.infer<typeof scannerE2ECaseSchema>;
export type ScannerE2ECaseRegistry = z.infer<
	typeof scannerE2ECaseRegistrySchema
>;
