import type { AppEnv } from "../app/env";
import * as schema from "./schema";
import { createSqliteDbRuntime, type DbRuntime } from "./sqlite";
export {
	createSingleWriterClient,
	type DatabaseClient,
	type DatabaseWriter,
} from "./client";
export {
	connectDb,
	createSqliteDbRuntime,
	type AppDatabase,
	type AppDatabaseClient,
	type DbRuntime,
} from "./sqlite";

export function createDbRuntime(env: AppEnv): DbRuntime {
	return createSqliteDbRuntime(env);
}

export { schema };
