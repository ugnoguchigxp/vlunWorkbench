import crypto from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { verifyPersistedBenchmarkRun } from "../api/db/benchmark-run-verifier";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import { measuredCapabilityClaimSchema } from "../shared/schemas/security-capability.schema";
import { sha256Tree } from "./benchmark/benchmark-input-provenance";
import { owaspBenchmarkInputHash } from "./benchmark/owasp-benchmark-input";
import {
	assertOwaspMetricsPassReleasePolicy,
	owaspReleasePolicySchema,
} from "./benchmark/owasp-release-policy";
import {
	assertMetricArtifactIntegrity,
	isAuthoritativeJuiceShopReleaseRun,
	overall,
	readMetricArtifact,
	verifyJuiceShopArtifactIntegrity,
	verifyOwaspArtifactIntegrity,
} from "./professional-capability-artifact-verifier";
import { assessOsvEvidence } from "./professional-capability-gates";

const cliArguments = process.argv.slice(2);
if (cliArguments.some((argument) => argument !== "--report-only"))
	throw new Error("professional_capability_argument_invalid");
const reportOnly = cliArguments.includes("--report-only");

const contracts = [
	["bun", "run", "test:detection-effectiveness"],
	["bun", "run", "test:semgrep:catalog"],
	["bun", "run", "test:osv:offline-fixtures"],
	["bun", "run", "test:zap-active:contract"],
	["bun", "run", "test:threat-model"],
	["bun", "run", "test:business-logic"],
	["bun", "run", "scripts/benchmark/endpoint-discovery.ts"],
	["bun", "run", "scripts/benchmark/business-logic.ts"],
];
const contractResults: Array<{
	command: string;
	ok: boolean;
	exitCode: number;
}> = [];
for (const command of contracts) {
	const child = Bun.spawn(command, {
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	});
	const exitCode = await child.exited;
	contractResults.push({
		command: command.join(" "),
		ok: exitCode === 0,
		exitCode,
	});
}
if (contractResults.some((item) => !item.ok))
	throw new Error("professional_capability_contract_failed");

const [policy, scope, manifest, corpusLock] = await Promise.all([
	readJson("spec/security-capability/benchmark-policy.v1.json"),
	readJson("spec/security-capability/scope-catalog.v1.json"),
	loadScannerDataManifest(),
	readJson("spec/security-capability/corpora.lock.json"),
]);
const minimums = policy.minimums as Record<string, number>;
const semgrepCatalog = await readJson(
	"docker/toolbox/scanner-data/semgrep-rules/catalog.json",
);
const semgrepRules = semgrepCatalog.rules as Array<{
	language: string;
	family: string;
}>;
const semgrepEvidence = await readJsonIfExists(
	".artifacts/benchmark/semgrep-catalog.json",
);
const semgrepGate =
	semgrepRules.length >= minimums.semgrepRuleCount &&
	new Set(semgrepRules.map((item) => item.language)).size === 5 &&
	[...new Set(semgrepRules.map((item) => item.language))].every(
		(language) =>
			new Set(
				semgrepRules
					.filter((item) => item.language === language)
					.map((item) => item.family),
			).size >= minimums.supportedLanguageSecurityFamilies,
	) &&
	semgrepEvidence?.positiveRecall === minimums.semgrepPositiveRecall &&
	semgrepEvidence?.negativeFalsePositive ===
		minimums.semgrepNegativeFalsePositive &&
	semgrepEvidence?.networkRequests === minimums.offlineNetworkRequests;
const osvBundles = manifest.tools.osv?.dataBundles ?? [];
const owasp = await readMetricArtifact(
	".artifacts/benchmark/owasp-metrics.json",
);
const juice = await readMetricArtifact(
	".artifacts/benchmark/juice-shop-metrics.json",
);
const business = await readMetricArtifact(
	".artifacts/benchmark/business-logic-metrics.json",
);
const endpoint = await readJsonIfExists(
	".artifacts/benchmark/endpoint-discovery-metrics.json",
);
const osvEvidence = await readJsonIfExists(
	".artifacts/benchmark/osv-offline-fixtures.json",
);
const releaseCommit = await gitCommit();
const workingTreeClean = await gitWorkingTreeClean();
for (const artifact of [owasp, juice, business])
	if (artifact) assertMetricArtifactIntegrity(artifact);
if (owasp)
	await verifyOwaspArtifactIntegrity({
		artifact: owasp,
		manifestHash: manifest.manifestHash,
		corpusLock,
	});
const juiceRunReport = juice
	? await verifyJuiceShopArtifactIntegrity({
			artifact: juice,
			manifestHash: manifest.manifestHash,
			corpusLock,
		})
	: null;
const osvGate = assessOsvEvidence({
	bundleCount: osvBundles.filter((item) => item.kind === "vulnerability-db")
		.length,
	databaseSupplied: osvEvidence?.databaseSupplied,
	manifestState: manifest.tools.osv?.state,
	matrix: osvEvidence?.matrix,
	minimumEcosystems: minimums.osvSupportedEcosystems,
	networkRequests: osvEvidence?.networkRequests,
	expectedEcosystems: osvBundles.flatMap((item) => item.coverage),
	provenance: {
		actual: osvEvidence,
		gitCommit: releaseCommit,
		scannerManifestHash: manifest.manifestHash,
		fixtureHash: await sha256Tree(["tests/security-capability/osv"]),
		implementationHash: await sha256Tree([
			"scripts/test-osv-offline-fixtures.ts",
			"scripts/osv-fixture-runtime.ts",
		]),
	},
});
const owaspOverall = overall(owasp);
const juiceOverall = overall(juice);
const businessOverall = overall(business);
let owaspCategoryGate = false;
try {
	assertOwaspMetricsPassReleasePolicy(
		owasp?.metrics ?? [],
		owaspReleasePolicySchema.parse(policy),
	);
	owaspCategoryGate = true;
} catch {
	owaspCategoryGate = false;
}
const externalGates = {
	owasp:
		Boolean(owaspOverall) &&
		(owaspOverall?.recall ?? -1) >= minimums.owaspOverallRecall &&
		(owaspOverall?.precision ?? -1) >= minimums.owaspOverallPrecision &&
		(owaspOverall?.falsePositiveRate ?? 2) <=
			minimums.owaspOverallFalsePositiveRate &&
		(owaspOverall?.score ?? -2) >= minimums.owaspScore &&
		owaspCategoryGate,
	juiceShop:
		Boolean(juiceOverall) &&
		isAuthoritativeJuiceShopReleaseRun({
			report: juiceRunReport,
			releaseCommit,
			workingTreeClean,
		}) &&
		(juice?.eligibleScenarioCount ?? 0) >=
			minimums.juiceShopEligibleScenarios &&
		(juice?.categoryCount ?? 0) >= minimums.juiceShopCategories &&
		(juice?.executedScenarioCount ?? 0) >=
			minimums.juiceShopEligibleScenarios &&
		(juiceOverall?.recall ?? -1) >= minimums.juiceShopRecall &&
		(juiceOverall?.precision ?? -1) >= minimums.juiceShopPrecision,
	businessLogic:
		Boolean(businessOverall) &&
		business?.measurementStatus === "completed" &&
		business.gitCommit === releaseCommit &&
		(businessOverall?.recall ?? -1) >= minimums.businessLogicRecall &&
		(businessOverall?.precision ?? -1) >= minimums.businessLogicPrecision,
	endpointDiscovery:
		Number(endpoint?.recall ?? -1) >= minimums.endpointDiscoveryRecall &&
		Number(endpoint?.precision ?? -1) >= minimums.endpointDiscoveryPrecision,
};
const unsupportedCapabilities = (
	scope.capabilities as Array<{ id: string; tier: string }>
)
	.filter((item) => item.tier !== "supported")
	.map((item) => item.id)
	.sort();
const passingRunInput = process.env.VULN_WORKBENCH_PASSING_BENCHMARK_RUN_ID;
const passingRunResult = z.string().uuid().safeParse(passingRunInput);
if (passingRunInput && !passingRunResult.success)
	throw new Error("passing_benchmark_run_id_invalid");
const verifiedBenchmarkRunId = passingRunResult.data ?? null;
if (verifiedBenchmarkRunId) {
	if (!owasp) throw new Error("passing_benchmark_owasp_artifact_required");
	await verifyPersistedBenchmarkRun({
		runId: verifiedBenchmarkRunId,
		databaseUrl: process.env.VULN_WORKBENCH_BENCHMARK_DATABASE_URL,
		releaseCommit,
		manifestHash: manifest.manifestHash,
		policyVersion: String(policy.policyVersion),
		toolboxImageDigest: process.env.VULN_WORKBENCH_TOOLBOX_IMAGE_DIGEST,
		runInputHash: owaspBenchmarkInputHash(owasp),
		artifact: owasp,
	});
}
const status =
	verifiedBenchmarkRunId &&
	semgrepGate &&
	osvGate &&
	Object.values(externalGates).every(Boolean)
		? "met"
		: "not_met";
const passingBenchmarkRunId = status === "met" ? verifiedBenchmarkRunId : null;
const claim = measuredCapabilityClaimSchema.parse({
	claimId: "measured-automated-web-api-assessment-v1",
	status,
	scopeCatalogVersion: scope.catalogVersion,
	benchmarkPolicyVersion: policy.policyVersion,
	passingBenchmarkRunId,
	unsupportedCapabilities,
});
const outputPath = path.resolve(
	".artifacts/professional-capability-release-report.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
const report = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	releaseCommit,
	claim,
	hashes: {
		corpusLock: sha256(
			await readFile("spec/security-capability/corpora.lock.json"),
		),
		scannerManifest: manifest.manifestHash,
	},
	provenance: {
		workingTreeClean,
		juiceShopAuthoritativeLinux:
			juiceRunReport?.preflight.authoritativeLinux ?? false,
		juiceShopMeasurementStatus:
			juiceRunReport?.measurementStatus ?? "not_executed",
	},
	gates: {
		contracts: contractResults,
		semgrep: semgrepGate,
		osv: osvGate,
		...externalGates,
	},
	metrics: {
		owasp: owaspOverall,
		juiceShop: juiceOverall,
		businessLogic: businessOverall,
		endpointDiscovery: endpoint,
	},
	residualRisk:
		status === "met"
			? "The claim is limited to the versioned scope catalog and measured corpora."
			: "One or more prepared offline datasets or external benchmark gates have not passed; the measured capability claim remains not_met.",
};
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify({ ok: true, outputPath, claim, gates: report.gates }),
);
if (status !== "met" && !reportOnly) process.exitCode = 1;

async function readJson(filePath: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(filePath, "utf8")) as Record<
		string,
		unknown
	>;
}

async function readJsonIfExists(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	return (await stat(filePath).catch(() => null))
		? await readJson(filePath)
		: null;
}

function sha256(value: Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function gitCommit(): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await child.exited) !== 0) throw new Error("git_commit_unavailable");
	return (await new Response(child.stdout).text()).trim();
}

async function gitWorkingTreeClean(): Promise<boolean> {
	const child = Bun.spawn(
		["git", "status", "--porcelain", "--untracked-files=all"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await child.exited) !== 0)
		throw new Error("git_working_tree_status_unavailable");
	return (await new Response(child.stdout).text()).trim() === "";
}
