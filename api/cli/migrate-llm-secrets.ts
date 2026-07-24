import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { encodeWriterValue } from "../db/writer/codec";
import {
	createDatabaseBackup,
	verifyDatabaseBackup,
} from "../operations/database-backup";
import { SecretCrypto } from "../security/secret-crypto";

const dryRun = process.argv.slice(2).includes("--dry-run");
const backupIndex = process.argv.indexOf("--backup-output");
const backupOutput =
	backupIndex >= 0 ? process.argv[backupIndex + 1] : undefined;

async function main(): Promise<void> {
	const env = readAppEnv();
	const connection = createDbConnection(env.databaseUrl);
	try {
		const rows = await connection.db.query.llmProviderEndpoints.findMany();
		const legacyRows = rows.filter((row) => Boolean(row.apiKey));
		if (dryRun) {
			process.stdout.write(
				`${JSON.stringify({
					ok: true,
					dryRun: true,
					legacyPlaintextCount: legacyRows.length,
					encryptedCount: rows.filter((row) => row.apiKeyCiphertext).length,
				})}\n`,
			);
			return;
		}
		if (!env.llmSettingsEncryptionKey) {
			throw new Error(
				"LLM_SETTINGS_ENCRYPTION_KEY is required to migrate LLM secrets.",
			);
		}
		const crypto = new SecretCrypto(
			env.llmSettingsEncryptionKey,
			env.llmSettingsPreviousEncryptionKeys ?? [],
		);
		if (!backupOutput) {
			throw new Error(
				"--backup-output is required before plaintext secret cleanup.",
			);
		}
		await createDatabaseBackup(env.databaseUrl, backupOutput);
		await verifyDatabaseBackup(backupOutput);
		const statements = [];
		for (const row of legacyRows) {
			const apiKey = row.apiKey;
			if (!apiKey) continue;
			const identity = { endpointId: row.id, providerKind: row.kind };
			const encrypted = crypto.encrypt(apiKey, identity);
			if (crypto.decrypt(encrypted, identity) !== apiKey) {
				throw new Error(
					`Encryption verification failed for endpoint ${row.id}.`,
				);
			}
			statements.push({
				sql: `UPDATE llm_provider_endpoints
					SET api_key = NULL,
						api_key_ciphertext = ?1,
						api_key_nonce = ?2,
						api_key_auth_tag = ?3,
						api_key_key_id = ?4,
						updated_at = ?5
					WHERE id = ?6`,
				params: [
					encrypted.ciphertext,
					encrypted.nonce,
					encrypted.authTag,
					encrypted.keyId,
					Date.now(),
					row.id,
				].map(encodeWriterValue),
				method: "run" as const,
			});
		}
		if (statements.length > 0) {
			if (!connection.writerClient) {
				throw new Error("SQLite Writer is required for secret migration.");
			}
			await connection.writerClient.atomicBatch(statements);
		}
		const remaining = (
			await connection.db.query.llmProviderEndpoints.findMany()
		).filter((row) => Boolean(row.apiKey)).length;
		if (remaining !== 0) {
			throw new Error(
				`LLM secret migration left ${remaining} plaintext row(s).`,
			);
		}
		process.stdout.write(
			`${JSON.stringify({
				ok: true,
				dryRun: false,
				migrated: statements.length,
				backupOutput,
				remainingPlaintextCount: remaining,
			})}\n`,
		);
	} finally {
		connection.sqlite.close(false);
	}
}

await main().catch((error) => {
	process.stdout.write(
		`${JSON.stringify({
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		})}\n`,
	);
	process.exitCode = 1;
});
