import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
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
const scannerDataManifestSchema = z.object({
	version: z.literal(1),
	snapshotDate: z.string().date(),
	manifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	tools: z.record(z.string(), scannerDataEntrySchema),
});
export type ScannerDataManifest = z.infer<typeof scannerDataManifestSchema>;

export class ScannerProvenanceError extends Error {
	readonly code = "SCANNER_PROVENANCE_INVALID";
}

export async function loadScannerDataManifest(
	manifestPath = defaultManifestPath(),
): Promise<ScannerDataManifest> {
	let parsed: ScannerDataManifest;
	try {
		parsed = scannerDataManifestSchema.parse(
			JSON.parse(await fs.readFile(manifestPath, "utf8")),
		);
	} catch (error) {
		throw new ScannerProvenanceError(
			`Scanner data manifest is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const { manifestHash, ...hashInput } = parsed;
	const actualManifestHash = hashValue(canonicalJson(hashInput));
	if (manifestHash !== actualManifestHash) {
		throw new ScannerProvenanceError(
			`Scanner data manifest hash mismatch: expected ${manifestHash}, got ${actualManifestHash}`,
		);
	}
	const root = path.dirname(manifestPath);
	for (const [toolId, entry] of Object.entries(parsed.tools)) {
		if (entry.state !== "ready" || !entry.path) continue;
		const actualDigest = await hashTree(path.resolve(root, entry.path));
		if (entry.digest !== actualDigest) {
			throw new ScannerProvenanceError(
				`Scanner data digest mismatch for ${toolId}: expected ${entry.digest}, got ${actualDigest}`,
			);
		}
	}
	const now = Date.now();
	for (const entry of Object.values(parsed.tools)) {
		if (!entry.generatedAt || !entry.maxAgeHours || entry.state !== "ready")
			continue;
		if (
			now - Date.parse(entry.generatedAt) >
			entry.maxAgeHours * 60 * 60 * 1000
		) {
			entry.state = "stale";
		}
	}
	return parsed;
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
		);
	}
	if (params.execution.runner === "docker" && entry.state !== "ready") {
		throw new ScannerProvenanceError(
			`Offline scanner data is ${entry.state} for required Docker tool ${params.toolId}`,
		);
	}
	const semgrepConfig = params.config ?? "owned";
	const exploratoryConfig =
		params.toolId === "semgrep" && semgrepConfig === "auto";
	const ownedSemgrepConfig =
		params.toolId === "semgrep" &&
		(semgrepConfig === "owned" ||
			semgrepConfig === entry.runtimePath ||
			semgrepConfig.endsWith("/docker/toolbox/scanner-data/semgrep-rules"));
	const reproducibleConfig = params.toolId !== "semgrep" || ownedSemgrepConfig;
	return {
		manifestVersion: manifest.version,
		manifestHash: manifest.manifestHash,
		snapshotDate: manifest.snapshotDate,
		toolVersion: entry.version,
		dataKind: entry.dataKind,
		dataState: entry.state,
		dataDigest: entry.digest,
		runtimePath: entry.runtimePath,
		reproducible: entry.state === "ready" && reproducibleConfig,
		configSource: exploratoryConfig
			? "semgrep-registry-auto"
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
	manifest: Omit<ScannerDataManifest, "manifestHash">,
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
