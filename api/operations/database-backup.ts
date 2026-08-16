import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { BenchmarkMetric } from "../../shared/schemas/benchmark.schema";
import { getSqliteWriterClient } from "../db/writer/client";

const MIGRATIONS_TABLE = "vuln_workbench_schema_migrations";
const BENCHMARK_BACKUP_ALLOWED_NONEMPTY_TABLES = new Set([
	MIGRATIONS_TABLE,
	"security_capability_benchmark_runs",
	"security_capability_benchmark_metrics",
]);

export async function createDatabaseBackup(
	databaseUrl: string,
	outputPath: string,
): Promise<{ outputPath: string }> {
	const absoluteOutput = path.resolve(outputPath);
	const writer = getSqliteWriterClient(databaseUrl);
	try {
		return await writer.createBackup(absoluteOutput);
	} finally {
		await writer.close({ shutdownIfOwned: true });
	}
}

export type BackupVerification = {
	ok: true;
	inputPath: string;
	integrity: "ok";
	appliedMigrations: number;
	checksummedMigrations: number;
	legacyUncheckedMigrations: number;
	representativeRecordCounts: Record<string, number>;
};

export async function verifyDatabaseBackup(
	inputPath: string,
	migrationsDirectory = path.resolve(process.cwd(), "drizzle"),
): Promise<BackupVerification> {
	const absoluteInput = path.resolve(inputPath);
	const metadata = await stat(absoluteInput);
	if (!metadata.isFile() || metadata.nlink !== 1) {
		throw new Error("Backup input must be a regular, non-hard-linked file.");
	}

	const sqlite = new Database(absoluteInput, { readonly: true, strict: true });
	try {
		sqlite.run("PRAGMA query_only = ON");
		const integrityRows = sqlite
			.query<{ integrity_check: string }, []>("PRAGMA integrity_check")
			.all();
		if (
			integrityRows.length !== 1 ||
			integrityRows[0]?.integrity_check !== "ok"
		) {
			throw new Error("SQLite integrity check failed.");
		}

		const table = sqlite
			.query<{ name: string }, [string]>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
			)
			.get(MIGRATIONS_TABLE);
		if (!table) throw new Error("Backup has no migration history table.");

		const migrationColumns = sqlite
			.query<{ name: string }, []>(`PRAGMA table_info(${MIGRATIONS_TABLE})`)
			.all();
		const hasChecksumColumn = migrationColumns.some(
			(column) => column.name === "checksum",
		);
		const applied = sqlite
			.query<{ filename: string; checksum: string | null }, []>(
				hasChecksumColumn
					? `SELECT filename, checksum FROM ${MIGRATIONS_TABLE} ORDER BY filename`
					: `SELECT filename, NULL AS checksum FROM ${MIGRATIONS_TABLE} ORDER BY filename`,
			)
			.all();
		const migrationFiles = (
			await readdir(migrationsDirectory, { withFileTypes: true })
		)
			.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
			.map((entry) => entry.name);
		const knownMigrations = new Set(migrationFiles);
		for (const migration of applied) {
			if (!knownMigrations.has(migration.filename)) {
				throw new Error(`Backup has unknown migration: ${migration.filename}`);
			}
			if (migration.checksum) {
				const content = await readFile(
					path.join(migrationsDirectory, migration.filename),
				);
				const checksum = createHash("sha256").update(content).digest("hex");
				if (checksum !== migration.checksum) {
					throw new Error(
						`Backup migration checksum mismatch: ${migration.filename}`,
					);
				}
			}
		}

		const representativeRecordCounts: Record<string, number> = {};
		for (const tableName of ["users", "projects", "scan_runs", "findings"]) {
			const exists = sqlite
				.query<{ name: string }, [string]>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
				)
				.get(tableName);
			if (!exists) continue;
			const row = sqlite
				.query<{ count: number }, []>(
					`SELECT count(*) AS count FROM ${tableName}`,
				)
				.get();
			representativeRecordCounts[tableName] = row?.count ?? 0;
		}

		return {
			ok: true,
			inputPath: absoluteInput,
			integrity: "ok",
			appliedMigrations: applied.length,
			checksummedMigrations: applied.filter((migration) => migration.checksum)
				.length,
			legacyUncheckedMigrations: applied.filter(
				(migration) => !migration.checksum,
			).length,
			representativeRecordCounts,
		};
	} finally {
		sqlite.close(false);
	}
}

export function verifyBenchmarkOnlyDatabaseBackup(inputPath: string): void {
	const sqlite = new Database(path.resolve(inputPath), {
		readonly: true,
		strict: true,
	});
	try {
		sqlite.run("PRAGMA query_only = ON");
		const tables = sqlite
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all();
		const counts = new Map<string, number>();
		for (const { name } of tables) {
			if (!/^[a-z0-9_]+$/.test(name)) {
				throw new Error("phase_54_closeout_database_table_name_invalid");
			}
			const row = sqlite
				.query<{ count: number }, []>(`SELECT count(*) AS count FROM "${name}"`)
				.get();
			const count = row?.count ?? 0;
			counts.set(name, count);
			if (count > 0 && !BENCHMARK_BACKUP_ALLOWED_NONEMPTY_TABLES.has(name)) {
				throw new Error(
					`phase_54_closeout_database_unexpected_records:${name}`,
				);
			}
		}
		if (
			(counts.get(MIGRATIONS_TABLE) ?? 0) < 1 ||
			counts.get("security_capability_benchmark_runs") !== 1 ||
			(counts.get("security_capability_benchmark_metrics") ?? 0) < 1
		) {
			throw new Error(
				"phase_54_closeout_database_benchmark_evidence_incomplete",
			);
		}
	} finally {
		sqlite.close(false);
	}
}

export function verifyBenchmarkDatabaseBackupContents(
	inputPath: string,
	params: {
		runId: string;
		releaseCommit: string;
		manifestHash: string;
		policyVersion: string;
		toolboxImageDigest: string;
		runInputHash: string;
		corpusDigest: string;
		outputHash: string;
		metrics: BenchmarkMetric[];
	},
): void {
	const sqlite = new Database(path.resolve(inputPath), {
		readonly: true,
		strict: true,
	});
	try {
		sqlite.run("PRAGMA query_only = ON");
		const run = sqlite
			.query<
				{
					corpusId: string;
					corpusDigest: string;
					inputHash: string;
					gitCommit: string;
					scannerManifestHash: string;
					toolboxImageDigest: string;
					benchmarkPolicyVersion: string;
					status: string;
					outputHash: string | null;
				},
				[string]
			>(
				`SELECT
					corpus_id AS corpusId,
					corpus_digest AS corpusDigest,
					input_hash AS inputHash,
					git_commit AS gitCommit,
					scanner_manifest_hash AS scannerManifestHash,
					toolbox_image_digest AS toolboxImageDigest,
					benchmark_policy_version AS benchmarkPolicyVersion,
					status,
					output_hash AS outputHash
				FROM security_capability_benchmark_runs
				WHERE id = ?1
				LIMIT 1`,
			)
			.get(params.runId);
		if (
			!run ||
			run.corpusId !== "owasp-benchmark-java" ||
			run.corpusDigest !== params.corpusDigest ||
			run.inputHash !== params.runInputHash ||
			run.gitCommit !== params.releaseCommit ||
			run.scannerManifestHash !== params.manifestHash ||
			run.toolboxImageDigest !== params.toolboxImageDigest ||
			run.benchmarkPolicyVersion !== params.policyVersion ||
			run.status !== "completed" ||
			run.outputHash !== params.outputHash
		) {
			throw new Error("phase_54_closeout_database_benchmark_run_mismatch");
		}
		const persistedMetrics = sqlite
			.query<BenchmarkMetric, [string]>(
				`SELECT
					category,
					true_positive AS truePositive,
					false_negative AS falseNegative,
					true_negative AS trueNegative,
					false_positive AS falsePositive,
					recall,
					precision,
					false_positive_rate AS falsePositiveRate,
					score
				FROM security_capability_benchmark_metrics
				WHERE run_id = ?1
				ORDER BY category`,
			)
			.all(params.runId);
		const expectedMetrics = [...params.metrics].sort((left, right) =>
			left.category.localeCompare(right.category),
		);
		if (
			persistedMetrics.length === 0 ||
			JSON.stringify(persistedMetrics) !== JSON.stringify(expectedMetrics)
		) {
			throw new Error("phase_54_closeout_database_benchmark_metric_mismatch");
		}
	} finally {
		sqlite.close(false);
	}
}
