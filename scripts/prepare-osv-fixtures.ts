import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import { sha256File } from "./benchmark/benchmark-input-provenance";
import { assertPinnedOsvSnapshotSource } from "./osv-snapshot-source";

const root = path.resolve(process.argv[2] ?? ".cache/scanner-data/current/osv");
const manifest = await loadScannerDataManifest();
if (manifest.tools.osv?.state !== "ready")
	throw new Error(
		"osv_fixture_lock_stale_or_missing:run_scanner_data_refresh_lock",
	);
for (const bundle of manifest.tools.osv.dataBundles ?? []) {
	if (bundle.kind !== "vulnerability-db" || bundle.coverage.length !== 1)
		throw new Error("osv_fixture_bundle_invalid");
	const ecosystem = bundle.coverage[0];
	if (!ecosystem || !/^[A-Za-z0-9._-]+$/.test(ecosystem))
		throw new Error("osv_fixture_ecosystem_invalid");
	const source = assertPinnedOsvSnapshotSource(bundle.sourceRef, ecosystem);
	const destination = path.join(root, "osv-scanner", ecosystem, "all.zip");
	if ((await sha256File(destination).catch(() => null)) === bundle.digest)
		continue;
	await mkdir(path.dirname(destination), { recursive: true });
	const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
	try {
		const response = await fetch(source.url, {
			redirect: "error",
			signal: AbortSignal.timeout(600_000),
		});
		if (!response.ok || !response.body)
			throw new Error(`osv_fixture_download_failed:${response.status}`);
		if (response.headers.get("x-goog-generation") !== source.generation) {
			throw new Error("osv_fixture_generation_mismatch");
		}
		const writer = Bun.file(temporary).writer();
		const reader = response.body.getReader();
		let bytes = 0;
		try {
			for (;;) {
				const { value: chunk, done } = await reader.read();
				if (done) break;
				bytes += chunk.byteLength;
				if (bytes > 2 * 1024 * 1024 * 1024)
					throw new Error("osv_fixture_archive_too_large");
				writer.write(chunk);
				await writer.flush();
			}
		} finally {
			await reader.cancel();
			await writer.end();
		}
		if ((await sha256File(temporary)) !== bundle.digest)
			throw new Error(
				`osv_fixture_lock_mismatch:${ecosystem}:restore_cached_snapshot_or_refresh_lock`,
			);
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}
console.log(
	JSON.stringify({
		ok: true,
		root,
		scannerManifestHash: manifest.manifestHash,
	}),
);
