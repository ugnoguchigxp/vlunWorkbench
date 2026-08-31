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

function runtimeIsolationEnvironment(digest: string): NodeJS.ProcessEnv {
	return {
		VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: `owner@${digest}`,
		VULN_WORKBENCH_RUNTIME_NODE_IMAGE: `node@${digest}`,
		VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: `materializer@${digest}`,
		VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: `proxy@${digest}`,
		VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: `probe@${digest}`,
		VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: `http@${digest}`,
		VULN_WORKBENCH_RUNTIME_DOCKER_DAEMON_IDENTITY_HASH: digest,
		VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH: digest,
	};
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

	it("persists runtime isolation configuration in SQLite and applies it to AppEnv", async () => {
		const repo = new SettingsRepository(connection.db);
		const env = readAppEnv({});
		const digest = `sha256:${"a".repeat(64)}`;
		const runtimeIsolation = {
			qualificationVersion: 1 as const,
			namespaceOwnerImage: `owner@${digest}`,
			nodeImage: `node@${digest}`,
			materializerImage: `materializer@${digest}`,
			registryProxyImage: `proxy@${digest}`,
			probeImage: `probe@${digest}`,
			httpExecutorImage: `http@${digest}`,
			dockerDaemonIdentityHash: digest,
			qualificationHash: digest,
			postgresImage: "",
			mysqlImage: "",
			nucleiImage: "",
			zapImage: "",
			schemathesisImage: "",
		};

		const saved = await repo.updateRuntimeSettings(
			{
				scanExecutionMode: "docker",
				allowHostScannerExecution: false,
				scanDockerImage: "scanner:stable",
				dockerMemory: "2g",
				dockerCpus: 1.5,
				dockerPidsLimit: 256,
				scannerStdoutLimitBytes: 32 * 1024 * 1024,
				scannerStderrLimitBytes: 4 * 1024 * 1024,
				webProcessConcurrency: 2,
				webScanQueueLimit: 32,
				webScanStepTimeoutMaxSec: 3_600,
				webScanWallClockTimeoutSec: 21_600,
				codexSdkTimeoutMs: 300_000,
				runtimeIsolation,
			},
			env,
		);

		expect(saved).toMatchObject({
			runtimeIsolation,
			runtimeIsolationConfigured: true,
			runtimeIsolationMissingFields: [],
		});
		expect((await repo.resolveAppEnv(env)).runtimeIsolation).toEqual(
			runtimeIsolation,
		);

		const legacyClientSave = await repo.updateRuntimeSettings(
			{
				scanExecutionMode: "host",
				allowHostScannerExecution: true,
				scanDockerImage: "scanner:stable",
				dockerMemory: "3g",
				dockerCpus: 2,
				dockerPidsLimit: 512,
				scannerStdoutLimitBytes: 64 * 1024 * 1024,
				scannerStderrLimitBytes: 8 * 1024 * 1024,
				codexSdkTimeoutMs: 600_000,
			},
			env,
		);
		expect(legacyClientSave.runtimeIsolation).toEqual(runtimeIsolation);
		expect(legacyClientSave.runtimeIsolationConfigured).toBe(true);
	});

	it("migrates the legacy auto-configured local image syntax on read", async () => {
		const digest = `sha256:${"a".repeat(64)}`;
		const legacyImage = `vuln-workbench-runtime@${digest}`;
		await connection.db.insert(runtimeSettings).values({
			id: "global",
			settings: {
				scanExecutionMode: "docker",
				allowHostScannerExecution: false,
				scanDockerImage: "scanner:stable",
				dockerMemory: "2g",
				dockerCpus: 2,
				dockerPidsLimit: 512,
				scannerStdoutLimitBytes: 64 * 1024 * 1024,
				scannerStderrLimitBytes: 8 * 1024 * 1024,
				webProcessConcurrency: 2,
				webScanQueueLimit: 32,
				webScanStepTimeoutMaxSec: 3_600,
				webScanWallClockTimeoutSec: 21_600,
				codexSdkTimeoutMs: 600_000,
				runtimeIsolation: {
					qualificationVersion: 1,
					namespaceOwnerImage: legacyImage,
					nodeImage: legacyImage,
					materializerImage: legacyImage,
					registryProxyImage: legacyImage,
					probeImage: legacyImage,
					httpExecutorImage: legacyImage,
					dockerDaemonIdentityHash: digest,
					qualificationHash: digest,
					postgresImage: "",
					mysqlImage: "",
					nucleiImage: "",
					zapImage: "",
					schemathesisImage: "",
				},
			},
		});

		const repository = new SettingsRepository(connection.db);
		const response = await repository.getRuntimeSettings(readAppEnv({}));
		const resolved = await repository.resolveAppEnv(readAppEnv({}));

		expect(response.runtimeIsolation).toMatchObject({
			namespaceOwnerImage: digest,
			nodeImage: digest,
			httpExecutorImage: digest,
		});
		expect(resolved.runtimeIsolation?.registryProxyImage).toBe(digest);
	});

	it("uses legacy environment isolation for a persisted record created before the field existed", async () => {
		const digest = `sha256:${"b".repeat(64)}`;
		const env = readAppEnv(runtimeIsolationEnvironment(digest));
		await connection.db.insert(runtimeSettings).values({
			id: "global",
			settings: {
				scanExecutionMode: "docker",
				allowHostScannerExecution: false,
				scanDockerImage: "scanner:stable",
				dockerMemory: "2g",
				dockerCpus: 2,
				dockerPidsLimit: 512,
				scannerStdoutLimitBytes: 64 * 1024 * 1024,
				scannerStderrLimitBytes: 8 * 1024 * 1024,
				codexSdkTimeoutMs: 600_000,
			},
		});

		const resolved = await new SettingsRepository(
			connection.db,
		).getRuntimeSettings(env);
		expect(resolved.runtimeIsolation).toMatchObject({
			namespaceOwnerImage: `owner@${digest}`,
			httpExecutorImage: `http@${digest}`,
			dockerDaemonIdentityHash: digest,
			qualificationHash: digest,
		});
		expect(resolved.runtimeIsolationConfigured).toBe(true);
	});

	it("allows only the trusted local qualification flow to upgrade Bun capability", async () => {
		const repo = new SettingsRepository(connection.db);
		const env = readAppEnv({});
		const digestA = `sha256:${"a".repeat(64)}`;
		const digestB = `sha256:${"b".repeat(64)}`;
		const runtimeIsolation = {
			qualificationVersion: 2 as const,
			namespaceOwnerImage: `runtime@${digestA}`,
			nodeImage: `runtime@${digestA}`,
			materializerImage: `runtime@${digestA}`,
			registryProxyImage: `runtime@${digestA}`,
			probeImage: `runtime@${digestA}`,
			httpExecutorImage: `runtime@${digestA}`,
			dockerDaemonIdentityHash: digestA,
			qualificationHash: digestA,
			postgresImage: "",
			mysqlImage: "",
			nucleiImage: "",
			zapImage: "",
			schemathesisImage: "",
		};
		const update = {
			scanExecutionMode: "docker" as const,
			allowHostScannerExecution: false,
			scanDockerImage: "scanner:stable",
			dockerMemory: "2g",
			dockerCpus: 1.5,
			dockerPidsLimit: 256,
			scannerStdoutLimitBytes: 32 * 1024 * 1024,
			scannerStderrLimitBytes: 4 * 1024 * 1024,
			webProcessConcurrency: 2,
			webScanQueueLimit: 32,
			webScanStepTimeoutMaxSec: 3_600,
			webScanWallClockTimeoutSec: 21_600,
			codexSdkTimeoutMs: 300_000,
			runtimeIsolation,
		};

		const untrustedUpgrade = await repo.updateRuntimeSettings(update, env);
		expect(untrustedUpgrade.runtimeIsolation.qualificationVersion).toBe(1);

		const trustedUpgrade = await repo.updateRuntimeSettings(update, env, {
			trustRuntimeIsolationQualification: true,
		});
		expect(trustedUpgrade.runtimeIsolation.qualificationVersion).toBe(2);

		const changedImage = await repo.updateRuntimeSettings(
			{
				...update,
				runtimeIsolation: {
					...runtimeIsolation,
					nodeImage: `runtime@${digestB}`,
				},
			},
			env,
		);
		expect(changedImage.runtimeIsolation.qualificationVersion).toBe(1);
	});

	it("fails closed instead of rejecting the settings page for an invalid legacy bootstrap", async () => {
		const env = readAppEnv({
			...runtimeIsolationEnvironment(`sha256:${"c".repeat(64)}`),
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: "owner:latest",
		});

		const resolved = await new SettingsRepository(
			connection.db,
		).getRuntimeSettings(env);
		expect(resolved.runtimeIsolationConfigured).toBe(false);
		expect(resolved.runtimeIsolation.namespaceOwnerImage).toBe("");
		expect(resolved.runtimeIsolation.nodeImage).toMatch(/^node@sha256:/);
		expect(resolved.runtimeIsolationMissingFields).toEqual([
			"namespaceOwnerImage",
		]);
	});

	it("rejects mutable runtime isolation images before persistence", async () => {
		const repo = new SettingsRepository(connection.db);
		const env = readAppEnv({});
		await expect(
			repo.updateRuntimeSettings(
				{
					scanExecutionMode: "docker",
					allowHostScannerExecution: false,
					scanDockerImage: "scanner:stable",
					dockerMemory: "2g",
					dockerCpus: 2,
					dockerPidsLimit: 512,
					scannerStdoutLimitBytes: 64 * 1024 * 1024,
					scannerStderrLimitBytes: 8 * 1024 * 1024,
					codexSdkTimeoutMs: 600_000,
					runtimeIsolation: {
						...env.runtimeIsolation!,
						namespaceOwnerImage: "owner:latest",
					},
				},
				env,
			),
		).rejects.toThrow(/image@sha256/);
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
