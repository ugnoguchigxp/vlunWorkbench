import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	projectStructureSnapshotFailureSchema,
	projectStructureSnapshotResultSchema,
} from "../../shared/schemas/project-structure.schema";
import { buildProjectStructureSnapshot } from "../modules/static-intelligence/project-structure/builder";

type CliArgs = {
	projectPath: string;
	projectId?: string;
	output?: string;
	pretty: boolean;
	includeRootPath: boolean;
	maxFiles: number;
};

async function main(): Promise<number> {
	let args: CliArgs;
	try {
		args = parseCliArgs();
	} catch (error) {
		writeResult(
			projectStructureSnapshotFailureSchema.parse({
				ok: false,
				status: "failed",
				message: message(error),
			}),
		);
		return 2;
	}
	try {
		if (args.output) await assertOutputParentExists(args.output);
		const snapshot = await buildProjectStructureSnapshot({
			projectPath: args.projectPath,
			projectId: args.projectId,
			includeRootPath: args.includeRootPath,
			maxFiles: args.maxFiles,
		});
		const output = args.output
			? await writeSnapshotOutput(args.output, snapshot, args.pretty)
			: undefined;
		writeResult(
			projectStructureSnapshotResultSchema.parse({
				ok: true,
				status: "completed",
				version: "v2",
				generatedAt: snapshot.generatedAt,
				snapshot,
				...(output ? { output } : {}),
			}),
			args.pretty,
		);
		return 0;
	} catch (error) {
		writeResult(
			projectStructureSnapshotFailureSchema.parse({
				ok: false,
				status: "failed",
				message: message(error),
			}),
		);
		return 1;
	}
}

function parseCliArgs(): CliArgs {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-path": { type: "string" },
			"project-id": { type: "string" },
			output: { type: "string" },
			pretty: { type: "string" },
			"include-root-path": { type: "string" },
			"max-files": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const values = parsed.values as Record<string, string | undefined>;
	if (!values["project-path"]) throw new Error("--project-path is required.");
	return {
		projectPath: values["project-path"],
		projectId: values["project-id"],
		output: values.output,
		pretty: parseBoolean(values.pretty, "--pretty") ?? false,
		includeRootPath:
			parseBoolean(values["include-root-path"], "--include-root-path") ?? false,
		maxFiles: parseMaxFiles(values["max-files"]),
	};
}

function parseBoolean(value: string | undefined, flag: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${flag} must be true or false.`);
}

function parseMaxFiles(value: string | undefined): number {
	if (value === undefined) return 5000;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20_000) {
		throw new Error("--max-files must be an integer between 1 and 20000.");
	}
	return parsed;
}

async function assertOutputParentExists(outputPath: string): Promise<void> {
	const stat = await fs.stat(path.dirname(outputPath)).catch(() => null);
	if (!stat?.isDirectory()) throw new Error("Output parent directory not found.");
}

async function writeSnapshotOutput(
	outputPath: string,
	snapshot: unknown,
	pretty: boolean,
): Promise<{ path: string; sha256: string }> {
	const content = JSON.stringify(snapshot, null, pretty ? 2 : undefined);
	await fs.writeFile(outputPath, content, "utf8");
	return {
		path: outputPath,
		sha256: createHash("sha256").update(content).digest("hex"),
	};
}

function writeResult(payload: Record<string, unknown>, pretty = false) {
	process.stdout.write(`${JSON.stringify(payload, null, pretty ? 2 : undefined)}\n`);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
