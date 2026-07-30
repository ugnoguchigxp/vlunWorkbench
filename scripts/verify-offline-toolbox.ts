import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const image =
	process.env.VULN_WORKBENCH_TOOLBOX_IMAGE ?? "vuln-workbench-toolbox:local";
const outputRoot = await mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-offline-toolbox-"),
);
await chmod(outputRoot, 0o777);
try {
	const common = [
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--memory",
		"4g",
		"--memory-swap",
		"4g",
		"--cpus",
		"2",
		"--pids-limit",
		"512",
		"-v",
		`${process.cwd()}:/workspace/repo:ro`,
		"-v",
		`${outputRoot}:/workspace/out:rw`,
		image,
	];
	run(
		[
			...common,
			"semgrep",
			"scan",
			"--config",
			"/opt/vuln-workbench/scanner-data/semgrep-rules",
			"--json",
			"--quiet",
			"api/modules/dast/auth-material.ts",
		],
		path.join(outputRoot, "semgrep.json"),
	);
	run([
		...common,
		"osv-scanner",
		"scan",
		"source",
		"--offline",
		"--no-resolve",
		"--format",
		"json",
		"--output-file",
		"/workspace/out/osv.json",
		"-L",
		"bun.lock",
		".",
	]);
	run([
		...common,
		"trivy",
		"fs",
		"--cache-dir",
		"/opt/vuln-workbench/scanner-data/trivy",
		"--skip-db-update",
		"--skip-java-db-update",
		"--offline-scan",
		"--scanners",
		"vuln",
		"--format",
		"json",
		"--output",
		"/workspace/out/trivy.json",
		".",
	]);
	const manifest = JSON.parse(
		execFileSync(
			"docker",
			[
				"run",
				"--rm",
				"--network",
				"none",
				image,
				"cat",
				"/opt/vuln-workbench/scanner-data/scanner-data-manifest.json",
			],
			{ encoding: "utf8" },
		),
	);
	const outputs = Object.fromEntries(
		await Promise.all(
			["semgrep", "osv", "trivy"].map(async (toolId) => {
				const bytes = await readFile(path.join(outputRoot, `${toolId}.json`));
				JSON.parse(bytes.toString("utf8"));
				return [toolId, { ok: true, outputBytes: bytes.byteLength }];
			}),
		),
	);
	const result = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		image,
		imageDigest: execFileSync(
			"docker",
			["image", "inspect", image, "--format", "{{.Id}}"],
			{ encoding: "utf8" },
		).trim(),
		manifestHash: manifest.manifestHash,
		networkMode: "none",
		resourceLimits: { memory: "4g", cpus: "2", pids: 512 },
		outputs,
	};
	const artifactPath = path.resolve(".artifacts/offline-toolbox-matrix.json");
	await mkdir(path.dirname(artifactPath), { recursive: true });
	await Bun.write(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ ok: true, artifactPath, ...result }));
} finally {
	await rm(outputRoot, { recursive: true, force: true });
}

function run(command: string[], stdoutPath?: string) {
	const output = execFileSync(command[0], command.slice(1), {
		stdio: stdoutPath ? ["ignore", "pipe", "inherit"] : "inherit",
	});
	if (stdoutPath) writeFileSync(stdoutPath, output);
}
