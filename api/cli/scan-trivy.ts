import { parseArgs } from "node:util";
import { normalizeTrivy } from "../modules/scans/normalizers/trivy";
import { TrivyRunner } from "../modules/scans/tools/trivy-runner";
import { executeScannerCli } from "./scan-cli-lifecycle";

try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-id": { type: "string" },
			profile: { type: "string", default: "filesystem" },
			"timeout-sec": { type: "string" },
		},
		strict: true,
	});
	if (!values["project-id"]) {
		throw new Error("Missing required argument: --project-id is required.");
	}
	const timeoutSec = values["timeout-sec"]
		? Number.parseInt(values["timeout-sec"], 10)
		: undefined;
	await executeScannerCli(
		{
			adapter: "trivy",
			displayName: "Trivy",
			command: "trivy fs",
			unavailableMessage: "Trivy executable not found",
			createRunner: (storage, execution) => new TrivyRunner(storage, execution),
			run: (runner, scanRunId, repoPath, options) =>
				runner.run(scanRunId, repoPath, options),
			normalize: (rawJson, stderr) => normalizeTrivy(rawJson, { stderr }),
			runMetadata: (options) => ({
				timeoutSec: options.timeoutSec ?? null,
			}),
		},
		{
			projectId: values["project-id"],
			profile: values.profile,
			options: { timeoutSec },
		},
	);
} catch (error) {
	console.log(
		JSON.stringify({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${
				error instanceof Error ? error.message : String(error)
			}`,
		}),
	);
	process.exitCode = 1;
}
