import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	processStaticIntelligencePrepareJob,
	recoverStaticIntelligencePrepareJobs,
} from "../modules/static-intelligence/prepare-worker";

const parsed = parseArgs({
	args: process.argv.slice(2),
	options: {
		"job-id": { type: "string" },
		recover: { type: "boolean", default: false },
	},
	strict: true,
});
const env = readAppEnv();
const connection = createDbConnection(env.databaseUrl);
try {
	const result = parsed.values.recover
		? await recoverStaticIntelligencePrepareJobs({
				db: connection.db,
			})
		: parsed.values["job-id"]
			? await processStaticIntelligencePrepareJob({
					db: connection.db,
					jobId: parsed.values["job-id"],
				})
			: { ok: false, status: "job_id_required" };
	console.log(JSON.stringify(result));
} finally {
	connection.sqlite.close();
}
