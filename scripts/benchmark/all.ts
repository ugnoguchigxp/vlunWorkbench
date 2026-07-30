import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

type CommandResult = {
	id: string;
	status: "completed" | "not_executed" | "failed";
	exitCode: number | null;
	reason: string | null;
};

const commands: Array<{
	id: string;
	script: string;
	prerequisite?: string;
}> = [
	{
		id: "owasp-benchmark-java",
		script: "scripts/benchmark/owasp-benchmark.ts",
		prerequisite:
			".cache/security-corpora/owasp-benchmark-java/source/expectedresults-1.2beta.csv",
	},
	{
		id: "owasp-juice-shop",
		script: "scripts/benchmark/juice-shop.ts",
	},
	{
		id: "owned-business-logic-pairs-v1",
		script: "scripts/benchmark/business-logic.ts",
	},
	{
		id: "owned-endpoint-discovery-v1",
		script: "scripts/benchmark/endpoint-discovery.ts",
	},
];
const results: CommandResult[] = [];
for (const command of commands) {
	if (command.prerequisite && !(await exists(command.prerequisite))) {
		results.push({
			id: command.id,
			status: "not_executed",
			exitCode: null,
			reason: "prepared_corpus_missing",
		});
		continue;
	}
	const child = Bun.spawn(["bun", "run", command.script], {
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	});
	const exitCode = await child.exited;
	results.push({
		id: command.id,
		status: exitCode === 0 ? "completed" : "failed",
		exitCode,
		reason: exitCode === 0 ? null : "benchmark_command_failed",
	});
}
const outputPath = path.resolve(".artifacts/benchmark/all.json");
await mkdir(path.dirname(outputPath), { recursive: true });
const completed = results.filter((item) => item.status === "completed").length;
await Bun.write(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			status:
				completed === results.length
					? "completed"
					: results.some((item) => item.status === "failed")
						? "failed"
						: "completed_with_limitations",
			results,
		},
		null,
		2,
	)}\n`,
);
console.log(JSON.stringify({ ok: true, outputPath, results }));
if (results.some((item) => item.status === "failed")) process.exitCode = 1;

async function exists(filePath: string): Promise<boolean> {
	return Boolean(await stat(filePath).catch(() => null));
}
