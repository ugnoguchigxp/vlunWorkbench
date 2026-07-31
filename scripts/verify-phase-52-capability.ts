import crypto from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { builtInTechnologyPluginRegistry } from "../api/plugins/builtin";

const baselinePath = "spec/evidence/phase-52-plugin-refactor-baseline.json";
const scannerManifestPath =
	"docker/toolbox/scanner-data/scanner-data-manifest.json";
const semgrepRoot = "docker/toolbox/scanner-data/semgrep-rules";
const fixtureRoots = [
	"tests/security-capability/java-maven",
	"tests/security-capability/java-gradle",
	"tests/security-capability/osv/Maven",
	"tests/security-capability/osv/Gradle",
] as const;
const expectedPluginIds = [
	"build.gradle",
	"build.maven",
	"build.npm",
	"framework.java.spring",
	"framework.typescript.express",
	"framework.typescript.fastify",
	"framework.typescript.hono",
	"language.java",
	"language.typescript",
] as const;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const baselineSchema = z
	.object({
		schemaVersion: z.literal(1),
		phase: z.literal("52"),
		generatedAt: z.string().datetime(),
		implementationBaselineCommit: z.string().regex(/^[a-f0-9]{40}$/),
		hardStartGate: z.object({
			status: z.literal("passed"),
			commands: z
				.array(
					z.object({
						command: z.string().min(1),
						status: z.literal("passed"),
					}),
				)
				.min(6),
		}),
		hashes: z.object({
			scannerDataManifest: sha256Schema,
			scannerDataManifestFile: sha256Schema,
			semgrepCatalog: sha256Schema,
			semgrepRules: z.object({
				typescript: sha256Schema,
				javascript: sha256Schema,
				java: sha256Schema,
			}),
			toolboxImage: sha256Schema.nullable(),
		}),
		toolboxImageLimitation: z.string().min(1).nullable(),
		behaviorInventory: z.record(z.string(), z.unknown()),
		baselineKnownGaps: z.array(z.string().min(1)).min(1),
		inheritedReleaseGates: z.array(z.string().min(1)).min(1),
	})
	.strict();

const baselineText = await readFile(baselinePath, "utf8");
const baseline = baselineSchema.parse(JSON.parse(baselineText) as unknown);
assertPortableEvidence(baselineText);
await assertAncestor(baseline.implementationBaselineCommit);

const scannerManifestBytes = await readFile(scannerManifestPath);
const scannerManifest = JSON.parse(
	new TextDecoder().decode(scannerManifestBytes),
) as { manifestHash?: unknown };
if (scannerManifest.manifestHash !== baseline.hashes.scannerDataManifest) {
	throw new Error("phase_52_scanner_manifest_hash_drift");
}
if (sha256(scannerManifestBytes) !== baseline.hashes.scannerDataManifestFile) {
	throw new Error("phase_52_scanner_manifest_file_digest_drift");
}

const catalogBytes = await readFile(path.join(semgrepRoot, "catalog.json"));
if (sha256(catalogBytes) !== baseline.hashes.semgrepCatalog) {
	throw new Error("phase_52_semgrep_catalog_digest_drift");
}

const pluginIds = builtInTechnologyPluginRegistry
	.plugins()
	.map((plugin) => plugin.manifest.id)
	.sort((left, right) => left.localeCompare(right));
if (JSON.stringify(pluginIds) !== JSON.stringify(expectedPluginIds)) {
	throw new Error(
		`phase_52_builtin_plugin_set_mismatch:${pluginIds.join(",")}`,
	);
}

const ruleDigests: Record<string, string> = {};
for (const contribution of builtInTechnologyPluginRegistry.semgrepRules()) {
	const bytes = await readFile(path.join(semgrepRoot, contribution.path));
	const actual = sha256(bytes);
	if (actual !== contribution.digest) {
		throw new Error(
			`phase_52_semgrep_contribution_digest_mismatch:${contribution.pluginId}:${contribution.path}`,
		);
	}
	ruleDigests[contribution.path] = actual;
}
if (
	ruleDigests["typescript/owned-core.yml"] !==
		baseline.hashes.semgrepRules.typescript ||
	ruleDigests["javascript/owned-core.yml"] !==
		baseline.hashes.semgrepRules.javascript ||
	ruleDigests["java/owned-core.yml"] !== baseline.hashes.semgrepRules.java
) {
	throw new Error("phase_52_baseline_rule_digest_mismatch");
}

const fixtureDigest = await digestTrees(fixtureRoots);
const gitCommit = await gitOutput(["rev-parse", "HEAD"]);
const workingTreeStatus = await gitOutput(["status", "--short"]);
const osvArtifact = await readOptionalJson(
	".artifacts/benchmark/osv-offline-fixtures.json",
);
const artifact = {
	schemaVersion: 1,
	phase: "52",
	generatedAt: new Date().toISOString(),
	sourceCommit: gitCommit,
	workingTreeClean: workingTreeStatus.length === 0,
	verificationLevel: "local",
	registryDigest: builtInTechnologyPluginRegistry.registryDigest,
	builtInPluginIds: pluginIds,
	scannerData: {
		manifestHash: baseline.hashes.scannerDataManifest,
		manifestFileDigest: baseline.hashes.scannerDataManifestFile,
	},
	semgrep: {
		catalogDigest: baseline.hashes.semgrepCatalog,
		ruleDigests,
	},
	fixtures: {
		digest: fixtureDigest,
		roots: fixtureRoots,
	},
	offlineSca: {
		networkRequests:
			typeof osvArtifact?.networkRequests === "number"
				? osvArtifact.networkRequests
				: 0,
		databaseSupplied: osvArtifact?.databaseSupplied === true,
	},
	toolboxImageDigest: baseline.hashes.toolboxImage,
	limitations: [
		...(baseline.toolboxImageLimitation
			? [baseline.toolboxImageLimitation]
			: []),
		...(osvArtifact?.databaseSupplied === true
			? []
			: ["offline_vulnerability_database_not_supplied"]),
		"java_dast_sandbox_execution_not_implemented",
		...(workingTreeStatus.length === 0
			? []
			: ["release_same_commit_clean_checkout_not_claimed"]),
	],
};
const artifactPath = path.resolve(
	".artifacts/benchmark/phase-52-capability.json",
);
await mkdir(path.dirname(artifactPath), { recursive: true });
await Bun.write(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, artifactPath, ...artifact }));

function sha256(value: Uint8Array | string): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function digestTrees(
	roots: readonly string[],
): Promise<`sha256:${string}`> {
	const hash = crypto.createHash("sha256");
	for (const root of roots) {
		for (const file of await listFiles(root)) {
			hash.update(`${file}\0`);
			hash.update(await readFile(file));
			hash.update("\0");
		}
	}
	return `sha256:${hash.digest("hex")}`;
}

async function listFiles(root: string): Promise<string[]> {
	const output: string[] = [];
	await walk(root);
	return output.sort((left, right) => left.localeCompare(right));

	async function walk(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(entryPath);
			} else if (entry.isFile()) {
				output.push(entryPath.split(path.sep).join("/"));
			}
		}
	}
}

async function assertAncestor(commit: string): Promise<void> {
	const process = Bun.spawn(
		["git", "merge-base", "--is-ancestor", commit, "HEAD"],
		{ stdout: "ignore", stderr: "pipe" },
	);
	if ((await process.exited) !== 0) {
		throw new Error("phase_52_baseline_commit_is_not_ancestor");
	}
}

async function gitOutput(args: string[]): Promise<string> {
	const process = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`phase_52_git_command_failed:${stderr.trim()}`);
	}
	return stdout.trim();
}

async function readOptionalJson(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	const text = await readFile(filePath, "utf8").catch(() => null);
	return text ? (JSON.parse(text) as Record<string, unknown>) : null;
}

function assertPortableEvidence(text: string): void {
	if (
		/(?:\/Users\/|\/home\/|[A-Z]:\\\\Users\\\\)/.test(text) ||
		/(?:authorization|cookie|password|secret)\s*[:=]\s*[^\s"]+/i.test(text)
	) {
		throw new Error("phase_52_baseline_contains_secret_or_absolute_home_path");
	}
}
