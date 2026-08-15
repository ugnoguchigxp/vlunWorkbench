import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	type RunAuthorizationShadowInput,
	runAuthorizationShadow,
} from "../modules/security-intelligence/authorization-shadow-service";

type AuthorizationShadowCliDependencies = {
	readInput: (inputPath: string) => Promise<string>;
	writeOutput: (value: string) => void;
	writeError: (value: string) => void;
};

const defaultDependencies: AuthorizationShadowCliDependencies = {
	readInput: (inputPath) => readFile(inputPath, "utf8"),
	writeOutput: (value) => process.stdout.write(value),
	writeError: (value) => process.stderr.write(value),
};

export async function runAuthorizationShadowCli(
	argv: string[],
	dependencies: AuthorizationShadowCliDependencies = defaultDependencies,
): Promise<number> {
	let values: { enable?: boolean; input?: string; pretty?: boolean };
	try {
		values = parseArgs({
			args: argv,
			options: {
				enable: { type: "boolean", default: false },
				input: { type: "string" },
				pretty: { type: "boolean", default: false },
			},
			strict: true,
		}).values;
	} catch (error) {
		return fail(dependencies, "invalid_arguments", message(error));
	}
	if (values.enable !== true) {
		dependencies.writeOutput(`${JSON.stringify({ status: "disabled" })}\n`);
		return 0;
	}
	if (!values.input) {
		return fail(
			dependencies,
			"input_required",
			"--input is required when --enable is set.",
		);
	}
	try {
		const parsed = JSON.parse(await dependencies.readInput(values.input));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Input must be a JSON object.");
		}
		const result = runAuthorizationShadow({
			...(parsed as Omit<RunAuthorizationShadowInput, "enabled">),
			enabled: true,
		});
		dependencies.writeOutput(
			`${JSON.stringify(result, null, values.pretty ? 2 : undefined)}\n`,
		);
		return 0;
	} catch (error) {
		return fail(dependencies, "authorization_shadow_failed", message(error));
	}
}

function fail(
	dependencies: AuthorizationShadowCliDependencies,
	code: string,
	errorMessage: string,
): number {
	dependencies.writeError(
		`${JSON.stringify({ ok: false, code, message: errorMessage })}\n`,
	);
	return 2;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
	process.exitCode = await runAuthorizationShadowCli(process.argv.slice(2));
}
