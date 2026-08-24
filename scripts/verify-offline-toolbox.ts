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
	execFileSync(
		"docker",
		[
			"run",
			"--rm",
			"--network",
			"none",
			image,
			"sh",
			"-c",
			"! command -v semgrep >/dev/null 2>&1",
		],
		{ stdio: "inherit" },
	);
	const coreScannerVersions = Object.fromEntries(
		(
			[
				["gitleaks", ["gitleaks", "version"]],
				["cosign", ["cosign", "version"]],
				["zizmor", ["zizmor", "--version"]],
				["slsa-verifier", ["slsa-verifier", "version"]],
				["schemathesis", ["st", "--version"]],
			] satisfies Array<[string, string[]]>
		).map(([scannerId, command]) => [
			scannerId,
			execFileSync(
				"docker",
				["run", "--rm", "--network", "none", image, ...command],
				{ encoding: "utf8" },
			).trim(),
		]),
	);
	run(
		[
			...common,
			"gitleaks",
			"detect",
			"--source",
			"scripts/scan-profile-qualification/fixtures",
			"--no-git",
			"--report-format",
			"json",
			"--report-path",
			"/workspace/out/gitleaks.json",
			"--redact",
		],
		undefined,
		[0, 1],
	);
	run(
		[
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
		],
		undefined,
		[0, 1],
	);
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
	run(
		[
			...common,
			"zizmor",
			"--offline",
			"--format=json-v1",
			"--no-progress",
			"--color=never",
			"--no-exit-codes",
			"/workspace/repo/.github/workflows",
		],
		path.join(outputRoot, "zizmor.json"),
	);
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
	const cosignTrustedRootPath =
		manifest.tools?.cosign?.runtimePath ??
		"/opt/vuln-workbench/scanner-data/sigstore-trusted-root.json";
	const cosignTrustedRootDigest = `sha256:${
		execFileSync(
			"docker",
			[
				"run",
				"--rm",
				"--network",
				"none",
				image,
				"sha256sum",
				cosignTrustedRootPath,
			],
			{ encoding: "utf8" },
		)
			.trim()
			.split(/\s+/)[0]
	}`;
	const expectedCosignTrustedRootDigest =
		manifest.tools?.cosign?.dataBundles?.find(
			(bundle: { id?: string }) =>
				bundle.id === "sigstore-production-trusted-root-v1",
		)?.digest;
	if (
		!expectedCosignTrustedRootDigest ||
		expectedCosignTrustedRootDigest !== cosignTrustedRootDigest
	) {
		throw new Error(
			`cosign_trusted_root_digest_mismatch:${expectedCosignTrustedRootDigest ?? "missing"}:${cosignTrustedRootDigest}`,
		);
	}
	const outputs = Object.fromEntries(
		await Promise.all(
			["gitleaks", "osv", "trivy", "zizmor"].map(async (toolId) => {
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
		cosignTrustedRootDigest,
		networkMode: "none",
		resourceLimits: { memory: "4g", cpus: "2", pids: 512 },
		excludedCoreTools: { semgrep: true },
		coreScannerVersions,
		outputs,
	};
	const artifactPath = path.resolve(".artifacts/offline-toolbox-matrix.json");
	await mkdir(path.dirname(artifactPath), { recursive: true });
	await Bun.write(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ ok: true, artifactPath, ...result }));
} finally {
	await rm(outputRoot, { recursive: true, force: true });
}

function run(
	command: string[],
	stdoutPath?: string,
	acceptedExitCodes: number[] = [0],
) {
	try {
		const output = execFileSync(command[0], command.slice(1), {
			stdio: stdoutPath ? ["ignore", "pipe", "inherit"] : "inherit",
		});
		if (stdoutPath) writeFileSync(stdoutPath, output);
	} catch (error) {
		const status = (error as { status?: number }).status;
		if (status === undefined || !acceptedExitCodes.includes(status))
			throw error;
	}
}
