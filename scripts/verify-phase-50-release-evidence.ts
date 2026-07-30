import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { measuredCapabilityClaimSchema } from "../shared/schemas/security-capability.schema";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";

const evidenceFiles = [
	"spec/evidence/phase-50-baseline.json",
	"spec/evidence/phase-50-semgrep-capability.json",
	"spec/evidence/phase-50-osv-capability.json",
	"spec/evidence/phase-50-zap-active-capability.json",
	"spec/evidence/phase-50-threat-business-capability.json",
	"spec/evidence/phase-50-external-benchmark.json",
	"spec/evidence/phase-50-release-report.json",
] as const;

const commonEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		phase: z.literal("50"),
		generatedAt: z.string().datetime(),
		owner: z.string().trim().min(1),
		releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
		residualRisk: z.string().trim().min(1),
	})
	.passthrough();

const evidence = new Map<string, z.infer<typeof commonEvidenceSchema>>();
for (const filePath of evidenceFiles) {
	evidence.set(
		filePath,
		commonEvidenceSchema.parse(
			JSON.parse(await readFile(filePath, "utf8")) as unknown,
		),
	);
}

const releaseCommits = new Set(
	[...evidence.values()].map((item) => item.releaseCommit),
);
if (releaseCommits.size !== 1)
	throw new Error("phase_50_evidence_release_commit_mismatch");
const releaseCommit = [...releaseCommits][0];
if (!releaseCommit) throw new Error("phase_50_release_commit_missing");
await assertCommitIsAncestor(releaseCommit);

const [manifest, scope, corpusLockBytes] = await Promise.all([
	loadScannerDataManifest(),
	readJson("spec/security-capability/scope-catalog.v1.json"),
	readFile("spec/security-capability/corpora.lock.json"),
]);
const corpusLockHash = sha256(corpusLockBytes);

const report = z
	.object({
		claim: measuredCapabilityClaimSchema,
		hashes: z.object({
			corpusLock: z.literal(corpusLockHash),
			scannerManifest: z.literal(manifest.manifestHash),
		}),
		gates: z.object({
			contracts: z.boolean(),
			semgrep: z.boolean(),
			osv: z.boolean(),
			zapActiveContract: z.boolean(),
			threatModel: z.boolean(),
			owasp: z.boolean(),
			juiceShop: z.boolean(),
			businessLogic: z.boolean(),
			endpointDiscovery: z.boolean(),
		}),
		invariants: z.object({
			requiredOwnerPresent: z.literal(true),
			unsupportedCapabilitiesDisclosed: z.literal(true),
			humanApprovalRequiredForCompletion: z.literal(false),
			llmOnlyHypothesisPromotedToConfirmedFinding: z.literal(0),
			supportedCapabilityHasFixtureOrMetric: z.literal(true),
			allEvidenceReferencesSameReleaseCommit: z.literal(true),
		}),
	})
	.parse(evidence.get("spec/evidence/phase-50-release-report.json") as unknown);

const expectedUnsupported = (
	scope.capabilities as Array<{ id: string; tier: string }>
)
	.filter((item) => item.tier !== "supported")
	.map((item) => item.id)
	.sort();
if (
	JSON.stringify([...report.claim.unsupportedCapabilities].sort()) !==
	JSON.stringify(expectedUnsupported)
)
	throw new Error("phase_50_unsupported_capability_mismatch");

const semgrep = evidence.get(
	"spec/evidence/phase-50-semgrep-capability.json",
) as Record<string, unknown>;
const osv = evidence.get(
	"spec/evidence/phase-50-osv-capability.json",
) as Record<string, unknown>;
const zap = evidence.get(
	"spec/evidence/phase-50-zap-active-capability.json",
) as Record<string, unknown>;
const threatBusiness = evidence.get(
	"spec/evidence/phase-50-threat-business-capability.json",
) as Record<string, unknown>;
for (const [name, item] of [
	["semgrep", semgrep],
	["osv", osv],
	["zap", zap],
] as const) {
	if (item.scannerManifestHash !== manifest.manifestHash)
		throw new Error(`phase_50_${name}_manifest_hash_mismatch`);
}
if (semgrep.gates === undefined || semgrep.metrics === undefined)
	throw new Error("phase_50_semgrep_fixture_or_metric_missing");
if (!Array.isArray(osv.matrix) || osv.matrix.length !== 8)
	throw new Error("phase_50_osv_fixture_matrix_missing");
if (zap.verification === undefined)
	throw new Error("phase_50_zap_contract_evidence_missing");
if (
	threatBusiness.applicationModel === undefined ||
	threatBusiness.threatModel === undefined ||
	threatBusiness.businessLogic === undefined
)
	throw new Error("phase_50_threat_business_evidence_missing");

const external = evidence.get(
	"spec/evidence/phase-50-external-benchmark.json",
) as Record<string, unknown>;
if (external.corpusLockHash !== corpusLockHash)
	throw new Error("phase_50_corpus_lock_hash_mismatch");
if (external.scannerManifestHash !== manifest.manifestHash)
	throw new Error("phase_50_external_manifest_hash_mismatch");

if (report.claim.status === "met") {
	if (!Object.values(report.gates).every(Boolean))
		throw new Error("phase_50_met_claim_has_failing_gate");
} else if (report.claim.passingBenchmarkRunId !== null) {
	throw new Error("phase_50_not_met_claim_has_passing_run");
}

console.log(
	JSON.stringify({
		ok: true,
		releaseCommit,
		evidenceFileCount: evidenceFiles.length,
		claimStatus: report.claim.status,
	}),
);

async function readJson(filePath: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(filePath, "utf8")) as Record<
		string,
		unknown
	>;
}

function sha256(value: Uint8Array): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function assertCommitIsAncestor(commit: string): Promise<void> {
	const child = Bun.spawn(
		["git", "merge-base", "--is-ancestor", commit, "HEAD"],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	if ((await child.exited) !== 0)
		throw new Error("phase_50_release_commit_is_not_ancestor");
}
