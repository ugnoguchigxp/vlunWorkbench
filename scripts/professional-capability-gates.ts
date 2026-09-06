type OsvFixtureObservation = {
	ecosystem?: unknown;
	fixedDetected?: unknown;
	vulnerableDetected?: unknown;
};

export function assessOsvEvidence(params: {
	bundleCount: number;
	databaseSupplied: unknown;
	manifestState: string | undefined;
	matrix: unknown;
	minimumEcosystems: number;
	networkRequests: unknown;
	expectedEcosystems?: string[];
	provenance?: {
		actual: Record<string, unknown> | null;
		gitCommit: string;
		scannerManifestHash: string;
		fixtureHash: string;
		implementationHash: string;
	};
}): boolean {
	if (!Array.isArray(params.matrix)) return false;
	const observations = params.matrix as OsvFixtureObservation[];
	const ecosystems = new Set(
		observations.flatMap((item) =>
			typeof item?.ecosystem === "string" ? [item.ecosystem] : [],
		),
	);
	if (
		params.expectedEcosystems &&
		(ecosystems.size !== params.expectedEcosystems.length ||
			params.expectedEcosystems.some((name) => !ecosystems.has(name)))
	)
		return false;
	if (params.provenance) {
		const { actual, ...expected } = params.provenance;
		if (
			actual?.schemaVersion !== 2 ||
			actual.networkIsolation !== "docker_network_none" ||
			actual.ok !== true ||
			Object.entries(expected).some(([key, value]) => actual[key] !== value)
		)
			return false;
	}
	return (
		params.manifestState === "ready" &&
		params.bundleCount === params.minimumEcosystems &&
		params.databaseSupplied === true &&
		params.networkRequests === 0 &&
		ecosystems.size === params.minimumEcosystems &&
		observations.every(
			(item) =>
				item.vulnerableDetected === true && item.fixedDetected === false,
		)
	);
}
