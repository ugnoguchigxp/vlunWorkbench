export {};

const proc = Bun.spawn(["bun", "audit", "--json"], {
	stdout: "pipe",
	stderr: "pipe",
	env: { ...process.env, NO_COLOR: "1" },
});
const [stdout, exitCode] = await Promise.all([
	new Response(proc.stdout).text(),
	proc.exited,
]);
const jsonStart = stdout.indexOf("{");
if (jsonStart < 0) {
	throw new Error("bun audit did not return JSON.");
}
const advisories = JSON.parse(stdout.slice(jsonStart)) as Record<
	string,
	Array<{ id: number; severity: string; title: string }>
>;
const findings = Object.entries(advisories).flatMap(([packageName, items]) =>
	items.map((item) => ({ packageName, ...item })),
);
const blocking = findings.filter((item) =>
	["moderate", "high", "critical"].includes(item.severity.toLowerCase()),
);
process.stdout.write(
	`${JSON.stringify({
		ok: blocking.length === 0,
		exitCode,
		total: findings.length,
		blocking,
	})}\n`,
);
if (blocking.length > 0) process.exitCode = 1;
