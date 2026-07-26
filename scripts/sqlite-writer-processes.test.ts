import { describe, expect, it } from "bun:test";
import { parseSqliteWriterProcesses } from "./sqlite-writer-processes";

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
});
