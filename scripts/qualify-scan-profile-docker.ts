import { access } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

function artifactRelativePath(value: string, name: string): string {
	if (
		path.isAbsolute(value) ||
		value.includes("\0") ||
		value.split(/[\\/]+/).some((segment) => segment === "..")
	)
		throw new Error(`docker_qualification_${name}_must_be_artifact_relative`);
	return value;
}

async function main() {
	const { values } = parseArgs({
		options: {
			unsigned: { type: "string" },
			artifactRoot: { type: "string" },
			out: { type: "string" },
			image: { type: "string", default: "vuln-workbench-qualification:local" },
		},
	});
	if (!values.unsigned || !values.artifactRoot || !values.out)
		throw new Error("docker_qualification_args_required");
	const root = process.cwd();
	const artifactRoot = path.resolve(root, values.artifactRoot);
	if (artifactRoot === root || !artifactRoot.startsWith(`${root}${path.sep}`))
		throw new Error("docker_qualification_artifact_root_must_be_inside_source");
	const nodeModules = path.join(root, "node_modules");
	const unsigned = artifactRelativePath(values.unsigned, "unsigned");
	const output = artifactRelativePath(values.out, "out");
	await Promise.all([access(artifactRoot), access(nodeModules)]);
	const child = Bun.spawn(
		[
			"docker",
			"run",
			"--rm",
			"--network",
			"none",
			"--read-only",
			"--tmpfs",
			"/tmp:rw,noexec,nosuid,size=128m",
			"--mount",
			`type=bind,src=${root},dst=/workspace/repo,readonly`,
			"--mount",
			`type=bind,src=${nodeModules},dst=/workspace/repo/node_modules,readonly`,
			"--mount",
			`type=bind,src=${artifactRoot},dst=/workspace/artifacts`,
			values.image,
			"run",
			"scripts/build-scan-profile-stability-qualification.ts",
			"--unsigned",
			`/workspace/artifacts/${unsigned}`,
			"--artifactRoot",
			"/workspace/artifacts",
			"--out",
			`/workspace/artifacts/${output}`,
			"--require-clean-candidate",
			"--candidate-repository",
			"/workspace/repo",
		],
		{ cwd: root, stdout: "inherit", stderr: "inherit" },
	);
	if ((await child.exited) !== 0)
		throw new Error("docker_qualification_failed");
}
if (import.meta.main) await main();
