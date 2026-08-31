import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { SCAN_PROFILE_CATALOG } from "../api/modules/scans/profile-catalog";
import type { ScanProfileCatalogEntry } from "../shared/schemas/scan-profile-catalog.schema";

const BASELINE_PATH = path.join(
	process.cwd(),
	"spec/security-capability/scan-profile-stability-baseline.v1.json",
);

const EXPERIMENTAL_PROFILE_IDS = [
	"dynamic-verification",
	"authenticated-web",
	"api-readonly",
	"active-technical-lab",
	"business-logic-lab",
	"remediation-verification",
] as const;

type EvidenceEligibility = "reference_only" | "missing";

type ExperimentalInventory = {
	profileId: (typeof EXPERIMENTAL_PROFILE_IDS)[number];
	executionEntry: string;
	executionDefinition: string;
	testPath: string;
	benchmarkPath: string | null;
	evidence: {
		eligibility: EvidenceEligibility;
		path: string | null;
		commit: string | null;
		sha256: string | null;
	};
	knownLimitations: string[];
};

export type ScanProfileStabilityBaseline = {
	schemaVersion: 1;
	generatedAt: string;
	sourceRevision: string | null;
	catalogHash: string;
	entries: Array<{
		id: string;
		availability: ScanProfileCatalogEntry["availability"];
		claim: {
			displayName: string;
			description: string;
			capabilityRequirements: ScanProfileCatalogEntry["capabilityRequirements"];
		};
		launchDestination: ScanProfileCatalogEntry["launchDestination"];
		safetyClass: ScanProfileCatalogEntry["safetyClass"];
		entryHash: string;
	}>;
	experimentalInventory: ExperimentalInventory[];
};

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function experimentalInventory(): Omit<ExperimentalInventory, "evidence">[] {
	return [
		{
			profileId: "dynamic-verification",
			executionEntry: "api/routes/dynamic.route.ts",
			executionDefinition: "api/modules/dynamic/dynamic-profiles.ts",
			testPath: "api/modules/dynamic/dynamic-runner.test.ts",
			benchmarkPath: null,
			knownLimitations: ["experimental", "isolated_workspace_required"],
		},
		{
			profileId: "authenticated-web",
			executionEntry: "api/routes/dast-auth.route.ts",
			executionDefinition: "api/modules/dast/profiles.ts",
			testPath: "api/routes/dast-auth.route.test.ts",
			benchmarkPath: "scripts/benchmark/dast-standard.ts",
			knownLimitations: ["experimental", "auth_context_required"],
		},
		{
			profileId: "api-readonly",
			executionEntry: "api/cli/scan-profile.ts",
			executionDefinition: "api/modules/api-schema-fuzz/schemathesis-runner.ts",
			testPath: "api/modules/api-schema-fuzz/schema-discovery.test.ts",
			benchmarkPath: "scripts/benchmark/dast-standard.ts",
			knownLimitations: ["experimental", "schema_required"],
		},
		{
			profileId: "active-technical-lab",
			executionEntry: "api/routes/dast.route.ts",
			executionDefinition: "api/modules/runtime-scans/zap-active-runner.ts",
			testPath: "api/modules/runtime-scans/zap-active-runner.test.ts",
			benchmarkPath: "scripts/benchmark/dast-real-scanners.ts",
			knownLimitations: [
				"experimental",
				"disposable_target_required",
				"roe_required",
			],
		},
		{
			profileId: "business-logic-lab",
			executionEntry: "api/routes/business-logic.route.ts",
			executionDefinition:
				"api/modules/business-logic/business-logic-runner.ts",
			testPath: "api/modules/business-logic/business-logic-runner.test.ts",
			benchmarkPath: "scripts/benchmark/business-logic.ts",
			knownLimitations: [
				"experimental",
				"disposable_target_required",
				"roe_required",
			],
		},
		{
			profileId: "remediation-verification",
			executionEntry: "api/routes/reproductions.route.ts",
			executionDefinition: "api/modules/reproductions/reproduction-runner.ts",
			testPath: "api/modules/reproductions/reproduction-runner.test.ts",
			benchmarkPath: null,
			knownLimitations: ["experimental", "original_safety_boundary_required"],
		},
	];
}

async function evidenceFor(
	profileId: ExperimentalInventory["profileId"],
): Promise<ExperimentalInventory["evidence"]> {
	const evidenceByProfile: Partial<
		Record<ExperimentalInventory["profileId"], string>
	> = {
		"active-technical-lab": "spec/evidence/phase-50-zap-active-capability.json",
		"authenticated-web": "spec/evidence/phase-51-dast-baseline.json",
		"api-readonly": "spec/evidence/phase-51-dast-baseline.json",
		"remediation-verification":
			"spec/security-capability/scan-execution-remediation-closeout.v1.json",
	};
	const evidencePath = evidenceByProfile[profileId];
	if (!evidencePath) {
		return { eligibility: "missing", path: null, commit: null, sha256: null };
	}
	const resolved = path.join(process.cwd(), evidencePath);
	const bytes = await fs.readFile(resolved);
	return {
		eligibility: "reference_only",
		path: evidencePath,
		commit: await gitRevision(),
		sha256: sha256(bytes),
	};
}

async function verifyInventoryPaths(
	entry: Omit<ExperimentalInventory, "evidence">,
) {
	const paths = [
		entry.executionEntry,
		entry.executionDefinition,
		entry.testPath,
		...(entry.benchmarkPath ? [entry.benchmarkPath] : []),
	];
	for (const inventoryPath of paths) {
		try {
			await fs.access(path.join(process.cwd(), inventoryPath));
		} catch {
			throw new Error(
				`scan_profile_stability_inventory_path_missing:${entry.profileId}:${inventoryPath}`,
			);
		}
	}
}

async function gitRevision(): Promise<string | null> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], {
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "ignore",
	});
	if ((await child.exited) !== 0) return null;
	const revision = (await new Response(child.stdout).text()).trim();
	return /^[a-f0-9]{40}$/.test(revision) ? revision : null;
}

export async function buildScanProfileStabilityBaseline(params: {
	generatedAt: string;
	sourceRevision: string | null;
}): Promise<ScanProfileStabilityBaseline> {
	const entries = SCAN_PROFILE_CATALOG.map((entry) => ({
		id: entry.id,
		availability: entry.availability,
		claim: {
			displayName: entry.displayName,
			description: entry.description,
			capabilityRequirements: entry.capabilityRequirements,
		},
		launchDestination: entry.launchDestination,
		safetyClass: entry.safetyClass,
		entryHash: sha256(canonicalJson(entry)),
	}));
	return {
		schemaVersion: 1,
		generatedAt: params.generatedAt,
		sourceRevision: params.sourceRevision,
		catalogHash: sha256(canonicalJson(SCAN_PROFILE_CATALOG)),
		entries,
		experimentalInventory: await Promise.all(
			experimentalInventory().map(async (entry) => {
				await verifyInventoryPaths(entry);
				return { ...entry, evidence: await evidenceFor(entry.profileId) };
			}),
		),
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			write: { type: "boolean", default: false },
			check: { type: "boolean", default: false },
		},
	});
	if (values.write === values.check) {
		throw new Error("Specify exactly one of --write or --check.");
	}
	const baseline = await buildScanProfileStabilityBaseline({
		generatedAt: new Date().toISOString(),
		sourceRevision: await gitRevision(),
	});
	if (values.write) {
		await fs.writeFile(
			BASELINE_PATH,
			`${JSON.stringify(baseline, null, "\t")}\n`,
		);
		return;
	}
	const stored = JSON.parse(
		await fs.readFile(BASELINE_PATH, "utf8"),
	) as ScanProfileStabilityBaseline;
	// The stored revision identifies the deliberate baseline snapshot. It must not
	// make every subsequent implementation commit fail this catalog-contract check.
	const comparable = {
		...baseline,
		generatedAt: stored.generatedAt,
		sourceRevision: stored.sourceRevision,
	};
	if (canonicalJson(stored) !== canonicalJson(comparable)) {
		throw new Error(
			"scan_profile_stability_baseline_mismatch: run bun run scripts/scan-profile-stability-baseline.ts --write only when intentionally updating the promotion baseline.",
		);
	}
}

if (import.meta.main) await main();
