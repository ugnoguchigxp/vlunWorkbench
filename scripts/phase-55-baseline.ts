import { lstat, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
	phase55BaselineEvidenceSchema,
	phase55BaselineInputSnapshotSchema,
	type Phase55BaselineEvidence,
} from "../shared/schemas/phase-55-evidence.schema";
import { assertEvidencePrivacy, sha256 } from "./phase-54-baseline-lib";
import {
	PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
	PHASE_54_CLOSEOUT_EVIDENCE_REF,
	PHASE_55_BASELINE_INPUT_PATHS,
	PHASE_55_PROFILE_DEFINITION_PATHS,
	assertPhase55DiagnosticSourceBindings,
	phase55FileSetHash,
	phase55ProfessionalReportSchema,
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
	throw new Error("phase_55_baseline_argument_invalid");

const baselineInputSnapshotBytes = await requireFile(baselineInputSnapshotPath);
const baselineInputSnapshotText = new TextDecoder().decode(
	baselineInputSnapshotBytes,
);
assertEvidencePrivacy(baselineInputSnapshotText);
const baselineInputSnapshot = phase55BaselineInputSnapshotSchema.parse(
	JSON.parse(baselineInputSnapshotText),
);
const diagnosticProfessionalBytes = await requireFile(
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
const planningBaselineCommit = baselineInputSnapshot.planningBaselineCommit;
const capturedAt = new Date(
	await gitText(["show", "-s", "--format=%cI", planningBaselineCommit]),
).toISOString();
const inputBytes = Object.fromEntries(
	await Promise.all(
		Object.entries(PHASE_55_BASELINE_INPUT_PATHS).map(
			async ([key, filePath]) =>
				[
					key,
					await gitBytes(["show", `${planningBaselineCommit}:${filePath}`]),
				] as const,
		),
	),
) as Record<keyof typeof PHASE_55_BASELINE_INPUT_PATHS, Uint8Array>;
const profileDefinitionFiles = await Promise.all(
	PHASE_55_PROFILE_DEFINITION_PATHS.map(
		async (filePath) =>
			[
				filePath,
				await gitBytes(["show", `${planningBaselineCommit}:${filePath}`]),
			] as const,
	),
);
const profileDefinitionsHash = phase55FileSetHash(profileDefinitionFiles);
if (
	baselineInputSnapshot.profileInventory.profileDefinitionsHash !==
	profileDefinitionsHash
) {
	throw new Error("phase_55_input_snapshot_profile_definitions_mismatch");
}

const scannerManifest = scannerManifestSchema.parse(
	JSON.parse(new TextDecoder().decode(inputBytes.scannerManifestFile)),
);
const semgrepCatalog = semgrepCatalogSchema.parse(
	JSON.parse(new TextDecoder().decode(inputBytes.semgrepCatalog)),
);
const scopeCatalog = scopeCatalogSchema.parse(
	JSON.parse(new TextDecoder().decode(inputBytes.scopeCatalog)),
);
const unsupportedCapabilities = scopeCatalog.capabilities
	.filter((capability) => capability.tier !== "supported")
	.map((capability) => capability.id)
	.sort();
if (
	JSON.stringify(
		baselineInputSnapshot.professionalCapability.unsupportedCapabilities,
	) !== JSON.stringify(unsupportedCapabilities)
) {
	throw new Error("phase_55_input_snapshot_scope_catalog_mismatch");
}
const existingBytes = await readOptionalFile(baselinePath);
const existingBaseline = existingBytes
	? phase55BaselineEvidenceSchema.parse(
			JSON.parse(new TextDecoder().decode(existingBytes)),
		)
	: null;
const closeout = existingBaseline?.phase54Closeout ?? {
	evidenceRef: PHASE_54_CLOSEOUT_EVIDENCE_REF,
	availability: "missing" as const,
	gateState: "blocked" as const,
	reasonCode: "phase_54_authoritative_closeout_missing" as const,
	reportHash: null,
	releaseCommit: null,
	inputHashes: null,
	professionalReportHash: null,
};

const trackedFiles = (
	await gitText(["ls-tree", "-r", "--name-only", planningBaselineCommit])
)
	.split("\n")
	.filter(Boolean);
const profileIds = baselineInputSnapshot.profileInventory.profileIds;
const semgrepLanguages = [
	...new Set(semgrepCatalog.rules.map((rule) => rule.language)),
].sort();
const osvEcosystems = [
	...new Set(
		(scannerManifest.tools.osv?.dataBundles ?? [])
			.filter((bundle) => bundle.kind === "vulnerability-db")
			.flatMap((bundle) => bundle.coverage),
	),
].sort();
const entryAllowed = closeout.availability === "verified";
const baseline: Phase55BaselineEvidence = phase55BaselineEvidenceSchema.parse({
	schemaVersion: 1,
	phase: "55",
	evidenceKind: "planning_baseline",
	capturedAt,
	owner: "vulnWorkbench maintainers",
	planningBaselineCommit,
	phase54Closeout: closeout,
	productionSliceEntry: {
		state: entryAllowed ? "passed" : "blocked",
		allowed: entryAllowed,
		reasonCode: closeout.reasonCode,
	},
	inventory: {
		testFiles: countTestFiles(trackedFiles),
		ownedSemgrepRules: semgrepCatalog.rules.length,
		semgrepLanguages,
		osvEcosystems,
		profileIds,
		optionalSemgrepEnabledByDefault:
			baselineInputSnapshot.profileInventory.optionalSemgrepEnabledByDefault,
	},
	professionalCapability: baselineInputSnapshot.professionalCapability,
	hashes: {
		benchmarkPolicy: sha256(inputBytes.benchmarkPolicy),
		scopeCatalog: sha256(inputBytes.scopeCatalog),
		corpusLock: sha256(inputBytes.corpusLock),
		scannerManifestFile: sha256(inputBytes.scannerManifestFile),
		scannerManifest: scannerManifest.manifestHash,
		semgrepCatalog: sha256(inputBytes.semgrepCatalog),
		profileDefinitions: profileDefinitionsHash,
		baselineInputSnapshot: sha256(baselineInputSnapshotBytes),
	},
	privacy: {
		absoluteHomePathsIncluded: false,
		sourceSnippetsIncluded: false,
		credentialsIncluded: false,
	},
	residualRisk: entryAllowed
		? "Phase 55 production slices remain subject to their own acceptance gates."
		: "Phase 54 authoritative Ubuntu closeout is unavailable; only baseline, schema, fixture design, and documentation work may proceed.",
});
const serialized = `${JSON.stringify(baseline, null, 2)}\n`;
assertEvidencePrivacy(serialized);
if (existingBytes) {
	if (new TextDecoder().decode(existingBytes) !== serialized) {
		throw new Error("phase_55_baseline_exists_with_different_content");
	}
} else {
	await writeFile(baselinePath, serialized, { flag: "wx" });
}
console.log(
	JSON.stringify({
		ok: true,
		outputPath: baselinePath,
		planningBaselineCommit,
		phase54Closeout: closeout.gateState,
		productionSlicesStartAllowed: entryAllowed,
		professionalEvidenceSource:
			baselineInputSnapshot.professionalCapability.source,
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
			!(parts[0] === "artifacts")
		);
	}).length;
}

async function readOptionalFile(filePath: string): Promise<Uint8Array | null> {
	const metadata = await lstat(filePath).catch((error) => {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	});
	if (!metadata) return null;
	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		throw new Error(`phase_55_evidence_file_type_invalid:${filePath}`);
	}
	if (metadata.size > maxEvidenceFileBytes) {
		throw new Error(`phase_55_evidence_file_too_large:${filePath}`);
	}
	return new Uint8Array(await readFile(filePath));
}

async function requireFile(filePath: string): Promise<Uint8Array> {
	const bytes = await readOptionalFile(filePath);
	if (!bytes) throw new Error(`phase_55_evidence_file_missing:${filePath}`);
	return bytes;
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
