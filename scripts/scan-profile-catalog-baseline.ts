import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { ScanProfile } from "../shared/schemas/scan-profile.schema";
import { buildScanProfiles } from "../api/modules/scans/profiles";

const BASELINE_PATH = path.join(
	process.cwd(),
	"spec/security-capability/scan-profile-catalog-baseline.v1.json",
);

type ConsumerKind =
	| "migrate"
	| "preserve_contract"
	| "historical"
	| "test_fixture"
	| "none";

type Consumer = { kind: ConsumerKind; ref: string };

export type ScanProfileCatalogBaseline = {
	schemaVersion: 1;
	generatedAt: string;
	sourceRevision: string | null;
	variants: Array<{
		optionalAdapterIds: string[];
		definitionCount: number;
		enabledCount: number;
		disabledIds: string[];
		profiles: Array<{
			id: string;
			enabled: boolean;
			supportedTargets: string[];
			strictness: "strict" | "best_effort";
			defaultTimeoutSec: number;
			executionFingerprint: string;
			knownConsumers: Consumer[];
		}>;
	}>;
};

const CONSUMERS: Record<string, Consumer[]> = {
	"agent-output": [
		{ kind: "preserve_contract", ref: "api/cli/oracle-security.ts" },
	],
	baseline: [
		{ kind: "migrate", ref: "api/cli/scan-profile.ts" },
		{ kind: "migrate", ref: "api/routes/projects.route.ts" },
		{ kind: "migrate", ref: "web/src/domains/scans/scan-launch-state.ts" },
	],
	"source-baseline": [
		{
			kind: "preserve_contract",
			ref: "api/modules/integrations/nightworkers/nightworkers-scan-preset-registry.ts",
		},
	],
	"diff-source-baseline": [
		{ kind: "migrate", ref: "api/routes/projects.route.ts" },
		{
			kind: "preserve_contract",
			ref: "api/modules/integrations/nightworkers/nightworkers-scan-preset-registry.ts",
		},
	],
	"diff-basic-security": [
		{
			kind: "preserve_contract",
			ref: "api/modules/integrations/nightworkers/nightworkers-scan-preset-registry.ts",
		},
	],
	"basic-security": [
		{
			kind: "preserve_contract",
			ref: "api/modules/integrations/nightworkers/nightworkers-scan-preset-registry.ts",
		},
	],
	"detailed-security": [
		{
			kind: "preserve_contract",
			ref: "api/modules/integrations/nightworkers/nightworkers-scan-preset-registry.ts",
		},
	],
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

function executionFingerprint(profile: ScanProfile): string {
	const {
		id: _id,
		name: _name,
		description: _description,
		category: _category,
		coverageGaps: _coverageGaps,
		...execution
	} = profile;
	return `sha256:${createHash("sha256")
		.update(canonicalJson(execution))
		.digest("hex")}`;
}

function profileBaseline(profile: ScanProfile) {
	return {
		id: profile.id,
		enabled: profile.enabled,
		supportedTargets: [...(profile.supportedTargets ?? ["full"])].sort(),
		strictness: profile.strictness ?? "best_effort",
		defaultTimeoutSec: profile.defaultTimeoutSec,
		executionFingerprint: executionFingerprint(profile),
		knownConsumers: CONSUMERS[profile.id] ?? [
			{ kind: "none" as const, ref: "no known direct consumer" },
		],
	};
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

export async function buildScanProfileCatalogBaseline(params: {
	generatedAt: string;
	sourceRevision: string | null;
}): Promise<ScanProfileCatalogBaseline> {
	const optionalVariants = [[], ["semgrep"]] as const;
	return {
		schemaVersion: 1,
		generatedAt: params.generatedAt,
		sourceRevision: params.sourceRevision,
		variants: optionalVariants.map((optionalAdapterIds) => {
			const profiles = buildScanProfiles({ optionalAdapterIds });
			return {
				optionalAdapterIds: [...optionalAdapterIds],
				definitionCount: profiles.length,
				enabledCount: profiles.filter((profile) => profile.enabled).length,
				disabledIds: profiles
					.filter((profile) => !profile.enabled)
					.map((profile) => profile.id)
					.sort(),
				profiles: profiles.map(profileBaseline),
			};
		}),
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
	const baseline = await buildScanProfileCatalogBaseline({
		generatedAt: new Date().toISOString(),
		sourceRevision: await gitRevision(),
	});
	if (values.write) {
		await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
		await fs.writeFile(
			BASELINE_PATH,
			`${JSON.stringify(baseline, null, "\t")}\n`,
		);
		return;
	}
	const stored = JSON.parse(
		await fs.readFile(BASELINE_PATH, "utf8"),
	) as ScanProfileCatalogBaseline;
	const comparable = { ...baseline, generatedAt: stored.generatedAt };
	if (canonicalJson(stored) !== canonicalJson(comparable)) {
		throw new Error(
			"scan_profile_catalog_baseline_mismatch: run bun run scripts/scan-profile-catalog-baseline.ts --write only when intentionally refreshing the legacy contract.",
		);
	}
}

if (import.meta.main) await main();
