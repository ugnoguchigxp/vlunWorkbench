import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const scannerE2EEvidenceSchema = z.object({
	schemaVersion: z.literal(1),
	caseId: z.string().min(1).max(100),
	contractHash: sha256DigestSchema,
	status: z.enum(["passed", "failed"]),
	verdict: z.enum(["passed", "not_applicable"]),
	executedAt: z.string().datetime(),
	scanRunId: z.string().uuid(),
	executionSurface: z.literal("profile_orchestrator"),
	executionPlanHash: sha256DigestSchema,
	preflightHash: sha256DigestSchema,
	sourceRevisionHash: sha256DigestSchema.nullable(),
	scannerManifestHash: sha256DigestSchema.nullable(),
	executionHash: sha256DigestSchema,
	/** Case-scoped scanner runtime identity; never includes the scanned project's revision. */
	scannerIdentityHash: sha256DigestSchema,
	diagnosticRunId: z.string().uuid(),
	diagnosticStatus: z.enum(["completed", "completed_with_limitations"]),
	canonicalFinalReportId: z.string().uuid(),
	canonicalFinalArtifactId: z.string().uuid(),
	artifactIds: z.array(z.string().uuid()).max(64),
	/**
	 * Artifact identities together with their persisted roles.  IDs alone cannot
	 * prove that a case emitted the role required by the release contract.
	 */
	artifacts: z
		.array(
			z.object({
				id: z.string().uuid(),
				kind: z.string().min(1).max(80),
			}),
		)
		.max(64),
	toolVersions: z.record(z.string(), z.string().min(1).max(200)),
	/** Browser-only DAST has no scanner container image; its browser identity is in scannerIdentityHash. */
	imageDigests: z.array(sha256DigestSchema).max(12),
	reasonCodes: z.array(z.string().min(1).max(100)).max(32),
});

export const scannerE2EEvidenceBundleSchema = z.object({
	schemaVersion: z.literal(1),
	evidence: z.array(scannerE2EEvidenceSchema).min(1).max(100),
});

export type ScannerE2EEvidence = z.infer<typeof scannerE2EEvidenceSchema>;
