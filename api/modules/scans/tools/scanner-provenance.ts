import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scannerDataManifestV2Schema } from "../../../../shared/schemas/security-capability.schema";
import { canonicalJson } from "../diff-scan-plan";
import type { ToolExecutionConfig } from "./tool-process-runner";

const scannerDataEntrySchema = z.object({
	version: z.string().min(1),
	dataKind: z.string().min(1),
	state: z.enum(["ready", "missing", "stale"]),
	path: z.string().nullable(),
	runtimePath: z.string().nullable(),
	digest: z.string().nullable(),
	sourceRef: z.string().min(1).optional(),
	generatedAt: z.string().datetime().optional(),
	maxAgeHours: z.number().positive().optional(),
	coverage: z.array(z.string().min(1)).optional(),
});
const scannerDataManifestV1Schema = z.object({
	version: z.literal(1),
	snapshotDate: z.string().date(),
	manifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	tools: z.record(z.string(), scannerDataEntrySchema),
});
const scannerDataManifestSchema = z.union([
	scannerDataManifestV1Schema,
	scannerDataManifestV2Schema,
]);
type ScannerDataManifestInput = z.infer<typeof scannerDataManifestSchema>;

export type ScannerDataEntry = z.infer<typeof scannerDataEntrySchema> & {
	dataBundles?: Array<{
		id: string;
		kind: "ruleset" | "vulnerability-db" | "add-on" | "template";
		sourceRef: string;
		sourceCommit: string | null;
		license: string;
		generatedAt: string;
		maxAgeHours: number;
		digest: string;
		coverage: string[];
		recordCount?: number;
		path?: string | null;
	}>;
};

export type ScannerDataManifest = {
	version: 1 | 2;
	snapshotDate: string;
	generatedAt?: string;
	manifestHash: string;
	legacyManifest: boolean;
	tools: Record<string, ScannerDataEntry>;
};

export class ScannerProvenanceError extends Error {
	readonly code = "SCANNER_PROVENANCE_INVALID";

	constructor(
		message: string,
		readonly reason: "invalid" | "entry_missing" = "invalid",
	) {
		super(message);
	}
}

export async function loadScannerDataManifest(
	manifestPath = defaultManifestPath(),
): Promise<ScannerDataManifest> {
	let input: ScannerDataManifestInput;
	try {
		input = scannerDataManifestSchema.parse(
			JSON.parse(await fs.readFile(manifestPath, "utf8")),
		);
	} catch (error) {
		throw new ScannerProvenanceError(
			`Scanner data manifest is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const { manifestHash, ...hashInput } = input;
	const actualManifestHash = hashValue(canonicalJson(hashInput));
	if (manifestHash !== actualManifestHash) {
		throw new ScannerProvenanceError(
			`Scanner data manifest hash mismatch: expected ${manifestHash}, got ${actualManifestHash}`,
		);
	}
	const parsed = normalizeManifest(input);
	const root = path.dirname(manifestPath);
	for (const [toolId, entry] of Object.entries(parsed.tools)) {
		if (entry.state !== "ready") continue;
		const bundles =
			entry.dataBundles ??
			(entry.path && entry.digest
				? [
						{
							id: toolId,
							kind: "template" as const,
							sourceRef: entry.sourceRef ?? `manifest:${toolId}`,
							sourceCommit: null,
							license: "NOASSERTION",
							generatedAt:
								entry.generatedAt ?? `${parsed.snapshotDate}T00:00:00.000Z`,
							maxAgeHours: entry.maxAgeHours ?? 1,
							digest: entry.digest,
							coverage: entry.coverage ?? [],
							path: entry.path,
						},
					]
				: []);
		for (const bundle of bundles) {
			if (!bundle.path) continue;
			const actualDigest = await hashTree(path.resolve(root, bundle.path));
			if (bundle.digest !== actualDigest) {
				throw new ScannerProvenanceError(
					`Scanner data digest mismatch for ${toolId}/${bundle.id}: expected ${bundle.digest}, got ${actualDigest}`,
				);
			}
		}
	}
	const now = Date.now();
	for (const entry of Object.values(parsed.tools)) {
		if (entry.state !== "ready") continue;
		const stale = (entry.dataBundles ?? []).some(
			(bundle) =>
				now - Date.parse(bundle.generatedAt) >
				bundle.maxAgeHours * 60 * 60 * 1000,
		);
		if (stale) {
			entry.state = "stale";
		} else if (
			entry.generatedAt &&
			entry.maxAgeHours &&
			now - Date.parse(entry.generatedAt) > entry.maxAgeHours * 60 * 60 * 1000
		) {
			entry.state = "stale";
		}
	}
	return parsed;
}

function normalizeManifest(
	input: ScannerDataManifestInput,
): ScannerDataManifest {
	if (input.version === 1) {
		return {
			...input,
			legacyManifest: true,
			tools: structuredClone(input.tools),
		};
	}
	const tools: Record<string, ScannerDataEntry> = {};
	for (const [toolId, tool] of Object.entries(input.tools)) {
		const bundle = tool.dataBundles[0];
		tools[toolId] = {
			version: tool.version,
			dataKind: bundle?.kind ?? "binary",
			state: tool.state,
			path: bundle?.path ?? null,
			runtimePath: tool.runtimePath ?? null,
			digest: bundle?.digest ?? tool.binaryDigest,
			sourceRef: bundle?.sourceRef,
			generatedAt: bundle?.generatedAt,
			maxAgeHours: bundle?.maxAgeHours,
			coverage: tool.dataBundles.flatMap((item) => item.coverage),
			dataBundles: structuredClone(tool.dataBundles),
		};
	}
	return {
		version: 2,
		generatedAt: input.generatedAt,
		snapshotDate: input.generatedAt.slice(0, 10),
		manifestHash: input.manifestHash,
		legacyManifest: false,
		tools,
	};
}

export async function resolveScannerProvenance(params: {
	toolId: string;
	execution: ToolExecutionConfig;
	config?: string;
	manifestPath?: string;
}) {
	const manifest = await loadScannerDataManifest(params.manifestPath);
	const entry = manifest.tools[params.toolId];
	if (!entry) {
		throw new ScannerProvenanceError(
			`Scanner data manifest has no entry for ${params.toolId}`,
			"entry_missing",
		);
	}
	if (params.execution.runner === "docker" && entry.state !== "ready") {
		throw new ScannerProvenanceError(
			`Offline scanner data is ${entry.state} for required Docker tool ${params.toolId}`,
		);
	}
	const semgrepConfig = params.config ?? "curated-sast-v1";
	const exploratoryConfig =
		params.toolId === "semgrep" && semgrepConfig === "auto";
	const ownedSemgrepConfig =
		params.toolId === "semgrep" &&
		(semgrepConfig === "owned" ||
			semgrepConfig === "curated-sast-v1" ||
			semgrepConfig === entry.runtimePath ||
			semgrepConfig.endsWith("/docker/toolbox/scanner-data/semgrep-rules"));
	const reproducibleConfig = params.toolId !== "semgrep" || ownedSemgrepConfig;
	return {
		manifestVersion: manifest.version,
		manifestHash: manifest.manifestHash,
		legacyManifest: manifest.legacyManifest,
		snapshotDate: manifest.snapshotDate,
		toolVersion: entry.version,
		dataKind: entry.dataKind,
		dataState: entry.state,
		dataDigest: entry.digest,
		runtimePath: entry.runtimePath,
		reproducible:
			!manifest.legacyManifest && entry.state === "ready" && reproducibleConfig,
		configSource: exploratoryConfig
			? "semgrep-registry-auto"
			: semgrepConfig === "curated-sast-v1"
				? "curated-manifest"
				: ownedSemgrepConfig
					? "owned-manifest"
					: params.toolId === "semgrep"
						? "custom-unpinned"
						: "manifest",
	};
}

export async function hashTree(root: string): Promise<string> {
	const entries: Array<{ path: string; bytes: Uint8Array }> = [];
	await collectFiles(root, root, entries);
	const hash = crypto.createHash("sha256");
	for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
		hash.update(entry.path);
		hash.update("\0");
		hash.update(entry.bytes);
		hash.update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

export function computeScannerManifestHash(
	manifest: Record<string, unknown>,
): string {
	return hashValue(canonicalJson(manifest));
}

function hashValue(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function collectFiles(
	root: string,
	current: string,
	output: Array<{ path: string; bytes: Uint8Array }>,
): Promise<void> {
	for (const entry of await fs.readdir(current, { withFileTypes: true })) {
		const entryPath = path.join(current, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(root, entryPath, output);
		} else if (entry.isFile()) {
			output.push({
				path: path.relative(root, entryPath).split(path.sep).join("/"),
				bytes: await fs.readFile(entryPath),
			});
		}
	}
}

function defaultManifestPath(): string {
	return (
		process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST ??
		path.resolve(
			process.cwd(),
			"docker/toolbox/scanner-data/scanner-data-manifest.json",
		)
	);
}
