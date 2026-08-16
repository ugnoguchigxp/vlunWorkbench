import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAppEnv } from "../../app/env";
import { createDbConnection, type DbConnection } from "../../db";
import { runtimeSettings } from "../../db/schema";
import { SettingsRepository } from "./settings.repository";

function migrate(connection: DbConnection): void {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((left, right) => left.localeCompare(right))) {
		connection.sqlite.exec(
			readFileSync(path.join(migrationsDir, filename), "utf8"),
		);
	}
}

describe("SettingsRepository runtime settings", () => {
	let connection: DbConnection;

	beforeEach(() => {
		connection = createDbConnection(":memory:");
		migrate(connection);
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("uses legacy environment values only until settings are saved", async () => {
		const repo = new SettingsRepository(connection.db);
		const env = readAppEnv({
			SCAN_EXECUTION_MODE: "docker",
			VULN_WORKBENCH_DOCKER_MEMORY: "3g",
			CODEX_SDK_TIMEOUT_MS: "900000",
		});

		expect(await repo.getRuntimeSettings(env)).toMatchObject({
			scanExecutionMode: "docker",
			dockerMemory: "3g",
			codexSdkTimeoutMs: 900_000,
			updatedAt: null,
		});

		await repo.updateRuntimeSettings({
			scanExecutionMode: "host",
			allowHostScannerExecution: true,
			scanDockerImage: "scanner:stable",
			dockerMemory: "2g",
			dockerCpus: 1.5,
			dockerPidsLimit: 256,
			scannerStdoutLimitBytes: 32 * 1024 * 1024,
			scannerStderrLimitBytes: 4 * 1024 * 1024,
			webProcessConcurrency: 3,
			webScanQueueLimit: 12,
			webScanStepTimeoutMaxSec: 1_800,
			webScanWallClockTimeoutSec: 7_200,
			codexSdkTimeoutMs: 300_000,
		}, env);

		const resolved = await repo.resolveAppEnv(env);
		expect(resolved).toMatchObject({
			scanExecutionMode: "host",
			scanDockerImage: "scanner:stable",
			dockerMemory: "2g",
			dockerCpus: 1.5,
			webProcessConcurrency: 3,
			webScanQueueLimit: 12,
			webScanStepTimeoutMaxSec: 1_800,
			webScanWallClockTimeoutSec: 7_200,
			codexSdkTimeoutMs: 300_000,
		});
	});

	it("rejects Web process limits outside the supported range", async () => {
		const repo = new SettingsRepository(connection.db);
		const env = readAppEnv({});
		await expect(
			repo.updateRuntimeSettings(
				{
					scanExecutionMode: "host",
					allowHostScannerExecution: true,
					scanDockerImage: "scanner:stable",
					dockerMemory: "2g",
					dockerCpus: 2,
					dockerPidsLimit: 512,
					scannerStdoutLimitBytes: 64 * 1024 * 1024,
					scannerStderrLimitBytes: 8 * 1024 * 1024,
					webProcessConcurrency: 9,
					webScanQueueLimit: 32,
					webScanStepTimeoutMaxSec: 3_600,
					webScanWallClockTimeoutSec: 21_600,
					codexSdkTimeoutMs: 600_000,
				},
				env,
			),
		).rejects.toThrow();
	});

	it("rejects unsafe process limits before persistence", async () => {
		const repo = new SettingsRepository(connection.db);
		const env = readAppEnv({});
		await expect(
			repo.updateRuntimeSettings({
				scanExecutionMode: "docker",
				allowHostScannerExecution: false,
				scanDockerImage: "scanner:stable",
				dockerMemory: "64g",
				dockerCpus: 2,
				dockerPidsLimit: 512,
				scannerStdoutLimitBytes: 64 * 1024 * 1024,
				scannerStderrLimitBytes: 8 * 1024 * 1024,
				codexSdkTimeoutMs: 600_000,
			}, env),
		).rejects.toThrow(/between 512 MiB and 8 GiB/);
	});

	it("stores a masked DAST auth key and retains the previous key on rotation", async () => {
		const repo = new SettingsRepository(connection.db);
		const environmentKey = Buffer.alloc(32, 3).toString("base64");
		const settingsKey = Buffer.alloc(32, 5).toString("base64");
		const rotatedKey = Buffer.alloc(32, 7).toString("base64");
		const env = readAppEnv({ DAST_AUTH_ENCRYPTION_KEY: environmentKey });
		const base = {
			scanExecutionMode: "host" as const,
			allowHostScannerExecution: true,
			scanDockerImage: "scanner:stable",
			dockerMemory: "2g",
			dockerCpus: 1.5,
			dockerPidsLimit: 256,
			scannerStdoutLimitBytes: 32 * 1024 * 1024,
			scannerStderrLimitBytes: 4 * 1024 * 1024,
			codexSdkTimeoutMs: 300_000,
		};

		expect(await repo.getRuntimeSettings(env)).toMatchObject({
			dastAuthEncryptionKey: "",
			dastAuthEncryptionKeyConfigured: true,
			dastAuthEncryptionKeySource: "environment",
		});

		const saved = await repo.updateRuntimeSettings(
			{ ...base, dastAuthEncryptionKey: settingsKey },
			env,
		);
		expect(saved).toMatchObject({
			dastAuthEncryptionKey: "",
			dastAuthEncryptionKeyConfigured: true,
			dastAuthEncryptionKeySource: "settings",
		});
		const raw = await connection.db.select().from(runtimeSettings);
		expect(JSON.stringify(raw)).not.toContain(settingsKey);
		expect(JSON.stringify(raw)).not.toContain(environmentKey);

		await repo.updateRuntimeSettings(
			{ ...base, dastAuthEncryptionKey: rotatedKey },
			env,
		);
		const resolved = await repo.resolveAppEnv(env);
		expect(resolved.dastAuthEncryptionKey).toBe(rotatedKey);
		expect(resolved.dastAuthPreviousEncryptionKeys).toEqual([
			settingsKey,
			environmentKey,
		]);
	});
});
