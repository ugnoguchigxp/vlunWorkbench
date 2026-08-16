import { lstat, readFile } from "node:fs/promises";
import { z } from "zod";
import {
	phase55BaselineEvidenceSchema,
	phase55BaselineInputSnapshotSchema,
} from "../shared/schemas/phase-55-evidence.schema";
import { phase54CloseoutReportSchema } from "../shared/schemas/release-evidence.schema";
import { assertEvidencePrivacy, sha256 } from "./phase-54-baseline-lib";
import {
	PHASE_54_CLOSEOUT_EVIDENCE_REF,
	PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
	PHASE_55_BASELINE_INPUT_PATHS,
	PHASE_55_PROFILE_DEFINITION_PATHS,
	assertPhase55DiagnosticSourceBindings,
	phase55FileSetHash,
	phase55ProfessionalReportSchema,
	assertPhase55TrackedInputBindings,
} from "./phase-55-baseline-lib";

const baselinePath = "spec/evidence/phase-55-baseline.json";
const baselineInputSnapshotPath = "spec/evidence/phase-55-baseline-inputs.json";
const maxEvidenceFileBytes = 16 * 1024 * 1024;
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const scannerManifestSchema = z.object({
	manifestHash: digestSchema,
	tools: z.object({
		osv: z
			.object({
				dataBundles: z.array(
					z.object({
						kind: z.string(),
						coverage: z.array(z.string()),
					}),
				),
			})
			.optional(),
	}),
});
const semgrepCatalogSchema = z.object({
	rules: z.array(z.object({ language: z.string().min(1) })),
});
const scopeCatalogSchema = z.object({
	capabilities: z.array(
		z.object({
			id: z.string().min(1),
			tier: z.enum(["supported", "experimental", "unsupported"]),
		}),
	),
});

if (process.argv.length > 2)
	throw new Error("phase_55_baseline_verifier_argument_invalid");

const baselineBytes = await readEvidenceFile(baselinePath);
const baselineText = new TextDecoder().decode(baselineBytes);
assertEvidencePrivacy(baselineText);
const baseline = phase55BaselineEvidenceSchema.parse(
	JSON.parse(baselineText) as unknown,
);
const baselineInputSnapshotBytes = await readEvidenceFile(
	baselineInputSnapshotPath,
);
const baselineInputSnapshotText = new TextDecoder().decode(
	baselineInputSnapshotBytes,
);
assertEvidencePrivacy(baselineInputSnapshotText);
const baselineInputSnapshot = phase55BaselineInputSnapshotSchema.parse(
	JSON.parse(baselineInputSnapshotText) as unknown,
);
assertPhase55TrackedInputBindings({
	baseline,
	inputSnapshot: baselineInputSnapshot,
	inputSnapshotHash: sha256(baselineInputSnapshotBytes),
});
const diagnosticProfessionalBytes = await readEvidenceFile(
	PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
);
const diagnosticProfessionalText = new TextDecoder().decode(
	diagnosticProfessionalBytes,
);
assertEvidencePrivacy(diagnosticProfessionalText);
assertPhase55DiagnosticSourceBindings({
	inputSnapshot: baselineInputSnapshot,
	sourceReport: phase55ProfessionalReportSchema.parse(
		JSON.parse(diagnosticProfessionalText),
	),
	sourceArtifactHash: sha256(diagnosticProfessionalBytes),
});
await assertAncestor(baseline.planningBaselineCommit);
const expectedCapturedAt = new Date(
	await gitText([
		"show",
		"-s",
		"--format=%cI",
		baseline.planningBaselineCommit,
	]),
).toISOString();
if (baseline.capturedAt !== expectedCapturedAt) {
	throw new Error("phase_55_baseline_capture_time_mismatch");
}

const historicalInputs = Object.fromEntries(
	await Promise.all(
		Object.entries(PHASE_55_BASELINE_INPUT_PATHS).map(
			async ([key, filePath]) =>
				[
					key,
					await gitBytes([
						"show",
						`${baseline.planningBaselineCommit}:${filePath}`,
					]),
				] as const,
		),
	),
) as Record<keyof typeof PHASE_55_BASELINE_INPUT_PATHS, Uint8Array>;
const expectedHashes = {
	benchmarkPolicy: sha256(historicalInputs.benchmarkPolicy),
	scopeCatalog: sha256(historicalInputs.scopeCatalog),
	corpusLock: sha256(historicalInputs.corpusLock),
	scannerManifestFile: sha256(historicalInputs.scannerManifestFile),
	semgrepCatalog: sha256(historicalInputs.semgrepCatalog),
};
for (const [key, expected] of Object.entries(expectedHashes) as Array<
	[keyof typeof expectedHashes, string]
>) {
	if (baseline.hashes[key] !== expected) {
		throw new Error(`phase_55_baseline_hash_mismatch:${key}`);
	}
}
const profileDefinitionFiles = await Promise.all(
	PHASE_55_PROFILE_DEFINITION_PATHS.map(
		async (filePath) =>
			[
				filePath,
				await gitBytes([
					"show",
					`${baseline.planningBaselineCommit}:${filePath}`,
				]),
			] as const,
	),
);
if (
	baseline.hashes.profileDefinitions !==
	phase55FileSetHash(profileDefinitionFiles)
) {
	throw new Error("phase_55_baseline_hash_mismatch:profileDefinitions");
}

const scannerManifest = scannerManifestSchema.parse(
	JSON.parse(new TextDecoder().decode(historicalInputs.scannerManifestFile)),
);
if (baseline.hashes.scannerManifest !== scannerManifest.manifestHash) {
	throw new Error("phase_55_baseline_manifest_hash_mismatch");
}
const semgrepCatalog = semgrepCatalogSchema.parse(
	JSON.parse(new TextDecoder().decode(historicalInputs.semgrepCatalog)),
);
const expectedLanguages = [
	...new Set(semgrepCatalog.rules.map((rule) => rule.language)),
].sort();
if (
	baseline.inventory.ownedSemgrepRules !== semgrepCatalog.rules.length ||
	JSON.stringify(baseline.inventory.semgrepLanguages) !==
		JSON.stringify(expectedLanguages)
) {
	throw new Error("phase_55_baseline_semgrep_inventory_mismatch");
}
const expectedEcosystems = [
	...new Set(
		(scannerManifest.tools.osv?.dataBundles ?? [])
			.filter((bundle) => bundle.kind === "vulnerability-db")
			.flatMap((bundle) => bundle.coverage),
	),
].sort();
if (
	JSON.stringify(baseline.inventory.osvEcosystems) !==
	JSON.stringify(expectedEcosystems)
) {
	throw new Error("phase_55_baseline_osv_inventory_mismatch");
}
const scopeCatalog = scopeCatalogSchema.parse(
	JSON.parse(new TextDecoder().decode(historicalInputs.scopeCatalog)),
);
const expectedUnsupported = scopeCatalog.capabilities
	.filter((capability) => capability.tier !== "supported")
	.map((capability) => capability.id)
	.sort();
if (
	JSON.stringify(baseline.professionalCapability.unsupportedCapabilities) !==
	JSON.stringify(expectedUnsupported)
) {
	throw new Error("phase_55_baseline_unsupported_capability_mismatch");
}

const trackedFiles = (
	await gitText([
		"ls-tree",
		"-r",
		"--name-only",
		baseline.planningBaselineCommit,
	])
)
	.split("\n")
	.filter(Boolean);
if (baseline.inventory.testFiles !== countTestFiles(trackedFiles)) {
	throw new Error("phase_55_baseline_test_inventory_mismatch");
}

if (baseline.phase54Closeout.availability === "verified") {
	const closeoutBytes = await readEvidenceFile(PHASE_54_CLOSEOUT_EVIDENCE_REF);
	const closeoutText = new TextDecoder().decode(closeoutBytes);
	assertEvidencePrivacy(closeoutText);
	const closeout = phase54CloseoutReportSchema.parse(JSON.parse(closeoutText));
	if (
		sha256(closeoutBytes) !== baseline.phase54Closeout.reportHash ||
		closeout.releaseCommit !== baseline.planningBaselineCommit ||
		JSON.stringify(closeout.inputHashes) !==
			JSON.stringify(baseline.phase54Closeout.inputHashes) ||
		closeout.professionalReportHash !==
			baseline.phase54Closeout.professionalReportHash
	) {
		throw new Error("phase_55_baseline_phase_54_closeout_mismatch");
	}
}
console.log(
	JSON.stringify({
		baselineValid: true,
		phase: baseline.phase,
		planningBaselineCommit: baseline.planningBaselineCommit,
		inputHashesVerifiedAtBaselineCommit:
			Object.keys(PHASE_55_BASELINE_INPUT_PATHS).length + 1,
		phase54Closeout: baseline.phase54Closeout.gateState,
		productionSlicesStartAllowed: baseline.productionSliceEntry.allowed,
		professionalEvidenceSource: baseline.professionalCapability.source,
	}),
);

function countTestFiles(files: string[]): number {
	const ignoredEverywhere = new Set([
		".git",
		".artifacts",
		".cache",
		".tmp",
		"build",
		"coverage",
		"data",
		"dist",
		"dist-web",
		"node_modules",
		"playwright-report",
		"test-results",
	]);
	return files.filter((file) => {
		if (!/\.test\.(?:ts|tsx)$/.test(file)) return false;
		const parts = file.split("/");
		return (
			!parts.some((part) => ignoredEverywhere.has(part)) &&
			parts[0] !== "artifacts"
		);
	}).length;
}

async function readEvidenceFile(filePath: string): Promise<Uint8Array> {
	const metadata = await lstat(filePath);
	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		throw new Error(`phase_55_evidence_file_type_invalid:${filePath}`);
	}
	if (metadata.size > maxEvidenceFileBytes) {
		throw new Error(`phase_55_evidence_file_too_large:${filePath}`);
	}
	return new Uint8Array(await readFile(filePath));
}

async function assertAncestor(commit: string): Promise<void> {
	const child = Bun.spawn(
		["git", "merge-base", "--is-ancestor", commit, "HEAD"],
		{
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	if ((await child.exited) !== 0) {
		throw new Error("phase_55_baseline_commit_is_not_ancestor");
	}
}

async function gitText(args: string[]): Promise<string> {
	return new TextDecoder().decode(await gitBytes(args)).trim();
}

async function gitBytes(args: string[]): Promise<Uint8Array> {
	const child = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`phase_55_git_command_failed:${stderr.trim()}`);
	}
	return new Uint8Array(stdout);
}
