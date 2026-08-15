import { describe, expect, it } from "bun:test";
import path from "node:path";

describe("security assessment CLI", () => {
	it("writes argument failures to stderr without polluting stdout", async () => {
		const result = await runCli([]);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			code: "scan_run_id_required",
		});
	});

	it("rejects unsupported output formats before opening the database", async () => {
		const result = await runCli([
			"--scan-run-id",
			"scan-run:fixture",
			"--format",
			"yaml",
		]);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr).code).toBe("format_invalid");
	});
});

async function runCli(args: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const child = Bun.spawn(
		["bun", "run", "api/cli/security-assessment.ts", ...args],
		{
			cwd: path.resolve(import.meta.dir, "../.."),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}
