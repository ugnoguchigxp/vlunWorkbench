import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	createDatabaseBackup,
	verifyBenchmarkDatabaseBackupContents,
	verifyBenchmarkOnlyDatabaseBackup,
	verifyDatabaseBackup,
} from "../api/operations/database-backup";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import {
	phase54CloseoutReportSchema,
	phase54CloseoutSnapshotSchema,
} from "../shared/schemas/release-evidence.schema";
import { assertEvidencePrivacy } from "./phase-54-baseline-lib";
import {
	readMetricArtifact,
	verifyJuiceShopArtifactIntegrity,
	verifyOwaspArtifactIntegrity,
	isAuthoritativeJuiceShopReleaseRun,
} from "./professional-capability-artifact-verifier";
import {
	assertOwaspMetricsPassReleasePolicy,
	owaspReleasePolicySchema,
} from "./benchmark/owasp-release-policy";
import { sha256File } from "./benchmark/benchmark-input-provenance";
import { owaspBenchmarkInputHash } from "./benchmark/owasp-benchmark-input";
import {
	assertPhase54CloseoutBindings,
	assertPhase54CloseoutEvidenceHashesStable,
	assertPhase54CloseoutEvidencePrivacy,
	assertPhase54CloseoutSnapshotStable,
	assertPhase54RegressionVerifiedCommit,
	capturePhase54CloseoutEvidenceHashes,
	capturePhase54CloseoutSnapshot,
	phase54OwaspRunReceiptSchema,
	phase54ProfessionalReportSchema,
} from "./phase-54-closeout-lib";

const MAX_PHASE54_DATABASE_BACKUP_BYTES = 64 * 1024 * 1024;

const paths = {
	snapshot: ".artifacts/phase-54-closeout/input-snapshot.json",
	report: ".artifacts/phase-54-closeout/report.json",
	owaspMetrics: ".artifacts/benchmark/owasp-metrics.json",
	owaspReceipt: ".artifacts/benchmark/owasp-run.json",
	juiceMetrics: ".artifacts/benchmark/juice-shop-metrics.json",
	juiceRun: ".artifacts/benchmark/juice-shop-run.json",
	professionalReport: ".artifacts/professional-capability-release-report.json",
} as const;

const databaseUrl = process.env.VULN_WORKBENCH_BENCHMARK_DATABASE_URL;
const toolboxImageDigest = process.env.VULN_WORKBENCH_TOOLBOX_IMAGE_DIGEST;
const databaseBackupPath =
	process.env.VULN_WORKBENCH_BENCHMARK_DATABASE_BACKUP_PATH;
const regressionVerifiedCommit =
	process.env.VULN_WORKBENCH_PHASE54_REGRESSION_VERIFIED_COMMIT;
if (!databaseUrl) throw new Error("phase_54_closeout_database_required");
if (!toolboxImageDigest)
	throw new Error("phase_54_closeout_toolbox_digest_required");
if (!databaseBackupPath)
	throw new Error("phase_54_closeout_database_backup_path_required");
assertPhase54RegressionVerifiedCommit(regressionVerifiedCommit);
if (await lstat(databaseBackupPath).catch(() => null)) {
	throw new Error("phase_54_closeout_database_backup_reuse_rejected");
}

await assertPhase54CloseoutEvidencePrivacy();
const evidenceHashesBefore = await capturePhase54CloseoutEvidenceHashes();

const [
	snapshot,
	currentSnapshot,
	policy,
	corpusLock,
	manifest,
	owaspArtifact,
	juiceArtifact,
	owaspReceipt,
	professionalReport,
] = await Promise.all([
	readJson(paths.snapshot).then((value) =>
		phase54CloseoutSnapshotSchema.parse(value),
	),
	capturePhase54CloseoutSnapshot(),
	readJson("spec/security-capability/benchmark-policy.v1.json").then((value) =>
		owaspReleasePolicySchema.parse(value),
	),
	readJsonObject("spec/security-capability/corpora.lock.json"),
	loadScannerDataManifest(),
	requireMetricArtifact(paths.owaspMetrics),
	requireMetricArtifact(paths.juiceMetrics),
	readJson(paths.owaspReceipt).then((value) =>
		phase54OwaspRunReceiptSchema.parse(value),
	),
	readJson(paths.professionalReport).then((value) =>
		phase54ProfessionalReportSchema.parse(value),
	),
]);
assertPhase54RegressionVerifiedCommit(
	regressionVerifiedCommit,
	currentSnapshot.releaseCommit,
);

await verifyOwaspArtifactIntegrity({
	artifact: owaspArtifact,
	manifestHash: manifest.manifestHash,
	corpusLock,
});
assertOwaspMetricsPassReleasePolicy(owaspArtifact.metrics, policy);
if (owaspReceipt.inputHash !== owaspBenchmarkInputHash(owaspArtifact)) {
	throw new Error("phase_54_closeout_owasp_input_hash_mismatch");
}
const juiceReport = await verifyJuiceShopArtifactIntegrity({
	artifact: juiceArtifact,
	manifestHash: manifest.manifestHash,
	corpusLock,
});
if (
	!isAuthoritativeJuiceShopReleaseRun({
		report: juiceReport,
		releaseCommit: currentSnapshot.releaseCommit,
		workingTreeClean: currentSnapshot.cleanCheckout,
	})
) {
	throw new Error("phase_54_closeout_juice_shop_not_authoritative");
}
assertPhase54CloseoutBindings({
	snapshot,
	current: currentSnapshot,
	releaseCommit: currentSnapshot.releaseCommit,
	owaspArtifact,
	owaspReceipt,
	juiceArtifact,
	juiceReport,
	professionalReport,
});
await createDatabaseBackup(databaseUrl, databaseBackupPath);
const benchmarkDatabaseBackupHashBefore = await sha256File(databaseBackupPath);
await verifyDatabaseBackup(databaseBackupPath);
if (
	!owaspArtifact.corpusDigest ||
	!owaspArtifact.outputHash ||
	!owaspArtifact.rawScannerArtifactHash
) {
	throw new Error("phase_54_closeout_owasp_database_binding_missing");
}
verifyBenchmarkDatabaseBackupContents(databaseBackupPath, {
	runId: owaspReceipt.runId,
	releaseCommit: currentSnapshot.releaseCommit,
	manifestHash: manifest.manifestHash,
	policyVersion: policy.policyVersion,
	toolboxImageDigest,
	runInputHash: owaspReceipt.inputHash,
	corpusDigest: owaspArtifact.corpusDigest,
	outputHash: owaspArtifact.outputHash,
	metrics: owaspArtifact.metrics,
});
verifyBenchmarkOnlyDatabaseBackup(databaseBackupPath);
const backupMetadata = await lstat(databaseBackupPath);
if (
	!backupMetadata.isFile() ||
	backupMetadata.nlink !== 1 ||
	backupMetadata.size > MAX_PHASE54_DATABASE_BACKUP_BYTES
) {
	throw new Error("phase_54_closeout_database_backup_bounds_invalid");
}
const finalSnapshot = await capturePhase54CloseoutSnapshot();
assertPhase54CloseoutSnapshotStable(currentSnapshot, finalSnapshot);
await assertPhase54CloseoutEvidencePrivacy();
const evidenceHashesAfter = await capturePhase54CloseoutEvidenceHashes();
assertPhase54CloseoutEvidenceHashesStable(
	evidenceHashesBefore,
	evidenceHashesAfter,
);
if (!owaspArtifact.outputHash || !juiceArtifact.evidenceBundleHash) {
	throw new Error("phase_54_closeout_required_artifact_hash_missing");
}
const benchmarkDatabaseBackupHash = await sha256File(databaseBackupPath);
if (benchmarkDatabaseBackupHash !== benchmarkDatabaseBackupHashBefore) {
	throw new Error(
		"phase_54_closeout_database_backup_changed_during_verification",
	);
}
const report = phase54CloseoutReportSchema.parse({
	schemaVersion: 1,
	evidenceKind: "phase_54_same_commit_closeout",
	generatedAt: new Date().toISOString(),
	releaseCommit: finalSnapshot.releaseCommit,
	cleanCheckout: true,
	platform: finalSnapshot.platform,
	architecture: finalSnapshot.architecture,
	sourceTreeHash: finalSnapshot.sourceTreeHash,
	inputHashes: finalSnapshot.inputHashes,
	toolboxImageDigest,
	owasp: {
		runId: owaspReceipt.runId,
		inputHash: owaspReceipt.inputHash,
		outputHash: owaspArtifact.outputHash,
		metricsArtifactHash: requiredEvidenceHash(
			evidenceHashesAfter,
			paths.owaspMetrics,
		),
		runReceiptHash: requiredEvidenceHash(
			evidenceHashesAfter,
			paths.owaspReceipt,
		),
	},
	juiceShop: {
		metricsArtifactHash: requiredEvidenceHash(
			evidenceHashesAfter,
			paths.juiceMetrics,
		),
		runReportHash: requiredEvidenceHash(evidenceHashesAfter, paths.juiceRun),
		evidenceBundleHash: juiceArtifact.evidenceBundleHash,
	},
	professionalReportHash: requiredEvidenceHash(
		evidenceHashesAfter,
		paths.professionalReport,
	),
	benchmarkDatabaseBackupHash,
	verification: {
		sourceInputsStable: true,
		owaspArtifactIntegrity: true,
		owaspPolicyPassed: true,
		owaspRunPersisted: true,
		databaseBackupIsolated: true,
		juiceShopArtifactIntegrity: true,
		juiceShopAuthoritativeLinux: true,
		regressionContractsPassed: true,
		regressionVerifiedCommit,
	},
	professionalClaimStatus: "not_met",
	claimChangeIncluded: false,
	privacy: {
		absoluteHomePathsIncluded: false,
		sourceSnippetsIncluded: false,
		credentialsIncluded: false,
	},
});
const serialized = `${JSON.stringify(report, null, 2)}\n`;
assertEvidencePrivacy(serialized);
await mkdir(path.dirname(paths.report), { recursive: true });
await writeFile(paths.report, serialized, { flag: "wx" });
console.log(
	JSON.stringify({
		ok: true,
		releaseCommit: report.releaseCommit,
		owaspRunId: report.owasp.runId,
		claimChangeIncluded: report.claimChangeIncluded,
	}),
);

async function readJson(filePath: string): Promise<unknown> {
	return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function readJsonObject(
	filePath: string,
): Promise<Record<string, unknown>> {
	const value = await readJson(filePath);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`phase_54_closeout_json_object_required:${filePath}`);
	}
	return value as Record<string, unknown>;
}

async function requireMetricArtifact(filePath: string) {
	const artifact = await readMetricArtifact(filePath);
	if (!artifact)
		throw new Error(`phase_54_closeout_artifact_missing:${filePath}`);
	return artifact;
}

function requiredEvidenceHash(
	hashes: Readonly<Record<string, string>>,
	evidencePath: string,
): string {
	const digest = hashes[evidencePath];
	if (!digest) {
		throw new Error(`phase_54_closeout_evidence_hash_missing:${evidencePath}`);
	}
	return digest;
}
