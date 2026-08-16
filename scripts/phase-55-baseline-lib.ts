import type { Phase54CloseoutReport } from "../shared/schemas/release-evidence.schema";
import type {
	Phase55BaselineEvidence,
	Phase55BaselineInputSnapshot,
} from "../shared/schemas/phase-55-evidence.schema";
import { z } from "zod";
import { sha256 } from "./phase-54-baseline-lib";

export const PHASE_54_CLOSEOUT_EVIDENCE_REF =
	".artifacts/phase-54-closeout/report.json";

export const PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF =
	"spec/evidence/phase-55-diagnostic-professional-capability.json";

export const PHASE_55_BASELINE_INPUT_PATHS = {
	benchmarkPolicy: "spec/security-capability/benchmark-policy.v1.json",
	scopeCatalog: "spec/security-capability/scope-catalog.v1.json",
	corpusLock: "spec/security-capability/corpora.lock.json",
	scannerManifestFile: "docker/toolbox/scanner-data/scanner-data-manifest.json",
	semgrepCatalog: "docker/toolbox/scanner-data/semgrep-rules/catalog.json",
} as const;

export const PHASE_55_PROFILE_DEFINITION_PATHS = [
	"api/modules/scans/optional-scanner-adapter-config.ts",
	"api/modules/scans/profiles.ts",
	"api/modules/scans/static-scan-profiles.ts",
	"api/modules/scans/zap-active-profiles.ts",
] as const;

export function phase55FileSetHash(
	files: ReadonlyArray<readonly [path: string, bytes: Uint8Array]>,
): `sha256:${string}` {
	return sha256(
		files
			.map(([filePath, bytes]) => `${filePath}\0${sha256(bytes)}`)
			.sort()
			.join("\n"),
	);
}

const phase55ReportedMetricSchema = z.object({
	category: z.literal("overall"),
	truePositive: z.number().int().nonnegative(),
	falseNegative: z.number().int().nonnegative(),
	trueNegative: z.number().int().nonnegative(),
	falsePositive: z.number().int().nonnegative(),
	recall: z.number().min(0).max(1).nullable(),
	precision: z.number().min(0).max(1).nullable(),
	falsePositiveRate: z.number().min(0).max(1).nullable(),
	score: z.number().min(-1).max(1).nullable(),
});

export const phase55ProfessionalReportSchema = z.object({
	releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
	claim: z.object({
		status: z.enum(["met", "not_met"]),
		unsupportedCapabilities: z.array(z.string().min(1)),
	}),
	gates: z.object({
		semgrep: z.boolean(),
		osv: z.boolean(),
		owasp: z.boolean(),
		juiceShop: z.boolean(),
		businessLogic: z.boolean(),
		endpointDiscovery: z.boolean(),
	}),
	metrics: z.object({
		owasp: phase55ReportedMetricSchema.nullable(),
		juiceShop: phase55ReportedMetricSchema.nullable(),
		businessLogic: phase55ReportedMetricSchema.nullable(),
		endpointDiscovery: z
			.object({
				frameworkCount: z.number().int().nonnegative(),
				truePositive: z.number().int().nonnegative(),
				falsePositive: z.number().int().nonnegative(),
				falseNegative: z.number().int().nonnegative(),
				recall: z.number().min(0).max(1).nullable(),
				precision: z.number().min(0).max(1).nullable(),
			})
			.nullable(),
	}),
});

export type Phase55ProfessionalReport = z.infer<
	typeof phase55ProfessionalReportSchema
>;

export function phase55ProfessionalSnapshot(
	report: Phase55ProfessionalReport,
): Omit<Phase55ProfessionalReport, "metrics"> & {
	metrics: {
		owasp: Omit<
			NonNullable<Phase55ProfessionalReport["metrics"]["owasp"]>,
			"category"
		> | null;
		juiceShop: Omit<
			NonNullable<Phase55ProfessionalReport["metrics"]["juiceShop"]>,
			"category"
		> | null;
		businessLogic: Omit<
			NonNullable<Phase55ProfessionalReport["metrics"]["businessLogic"]>,
			"category"
		> | null;
		endpointDiscovery: Phase55ProfessionalReport["metrics"]["endpointDiscovery"];
	};
} {
	return {
		...report,
		metrics: {
			owasp: stripMetricCategory(report.metrics.owasp),
			juiceShop: stripMetricCategory(report.metrics.juiceShop),
			businessLogic: stripMetricCategory(report.metrics.businessLogic),
			endpointDiscovery: report.metrics.endpointDiscovery,
		},
	};
}

export function phase55DiagnosticProfessionalCapability(
	report: Phase55ProfessionalReport,
	artifactHash: `sha256:${string}`,
): Phase55BaselineInputSnapshot["professionalCapability"] {
	const normalized = phase55ProfessionalSnapshot(report);
	return {
		source: "diagnostic",
		artifactHash,
		releaseCommit: normalized.releaseCommit,
		claimStatus: normalized.claim.status,
		unsupportedCapabilities: [
			...normalized.claim.unsupportedCapabilities,
		].sort(),
		gates: normalized.gates,
		metrics: normalized.metrics,
	};
}

export function assertPhase55DiagnosticSourceBindings(params: {
	inputSnapshot: Phase55BaselineInputSnapshot;
	sourceReport: Phase55ProfessionalReport;
	sourceArtifactHash: `sha256:${string}`;
}): void {
	if (
		params.inputSnapshot.professionalCapabilitySource.evidenceRef !==
		PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF
	) {
		throw new Error("phase_55_diagnostic_source_ref_mismatch");
	}
	if (
		params.inputSnapshot.professionalCapabilitySource.artifactHash !==
			params.sourceArtifactHash ||
		params.inputSnapshot.professionalCapability.artifactHash !==
			params.sourceArtifactHash
	) {
		throw new Error("phase_55_diagnostic_source_hash_mismatch");
	}
	if (
		JSON.stringify(params.inputSnapshot.professionalCapability) !==
		JSON.stringify(
			phase55DiagnosticProfessionalCapability(
				params.sourceReport,
				params.sourceArtifactHash,
			),
		)
	) {
		throw new Error("phase_55_diagnostic_source_projection_mismatch");
	}
}

function stripMetricCategory(
	metric: Phase55ProfessionalReport["metrics"]["owasp"],
) {
	if (!metric) return null;
	const { category: _category, ...values } = metric;
	return values;
}

export function assertPhase55StrictEntryBindings(params: {
	currentCommit: string;
	planningBaselineCommit: string;
	planningBaselineAncestor: boolean;
	currentSourceTreeHash: string;
	closeoutReport: Phase54CloseoutReport;
	professionalReportHash: `sha256:${string}`;
}): void {
	if (!params.planningBaselineAncestor) {
		throw new Error("phase_55_entry_baseline_not_ancestor");
	}
	if (params.closeoutReport.releaseCommit !== params.currentCommit) {
		throw new Error("phase_55_entry_closeout_commit_mismatch");
	}
	if (params.closeoutReport.sourceTreeHash !== params.currentSourceTreeHash) {
		throw new Error("phase_55_entry_source_tree_hash_mismatch");
	}
	if (
		params.closeoutReport.professionalReportHash !==
		params.professionalReportHash
	) {
		throw new Error("phase_55_entry_professional_report_hash_mismatch");
	}
	if (
		params.closeoutReport.verification.regressionVerifiedCommit !==
		params.currentCommit
	) {
		throw new Error("phase_55_entry_regression_commit_mismatch");
	}
}

export function assertPhase55TrackedInputBindings(params: {
	baseline: Phase55BaselineEvidence;
	inputSnapshot: Phase55BaselineInputSnapshot;
	inputSnapshotHash: `sha256:${string}`;
}): void {
	if (
		params.baseline.hashes.baselineInputSnapshot !== params.inputSnapshotHash
	) {
		throw new Error("phase_55_baseline_input_snapshot_hash_mismatch");
	}
	if (
		params.inputSnapshot.planningBaselineCommit !==
		params.baseline.planningBaselineCommit
	) {
		throw new Error("phase_55_baseline_input_snapshot_commit_mismatch");
	}
	if (
		params.inputSnapshot.profileInventory.profileDefinitionsHash !==
		params.baseline.hashes.profileDefinitions
	) {
		throw new Error("phase_55_baseline_profile_snapshot_hash_mismatch");
	}
	if (
		JSON.stringify(params.baseline.inventory.profileIds) !==
			JSON.stringify(params.inputSnapshot.profileInventory.profileIds) ||
		params.baseline.inventory.optionalSemgrepEnabledByDefault !==
			params.inputSnapshot.profileInventory.optionalSemgrepEnabledByDefault
	) {
		throw new Error("phase_55_baseline_profile_inventory_mismatch");
	}
	if (
		JSON.stringify(params.baseline.professionalCapability) !==
		JSON.stringify(params.inputSnapshot.professionalCapability)
	) {
		throw new Error("phase_55_baseline_professional_snapshot_mismatch");
	}
}
