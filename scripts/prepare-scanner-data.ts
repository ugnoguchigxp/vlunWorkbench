import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	computeScannerManifestHash,
	hashTree,
	loadScannerDataManifest,
} from "../api/modules/scans/tools/scanner-provenance";

const outputRoot = path.resolve(
	process.argv[2] ??
		path.join(os.tmpdir(), "vuln-workbench-scanner-data-bundle"),
);
if (
	outputRoot === path.parse(outputRoot).root ||
	outputRoot === process.cwd() ||
	outputRoot.length < 20
) {
	throw new Error(`Refusing unsafe scanner data output path: ${outputRoot}`);
}

const templatePath = path.resolve(
	"docker/toolbox/scanner-data/scanner-data-manifest.json",
);
const sourceRoot = path.dirname(templatePath);
const tempRoot = await mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-scanner-data-"),
);

try {
	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(outputRoot, { recursive: true });
	await cp(
		path.join(sourceRoot, "semgrep-rules"),
		path.join(outputRoot, "semgrep-rules"),
		{
			recursive: true,
		},
	);

	const osvHome = path.join(tempRoot, "osv-home");
	await mkdir(osvHome, { recursive: true });
	await run(
		[
			"osv-scanner",
			"scan",
			"source",
			"--offline-vulnerabilities",
			"--download-offline-databases",
			"--no-resolve",
			"--format",
			"json",
			"--output-file",
			path.join(tempRoot, "osv-prepare.json"),
			"-L",
			"bun.lock",
			".",
		],
		{ HOME: osvHome },
	);
	const osvCache = await findDirectory(osvHome, "osv-scanner");
	if (!osvCache) throw new Error("OSV offline database cache was not created.");
	await mkdir(path.join(outputRoot, "osv"), { recursive: true });
	await rename(osvCache, path.join(outputRoot, "osv", "osv-scanner"));

	const trivyRoot = path.join(outputRoot, "trivy");
	await run([
		"trivy",
		"image",
		"--cache-dir",
		trivyRoot,
		"--download-db-only",
		"--no-progress",
	]);

	const template = await loadScannerDataManifest(templatePath);
	const generatedAt = new Date().toISOString();
	const snapshotDate = generatedAt.slice(0, 10);
	const tools = structuredClone(template.tools);
	tools.semgrep = {
		...tools.semgrep,
		state: "ready",
		digest: await hashTree(path.join(outputRoot, "semgrep-rules")),
		sourceRef: "repo:docker/toolbox/scanner-data/semgrep-rules",
		generatedAt,
		maxAgeHours: 720,
	};
	tools.osv = {
		...tools.osv,
		state: "ready",
		digest: await hashTree(path.join(outputRoot, "osv")),
		sourceRef: "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip",
		generatedAt,
		maxAgeHours: 168,
		coverage: ["npm"],
	};
	tools.trivy = {
		...tools.trivy,
		state: "ready",
		digest: await hashTree(path.join(outputRoot, "trivy")),
		sourceRef: "mirror.gcr.io/aquasec/trivy-db:2",
		generatedAt,
		maxAgeHours: 168,
	};
	const withoutHash = { version: 1 as const, snapshotDate, tools };
	const manifest = {
		...withoutHash,
		manifestHash: computeScannerManifestHash(withoutHash),
	};
	await Bun.write(
		path.join(outputRoot, "scanner-data-manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		JSON.stringify({
			ok: true,
			outputRoot,
			manifestHash: manifest.manifestHash,
			snapshotDate,
			osvCoverage: ["npm"],
		}),
	);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

async function run(command: string[], extraEnv: Record<string, string> = {}) {
	const proc = Bun.spawn(command, {
		cwd: process.cwd(),
		env: { ...process.env, ...extraEnv },
		stdout: command[0] === "osv-scanner" ? "ignore" : "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) throw new Error(`${command[0]} exited with code ${code}`);
}

async function findDirectory(
	root: string,
	name: string,
): Promise<string | null> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const candidate = path.join(root, entry.name);
		if (entry.name === name) return candidate;
		const nested = await findDirectory(candidate, name);
		if (nested) return nested;
	}
	return null;
}
