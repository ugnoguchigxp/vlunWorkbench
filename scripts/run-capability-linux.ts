import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pinnedImageDigest } from "./benchmark/owasp-benchmark-runtime";

const root = process.cwd();
if (/[,\0\r\n]/.test(root))
	throw new Error("capability_linux_mount_path_invalid");
const semgrepImage =
	process.env.VULN_WORKBENCH_OWASP_SEMGREP_IMAGE ??
	"docker.io/semgrep/semgrep@sha256:bdf7013b2c3634a487671158da77c554f531742326b543a9464d2adf6c433ac8";
const osvImage =
	process.env.VULN_WORKBENCH_OSV_FIXTURE_IMAGE ??
	"ghcr.io/google/osv-scanner@sha256:5116601dedc01c1c580eb92371883ec052fc4c13c3fbc109d621a63ac416d475";
pinnedImageDigest(semgrepImage);
pinnedImageDigest(osvImage);
const tempRoot = path.join(
	root,
	".artifacts/capability-tmp",
	crypto.randomUUID(),
);
await mkdir(tempRoot, { recursive: true });
const volume = `vwb-capability-${crypto.randomUUID()}`;
const container = `vwb-capability-run-${crypto.randomUUID()}`;
const image = "vuln-workbench-benchmark:local";
const socket =
	process.env.VULN_WORKBENCH_DOCKER_SOCKET ?? "/var/run/docker.sock";
if (!path.isAbsolute(socket) || /[,\0\r\n]/.test(socket))
	throw new Error("capability_linux_socket_invalid");
await run([
	"docker",
	"build",
	"-f",
	"docker/benchmark/Dockerfile",
	"-t",
	image,
	".",
]);
for (const scanner of [
	semgrepImage,
	osvImage,
	"docker.io/bkimminich/juice-shop@sha256:cd58d79c5cb4d82f22fbaf616f9ff43bbd04ba630cd6b448a9ed99cf652fcebf",
]) {
	await run(["docker", "pull", scanner]);
}
await run(["bun", "run", "security-corpora:prepare"]);
await run(["bun", "run", "scripts/prepare-osv-fixtures.ts"]);
await run(["docker", "volume", "create", volume]);
try {
	await run([
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--mount",
		`type=volume,src=${volume},dst=/dependencies`,
		"--entrypoint",
		"cp",
		image,
		"-a",
		"/opt/benchmark-dependencies/node_modules/.",
		"/dependencies/",
	]);
	await run([
		"docker",
		"run",
		"--rm",
		"--name",
		container,
		"--network",
		"none",
		"--mount",
		`type=bind,src=${root},dst=${root}`,
		"--mount",
		`type=volume,src=${volume},dst=${root}/node_modules`,
		"--mount",
		`type=bind,src=${socket},dst=/var/run/docker.sock`,
		"--workdir",
		root,
		"--env",
		"GIT_CONFIG_COUNT=1",
		"--env",
		"GIT_CONFIG_KEY_0=safe.directory",
		"--env",
		`GIT_CONFIG_VALUE_0=${root}`,
		"--env",
		`TMPDIR=${tempRoot}`,
		"--env",
		`VULN_WORKBENCH_OWASP_SEMGREP_IMAGE=${semgrepImage}`,
		"--env",
		`VULN_WORKBENCH_OSV_FIXTURE_IMAGE=${osvImage}`,
		"--env",
		`VULN_WORKBENCH_OSV_FIXTURE_DB=${root}/.cache/scanner-data/current/osv`,
		image,
		"run",
		"verify:capability:full",
	]);
} finally {
	await Bun.spawn(["docker", "rm", "-f", container], {
		stdout: "ignore",
		stderr: "ignore",
	}).exited;
	await run(["docker", "volume", "rm", volume]);
}

async function run(command: string[]) {
	const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
	if ((await child.exited) !== 0)
		throw new Error(`capability_linux_command_failed:${command.join(" ")}`);
}
