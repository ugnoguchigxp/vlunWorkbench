import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { builtInTechnologyPluginRegistry } from "../api/plugins/builtin";
import {
	type Phase54BaselineEvidence,
	phase54BaselineEvidenceSchema,
	type ReleaseEvidenceGate,
} from "../shared/schemas/release-evidence.schema";
import { scannerDataManifestV2Schema } from "../shared/schemas/security-capability.schema";
import {
	assertEvidencePrivacy,
	assertStableSnapshotInputs,
	type CommandObservation,
	commandObservationToAttempt,
	gateStateFromAttempts,
	meetsProfessionalCapabilityPolicy,
	parseGitStatusPorcelain,
	sha256,
} from "./phase-54-baseline-lib";
import { discoverTestFiles } from "./test-files";

const scannerManifestPath =
	"docker/toolbox/scanner-data/scanner-data-manifest.json";
const externalBenchmarkPath = "spec/evidence/phase-50-external-benchmark.json";
const benchmarkPolicyPath = "spec/security-capability/benchmark-policy.v1.json";

const phase54ScopePaths = new Set([
	"README.jp.md",
	"README.md",
	"package.json",
	"scripts/phase-54-baseline-lib.test.ts",
	"scripts/phase-54-baseline-lib.ts",
	"scripts/phase-54-baseline.ts",
	"scripts/test-files.test.ts",
	"scripts/test-files.ts",
	"scripts/verify-phase-54-baseline.ts",
	"scripts/verify-steps.test.ts",
	"scripts/verify-steps.ts",
	"shared/schemas/release-evidence.schema.test.ts",
	"shared/schemas/release-evidence.schema.ts",
	"spec/evidence/phase-54-baseline.json",
	"spec/docs/.archived/phase-54-release-trust-and-product-value-realization-plan.md",
]);

const externalBenchmarkSchema = z.object({
	owaspBenchmark: z.object({
		metrics: z.object({
			recall: z.number().min(0).max(1),
			precision: z.number().min(0).max(1),
			falsePositiveRate: z.number().min(0).max(1),
			score: z.number().min(-1).max(1),
		}),
	}),
	juiceShop: z.object({
		eligibleScenarioCount: z.number().int().nonnegative(),
		categoryCount: z.number().int().nonnegative(),
		executedScenarioCount: z.number().int().nonnegative(),
		metrics: z.object({
			recall: z.number().min(0).max(1).nullable(),
			precision: z.number().min(0).max(1).nullable(),
			falsePositiveRate: z.number().min(0).max(1).nullable(),
			score: z.number().min(-1).max(1).nullable(),
		}),
	}),
});

const benchmarkPolicySchema = z.object({
	minimums: z.object({
		owaspOverallRecall: z.number().min(0).max(1),
		owaspOverallPrecision: z.number().min(0).max(1),
		owaspOverallFalsePositiveRate: z.number().min(0).max(1),
		owaspScore: z.number().min(-1).max(1),
		juiceShopEligibleScenarios: z.number().int().nonnegative(),
		juiceShopCategories: z.number().int().nonnegative(),
		juiceShopRecall: z.number().min(0).max(1),
		juiceShopPrecision: z.number().min(0).max(1),
	}),
});

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		output: { type: "string" },
		"skip-local-gates": { type: "boolean", default: false },
		"snapshot-kind": { type: "string", default: "working_snapshot" },
	},
	strict: true,
});

if (
	!["planning_baseline", "working_snapshot"].includes(
		args.values["snapshot-kind"] ?? "",
	)
) {
	throw new Error("invalid_phase_54_snapshot_kind");
}

const evidence = await collectBaseline({
	snapshotKind: args.values["snapshot-kind"] as
		| "planning_baseline"
		| "working_snapshot",
	skipLocalGates: args.values["skip-local-gates"] ?? false,
});
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertEvidencePrivacy(serialized);

if (args.values.output) {
	await writeFile(args.values.output, serialized, { flag: "wx" });
	console.log(
		JSON.stringify({
			ok: true,
			snapshotKind: evidence.snapshotKind,
			digest: sha256(serialized),
		}),
	);
} else {
	process.stdout.write(serialized);
}

async function collectBaseline(params: {
	snapshotKind: "planning_baseline" | "working_snapshot";
	skipLocalGates: boolean;
}): Promise<Phase54BaselineEvidence> {
	const [
		headCommit,
		statusOutput,
		tagOutput,
		contributorOutput,
		manifestBytes,
		externalBenchmarkBytes,
		benchmarkPolicyBytes,
		phase50ReleaseBytes,
		phase53BaselineBytes,
		thirdPartyScannerDocs,
		testFiles,
	] = await Promise.all([
		gitOutput(["rev-parse", "HEAD"]),
		gitOutput(
			["status", "--porcelain=v1", "--untracked-files=all", "-z"],
			false,
		),
		gitOutput(["tag", "--list"]),
		gitOutput(["shortlog", "-sne", "--all"]),
		readFile(scannerManifestPath),
		readFile(externalBenchmarkPath),
		readFile(benchmarkPolicyPath),
		readFile("spec/evidence/phase-50-release-report.json"),
		readFile("spec/evidence/phase-53-python-go-baseline.json"),
		readFile("spec/decisions/third-party-scanners.html", "utf8"),
		discoverTestFiles(),
	]);
	const manifest = scannerDataManifestV2Schema.parse(
		JSON.parse(manifestBytes.toString("utf8")),
	);
	const externalBenchmark = externalBenchmarkSchema.parse(
		JSON.parse(externalBenchmarkBytes.toString("utf8")),
	);
	const benchmarkPolicy = benchmarkPolicySchema.parse(
		JSON.parse(benchmarkPolicyBytes.toString("utf8")),
	);
	const changedPaths = parseGitStatusPorcelain(statusOutput);
	const scopedPaths = changedPaths.filter((file) =>
		phase54ScopePaths.has(file),
	);
	const concurrentPaths = changedPaths.filter(
		(file) => !phase54ScopePaths.has(file),
	);
	const semgrepBundle = manifest.tools.semgrep?.dataBundles.find(
		(bundle) => bundle.id === "curated-sast-v1",
	);
	if (!semgrepBundle) throw new Error("phase_54_semgrep_bundle_missing");
	const ownedSemgrepRules = semgrepBundle.coverage.reduce((total, entry) => {
		const match = entry.match(/:(\d+)-rules$/);
		return total + Number(match?.[1] ?? 0);
	}, 0);
	const osvEcosystems = (manifest.tools.osv?.dataBundles ?? [])
		.filter((bundle) => bundle.kind === "vulnerability-db")
		.flatMap((bundle) => bundle.coverage)
		.sort();
	const contributorLines = contributorOutput.split("\n").filter(Boolean);
	const automatedContributors = contributorLines.filter((line) =>
		/(?:\[bot\]|dependabot|automation)/i.test(line),
	).length;
	const staleClaims = [
		...(thirdPartyScannerDocs.includes("three owned rules")
			? ["third-party scanner record states three owned Semgrep rules"]
			: []),
		...(thirdPartyScannerDocs.includes("npm-only")
			? ["third-party scanner record states npm-only OSV coverage"]
			: []),
	];
	const gates = await collectGates({
		skipLocalGates: params.skipLocalGates,
		staleClaims,
		externalBenchmark,
		benchmarkPolicy,
	});
	assertStableSnapshotInputs(
		{
			headCommit,
			status: sha256(statusOutput),
			manifest: sha256(manifestBytes),
			externalBenchmark: sha256(externalBenchmarkBytes),
			benchmarkPolicy: sha256(benchmarkPolicyBytes),
			phase50Release: sha256(phase50ReleaseBytes),
			phase53Baseline: sha256(phase53BaselineBytes),
			thirdPartyScannerDocs: sha256(thirdPartyScannerDocs),
		},
		await readCollectionFingerprint(),
	);
	const hasFailedReleaseGate = gates.some(
		(gate) => gate.state === "failed" || gate.state === "blocked",
	);

	return phase54BaselineEvidenceSchema.parse({
		schemaVersion: 1,
		phase: "54",
		evidenceKind: "baseline",
		snapshotKind: params.snapshotKind,
		generatedAt: new Date().toISOString(),
		owner: "vulnWorkbench maintainers",
		planningBaselineCommit: headCommit,
		workingTree: {
			clean: changedPaths.length === 0,
			changedPaths,
			phase54ScopePaths: scopedPaths,
			concurrentPathsExcludedFromScope: concurrentPaths,
		},
		toolchain: {
			bun: Bun.version,
			platform: process.platform,
			architecture: process.arch,
		},
		inventory: {
			testFiles: testFiles.length,
			ownedSemgrepRules,
			osvEcosystems,
			builtInPlugins: builtInTechnologyPluginRegistry.plugins().length,
			humanContributors: contributorLines.length - automatedContributors,
			automatedContributors,
			gitTags: tagOutput.split("\n").filter(Boolean).length,
		},
		metrics: {
			owaspBenchmark: externalBenchmark.owaspBenchmark.metrics,
			juiceShop: {
				eligibleScenarios: externalBenchmark.juiceShop.eligibleScenarioCount,
				categories: externalBenchmark.juiceShop.categoryCount,
				executedScenarios: externalBenchmark.juiceShop.executedScenarioCount,
				...externalBenchmark.juiceShop.metrics,
			},
		},
		documentation: {
			manifestIsSourceOfTruth: true,
			staleClaims,
		},
		gates,
		evaluationAxes: [
			{
				id: "release_trust",
				assessment: hasFailedReleaseGate ? "weak" : "strong",
				evidence: [
					"Local and Linux verification paths are explicitly inventoried",
				],
				limitations: ["Required release gates are not all passing"],
			},
			{
				id: "security_effectiveness",
				assessment: "partial",
				evidence: ["Owned scanner and benchmark metrics are recorded"],
				limitations: ["Professional capability policy is not met"],
			},
			{
				id: "product_correctness",
				assessment: "partial",
				evidence: ["Evidence and support limitations are explicit"],
				limitations: [
					"Historical and current evidence lifecycles are not separated",
				],
			},
			{
				id: "interoperability_adoption",
				assessment: "partial",
				evidence: ["CLI, MCP, Markdown, and NightWorkers paths exist"],
				limitations: ["General SARIF exchange is not implemented"],
			},
			{
				id: "sustainability",
				assessment: "weak",
				evidence: ["Automated tests and operational runbooks exist"],
				limitations: ["No release tags and one human contributor"],
			},
		],
		hashes: {
			benchmarkPolicy: sha256(benchmarkPolicyBytes),
			scannerDataManifestFile: sha256(manifestBytes),
			externalBenchmark: sha256(externalBenchmarkBytes),
			phase50ReleaseReport: sha256(phase50ReleaseBytes),
			phase53Baseline: sha256(phase53BaselineBytes),
		},
		privacy: {
			absoluteHomePathsIncluded: false,
			sourceSnippetsIncluded: false,
			credentialsIncluded: false,
		},
		residualRisk:
			"Release gates, measured professional capability, packaging inputs, and target execution sandbox remain incomplete and are not represented as passing.",
	});
}

async function collectGates(params: {
	skipLocalGates: boolean;
	staleClaims: string[];
	externalBenchmark: z.infer<typeof externalBenchmarkSchema>;
	benchmarkPolicy: z.infer<typeof benchmarkPolicySchema>;
}): Promise<ReleaseEvidenceGate[]> {
	const localGateDefinitions = [
		{
			id: "format",
			command: ["bun", "run", "format:check"],
			summary: "Repository formatting gate",
		},
		{
			id: "phase-50-historical-evidence",
			command: ["bun", "run", "verify:phase-50-evidence"],
			summary: "Phase 50 historical evidence gate",
		},
		{
			id: "phase-53-capability",
			command: ["bun", "run", "verify:phase-53-capability"],
			summary: "Phase 53 local capability gate",
		},
	] as const;
	const gates: ReleaseEvidenceGate[] = [];
	for (const definition of localGateDefinitions) {
		const observation: CommandObservation = params.skipLocalGates
			? {
					exitCode: null,
					blockedReason: "local_gate_execution_skipped",
				}
			: await runCommand(definition.command, 180_000);
		const attempt = commandObservationToAttempt(1, observation);
		gates.push({
			id: definition.id,
			command: definition.command.join(" "),
			state: gateStateFromAttempts([attempt]),
			durationMs: observation.durationMs ?? null,
			attempts: [attempt],
			evidenceRefs: ["local-command"],
			summary: definition.summary,
		});
	}

	const docsAttempt = commandObservationToAttempt(1, {
		exitCode: params.staleClaims.length === 0 ? 0 : 1,
	});
	gates.push({
		id: "capability-documentation",
		command: null,
		state: gateStateFromAttempts([docsAttempt]),
		durationMs: null,
		attempts: [docsAttempt],
		evidenceRefs: [
			"spec/decisions/third-party-scanners.html",
			scannerManifestPath,
		],
		summary: "Manifest-backed documentation consistency",
	});

	const professionalPassed = meetsProfessionalCapabilityPolicy({
		owasp: params.externalBenchmark.owaspBenchmark.metrics,
		juiceShop: {
			eligibleScenarioCount:
				params.externalBenchmark.juiceShop.eligibleScenarioCount,
			categoryCount: params.externalBenchmark.juiceShop.categoryCount,
			executedScenarioCount:
				params.externalBenchmark.juiceShop.executedScenarioCount,
			recall: params.externalBenchmark.juiceShop.metrics.recall,
			precision: params.externalBenchmark.juiceShop.metrics.precision,
		},
		minimums: params.benchmarkPolicy.minimums,
	});
	const professionalAttempt = commandObservationToAttempt(1, {
		exitCode: professionalPassed ? 0 : 1,
	});
	gates.push({
		id: "professional-capability",
		command: "bun run verify:professional-capability:report",
		state: gateStateFromAttempts([professionalAttempt]),
		durationMs: null,
		attempts: [professionalAttempt],
		evidenceRefs: [externalBenchmarkPath, benchmarkPolicyPath],
		summary: "Measured professional capability policy",
	});

	for (const [id, command, reason] of [
		[
			"github-linux-strict",
			"bun run verify:strict",
			"remote_ci_state_not_collected_by_local_snapshot",
		],
		[
			"toolbox-offline",
			"bun run verify:toolbox-offline",
			"toolbox_image_digest_not_available",
		],
		[
			"python-project-execution-sandbox",
			null,
			"target_project_code_execution_sandbox_required",
		],
	] as const) {
		const attempt = commandObservationToAttempt(1, {
			exitCode: null,
			blockedReason: reason,
		});
		gates.push({
			id,
			command,
			state: "blocked",
			durationMs: null,
			attempts: [attempt],
			evidenceRefs: ["local-baseline"],
			summary: reason,
		});
	}

	gates.push({
		id: "go-dast-auto-start",
		command: null,
		state: "not_applicable",
		durationMs: null,
		attempts: [
			{
				attempt: 1,
				state: "not_applicable",
				exitCode: null,
				summary: "go_dast_auto_start_unsupported",
			},
		],
		evidenceRefs: ["spec/phase-53-python-go-plugin-expansion-plan.md"],
		summary: "Go DAST auto-start is outside the supported capability set",
	});
	return gates;
}

async function runCommand(
	command: readonly string[],
	timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean; durationMs: number }> {
	const startedAt = performance.now();
	const child = Bun.spawn([...command], {
		stdout: "ignore",
		stderr: "ignore",
		env: process.env,
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	const exitCode = await child.exited;
	clearTimeout(timeout);
	return {
		exitCode,
		timedOut,
		durationMs: Math.round(performance.now() - startedAt),
	};
}

async function readCollectionFingerprint(): Promise<Record<string, string>> {
	const [
		headCommit,
		statusOutput,
		manifestBytes,
		externalBenchmarkBytes,
		benchmarkPolicyBytes,
		phase50ReleaseBytes,
		phase53BaselineBytes,
		thirdPartyScannerDocs,
	] = await Promise.all([
		gitOutput(["rev-parse", "HEAD"]),
		gitOutput(
			["status", "--porcelain=v1", "--untracked-files=all", "-z"],
			false,
		),
		readFile(scannerManifestPath),
		readFile(externalBenchmarkPath),
		readFile(benchmarkPolicyPath),
		readFile("spec/evidence/phase-50-release-report.json"),
		readFile("spec/evidence/phase-53-python-go-baseline.json"),
		readFile("spec/decisions/third-party-scanners.html", "utf8"),
	]);
	return {
		headCommit,
		status: sha256(statusOutput),
		manifest: sha256(manifestBytes),
		externalBenchmark: sha256(externalBenchmarkBytes),
		benchmarkPolicy: sha256(benchmarkPolicyBytes),
		phase50Release: sha256(phase50ReleaseBytes),
		phase53Baseline: sha256(phase53BaselineBytes),
		thirdPartyScannerDocs: sha256(thirdPartyScannerDocs),
	};
}

async function gitOutput(args: string[], trim = true): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`git_command_failed:${args[0]}:${stderr.trim()}`);
	}
	return trim ? stdout.trim() : stdout;
}
