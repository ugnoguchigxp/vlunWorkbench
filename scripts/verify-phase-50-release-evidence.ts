import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { canonicalJson } from "../api/modules/scans/diff-scan-plan";
import {
	measuredCapabilityClaimSchema,
	scannerDataManifestV2Schema,
} from "../shared/schemas/security-capability.schema";

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
await assertEvidenceOnlyReleaseDescendant(releaseCommit);

const [manifestInput, scope, policy, corpusLockBytes] = await Promise.all([
	readJsonAtCommit(
		releaseCommit,
		"docker/toolbox/scanner-data/scanner-data-manifest.json",
	),
	readJsonAtCommit(
		releaseCommit,
		"spec/security-capability/scope-catalog.v1.json",
	),
	readJsonAtCommit(
		releaseCommit,
		"spec/security-capability/benchmark-policy.v1.json",
	),
	gitFileAtCommit(releaseCommit, "spec/security-capability/corpora.lock.json"),
]);
const manifest = scannerDataManifestV2Schema.parse(manifestInput);
const { manifestHash, ...manifestHashInput } = manifest;
if (sha256(Buffer.from(canonicalJson(manifestHashInput))) !== manifestHash)
	throw new Error("phase_50_historical_scanner_manifest_hash_mismatch");
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
const minimums = policy.minimums as Record<string, number>;
const owaspBenchmark = external.owaspBenchmark as Record<string, unknown>;
const owaspMetrics = owaspBenchmark.metrics as Record<string, unknown>;
const owaspOverallPassed =
	Number(owaspMetrics.recall ?? -1) >= minimums.owaspOverallRecall &&
	Number(owaspMetrics.precision ?? -1) >= minimums.owaspOverallPrecision &&
	Number(owaspMetrics.falsePositiveRate ?? 2) <=
		minimums.owaspOverallFalsePositiveRate &&
	Number(owaspMetrics.score ?? -2) >= minimums.owaspScore;
if (Boolean(owaspBenchmark.gatePassed) !== owaspOverallPassed)
	throw new Error("phase_50_owasp_gate_metric_mismatch");
const juiceShop = external.juiceShop as Record<string, unknown>;
const juiceMetrics = juiceShop.metrics as Record<string, unknown>;
const juiceGate =
	Number(juiceShop.eligibleScenarioCount ?? 0) >=
		minimums.juiceShopEligibleScenarios &&
	Number(juiceShop.categoryCount ?? 0) >= minimums.juiceShopCategories &&
	Number(juiceShop.executedScenarioCount ?? 0) >=
		minimums.juiceShopEligibleScenarios &&
	Number(juiceMetrics.recall ?? -1) >= minimums.juiceShopRecall &&
	Number(juiceMetrics.precision ?? -1) >= minimums.juiceShopPrecision;
if (Boolean(juiceShop.gatePassed) !== juiceGate)
	throw new Error("phase_50_juice_shop_gate_metric_mismatch");
const semgrepGates = semgrep.gates as Record<string, unknown>;
const semgrepMetrics = semgrep.metrics as Record<string, unknown>;
const semgrepEvidencePassed =
	Object.values(semgrepGates).every((value) => value === true) &&
	semgrepMetrics.positiveRecall === minimums.semgrepPositiveRecall &&
	semgrepMetrics.negativeFalsePositive ===
		minimums.semgrepNegativeFalsePositive &&
	semgrepMetrics.networkRequests === minimums.offlineNetworkRequests;
const osvEvidencePassed =
	osv.databaseSupplied === true &&
	osv.networkRequests === 0 &&
	Array.isArray(osv.matrix) &&
	osv.matrix.length === minimums.osvSupportedEcosystems &&
	osv.matrix.every(
		(item) =>
			Boolean(item) &&
			typeof item === "object" &&
			(item as Record<string, unknown>).vulnerableDetected === true &&
			(item as Record<string, unknown>).fixedDetected === false,
	);
const zapPassed = zap.gatePassed === true;
const threatBusinessGates = threatBusiness.gates as Record<string, unknown>;
if (
	report.gates.semgrep !== semgrepEvidencePassed ||
	report.gates.osv !== osvEvidencePassed ||
	report.gates.zapActiveContract !== zapPassed ||
	report.gates.threatModel !==
		(threatBusinessGates.threatModelContracts === true) ||
	report.gates.businessLogic !== (threatBusinessGates.businessLogic === true) ||
	report.gates.endpointDiscovery !==
		(threatBusinessGates.endpointDiscovery === true) ||
	report.gates.owasp !== Boolean(owaspBenchmark.gatePassed) ||
	report.gates.juiceShop !== Boolean(juiceShop.gatePassed)
)
	throw new Error("phase_50_release_gate_evidence_mismatch");
if (
	report.gates.contracts !==
	[
		semgrepEvidencePassed,
		osvEvidencePassed,
		zapPassed,
		threatBusinessGates.threatModelContracts === true,
		threatBusinessGates.businessLogic === true,
		threatBusinessGates.endpointDiscovery === true,
	].every(Boolean)
)
	throw new Error("phase_50_contract_gate_evidence_mismatch");

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

async function readJsonAtCommit(
	commit: string,
	filePath: string,
): Promise<Record<string, unknown>> {
	return JSON.parse(
		new TextDecoder().decode(await gitFileAtCommit(commit, filePath)),
	) as Record<string, unknown>;
}

function sha256(value: Uint8Array): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function assertEvidenceOnlyReleaseDescendant(
	commit: string,
): Promise<void> {
	if (!(await isAncestor(commit, "HEAD")))
		throw new Error("phase_50_release_commit_is_not_ancestor");
	const evidenceCommits = new Set(
		await Promise.all(
			evidenceFiles.map((filePath) =>
				gitOutput(["log", "-1", "--format=%H", "--", filePath]),
			),
		),
	);
	if (evidenceCommits.size !== 1)
		throw new Error("phase_50_evidence_files_do_not_share_commit");
	const evidenceCommit = [...evidenceCommits][0];
	if (!evidenceCommit || !(await isAncestor(commit, evidenceCommit)))
		throw new Error("phase_50_evidence_commit_is_not_release_descendant");
	if (!(await isAncestor(evidenceCommit, "HEAD")))
		throw new Error("phase_50_evidence_commit_is_not_ancestor");

	const output = await gitOutput([
		"diff",
		"--name-only",
		`${commit}..${evidenceCommit}`,
	]);
	const changedFiles = output
		.split("\n")
		.map((value) => value.trim())
		.filter(Boolean)
		.sort();
	const expectedFiles = [...evidenceFiles].sort();
	if (JSON.stringify(changedFiles) !== JSON.stringify(expectedFiles))
		throw new Error("phase_50_release_commit_has_non_evidence_descendants");

	const currentEvidence = Bun.spawn(
		["git", "diff", "--quiet", evidenceCommit, "--", ...evidenceFiles],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	if ((await currentEvidence.exited) !== 0)
		throw new Error("phase_50_evidence_changed_after_recording");
}

async function isAncestor(
	ancestor: string,
	descendant: string,
): Promise<boolean> {
	const child = Bun.spawn(
		["git", "merge-base", "--is-ancestor", ancestor, descendant],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	return (await child.exited) === 0;
}

async function gitOutput(args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, output] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	if (exitCode !== 0) throw new Error("phase_50_release_diff_unavailable");
	return output.trim();
}

async function gitFileAtCommit(
	commit: string,
	filePath: string,
): Promise<Uint8Array> {
	const child = Bun.spawn(["git", "show", `${commit}:${filePath}`], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, output] = await Promise.all([
		child.exited,
		new Response(child.stdout).arrayBuffer(),
	]);
	if (exitCode !== 0) throw new Error("phase_50_historical_input_unavailable");
	return new Uint8Array(output);
}
