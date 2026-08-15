import { parseArgs } from "node:util";
import { StaticScannerAdapterRegistry } from "../modules/scans/static-scanner-adapter-registry";
import { semgrepScannerAdapter } from "../plugins/scanners/semgrep";
import { executeScannerCli } from "./scan-cli-lifecycle";

const registeredSemgrepAdapter = new StaticScannerAdapterRegistry()
	.register(semgrepScannerAdapter)
	.require("semgrep");

try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-id": { type: "string" },
			profile: { type: "string", default: "semgrep-baseline" },
			config: { type: "string", default: "owned" },
			"timeout-sec": { type: "string" },
			"max-target-bytes": { type: "string" },
		},
		strict: true,
	});
	if (!values["project-id"]) {
		throw new Error("Missing required argument: --project-id is required.");
	}
	const timeoutSec = values["timeout-sec"]
		? Number.parseInt(values["timeout-sec"], 10)
		: undefined;
	const maxTargetBytes = values["max-target-bytes"]
		? Number.parseInt(values["max-target-bytes"], 10)
		: undefined;
	await executeScannerCli(
		{
			adapter: registeredSemgrepAdapter.manifest.id,
			displayName: registeredSemgrepAdapter.manifest.displayName,
			command: registeredSemgrepAdapter.defaultCommand({
				config: values.config,
			}),
			unavailableMessage: "Semgrep executable not found",
			createRunner: (storage, execution) =>
				registeredSemgrepAdapter.createRunner({
					artifactStorage: storage,
					execution,
				}),
			run: (runner, scanRunId, repoPath, options) =>
				runner.run({
					scanRunId,
					repoPath,
					options,
					timeoutSec: options.timeoutSec,
					onLifecycleEvent: () => {},
				}),
			normalize: (rawJson, stderr) =>
				registeredSemgrepAdapter.normalize(rawJson, { stderr }),
			runMetadata: (options) => ({
				config: options.config,
				timeoutSec: options.timeoutSec ?? null,
				maxTargetBytes: options.maxTargetBytes ?? null,
			}),
		},
		{
			projectId: values["project-id"],
			profile: values.profile,
			options: {
				config: values.config,
				timeoutSec,
				maxTargetBytes,
			},
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
