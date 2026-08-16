import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateTestDatabase } from "../db/testing/migrate";
import {
	createDatabaseBackup,
	verifyBenchmarkDatabaseBackupContents,
	verifyBenchmarkOnlyDatabaseBackup,
	verifyDatabaseBackup,
} from "./database-backup";

let root: string | undefined;
const digest = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("database backup", () => {
	it("creates a Writer-consistent backup and verifies integrity and migrations", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "vuln-workbench-backup-"));
		const databasePath = path.join(root, "live.sqlite");
		const backupPath = path.join(root, "backups", "snapshot.sqlite");
		await migrateTestDatabase(`file:${databasePath}`);

		const created = await createDatabaseBackup(
			`file:${databasePath}`,
			backupPath,
		);
		expect(created.outputPath).toBe(backupPath);

		const verified = await verifyDatabaseBackup(backupPath);
		expect(verified.integrity).toBe("ok");
		expect(verified.appliedMigrations).toBeGreaterThan(0);
		expect(verified.checksummedMigrations).toBe(verified.appliedMigrations);
		expect(verified.legacyUncheckedMigrations).toBe(0);
	});

	it("verifies legacy backups whose migration table predates checksums", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "vuln-workbench-backup-"));
		const backupPath = path.join(root, "legacy.sqlite");
		const sqlite = new Database(backupPath, { create: true, strict: true });
		try {
			sqlite.run(
				"CREATE TABLE vuln_workbench_schema_migrations (filename text PRIMARY KEY, applied_at integer NOT NULL)",
			);
			sqlite
				.query(
					"INSERT INTO vuln_workbench_schema_migrations (filename, applied_at) VALUES (?1, ?2)",
				)
				.run("0001_initial.sql", Date.now());
			sqlite.run("CREATE TABLE users (id text PRIMARY KEY)");
		} finally {
			sqlite.close(false);
		}

		const verified = await verifyDatabaseBackup(backupPath);
		expect(verified.integrity).toBe("ok");
		expect(verified.appliedMigrations).toBe(1);
		expect(verified.checksummedMigrations).toBe(0);
		expect(verified.legacyUncheckedMigrations).toBe(1);
	});

	it("allows only benchmark evidence in a Phase 54 release backup", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "phase-54-database-"));
		const databasePath = path.join(root, "backup.sqlite");
		const sqlite = new Database(databasePath, { create: true, strict: true });
		try {
			sqlite.run(
				"CREATE TABLE vuln_workbench_schema_migrations (filename text PRIMARY KEY)",
			);
			sqlite.run(
				`CREATE TABLE security_capability_benchmark_runs (
					id text PRIMARY KEY,
					corpus_id text NOT NULL,
					corpus_digest text NOT NULL,
					input_hash text NOT NULL,
					git_commit text NOT NULL,
					scanner_manifest_hash text NOT NULL,
					toolbox_image_digest text NOT NULL,
					benchmark_policy_version text NOT NULL,
					status text NOT NULL,
					output_hash text
				)`,
			);
			sqlite.run(
				`CREATE TABLE security_capability_benchmark_metrics (
					id text PRIMARY KEY,
					run_id text NOT NULL,
					category text NOT NULL,
					true_positive integer NOT NULL,
					false_negative integer NOT NULL,
					true_negative integer NOT NULL,
					false_positive integer NOT NULL,
					recall real,
					precision real,
					false_positive_rate real,
					score real
				)`,
			);
			sqlite.run("CREATE TABLE users (id text PRIMARY KEY, password_hash text)");
			sqlite.run(
				"INSERT INTO vuln_workbench_schema_migrations (filename) VALUES ('0001.sql')",
			);
			sqlite
				.query(
					`INSERT INTO security_capability_benchmark_runs (
						id, corpus_id, corpus_digest, input_hash, git_commit,
						scanner_manifest_hash, toolbox_image_digest,
						benchmark_policy_version, status, output_hash
					) VALUES ('run-1', 'owasp-benchmark-java', ?1, ?2, ?3, ?4, ?5, '1.0.0', 'completed', ?6)`,
				)
				.run(digest, digest, "a".repeat(40), digest, digest, digest);
			sqlite.run(
				`INSERT INTO security_capability_benchmark_metrics (
					id, run_id, category, true_positive, false_negative,
					true_negative, false_positive, recall, precision,
					false_positive_rate, score
				) VALUES ('metric-1', 'run-1', 'overall', 1, 0, 1, 0, 1, 1, 0, 1)`,
			);
		} finally {
			sqlite.close(false);
		}

		expect(() => verifyBenchmarkOnlyDatabaseBackup(databasePath)).not.toThrow();
		expect(() =>
			verifyBenchmarkDatabaseBackupContents(databasePath, {
				runId: "run-1",
				releaseCommit: "a".repeat(40),
				manifestHash: digest,
				policyVersion: "1.0.0",
				toolboxImageDigest: digest,
				runInputHash: digest,
				corpusDigest: digest,
				outputHash: digest,
				metrics: [
					{
						category: "overall",
						truePositive: 1,
						falseNegative: 0,
						trueNegative: 1,
						falsePositive: 0,
						recall: 1,
						precision: 1,
						falsePositiveRate: 0,
						score: 1,
					},
				],
			}),
		).not.toThrow();
		expect(() =>
			verifyBenchmarkDatabaseBackupContents(databasePath, {
				runId: "run-1",
				releaseCommit: "a".repeat(40),
				manifestHash: digest,
				policyVersion: "1.0.0",
				toolboxImageDigest: digest,
				runInputHash: `sha256:${"b".repeat(64)}`,
				corpusDigest: digest,
				outputHash: digest,
				metrics: [],
			}),
		).toThrow("phase_54_closeout_database_benchmark_run_mismatch");
		expect(() =>
			verifyBenchmarkDatabaseBackupContents(databasePath, {
				runId: "run-1",
				releaseCommit: "a".repeat(40),
				manifestHash: digest,
				policyVersion: "1.0.0",
				toolboxImageDigest: digest,
				runInputHash: digest,
				corpusDigest: digest,
				outputHash: digest,
				metrics: [],
			}),
		).toThrow("phase_54_closeout_database_benchmark_metric_mismatch");

		const contaminated = new Database(databasePath, { strict: true });
		try {
			contaminated.run(
				"INSERT INTO users (id, password_hash) VALUES ('user-1', 'sensitive')",
			);
		} finally {
			contaminated.close(false);
		}
		expect(() => verifyBenchmarkOnlyDatabaseBackup(databasePath)).toThrow(
			"phase_54_closeout_database_unexpected_records:users",
		);
	});
});
