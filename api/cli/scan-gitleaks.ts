import { parseArgs } from "node:util";
import { normalizeGitleaks } from "../modules/scans/normalizers/gitleaks";
import { GitleaksRunner } from "../modules/scans/tools/gitleaks-runner";
import { executeScannerCli } from "./scan-cli-lifecycle";

try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-id": { type: "string" },
			profile: { type: "string", default: "secrets" },
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
			adapter: "gitleaks",
			displayName: "Gitleaks",
			command: "gitleaks detect",
			unavailableMessage: "Gitleaks executable not found",
			createRunner: (storage, execution) =>
				new GitleaksRunner(storage, execution),
			run: (runner, scanRunId, repoPath, options) =>
				runner.run(scanRunId, repoPath, options),
			normalize: (rawJson, stderr) => normalizeGitleaks(rawJson, { stderr }),
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
