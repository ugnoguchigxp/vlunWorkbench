export {};

const proc = Bun.spawn(["git", "ls-files", "artifacts"], {
	stdout: "pipe",
	stderr: "inherit",
});
const output = await new Response(proc.stdout).text();
const exitCode = await proc.exited;
const files = output.split(/\r?\n/).filter(Boolean);
process.stdout.write(
	`${JSON.stringify({ ok: exitCode === 0 && files.length === 0, count: files.length })}\n`,
);
if (exitCode !== 0 || files.length > 0) process.exitCode = 1;
