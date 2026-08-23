import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	autoConfigureLocalRuntimeIsolation,
	mergeAutoConfiguredRuntimeIsolationSettings,
} from "../modules/runtime-isolation/runtime-isolation-auto-config";
import { SettingsRepository } from "../modules/settings/settings.repository";

const startupEnv = readAppEnv();
const connection = createDbConnection(startupEnv.databaseUrl);

try {
	const repository = new SettingsRepository(connection.db);
	const env = await repository.resolveAppEnv(startupEnv);
	const runtimeIsolation = await autoConfigureLocalRuntimeIsolation();
	const current = await repository.getRuntimeSettings(env);
	const mergedRuntimeIsolation = mergeAutoConfiguredRuntimeIsolationSettings(
		current.runtimeIsolation,
		runtimeIsolation,
	);
	const {
		updatedAt: _updatedAt,
		dastAuthEncryptionKeyConfigured: _keyConfigured,
		dastAuthEncryptionKeySource: _keySource,
		runtimeIsolationConfigured: _runtimeConfigured,
		runtimeIsolationMissingFields: _runtimeMissingFields,
		...input
	} = current;
	const updated = await repository.updateRuntimeSettings(
		{ ...input, runtimeIsolation: mergedRuntimeIsolation },
		env,
		{ trustRuntimeIsolationQualification: true },
	);
	console.log(
		JSON.stringify(
			{
				configured: updated.runtimeIsolationConfigured,
				runtimeIsolation: updated.runtimeIsolation,
				updatedAt: updated.updatedAt,
			},
			null,
			2,
		),
	);
} finally {
	if (connection.writerClient) {
		await connection.writerClient.close({ shutdownIfOwned: true });
	}
	if (connection.ownsConnection) connection.sqlite.close(false);
}
