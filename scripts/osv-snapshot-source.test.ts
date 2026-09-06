import { describe, expect, test } from "bun:test";
import {
	assertAllowedOsvSnapshotSource,
	assertPinnedOsvSnapshotSource,
	latestOsvSnapshotSource,
	pinOsvSnapshotSource,
} from "./osv-snapshot-source";

describe("OSV snapshot source", () => {
	test("pins the latest ecosystem object to its immutable GCS generation", () => {
		const latest = latestOsvSnapshotSource("crates.io");
		const pinned = pinOsvSnapshotSource(latest, "1788665539029532");
		expect(pinned).toBe(
			"https://osv-vulnerabilities.storage.googleapis.com/crates.io/all.zip?generation=1788665539029532",
		);
		expect(assertPinnedOsvSnapshotSource(pinned, "crates.io")).toMatchObject({
			ecosystem: "crates.io",
			generation: "1788665539029532",
		});
	});

	test("allows an unpinned source only while resolving a refresh", () => {
		expect(
			assertAllowedOsvSnapshotSource(latestOsvSnapshotSource("npm")),
		).toMatchObject({ ecosystem: "npm", generation: null });
		expect(() =>
			assertPinnedOsvSnapshotSource(latestOsvSnapshotSource("npm")),
		).toThrow("osv_snapshot_source_not_pinned");
	});

	test("rejects alternate hosts, object paths, query parameters, and ecosystems", () => {
		for (const source of [
			"https://example.test/npm/all.zip?generation=1788665539029532",
			"https://osv-vulnerabilities.storage.googleapis.com/npm/other.zip?generation=1788665539029532",
			"https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip?generation=1788665539029532&alt=media",
			"https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip?generation=latest",
			"https://osv-vulnerabilities.storage.googleapis.com/%ZZ/all.zip?generation=1788665539029532",
		]) {
			expect(() => assertPinnedOsvSnapshotSource(source)).toThrow();
		}
		expect(() =>
			assertPinnedOsvSnapshotSource(
				"https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip?generation=1788665539029532",
				"Go",
			),
		).toThrow("osv_snapshot_source_ecosystem_mismatch");
	});
});
