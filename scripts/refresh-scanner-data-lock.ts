import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRepositoryScannerDataLock } from "./scanner-data-lock";

const repositoryRoot = process.cwd();
const manifestPath = path.resolve(
	repositoryRoot,
	"docker/toolbox/scanner-data/scanner-data-manifest.json",
);
const retainedOutput = process.argv[2];
const outputRoot = retainedOutput
	? path.resolve(retainedOutput)
	: await mkdtemp(
			path.join(os.tmpdir(), "vuln-workbench-scanner-lock-refresh-"),
		);
const temporaryManifestPath = `${manifestPath}.refresh-${process.pid}`;

try {
	const child = Bun.spawn(
		["bun", "run", "scripts/prepare-scanner-data.ts", outputRoot],
		{
			cwd: repositoryRoot,
			stdout: "inherit",
			stderr: "inherit",
			env: {
				...process.env,
				VULN_WORKBENCH_SCANNER_DATA_REFRESH: "1",
			},
		},
	);
	if ((await child.exited) !== 0) {
		throw new Error("scanner_data_refresh_failed");
	}
	const generated = JSON.parse(
		await readFile(path.join(outputRoot, "scanner-data-manifest.json"), "utf8"),
	);
	const lock = buildRepositoryScannerDataLock(generated);
	await writeFile(temporaryManifestPath, `${JSON.stringify(lock, null, 2)}\n`, {
		flag: "wx",
	});
	await rename(temporaryManifestPath, manifestPath);
	console.log(
		JSON.stringify({
			ok: true,
			manifestPath: path.relative(repositoryRoot, manifestPath),
			manifestHash: lock.manifestHash,
			generatedAt: lock.generatedAt,
			bundleRoot: retainedOutput
				? path.relative(repositoryRoot, outputRoot)
				: null,
		}),
	);
} finally {
	await rm(temporaryManifestPath, { force: true });
	if (!retainedOutput) await rm(outputRoot, { recursive: true, force: true });
}
