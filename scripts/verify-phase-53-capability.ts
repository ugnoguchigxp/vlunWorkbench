import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { builtInTechnologyPluginRegistry } from "../api/plugins/builtin";
import type {
	BoundedTextResult,
	PluginContext,
	StartPlannerContext,
} from "../api/modules/project-capabilities/plugin-contract";

const semgrepRoot = "docker/toolbox/scanner-data/semgrep-rules";
const scannerManifestPath =
	"docker/toolbox/scanner-data/scanner-data-manifest.json";
const expectedPluginIds = [
	"language.python",
	"build.python-requirements",
	"framework.python.fastapi",
	"framework.python.flask",
	"framework.python.django",
	"language.go",
	"build.go-modules",
	"framework.go.net-http",
	"framework.go.gin",
	"framework.go.echo",
] as const;

const baselineEvidence = await readJson(
	"spec/evidence/phase-53-python-go-baseline.json",
);
if (baselineEvidence.phase !== "53" || baselineEvidence.schemaVersion !== 1) {
	throw new Error("phase_53_baseline_evidence_invalid");
}

const pluginIds = builtInTechnologyPluginRegistry
	.plugins()
	.map((plugin) => plugin.manifest.id);
for (const pluginId of expectedPluginIds) {
	if (!pluginIds.includes(pluginId)) {
		throw new Error(`phase_53_builtin_plugin_missing:${pluginId}`);
	}
}

const ruleDigests: Record<string, string> = {};
for (const contribution of builtInTechnologyPluginRegistry
	.semgrepRules()
	.filter((item) =>
		["language.python", "language.go"].includes(item.pluginId),
	)) {
	const digest = sha256(
		await readFile(path.join(semgrepRoot, contribution.path)),
	);
	if (digest !== contribution.digest) {
		throw new Error(
			`phase_53_semgrep_digest_mismatch:${contribution.pluginId}`,
		);
	}
	ruleDigests[contribution.path] = digest;
}

const endpointEvidence = await readJson(
	".artifacts/benchmark/endpoint-discovery-metrics.json",
);
if (
	typeof endpointEvidence.precision !== "number" ||
	typeof endpointEvidence.recall !== "number" ||
	endpointEvidence.precision < 0.9 ||
	endpointEvidence.recall < 0.9
) {
	throw new Error("phase_53_endpoint_metric_gate_failed");
}
const semgrepEvidence = await readJson(
	".artifacts/benchmark/semgrep-catalog.json",
);
if (
	semgrepEvidence.positiveRecall !== 1 ||
	semgrepEvidence.negativeFalsePositive !== 0
) {
	throw new Error("phase_53_semgrep_fixture_gate_failed");
}
const osvEvidence = await readJson(
	".artifacts/benchmark/osv-offline-fixtures.json",
);
if (osvEvidence.networkRequests !== 0) {
	throw new Error("phase_53_osv_network_policy_failed");
}

const plannerSnapshots = await validatePythonStartPlanners();
const goStartPlanners = builtInTechnologyPluginRegistry
	.plugins()
	.filter((plugin) => plugin.manifest.id.startsWith("framework.go."))
	.flatMap((plugin) => plugin.startPlanners);
if (goStartPlanners.length !== 0) {
	throw new Error("phase_53_go_start_planner_must_be_unsupported");
}

const scannerManifestBytes = await readFile(scannerManifestPath);
const scannerManifest = JSON.parse(scannerManifestBytes.toString("utf8")) as {
	manifestHash?: unknown;
};
const gitCommit = await gitOutput(["rev-parse", "HEAD"]);
const workingTreeStatus = await gitOutput(["status", "--short"]);
const databaseSupplied = osvEvidence.databaseSupplied === true;
const limitations = [
	...(databaseSupplied ? [] : ["offline_vulnerability_database_not_supplied"]),
	"toolbox_image_digest_not_available",
	"python_dast_project_code_execution_sandbox_required",
	"go_dast_auto_start_unsupported",
	...(workingTreeStatus.length === 0
		? []
		: ["release_same_commit_clean_checkout_not_claimed"]),
];
const artifact = {
	schemaVersion: 1,
	phase: "53",
	generatedAt: new Date().toISOString(),
	sourceCommit: gitCommit,
	workingTreeClean: workingTreeStatus.length === 0,
	verificationLevel: "local",
	baseline: {
		planningBaselineCommit: baselineEvidence.planningBaselineCommit,
		implementationStartCommit: baselineEvidence.implementationStartCommit,
		workingTreeClean: baselineEvidence.workingTreeClean,
	},
	registry: {
		digest: builtInTechnologyPluginRegistry.registryDigest,
		pluginIds,
		contributions: builtInTechnologyPluginRegistry.plugins().map((plugin) => ({
			pluginId: plugin.manifest.id,
			version: plugin.manifest.version,
			kind: plugin.manifest.kind,
			requires: plugin.manifest.requires,
			declaredCapabilities: plugin.manifest.declaredCapabilities,
			contributionIds: [
				...plugin.dependencyProviders.map((item) => item.id),
				...plugin.sourceAnalyzers.map((item) => item.id),
				...plugin.endpointExtractors.map((item) => item.id),
				...plugin.startPlanners.map((item) => item.id),
				...plugin.semgrepRules.map(
					(item) => `${item.rulesetId}:${item.language}`,
				),
			].sort(),
		})),
	},
	scannerData: {
		manifestHash:
			typeof scannerManifest.manifestHash === "string"
				? scannerManifest.manifestHash
				: null,
		manifestFileDigest: sha256(scannerManifestBytes),
	},
	semgrep: {
		ruleDigests,
		catalogDigest: sha256(
			await readFile(path.join(semgrepRoot, "catalog.json")),
		),
		positiveRecall: semgrepEvidence.positiveRecall,
		negativeFalsePositive: semgrepEvidence.negativeFalsePositive,
	},
	offlineSca: {
		networkRequests: osvEvidence.networkRequests,
		databaseSupplied,
		status: databaseSupplied ? "verified" : "gap",
	},
	toolboxImageDigest: null,
	endpointDiscovery: {
		precision: endpointEvidence.precision,
		recall: endpointEvidence.recall,
	},
	dast: {
		pythonPlannerSnapshots: plannerSnapshots,
		pythonExecutionStatus: "gap",
		pythonExecutionReason: "project_code_execution_sandbox_required",
		goAutoStartStatus: "unsupported",
		goStartPlannerCount: 0,
	},
	gates: {
		deterministicRegistry: true,
		pythonGoRulesetDigests: true,
		semgrepFixtures: true,
		dependencyFixtureContracts: true,
		endpointPrecisionRecall: true,
		pythonStartPlanSafety: true,
		goStartUnsupported: true,
		noNetworkResolution: true,
	},
	limitations,
};

const artifactPath = path.resolve(
	".artifacts/benchmark/phase-53-capability.json",
);
await mkdir(path.dirname(artifactPath), { recursive: true });
await Bun.write(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, artifactPath, ...artifact }));

async function validatePythonStartPlanners() {
	const fixtures = [
		{
			pluginId: "framework.python.fastapi",
			files: {
				"app.py": "from fastapi import FastAPI\napp = FastAPI()\n",
			},
			expectedArgs: [
				"-m",
				"uvicorn",
				"app:app",
				"--host",
				"127.0.0.1",
				"--port",
				"43123",
			],
		},
		{
			pluginId: "framework.python.flask",
			files: { "app.py": "from flask import Flask\napp = Flask(__name__)\n" },
			expectedArgs: [
				"-m",
				"flask",
				"--app",
				"app:app",
				"run",
				"--host",
				"127.0.0.1",
				"--port",
				"43123",
			],
		},
		{
			pluginId: "framework.python.django",
			files: { "manage.py": "def main():\n    pass\n" },
			expectedArgs: ["manage.py", "runserver", "127.0.0.1:43123"],
		},
	] as const;
	const snapshots = [];
	for (const fixture of fixtures) {
		const planner = builtInTechnologyPluginRegistry.get(fixture.pluginId)
			?.startPlanners[0];
		if (!planner)
			throw new Error(`phase_53_python_planner_missing:${fixture.pluginId}`);
		const context = plannerContext(fixture.files, fixture.pluginId);
		const result = await planner.plan(context);
		if (!result) {
			throw new Error(
				`phase_53_python_planner_safety_failed:${fixture.pluginId}`,
			);
		}
		if (
			result.executable !== "python3" ||
			JSON.stringify(result.args) !== JSON.stringify(fixture.expectedArgs) ||
			result.requestedNetwork !== "none" ||
			result.requiresProjectCodeConsent !== true ||
			result.args.some((arg) => /(?:pip|install|uv\s+sync|poetry)/i.test(arg))
		) {
			throw new Error(
				`phase_53_python_planner_safety_failed:${fixture.pluginId}`,
			);
		}
		snapshots.push({
			pluginId: fixture.pluginId,
			executable: result.executable,
			args: result.args,
			requestedNetwork: result.requestedNetwork,
			requiresProjectCodeConsent: result.requiresProjectCodeConsent,
		});
	}
	return snapshots;
}

function plannerContext(
	files: Record<string, string>,
	pluginId: string,
): StartPlannerContext {
	const context: PluginContext = {
		inventory: Object.entries(files).map(([filePath, content]) => ({
			path: filePath,
			sizeBytes: Buffer.byteLength(content),
		})),
		limits: {
			maxFiles: 100,
			maxFileBytes: 1024 * 1024,
			maxTotalBytes: 4 * 1024 * 1024,
		},
		async readText(relativePath): Promise<BoundedTextResult> {
			const text = files[relativePath];
			return text === undefined
				? { ok: false, reason: "not_found" }
				: { ok: true, text, sizeBytes: Buffer.byteLength(text) };
		},
	};
	return {
		...context,
		port: 43123,
		requestedPortExplicit: true,
		activePluginIds: ["language.python", pluginId],
	};
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(filePath, "utf8")) as Record<
		string,
		unknown
	>;
}

function sha256(value: Uint8Array | string): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function gitOutput(args: string[]): Promise<string> {
	const process = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(process.stdout).text();
	const stderr = await new Response(process.stderr).text();
	if ((await process.exited) !== 0) {
		throw new Error(
			`phase_53_git_command_failed:${args.join("_")}:${stderr.trim()}`,
		);
	}
	return stdout.trim();
}
