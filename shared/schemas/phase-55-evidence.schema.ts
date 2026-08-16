import { z } from "zod";
import {
	evidenceTextSchema,
	gitCommitSchema,
	phase54CloseoutInputHashesSchema,
	releaseEvidencePrivacySchema,
	repositoryRelativePathSchema,
} from "./release-evidence.schema";
import { sha256DigestSchema } from "./security-capability.schema";

const measuredMetricSchema = z.object({
	truePositive: z.number().int().nonnegative(),
	falseNegative: z.number().int().nonnegative(),
	trueNegative: z.number().int().nonnegative(),
	falsePositive: z.number().int().nonnegative(),
	recall: z.number().min(0).max(1).nullable(),
	precision: z.number().min(0).max(1).nullable(),
	falsePositiveRate: z.number().min(0).max(1).nullable(),
	score: z.number().min(-1).max(1).nullable(),
});

const endpointMetricSchema = z.object({
	frameworkCount: z.number().int().nonnegative(),
	truePositive: z.number().int().nonnegative(),
	falsePositive: z.number().int().nonnegative(),
	falseNegative: z.number().int().nonnegative(),
	recall: z.number().min(0).max(1).nullable(),
	precision: z.number().min(0).max(1).nullable(),
});

const professionalCapabilitySchema = z.object({
	source: z.enum(["authoritative", "diagnostic", "unavailable"]),
	artifactHash: sha256DigestSchema.nullable(),
	releaseCommit: gitCommitSchema.nullable(),
	claimStatus: z.enum(["met", "not_met", "unavailable"]),
	unsupportedCapabilities: z.array(evidenceTextSchema).max(100),
	gates: z.object({
		semgrep: z.boolean().nullable(),
		osv: z.boolean().nullable(),
		owasp: z.boolean().nullable(),
		juiceShop: z.boolean().nullable(),
		businessLogic: z.boolean().nullable(),
		endpointDiscovery: z.boolean().nullable(),
	}),
	metrics: z.object({
		owasp: measuredMetricSchema.nullable(),
		juiceShop: measuredMetricSchema.nullable(),
		businessLogic: measuredMetricSchema.nullable(),
		endpointDiscovery: endpointMetricSchema.nullable(),
	}),
});

const diagnosticProfessionalCapabilitySchema = professionalCapabilitySchema
	.extend({
		source: z.literal("diagnostic"),
		artifactHash: sha256DigestSchema,
		releaseCommit: gitCommitSchema,
		claimStatus: z.enum(["met", "not_met"]),
	})
	.superRefine((value, context) => {
		if (Object.values(value.gates).some((state) => state === null)) {
			context.addIssue({
				code: "custom",
				message: "phase_55_diagnostic_gate_state_required",
				path: ["gates"],
			});
		}
	});

export const phase55BaselineInputSnapshotSchema = z
	.object({
		schemaVersion: z.literal(1),
		evidenceKind: z.literal("phase_55_planning_input_snapshot"),
		capturedAt: z.string().datetime(),
		planningBaselineCommit: gitCommitSchema,
		profileInventory: z.object({
			profileIds: z.array(evidenceTextSchema).min(1).max(100),
			optionalSemgrepEnabledByDefault: z.literal(false),
			profileDefinitionsHash: sha256DigestSchema,
		}),
		professionalCapabilitySource: z.object({
			evidenceRef: repositoryRelativePathSchema,
			artifactHash: sha256DigestSchema,
		}),
		professionalCapability: diagnosticProfessionalCapabilitySchema,
		privacy: releaseEvidencePrivacySchema,
	})
	.superRefine((value, context) => {
		if (
			value.professionalCapabilitySource.artifactHash !==
			value.professionalCapability.artifactHash
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_diagnostic_source_hash_must_match_snapshot",
				path: ["professionalCapabilitySource", "artifactHash"],
			});
		}
		for (const [path, items] of [
			[["profileInventory", "profileIds"], value.profileInventory.profileIds],
			[
				["professionalCapability", "unsupportedCapabilities"],
				value.professionalCapability.unsupportedCapabilities,
			],
		] as const) {
			const canonical = [...new Set(items)].sort();
			if (JSON.stringify(items) !== JSON.stringify(canonical)) {
				context.addIssue({
					code: "custom",
					message: "phase_55_input_snapshot_array_must_be_sorted_and_unique",
					path: [...path],
				});
			}
		}
	});

export const phase55BaselineEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		phase: z.literal("55"),
		evidenceKind: z.literal("planning_baseline"),
		capturedAt: z.string().datetime(),
		owner: evidenceTextSchema,
		planningBaselineCommit: gitCommitSchema,
		phase54Closeout: z.object({
			evidenceRef: repositoryRelativePathSchema,
			availability: z.enum(["verified", "missing"]),
			gateState: z.enum(["passed", "blocked"]),
			reasonCode: z.enum([
				"phase_54_authoritative_closeout_verified",
				"phase_54_authoritative_closeout_missing",
			]),
			reportHash: sha256DigestSchema.nullable(),
			releaseCommit: gitCommitSchema.nullable(),
			inputHashes: phase54CloseoutInputHashesSchema.nullable(),
			professionalReportHash: sha256DigestSchema.nullable(),
		}),
		productionSliceEntry: z.object({
			state: z.enum(["passed", "blocked"]),
			allowed: z.boolean(),
			reasonCode: z.enum([
				"phase_54_authoritative_closeout_verified",
				"phase_54_authoritative_closeout_missing",
			]),
		}),
		inventory: z.object({
			testFiles: z.number().int().positive(),
			ownedSemgrepRules: z.number().int().nonnegative(),
			semgrepLanguages: z.array(evidenceTextSchema).max(100),
			osvEcosystems: z.array(evidenceTextSchema).max(100),
			profileIds: z.array(evidenceTextSchema).min(1).max(100),
			optionalSemgrepEnabledByDefault: z.boolean(),
		}),
		professionalCapability: professionalCapabilitySchema,
		hashes: z.object({
			benchmarkPolicy: sha256DigestSchema,
			scopeCatalog: sha256DigestSchema,
			corpusLock: sha256DigestSchema,
			scannerManifestFile: sha256DigestSchema,
			scannerManifest: sha256DigestSchema,
			semgrepCatalog: sha256DigestSchema,
			profileDefinitions: sha256DigestSchema,
			baselineInputSnapshot: sha256DigestSchema,
		}),
		privacy: releaseEvidencePrivacySchema,
		residualRisk: evidenceTextSchema,
	})
	.superRefine((value, context) => {
		const sortedUniqueFields = [
			["inventory", "semgrepLanguages", value.inventory.semgrepLanguages],
			["inventory", "osvEcosystems", value.inventory.osvEcosystems],
			["inventory", "profileIds", value.inventory.profileIds],
			[
				"professionalCapability",
				"unsupportedCapabilities",
				value.professionalCapability.unsupportedCapabilities,
			],
		] as const;
		for (const [parent, field, items] of sortedUniqueFields) {
			const canonical = [...new Set(items)].sort();
			if (JSON.stringify(items) !== JSON.stringify(canonical)) {
				context.addIssue({
					code: "custom",
					message: "phase_55_baseline_array_must_be_sorted_and_unique",
					path: [parent, field],
				});
			}
		}

		const closeoutVerified = value.phase54Closeout.availability === "verified";
		if (
			closeoutVerified !== (value.phase54Closeout.gateState === "passed") ||
			closeoutVerified !== value.productionSliceEntry.allowed ||
			closeoutVerified !== (value.productionSliceEntry.state === "passed")
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_entry_state_must_follow_phase_54_closeout",
				path: ["productionSliceEntry"],
			});
		}
		const expectedReason = closeoutVerified
			? "phase_54_authoritative_closeout_verified"
			: "phase_54_authoritative_closeout_missing";
		if (
			value.phase54Closeout.reasonCode !== expectedReason ||
			value.productionSliceEntry.reasonCode !== expectedReason
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_entry_reason_must_follow_phase_54_closeout",
				path: ["productionSliceEntry", "reasonCode"],
			});
		}
		const closeoutValues = [
			value.phase54Closeout.reportHash,
			value.phase54Closeout.releaseCommit,
			value.phase54Closeout.inputHashes,
			value.phase54Closeout.professionalReportHash,
		];
		if (
			(closeoutVerified && closeoutValues.some((item) => item === null)) ||
			(!closeoutVerified && closeoutValues.some((item) => item !== null))
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_closeout_fields_must_follow_availability",
				path: ["phase54Closeout"],
			});
		}
		if (
			closeoutVerified &&
			value.phase54Closeout.releaseCommit !== value.planningBaselineCommit
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_closeout_commit_must_match_planning_baseline",
				path: ["phase54Closeout", "releaseCommit"],
			});
		}

		const professional = value.professionalCapability;
		const unavailable = professional.source === "unavailable";
		const professionalValues = [
			professional.artifactHash,
			professional.releaseCommit,
			...Object.values(professional.gates),
			...Object.values(professional.metrics),
		];
		if (
			(unavailable &&
				(professional.claimStatus !== "unavailable" ||
					professionalValues.some((item) => item !== null))) ||
			(!unavailable &&
				(professional.claimStatus === "unavailable" ||
					professional.artifactHash === null ||
					professional.releaseCommit === null ||
					Object.values(professional.gates).some((item) => item === null)))
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_professional_evidence_source_inconsistent",
				path: ["professionalCapability"],
			});
		}
		if (
			professional.source === "authoritative" &&
			(!closeoutVerified ||
				professional.artifactHash !==
					value.phase54Closeout.professionalReportHash ||
				professional.releaseCommit !== value.planningBaselineCommit)
		) {
			context.addIssue({
				code: "custom",
				message: "phase_55_authoritative_metrics_require_closeout_binding",
				path: ["professionalCapability", "source"],
			});
		}
	});

export const phase55EntryReportSchema = z.object({
	schemaVersion: z.literal(1),
	evidenceKind: z.literal("phase_55_strict_entry"),
	generatedAt: z.string().datetime(),
	releaseCommit: gitCommitSchema,
	planningBaselineCommit: gitCommitSchema,
	phase54CloseoutReportHash: sha256DigestSchema,
	phase54ProfessionalReportHash: sha256DigestSchema,
	phase55BaselineHash: sha256DigestSchema,
	phase55BaselineInputSnapshotHash: sha256DigestSchema,
	phase55DiagnosticProfessionalEvidenceHash: sha256DigestSchema,
	phase54InputHashes: phase54CloseoutInputHashesSchema,
	verification: z.object({
		phase54FullCloseoutCompleted: z.literal(true),
		baselineVerified: z.literal(true),
		planningBaselineAncestor: z.literal(true),
		sameCommitCloseout: z.literal(true),
	}),
	privacy: releaseEvidencePrivacySchema,
});

export type Phase55BaselineEvidence = z.infer<
	typeof phase55BaselineEvidenceSchema
>;
export type Phase55BaselineInputSnapshot = z.infer<
	typeof phase55BaselineInputSnapshotSchema
>;
export type Phase55EntryReport = z.infer<typeof phase55EntryReportSchema>;
