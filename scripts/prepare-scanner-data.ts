import crypto from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scannerDataManifestV2Schema } from "../shared/schemas/security-capability.schema";
import {
	computeScannerManifestHash,
	hashTree,
} from "../api/modules/scans/tools/scanner-provenance";

const OSV_ECOSYSTEMS = [
	"npm",
	"PyPI",
	"Go",
	"Maven",
	"crates.io",
	"NuGet",
	"Packagist",
	"RubyGems",
] as const;
const outputRoot = path.resolve(
	process.argv[2] ??
		path.join(os.tmpdir(), "vuln-workbench-scanner-data-bundle"),
);
const downloadCacheRoot = path.resolve(
	process.env.VULN_WORKBENCH_SCANNER_DATA_DOWNLOAD_CACHE ??
		".cache/scanner-data/downloads",
);
assertSafeOutputRoot(outputRoot);
assertSafeOutputRoot(downloadCacheRoot);

const templatePath = path.resolve(
	"docker/toolbox/scanner-data/scanner-data-manifest.json",
);
const sourceRoot = path.dirname(templatePath);
const template = scannerDataManifestV2Schema.parse(
	JSON.parse(await readFile(templatePath, "utf8")),
);
const allowRefresh = ["1", "true", "yes", "on"].includes(
	(process.env.VULN_WORKBENCH_SCANNER_DATA_REFRESH ?? "").toLowerCase(),
);
const tempRoot = await mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-scanner-data-"),
);

try {
	const stagedOutput = path.join(tempRoot, "output");
	await mkdir(stagedOutput, { recursive: true });
	await cp(
		path.join(sourceRoot, "semgrep-rules"),
		path.join(stagedOutput, "semgrep-rules"),
		{ recursive: true },
	);
	await cp(
		path.join(sourceRoot, "..", "nuclei-safe-templates"),
		path.join(stagedOutput, "nuclei-safe-templates"),
		{ recursive: true },
	);
	const generatedAt = new Date().toISOString();
	const osvRoot = path.join(stagedOutput, "osv", "osv-scanner");
	await mkdir(osvRoot, { recursive: true });
	await mkdir(downloadCacheRoot, { recursive: true });
	const osvBundles = [];
	for (const ecosystem of OSV_ECOSYSTEMS) {
		const ecosystemRoot = path.join(osvRoot, ecosystem);
		await mkdir(ecosystemRoot, { recursive: true });
		const archivePath = path.join(ecosystemRoot, "all.zip");
		const cachedArchivePath = path.join(
			downloadCacheRoot,
			`${ecosystem.replace(/[^A-Za-z0-9._-]/g, "_")}-all.zip`,
		);
		const sourceRef = `https://osv-vulnerabilities.storage.googleapis.com/${encodeURIComponent(ecosystem)}/all.zip`;
		let recordCount = await validateOsvArchive(
			cachedArchivePath,
			ecosystem,
		).catch(() => null);
		if (recordCount === null) {
			await rm(cachedArchivePath, { force: true });
			await downloadBounded(
				sourceRef,
				cachedArchivePath,
				2 * 1024 * 1024 * 1024,
			);
			recordCount = await validateOsvArchive(cachedArchivePath, ecosystem);
		}
		await cp(cachedArchivePath, archivePath);
		const archiveDigest = await sha256File(archivePath);
		const lockedBundle = template.tools.osv.dataBundles.find(
			(bundle) =>
				bundle.coverage.length === 1 && bundle.coverage[0] === ecosystem,
		);
		if (
			template.tools.osv.state === "ready" &&
			lockedBundle &&
			lockedBundle.digest !== archiveDigest &&
			!allowRefresh
		)
			throw new Error(
				`scanner_data_lock_mismatch:${ecosystem}:${archiveDigest}`,
			);
		osvBundles.push({
			id: `osv-${ecosystem}`,
			kind: "vulnerability-db" as const,
			sourceRef,
			sourceCommit: null,
			license: "CC-BY-4.0",
			generatedAt,
			maxAgeHours: 168,
			digest: archiveDigest,
			coverage: [ecosystem],
			recordCount,
			path: null,
		});
	}

	const trivyRoot = path.join(stagedOutput, "trivy");
	await run([
		"trivy",
		"image",
		"--cache-dir",
		trivyRoot,
		"--download-db-only",
		"--no-progress",
	]);

	const tools = structuredClone(template.tools);
	const sourceLockDigest = await sha256File(
		"spec/security-capability/semgrep-rule-sources.lock.json",
	);
	tools.semgrep = {
		...tools.semgrep,
		state: "ready",
		dataBundles: [
			{
				id: "curated-sast-v1",
				kind: "ruleset",
				sourceRef: "repo:docker/toolbox/scanner-data/semgrep-rules",
				sourceCommit: null,
				license: "MIT",
				generatedAt,
				maxAgeHours: 8760,
				digest: await hashTree(path.join(stagedOutput, "semgrep-rules")),
				coverage: [
					"javascript:8-rules",
					"typescript:8-rules",
					"python:8-rules",
					"java:13-rules",
					"go:8-rules",
				],
				path: "semgrep-rules",
			},
			{
				id: "semgrep-rule-sources-lock-v1",
				kind: "ruleset",
				sourceRef:
					"repo:spec/security-capability/semgrep-rule-sources.lock.json",
				sourceCommit: null,
				license: "MIT",
				generatedAt,
				maxAgeHours: 8760,
				digest: sourceLockDigest,
				coverage: ["source-and-license-lock"],
				path: null,
			},
		],
	};
	const nucleiSafe = tools["nuclei-safe"];
	if (nucleiSafe) {
		const nucleiSafeDigest = await hashTree(
			path.join(stagedOutput, "nuclei-safe-templates"),
		);
		tools["nuclei-safe"] = {
			...nucleiSafe,
			dataBundles: nucleiSafe.dataBundles.map((bundle) =>
				bundle.id === "nuclei-safe-owned-v1"
					? {
							...bundle,
							digest: nucleiSafeDigest,
							path: "nuclei-safe-templates",
						}
					: bundle,
			),
		};
	}
	tools.osv = {
		...tools.osv,
		state: "ready",
		dataBundles: osvBundles,
	};
	const trivyDigest = await hashTree(trivyRoot);
	const lockedTrivy = template.tools.trivy.dataBundles.find(
		(bundle) => bundle.id === "trivy-db-v2",
	);
	if (
		template.tools.trivy.state === "ready" &&
		lockedTrivy &&
		lockedTrivy.digest !== trivyDigest &&
		!allowRefresh
	)
		throw new Error(`scanner_data_lock_mismatch:trivy:${trivyDigest}`);
	tools.trivy = {
		...tools.trivy,
		state: "ready",
		dataBundles: [
			{
				id: "trivy-db-v2",
				kind: "vulnerability-db",
				sourceRef: "mirror.gcr.io/aquasec/trivy-db:2",
				sourceCommit: null,
				license: "Apache-2.0",
				generatedAt,
				maxAgeHours: 168,
				digest: trivyDigest,
				coverage: ["os-packages", "language-packages"],
				path: "trivy",
			},
		],
	};
	const withoutHash = {
		version: 2 as const,
		generatedAt,
		tools,
	};
	const manifest = scannerDataManifestV2Schema.parse({
		...withoutHash,
		manifestHash: computeScannerManifestHash(withoutHash),
	});
	await Bun.write(
		path.join(stagedOutput, "scanner-data-manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	await rm(outputRoot, { recursive: true, force: true });
	await rename(stagedOutput, outputRoot);
	console.log(
		JSON.stringify({
			ok: true,
			outputRoot,
			manifestHash: manifest.manifestHash,
			generatedAt,
			osvCoverage: OSV_ECOSYSTEMS,
		}),
	);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

async function downloadBounded(
	url: string,
	outputPath: string,
	maxBytes: number,
): Promise<void> {
	const parsed = new URL(url);
	if (
		parsed.protocol !== "https:" ||
		parsed.hostname !== "osv-vulnerabilities.storage.googleapis.com"
	) {
		throw new Error(`scanner_data_source_not_allowed:${parsed.origin}`);
	}
	const response = await fetch(parsed);
	if (!response.ok || !response.body)
		throw new Error(`scanner_data_download_failed:${response.status}`);
	const file = Bun.file(outputPath);
	const writer = file.writer();
	let total = 0;
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) throw new Error("scanner_data_archive_too_large");
			writer.write(value);
		}
		await writer.end();
	} catch (error) {
		await reader.cancel();
		await writer.end();
		throw error;
	}
	if ((await stat(outputPath)).size !== total)
		throw new Error("scanner_data_archive_write_incomplete");
}

async function validateOsvArchive(
	archivePath: string,
	expectedEcosystem: string,
): Promise<number> {
	await run(["unzip", "-tqq", archivePath]);
	const totals = await run(["unzip", "-Z", "-t", archivePath], true);
	const uncompressedBytes = Number(
		totals.match(/(\d+)\s+bytes uncompressed/)?.[1] ?? Number.NaN,
	);
	if (
		!Number.isSafeInteger(uncompressedBytes) ||
		uncompressedBytes <= 0 ||
		uncompressedBytes > 8 * 1024 * 1024 * 1024
	)
		throw new Error("osv_archive_uncompressed_size_invalid");
	const entries = (await run(["unzip", "-Z1", archivePath], true))
		.split(/\r?\n/)
		.filter((entry) => entry.endsWith(".json"));
	if (entries.length === 0) throw new Error("osv_archive_empty");
	for (const entry of entries) {
		if (
			entry.startsWith("/") ||
			entry.split("/").some((segment) => segment === "..")
		) {
			throw new Error(`osv_archive_unsafe_path:${entry}`);
		}
	}
	let matchedEcosystem = false;
	const sampleEntries = [
		...new Set(
			Array.from({ length: Math.min(entries.length, 200) }, (_, index) =>
				Math.min(
					entries.length - 1,
					Math.floor((index * entries.length) / Math.min(entries.length, 200)),
				),
			).map((index) => entries[index]),
		),
	];
	for (const entry of sampleEntries) {
		const sample = JSON.parse(
			await run(["unzip", "-p", archivePath, entry], true),
		) as { affected?: Array<{ package?: { ecosystem?: string } }> };
		if (
			sample.affected?.some(
				(item) => item.package?.ecosystem === expectedEcosystem,
			)
		) {
			matchedEcosystem = true;
			break;
		}
	}
	if (!matchedEcosystem)
		throw new Error(`osv_archive_ecosystem_missing:${expectedEcosystem}`);
	return entries.length;
}

async function run(command: string[], capture = false): Promise<string> {
	const proc = Bun.spawn(command, {
		stdout: capture ? "pipe" : "inherit",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		capture && proc.stdout
			? new Response(proc.stdout).text()
			: Promise.resolve(""),
		proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
	]);
	if (exitCode !== 0)
		throw new Error(`${command[0]} failed (${exitCode}): ${stderr}`);
	return stdout;
}

async function sha256File(filePath: string): Promise<string> {
	const hash = crypto.createHash("sha256");
	hash.update(await readFile(filePath));
	return `sha256:${hash.digest("hex")}`;
}

function assertSafeOutputRoot(value: string): void {
	if (
		value === path.parse(value).root ||
		value === process.cwd() ||
		value.length < 20
	) {
		throw new Error(`Refusing unsafe scanner data output path: ${value}`);
	}
}
