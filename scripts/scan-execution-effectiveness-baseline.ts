import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { openReadonlySqliteSnapshot } from "../api/db";

type SqlRecord = Record<string, unknown>;
type SqliteDatabase = ReturnType<typeof openReadonlySqliteSnapshot>;

type BaselineArtifact = {
	id: string;
	kind: string;
	format: string;
	storageKey: string | null;
	sha256: string;
	sizeBytes: number;
};

type BaselineSnapshot = {
	run: {
		id: string;
		profile: string;
		status: string;
		profileOutcome: string;
		metadata: SqlRecord;
	};
	events: Array<{ seq: number; level: string; eventType: string }>;
	tools: Array<{
		toolName: string;
		toolVersion: string | null;
		status: string;
		exitCode: number | null;
		metadata: SqlRecord;
	}>;
	artifacts: BaselineArtifact[];
	coverage: Array<{
		controlId: string;
		status: string;
		method: string;
		reasonCode: string;
		snapshotHash: string;
	}>;
	reports: Array<{
		id: string;
		artifactId: string | null;
		format: string;
		status: string;
		errorCode: string | null;
	}>;
	reviews: Array<{
		id: string;
		provider: string;
		model: string;
		status: string;
	}>;
};

export type ScanExecutionEffectivenessBaseline = {
	schemaVersion: 1;
	generatedAt: string;
	run: {
		id: string;
		profile: string;
		status: string;
		profileOutcome: string;
	};
	preflight: {
		mode: "enforced" | "shadow" | "unknown";
		status: string | null;
		preflightHash: string | null;
		bindingHash: string | null;
		sourceRevision: string | null;
		sourceRevisionHash: string | null;
		sourceState: "clean" | "dirty" | "unknown";
	};
	events: Array<{ seq: number; level: string; eventType: string }>;
	tools: Array<{
		toolName: string;
		recordedRunVersion: string | null;
		status: string;
		exitCode: number | null;
		provenance: {
			manifestHash: string | null;
			expectedVersion: string | null;
			recordedReproducible: boolean | null;
		};
	}>;
	artifacts: Array<
		BaselineArtifact & { recomputedSha256: string; recomputedSizeBytes: number }
	>;
	coverage: BaselineSnapshot["coverage"];
	reports: BaselineSnapshot["reports"];
	reviews: BaselineSnapshot["reviews"];
};

function asRecord(value: unknown): SqlRecord {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as SqlRecord)
		: {};
}

function parseJsonRecord(value: unknown): SqlRecord {
	if (typeof value !== "string") return asRecord(value);
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return {};
	}
}

function nullableString(value: unknown, max = 200): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= max
		? value
		: null;
}

function nullableDigest(value: unknown): string | null {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
		? value
		: null;
}

function nullableRevision(value: unknown): string | null {
	return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value)
		? value
		: null;
}

function prefixedSha256(value: string): string {
	const normalized = value.replace(/^sha256:/, "");
	if (!/^[a-f0-9]{64}$/.test(normalized)) {
		throw new Error("scan_execution_baseline_artifact_sha256_invalid");
	}
	return `sha256:${normalized}`;
}

function safeStorageKey(value: string | null): string {
	if (!value || path.isAbsolute(value)) {
		throw new Error("scan_execution_baseline_artifact_storage_key_invalid");
	}
	const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
	if (normalized === ".." || normalized.startsWith("../")) {
		throw new Error("scan_execution_baseline_artifact_storage_key_invalid");
	}
	return normalized;
}

function artifactPath(artifactRoot: string, storageKey: string): string {
	const root = path.resolve(artifactRoot);
	const candidate = path.resolve(root, storageKey);
	if (!candidate.startsWith(`${root}${path.sep}`)) {
		throw new Error("scan_execution_baseline_artifact_storage_key_escaped");
	}
	return candidate;
}

async function hashArtifact(filePath: string) {
	const [content, stat] = await Promise.all([
		fs.readFile(filePath),
		fs.stat(filePath),
	]);
	return {
		sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
		sizeBytes: stat.size,
	};
}

/**
 * Produces a shareable characterization record without retaining project paths,
 * event messages, commands, artifact contents, or LLM input/output text.
 */
export async function buildScanExecutionEffectivenessBaseline(params: {
	snapshot: BaselineSnapshot;
	artifactRoot: string;
	generatedAt: string;
}): Promise<ScanExecutionEffectivenessBaseline> {
	const metadata = params.snapshot.run.metadata;
	const preflight = asRecord(metadata.scanPreflight);
	const binding = asRecord(preflight.binding);
	const artifacts = await Promise.all(
		params.snapshot.artifacts
			.slice()
			.sort((left, right) => left.id.localeCompare(right.id))
			.map(async (artifact) => {
				const storageKey = safeStorageKey(artifact.storageKey);
				const recomputed = await hashArtifact(
					artifactPath(params.artifactRoot, storageKey),
				);
				const sha256 = prefixedSha256(artifact.sha256);
				if (
					recomputed.sha256 !== sha256 ||
					recomputed.sizeBytes !== artifact.sizeBytes
				) {
					throw new Error(
						`scan_execution_baseline_artifact_hash_mismatch:${artifact.id}`,
					);
				}
				return {
					...artifact,
					storageKey,
					sha256,
					recomputedSha256: recomputed.sha256,
					recomputedSizeBytes: recomputed.sizeBytes,
				};
			}),
	);

	return {
		schemaVersion: 1,
		generatedAt: params.generatedAt,
		run: {
			id: params.snapshot.run.id,
			profile: params.snapshot.run.profile,
			status: params.snapshot.run.status,
			profileOutcome: params.snapshot.run.profileOutcome,
		},
		preflight: {
			mode:
				preflight.mode === "enforced" || preflight.mode === "shadow"
					? preflight.mode
					: "unknown",
			status: nullableString(preflight.status, 80),
			preflightHash: nullableDigest(preflight.preflightHash),
			bindingHash: nullableDigest(metadata.preflightBindingHash),
			sourceRevision: nullableRevision(preflight.sourceRevision),
			sourceRevisionHash: nullableDigest(binding.sourceRevisionHash),
			sourceState:
				preflight.sourceState === "clean" || preflight.sourceState === "dirty"
					? preflight.sourceState
					: "unknown",
		},
		events: params.snapshot.events
			.slice()
			.sort((left, right) => left.seq - right.seq),
		tools: params.snapshot.tools
			.slice()
			.sort((left, right) => left.toolName.localeCompare(right.toolName))
			.map((tool) => {
				const provenance = asRecord(tool.metadata.provenance);
				return {
					toolName: tool.toolName,
					recordedRunVersion: nullableString(tool.toolVersion),
					status: tool.status,
					exitCode: tool.exitCode,
					provenance: {
						manifestHash: nullableDigest(provenance.manifestHash),
						expectedVersion: nullableString(provenance.toolVersion),
						recordedReproducible:
							typeof provenance.reproducible === "boolean"
								? provenance.reproducible
								: null,
					},
				};
			}),
		artifacts,
		coverage: params.snapshot.coverage
			.slice()
			.sort((left, right) => left.controlId.localeCompare(right.controlId)),
		reports: params.snapshot.reports
			.slice()
			.sort((left, right) => left.id.localeCompare(right.id)),
		reviews: params.snapshot.reviews
			.slice()
			.sort((left, right) => left.id.localeCompare(right.id)),
	};
}

function requiredRow(
	row: SqlRecord | null | undefined,
	code: string,
): SqlRecord {
	if (!row) throw new Error(code);
	return row;
}

function text(row: SqlRecord, key: string): string {
	const value = row[key];
	if (typeof value !== "string")
		throw new Error(`scan_execution_baseline_invalid_${key}`);
	return value;
}

function nullableText(row: SqlRecord, key: string): string | null {
	const value = row[key];
	return typeof value === "string" ? value : null;
}

function nullableNumber(row: SqlRecord, key: string): number | null {
	const value = row[key];
	return typeof value === "number" ? value : null;
}

function number(row: SqlRecord, key: string): number {
	const value = row[key];
	if (typeof value !== "number")
		throw new Error(`scan_execution_baseline_invalid_${key}`);
	return value;
}

function queryRows(
	database: SqliteDatabase,
	query: string,
	scanRunId: string,
): SqlRecord[] {
	return database.query(query).all(scanRunId) as SqlRecord[];
}

function loadSnapshot(
	database: SqliteDatabase,
	scanRunId: string,
): BaselineSnapshot {
	const run = requiredRow(
		database
			.query(
				"select id, profile, status, profile_outcome as profileOutcome, metadata from scan_runs where id = ?",
			)
			.get(scanRunId) as SqlRecord | null,
		"scan_execution_baseline_run_not_found",
	);
	return {
		run: {
			id: text(run, "id"),
			profile: text(run, "profile"),
			status: text(run, "status"),
			profileOutcome: text(run, "profileOutcome"),
			metadata: parseJsonRecord(run.metadata),
		},
		events: queryRows(
			database,
			"select seq, level, event_type as eventType from scan_events where scan_run_id = ? order by seq asc",
			scanRunId,
		).map((row) => ({
			seq: number(row, "seq"),
			level: text(row, "level"),
			eventType: text(row, "eventType"),
		})),
		tools: queryRows(
			database,
			"select tool_name as toolName, tool_version as toolVersion, status, exit_code as exitCode, metadata from tool_runs where scan_run_id = ?",
			scanRunId,
		).map((row) => ({
			toolName: text(row, "toolName"),
			toolVersion: nullableText(row, "toolVersion"),
			status: text(row, "status"),
			exitCode: nullableNumber(row, "exitCode"),
			metadata: parseJsonRecord(row.metadata),
		})),
		artifacts: queryRows(
			database,
			"select id, kind, format, storage_key as storageKey, sha256, size_bytes as sizeBytes from scan_artifacts where scan_run_id = ?",
			scanRunId,
		).map((row) => ({
			id: text(row, "id"),
			kind: text(row, "kind"),
			format: text(row, "format"),
			storageKey: nullableText(row, "storageKey"),
			sha256: text(row, "sha256"),
			sizeBytes: number(row, "sizeBytes"),
		})),
		coverage: queryRows(
			database,
			"select control_id as controlId, status, method, reason_code as reasonCode, snapshot_hash as snapshotHash from scan_coverage_results where scan_run_id = ?",
			scanRunId,
		).map((row) => ({
			controlId: text(row, "controlId"),
			status: text(row, "status"),
			method: text(row, "method"),
			reasonCode: text(row, "reasonCode"),
			snapshotHash: text(row, "snapshotHash"),
		})),
		reports: queryRows(
			database,
			"select id, artifact_id as artifactId, format, status, error_code as errorCode from scan_reports where scan_run_id = ?",
			scanRunId,
		).map((row) => ({
			id: text(row, "id"),
			artifactId: nullableText(row, "artifactId"),
			format: text(row, "format"),
			status: text(row, "status"),
			errorCode: nullableText(row, "errorCode"),
		})),
		reviews: queryRows(
			database,
			"select id, provider, model, status from scan_reviews where scan_run_id = ?",
			scanRunId,
		).map((row) => ({
			id: text(row, "id"),
			provider: text(row, "provider"),
			model: text(row, "model"),
			status: text(row, "status"),
		})),
	};
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			"run-id": { type: "string" },
			db: { type: "string", default: "data/vuln-workbench.sqlite" },
			"artifact-root": { type: "string", default: "artifacts/scans" },
			out: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args["run-id"] || !args.out) {
		throw new Error("scan_execution_baseline_args_required");
	}
	const database = openReadonlySqliteSnapshot(path.resolve(args.db));
	try {
		const baseline = await buildScanExecutionEffectivenessBaseline({
			snapshot: loadSnapshot(database, args["run-id"]),
			artifactRoot: path.resolve(args["artifact-root"]),
			generatedAt: new Date().toISOString(),
		});
		const outputPath = path.resolve(args.out);
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		await fs.writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
		console.log(
			JSON.stringify({
				ok: true,
				outputPath,
				artifacts: baseline.artifacts.length,
			}),
		);
	} finally {
		database.close();
	}
}

if (import.meta.main) await main();
