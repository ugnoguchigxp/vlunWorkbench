const image = process.argv[2] ?? "vuln-workbench-dynamic:local";

const proc = Bun.spawn(
	["docker", "build", "-t", image, "-f", "docker/dynamic/Dockerfile", "."],
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
export {};
