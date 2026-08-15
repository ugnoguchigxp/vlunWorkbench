import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { assessJuiceShopMeasurement } from "./measurement-status";

type CommandResult = {
	id: string;
	status:
		| "completed"
		| "incomplete"
		| "not_executed"
		| "blocked"
		| "failed_cleanup"
		| "failed";
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
	{
		id: "owned-dast-standard-v1",
		script: "scripts/benchmark/dast-standard.ts",
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
	const measurement = await assessMeasurement(command.id, exitCode);
	results.push({
		id: command.id,
		status: measurement.status,
		exitCode,
		reason: measurement.reason,
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
					: results.some((item) =>
								["failed", "failed_cleanup"].includes(item.status),
							)
						? "failed"
						: "completed_with_limitations",
			results,
		},
		null,
		2,
	)}\n`,
);
console.log(JSON.stringify({ ok: true, outputPath, results }));
if (results.some((item) => ["failed", "failed_cleanup"].includes(item.status)))
	process.exitCode = 1;

async function exists(filePath: string): Promise<boolean> {
	return Boolean(await stat(filePath).catch(() => null));
}

async function assessMeasurement(
	id: string,
	exitCode: number,
): Promise<Pick<CommandResult, "status" | "reason">> {
	if (exitCode !== 0) {
		return { status: "failed", reason: "benchmark_command_failed" };
	}
	if (id !== "owasp-juice-shop") {
		return { status: "completed", reason: null };
	}
	const runReport = JSON.parse(
		await readFile(".artifacts/benchmark/juice-shop-run.json", "utf8"),
	) as {
		counts?: Parameters<typeof assessJuiceShopMeasurement>[0];
	};
	return assessJuiceShopMeasurement(runReport.counts ?? {});
}
