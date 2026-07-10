import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	codeStructureSnapshotFailureSchema,
	codeStructureSnapshotResultSchema,
} from "../../shared/schemas/static-intelligence-code-structure.schema";
import { buildCodeStructureSnapshot } from "../modules/static-intelligence/code-structure/extractor";
import { StaticIntelligenceGenerationRepository } from "../modules/static-intelligence/generation-repository";

type CliArgs = {
	mode: "extract" | "persisted";
	projectPath?: string;
	projectId?: string;
	scanRunId?: string;
	generationId?: string;
	output?: string;
	pretty: boolean;
	includeRootPath: boolean;
	maxFiles: number;
};

function writeResult(payload: Record<string, unknown>, pretty = false): void {
	process.stdout.write(
		`${JSON.stringify(payload, null, pretty ? 2 : undefined)}\n`,
	);
}

async function main(): Promise<number> {
	let args: CliArgs;
	try {
		args = parseCliArgs();
	} catch (error) {
		writeResult(
			codeStructureSnapshotFailureSchema.parse({
				ok: false,
				status: "failed",
				message: message(error),
			}),
		);
		return 2;
	}

	try {
		if (args.output) await assertOutputParentExists(args.output);
		const persisted =
			args.mode === "persisted" ? await loadPersistedSnapshot(args) : null;
		const snapshot =
			persisted?.snapshot ??
			(await buildCodeStructureSnapshot({
				projectPath: args.projectPath as string,
				projectId: args.projectId,
				includeRootPath: args.includeRootPath,
				maxFiles: args.maxFiles,
			}));
		const output = args.output
			? await writeSnapshotOutput(args.output, snapshot, args.pretty)
			: undefined;
		writeResult(
			codeStructureSnapshotResultSchema.parse({
				ok: true,
				status: "completed",
				version: "v1",
				generatedAt: snapshot.generatedAt,
				snapshot,
				...(persisted ? { generation: persisted.generation } : {}),
				...(output ? { output } : {}),
			}),
			args.pretty,
		);
		return 0;
	} catch (error) {
		const text = message(error);
		writeResult(
			codeStructureSnapshotFailureSchema.parse({
				ok: false,
				status: "failed",
				message: text,
			}),
		);
		return isUserInputError(text) ? 2 : 1;
	}
}

function parseCliArgs(): CliArgs {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-path": { type: "string" },
			"project-id": { type: "string" },
			"scan-run-id": { type: "string" },
			"generation-id": { type: "string" },
			output: { type: "string" },
			pretty: { type: "string" },
			"include-root-path": { type: "string" },
			"max-files": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const values = parsed.values as Record<string, string | undefined>;
	const projectPath = values["project-path"];
	const scanRunId = values["scan-run-id"];
	if (Boolean(projectPath) === Boolean(scanRunId)) {
		throw new Error(
			"Specify exactly one source: --project-path or --scan-run-id.",
		);
	}
	if (values["generation-id"] && !scanRunId) {
		throw new Error("--generation-id requires --scan-run-id.");
	}
	if (
		scanRunId &&
		(values["project-id"] ||
			values["include-root-path"] !== undefined ||
			values["max-files"] !== undefined)
	) {
		throw new Error(
			"--project-id, --include-root-path, and --max-files are only valid with --project-path.",
		);
	}
	return {
		mode: scanRunId ? "persisted" : "extract",
		projectPath,
		projectId: values["project-id"],
		scanRunId,
		generationId: values["generation-id"],
		output: values.output,
		pretty: parseBooleanOption(values.pretty, "--pretty") ?? false,
		includeRootPath:
			parseBooleanOption(values["include-root-path"], "--include-root-path") ??
			false,
		maxFiles: parseMaxFiles(values["max-files"]),
	};
}

async function loadPersistedSnapshot(args: CliArgs) {
	const env = readAppEnv();
	const connection = createDbConnection(env.databaseUrl);
	try {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
		);
		const generation = args.generationId
			? await repository.loadGeneration(
					args.scanRunId as string,
					args.generationId,
				)
			: await repository.loadLatestValidGeneration(args.scanRunId as string);
		if (!generation) throw new Error("Static Intelligence generation missing.");
		const snapshotRef = generation.structure.metadata.snapshotRef;
		if (!snapshotRef) throw new Error("Persisted snapshot provenance missing.");
		return {
			snapshot: generation.structure.snapshot,
			generation: {
				generationId: generation.generationId,
				snapshotRef,
				sourceTreeHash: generation.structure.metadata.sourceTreeHash,
			},
		};
	} finally {
		connection.sqlite.close();
	}
}

function parseBooleanOption(
	value: string | undefined,
	flagName: string,
): boolean | undefined {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${flagName} must be true or false.`);
}

function parseMaxFiles(value: string | undefined): number {
	if (value === undefined) return 5000;
	const numeric = Number(value);
	if (!Number.isInteger(numeric) || numeric < 1 || numeric > 20000) {
		throw new Error("--max-files must be an integer between 1 and 20000.");
	}
	return numeric;
}

async function assertOutputParentExists(outputPath: string): Promise<void> {
	const parent = path.dirname(outputPath);
	const stat = await fs.stat(parent).catch(() => null);
	if (!stat?.isDirectory()) {
		throw new Error(`Output parent directory not found: ${parent}`);
	}
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

function isUserInputError(value: string): boolean {
	return (
		value.includes("Project path not found") ||
		value.includes("Project path is not a directory") ||
		value.includes("Output parent directory not found") ||
		value.includes("Specify exactly one source") ||
		value.includes("generation missing") ||
		value.includes("Generation is incomplete or invalid") ||
		value.includes("generation-id") ||
		value.includes("only valid with --project-path") ||
		value.includes("--max-files")
	);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
