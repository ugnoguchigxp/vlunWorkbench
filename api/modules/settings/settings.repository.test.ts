import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAppEnv } from "../../app/env";
import { createDbConnection, type DbConnection } from "../../db";
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
			codexSdkTimeoutMs: 300_000,
		});

		const resolved = await repo.resolveAppEnv(env);
		expect(resolved).toMatchObject({
			scanExecutionMode: "host",
			scanDockerImage: "scanner:stable",
			dockerMemory: "2g",
			dockerCpus: 1.5,
			codexSdkTimeoutMs: 300_000,
		});
	});

	it("rejects unsafe process limits before persistence", async () => {
		const repo = new SettingsRepository(connection.db);
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
			}),
		).rejects.toThrow(/between 512 MiB and 8 GiB/);
	});
});
