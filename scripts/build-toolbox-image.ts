const image = process.argv[2] ?? "vuln-workbench-toolbox:local";

const proc = Bun.spawn(
	[
		"docker",
		"build",
		"-t",
		image,
		"-f",
		"docker/toolbox/Dockerfile",
		".",
	],
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
