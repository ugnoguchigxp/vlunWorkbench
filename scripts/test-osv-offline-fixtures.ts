import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import {
	gitCommit,
	sha256File,
	sha256Tree,
} from "./benchmark/benchmark-input-provenance";
import { buildOsvFixtureCommand } from "./osv-fixture-runtime";

type Expected = {
	ecosystem: string;
	package: string;
	vulnerableVersion: string;
	fixedVersion: string;
	expectedId: string;
};

const fixturesRoot = path.resolve("tests/security-capability/osv");
const image = process.env.VULN_WORKBENCH_OSV_FIXTURE_IMAGE;
const manifest = await loadScannerDataManifest();
const configuredDatabaseRoot =
	process.env.VULN_WORKBENCH_OSV_FIXTURE_DB ??
	process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY;
const databaseRoot = configuredDatabaseRoot
	? path.resolve(configuredDatabaseRoot)
	: null;
const archiveRoot = databaseRoot
	? path.join(databaseRoot, "osv-scanner")
	: null;
const ecosystems = (await readdir(fixturesRoot, { withFileTypes: true }))
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();
const errors: string[] = [];
const matrix: Array<Record<string, unknown>> = [];
for (const ecosystem of ecosystems) {
	const root = path.join(fixturesRoot, ecosystem);
	const expected = JSON.parse(
		await readFile(path.join(root, "expected.json"), "utf8"),
	) as Expected;
	if (
		!expected.ecosystem ||
		!expected.package ||
		!expected.vulnerableVersion ||
		!expected.fixedVersion ||
		!expected.expectedId
	) {
		errors.push(`invalid expected contract: ${ecosystem}`);
		continue;
	}
	for (const state of ["vulnerable", "fixed"] as const) {
		const entries = await readdir(path.join(root, state));
		if (entries.length !== 1)
			errors.push(`${ecosystem}/${state} must contain one manifest fixture`);
		const text = await readFile(path.join(root, state, entries[0]), "utf8");
		const expectedVersion =
			state === "vulnerable"
				? expected.vulnerableVersion
				: expected.fixedVersion;
		if (!text.includes(expectedVersion))
			errors.push(`${ecosystem}/${state} does not pin ${expectedVersion}`);
	}
	if (!databaseRoot) {
		matrix.push({
			fixture: ecosystem,
			ecosystem: expected.ecosystem,
			expectedId: expected.expectedId,
			status: "fixture_validated",
			limitation: "offline_database_not_supplied",
		});
		continue;
	}
	const databasePath = path.join(
		archiveRoot as string,
		expected.ecosystem,
		"all.zip",
	);
	await access(databasePath).catch(() =>
		errors.push(`missing offline database: ${databasePath}`),
	);
	if (errors.at(-1)?.includes(databasePath)) continue;
	const expectedDigest = manifest.tools.osv?.dataBundles?.find((bundle) =>
		bundle.coverage.includes(expected.ecosystem),
	)?.digest;
	if ((await sha256File(databasePath)) !== expectedDigest) {
		errors.push(
			`${ecosystem} offline database does not match the scanner manifest`,
		);
		continue;
	}
	const vulnerableIds = await scanFixture(
		path.join(root, "vulnerable"),
		databaseRoot,
	);
	const fixedIds = await scanFixture(path.join(root, "fixed"), databaseRoot);
	if (!vulnerableIds.has(expected.expectedId))
		errors.push(`${ecosystem} missed ${expected.expectedId}`);
	if (fixedIds.has(expected.expectedId))
		errors.push(`${ecosystem} fixed fixture retained ${expected.expectedId}`);
	matrix.push({
		fixture: ecosystem,
		ecosystem: expected.ecosystem,
		expectedId: expected.expectedId,
		status: "scanned_offline",
		vulnerableDetected: vulnerableIds.has(expected.expectedId),
		fixedDetected: fixedIds.has(expected.expectedId),
	});
}
if (ecosystems.length !== 9)
	errors.push(`expected 9 ecosystem fixtures, found ${ecosystems.length}`);
const result = {
	schemaVersion: 2,
	generatedAt: new Date().toISOString(),
	gitCommit: await gitCommit(),
	scannerManifestHash: manifest.manifestHash,
	fixtureHash: await sha256Tree(["tests/security-capability/osv"]),
	implementationHash: await sha256Tree([
		"scripts/test-osv-offline-fixtures.ts",
		"scripts/osv-fixture-runtime.ts",
	]),
	scannerImage: image ?? null,
	networkIsolation: image ? "docker_network_none" : "not_enforced",
	ok: errors.length === 0,
	networkRequests: image ? 0 : null,
	databaseSupplied: databaseRoot !== null,
	matrix,
	errors,
};
const artifactPath = path.resolve(
	".artifacts/benchmark/osv-offline-fixtures.json",
);
await mkdir(path.dirname(artifactPath), { recursive: true });
await Bun.write(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, artifactPath }));
if (errors.length > 0) process.exitCode = 1;

async function scanFixture(
	fixturePath: string,
	cacheDirectory: string,
): Promise<Set<string>> {
	const outputRoot = await mkdtemp(
		path.join(os.tmpdir(), "vuln-workbench-osv-"),
	);
	const outputPath = path.join(outputRoot, "result.json");
	try {
		const proc = Bun.spawn(
			buildOsvFixtureCommand({
				fixturePath,
				databaseRoot: cacheDirectory,
				outputPath,
				image,
			}),
			{
				stdout: "ignore",
				stderr: "pipe",
				env: {
					PATH: process.env.PATH ?? "",
					OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: cacheDirectory,
				},
			},
		);
		const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
		const exitCode = await proc.exited;
		if (![0, 1].includes(exitCode))
			throw new Error(`osv_fixture_scan_failed:${exitCode}:${stderr}`);
		const parsed = JSON.parse(await readFile(outputPath, "utf8"));
		const ids = new Set<string>();
		collectIds(parsed, ids);
		return ids;
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
}

function collectIds(value: unknown, output: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) collectIds(item, output);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, nested] of Object.entries(value)) {
		if (
			(key === "id" || key === "aliases") &&
			typeof nested === "string" &&
			/^(?:GHSA|GO|RUSTSEC|PYSEC|CVE)-/.test(nested)
		) {
			output.add(nested);
		} else if (key === "aliases" && Array.isArray(nested)) {
			for (const alias of nested)
				if (typeof alias === "string") output.add(alias);
		}
		collectIds(nested, output);
	}
}
