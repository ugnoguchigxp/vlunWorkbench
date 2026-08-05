import type { AppEnv } from "../app/env";
import { runSqliteMigrations } from "./migrate-sqlite";

export async function runMigrations(env: AppEnv) {
	return runSqliteMigrations(env);
}
