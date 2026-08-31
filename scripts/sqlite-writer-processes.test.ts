import { describe, expect, it } from "bun:test";
import {
	filterSqliteWriterProcessesForRepository,
	parseSqliteWriterProcesses,
} from "./sqlite-writer-processes";

describe("SQLite Writer process detection", () => {
	it("returns only SQLite Writer entrypoints", () => {
		expect(
			parseSqliteWriterProcesses(`
  100 /opt/homebrew/bin/bun api/cli/sqlite-writer.ts --database-url file:a.sqlite
  101 /opt/homebrew/bin/bun scripts/verify.ts
  102 /opt/homebrew/bin/bun /work/vulnWorkbench/api/cli/sqlite-writer.ts --database-url file:b.sqlite
`),
		).toEqual([
			{
				pid: 100,
				command:
					"/opt/homebrew/bin/bun api/cli/sqlite-writer.ts --database-url file:a.sqlite",
			},
			{
				pid: 102,
				command:
					"/opt/homebrew/bin/bun /work/vulnWorkbench/api/cli/sqlite-writer.ts --database-url file:b.sqlite",
			},
		]);
	});

	it("scopes cleanup checks to the current repository entrypoint", () => {
		const processes = parseSqliteWriterProcesses(`
  200 /opt/homebrew/bin/bun /work/current/api/cli/sqlite-writer.ts --database-url file:a.sqlite
  201 /opt/homebrew/bin/bun /private/tmp/closeout/api/cli/sqlite-writer.ts --database-url file:b.sqlite
  202 /opt/homebrew/bin/bun /work/current-copy/api/cli/sqlite-writer.ts --database-url file:c.sqlite
`);

		expect(
			filterSqliteWriterProcessesForRepository(processes, "/work/current"),
		).toEqual([
			{
				pid: 200,
				command:
					"/opt/homebrew/bin/bun /work/current/api/cli/sqlite-writer.ts --database-url file:a.sqlite",
			},
		]);
	});
});
