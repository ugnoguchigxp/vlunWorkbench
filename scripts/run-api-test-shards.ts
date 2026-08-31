import {
	listSqliteWriterProcesses,
	waitForNewSqliteWriterProcessesToExit,
} from "./sqlite-writer-processes";
import { discoverTestFiles, isVitestFile } from "./test-files";

const concurrency = Math.max(
	1,
	Number.parseInt(process.env.TEST_SHARD_CONCURRENCY ?? "2", 10) || 2,
);
const repositoryRoot = process.cwd();
const files = (await discoverTestFiles()).filter((file) => !isVitestFile(file));
const initialWriterPids = new Set(
	(await listSqliteWriterProcesses({ repositoryRoot })).map(
		(process) => process.pid,
	),
);
let nextIndex = 0;
const failures: Array<{ file: string; exitCode: number }> = [];

async function worker(): Promise<void> {
	while (true) {
		const index = nextIndex++;
		const file = files[index];
		if (!file) return;
		const proc = Bun.spawn(
			[
				"bun",
				"test",
				"--no-orphans",
				"--preload",
				"./scripts/bun-test-lifecycle.ts",
				file,
			],
			{
				stdout: "inherit",
				stderr: "inherit",
				env: { ...process.env, NODE_ENV: "test" },
			},
		);
		const exitCode = await proc.exited;
		if (exitCode !== 0) failures.push({ file, exitCode });
	}
}

await Promise.all(
	Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
);

const writerLeaks = await waitForNewSqliteWriterProcessesToExit(
	initialWriterPids,
	{
		repositoryRoot,
	},
);

process.stdout.write(
	`${JSON.stringify({
		ok: failures.length === 0 && writerLeaks.length === 0,
		files: files.length,
		concurrency,
		failures,
		writerLeaks,
	})}\n`,
);
if (failures.length > 0 || writerLeaks.length > 0) process.exitCode = 1;
