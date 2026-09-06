import { createHash } from "node:crypto";
import {
	type BoundedProcessResult,
	runBoundedProcess,
} from "../processes/bounded-process-runner";
import { getCleanEnv } from "../scans/tools/process-runner-shared";
import {
	RuntimeIsolationAutoConfigError,
	type RuntimeIsolationAutoConfigRunner,
} from "./runtime-isolation-auto-config";

const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

export function bunAdapterQualificationScript(registryUrl: string): string {
	const packageJson = JSON.stringify({
		name: "vwb-bun-qualification",
		dependencies: { "is-number": "7.0.0" },
	});
	const bunLock = JSON.stringify({
		lockfileVersion: 1,
		workspaces: {
			"": {
				name: "vwb-bun-qualification",
				dependencies: { "is-number": "7.0.0" },
			},
		},
		packages: {
			"is-number": [
				"is-number@7.0.0",
				"",
				{},
				"sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
			],
		},
	});
	return [
		`printf '%s' '${packageJson}' > package.json`,
		`printf '%s' '${bunLock}' > bun.lock`,
		`bun install --frozen-lockfile --ignore-scripts --no-progress --no-save --backend=copyfile --registry '${registryUrl}'`,
		"test -f node_modules/is-number/index.js",
	].join("; ");
}

export async function inspectBaseImage(
	runner: RuntimeIsolationAutoConfigRunner,
	dockerBin: string,
	imageTag: string,
	allowedDigestPattern: RegExp,
): Promise<string | null> {
	let result: BoundedProcessResult;
	try {
		result = await runner(
			[
				dockerBin,
				"image",
				"inspect",
				"--format",
				"{{json .RepoDigests}}",
				imageTag,
			],
			{ timeoutMs: 30_000, outputLimitBytes: OUTPUT_LIMIT_BYTES },
		);
	} catch {
		return null;
	}
	if (result.exitCode !== 0 || result.terminationReason) return null;
	try {
		const digests = JSON.parse(result.stdout.trim());
		if (!Array.isArray(digests)) return null;
		return (
			digests.find(
				(value): value is string =>
					typeof value === "string" && allowedDigestPattern.test(value),
			) ?? null
		);
	} catch {
		return null;
	}
}

export async function checkedCommand(
	runner: RuntimeIsolationAutoConfigRunner,
	argv: string[],
	timeoutMs: number,
	code: string,
	message: string,
	status: 409 | 503 = 409,
): Promise<BoundedProcessResult> {
	let result: BoundedProcessResult;
	try {
		result = await runner(argv, {
			timeoutMs,
			outputLimitBytes: OUTPUT_LIMIT_BYTES,
		});
	} catch {
		throw new RuntimeIsolationAutoConfigError(code, message, status);
	}
	if (result.exitCode !== 0 || result.terminationReason) {
		throw new RuntimeIsolationAutoConfigError(code, message, status);
	}
	return result;
}

export async function cleanupCommand(
	runner: RuntimeIsolationAutoConfigRunner,
	argv: string[],
): Promise<boolean> {
	try {
		const result = await runner(argv, {
			timeoutMs: 30_000,
			outputLimitBytes: OUTPUT_LIMIT_BYTES,
		});
		return result.exitCode === 0 && result.terminationReason === null;
	} catch {
		// Qualification cleanup must not replace the original actionable error.
		return false;
	}
}

export async function defaultRunner(
	argv: string[],
	options: { timeoutMs: number; outputLimitBytes: number },
): Promise<BoundedProcessResult> {
	return await runBoundedProcess({
		argv,
		...options,
		env: getCleanEnv(),
	});
}

export function sha256(value: string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
