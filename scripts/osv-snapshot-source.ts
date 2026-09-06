const OSV_SNAPSHOT_ORIGIN =
	"https://osv-vulnerabilities.storage.googleapis.com";

export function latestOsvSnapshotSource(ecosystem: string): string {
	assertEcosystem(ecosystem);
	return `${OSV_SNAPSHOT_ORIGIN}/${encodeURIComponent(ecosystem)}/all.zip`;
}

export function pinOsvSnapshotSource(
	latestSourceRef: string,
	generation: string,
): string {
	const source = assertAllowedOsvSnapshotSource(latestSourceRef);
	if (source.generation !== null) {
		throw new Error("osv_snapshot_source_already_pinned");
	}
	assertGeneration(generation);
	source.url.searchParams.set("generation", generation);
	return source.url.toString();
}

export function assertPinnedOsvSnapshotSource(
	sourceRef: string,
	expectedEcosystem?: string,
): { url: URL; ecosystem: string; generation: string } {
	const source = assertAllowedOsvSnapshotSource(sourceRef, expectedEcosystem);
	if (source.generation === null) {
		throw new Error("osv_snapshot_source_not_pinned");
	}
	return { ...source, generation: source.generation };
}

export function assertAllowedOsvSnapshotSource(
	sourceRef: string,
	expectedEcosystem?: string,
): { url: URL; ecosystem: string; generation: string | null } {
	const url = new URL(sourceRef);
	if (
		url.protocol !== "https:" ||
		url.origin !== OSV_SNAPSHOT_ORIGIN ||
		url.username !== "" ||
		url.password !== "" ||
		url.hash !== ""
	) {
		throw new Error("osv_snapshot_source_not_allowed");
	}
	const match = url.pathname.match(/^\/([^/]+)\/all\.zip$/);
	if (!match) throw new Error("osv_snapshot_source_path_invalid");
	let ecosystem: string;
	try {
		ecosystem = decodeURIComponent(match[1] ?? "");
	} catch {
		throw new Error("osv_snapshot_source_path_invalid");
	}
	assertEcosystem(ecosystem);
	if (expectedEcosystem !== undefined && ecosystem !== expectedEcosystem) {
		throw new Error("osv_snapshot_source_ecosystem_mismatch");
	}
	if ([...url.searchParams.keys()].some((key) => key !== "generation")) {
		throw new Error("osv_snapshot_source_query_invalid");
	}
	const generations = url.searchParams.getAll("generation");
	if (generations.length > 1) {
		throw new Error("osv_snapshot_source_query_invalid");
	}
	const generation = generations[0] ?? null;
	if (generation !== null) assertGeneration(generation);
	return { url, ecosystem, generation };
}

function assertEcosystem(ecosystem: string): void {
	if (!/^[A-Za-z0-9._-]+$/.test(ecosystem)) {
		throw new Error("osv_snapshot_ecosystem_invalid");
	}
}

function assertGeneration(generation: string): void {
	if (!/^[1-9][0-9]{5,}$/.test(generation)) {
		throw new Error("osv_snapshot_generation_invalid");
	}
}
