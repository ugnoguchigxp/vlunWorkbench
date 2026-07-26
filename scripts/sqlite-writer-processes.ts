const WRITER_ENTRYPOINT = "api/cli/sqlite-writer.ts";

export type SqliteWriterProcess = {
	pid: number;
	command: string;
};

export function parseSqliteWriterProcesses(
	processList: string,
): SqliteWriterProcess[] {
	const processes: SqliteWriterProcess[] = [];
	for (const line of processList.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(.+)$/);
		if (!match) continue;
		const command = match[2] ?? "";
		if (!command.includes(WRITER_ENTRYPOINT)) continue;
		processes.push({
			pid: Number.parseInt(match[1] ?? "", 10),
			command,
		});
	}
	return processes;
}

export async function listSqliteWriterProcesses(): Promise<
	SqliteWriterProcess[]
> {
	const proc = Bun.spawn(["ps", "-axo", "pid=,command="], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`Failed to inspect SQLite Writer processes: ${stderr.trim()}`,
		);
	}
	return parseSqliteWriterProcesses(stdout);
}

const delay = async (milliseconds: number): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export async function waitForNewSqliteWriterProcessesToExit(
	baselinePids: ReadonlySet<number>,
	timeoutMs = 5_000,
): Promise<SqliteWriterProcess[]> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const remaining = (await listSqliteWriterProcesses()).filter(
			(process) => !baselinePids.has(process.pid),
		);
		if (remaining.length === 0 || Date.now() >= deadline) return remaining;
		await delay(50);
	}
}
