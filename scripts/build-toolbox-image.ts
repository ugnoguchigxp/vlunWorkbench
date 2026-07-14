const image = process.argv[2] ?? "vuln-workbench-toolbox:local";

const audit = Bun.spawn(
	["bun", "run", "scripts/audit-nuclei-safe-templates.ts"],
	{
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	},
);
const auditExitCode = await audit.exited;
if (auditExitCode !== 0) process.exit(auditExitCode);

const proc = Bun.spawn(
	["docker", "build", "-t", image, "-f", "docker/toolbox/Dockerfile", "."],
	{
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	},
);

const exitCode = await proc.exited;
if (exitCode !== 0) {
	process.exit(exitCode);
}

console.log(`Built ${image}`);
