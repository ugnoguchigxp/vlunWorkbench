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
}): boolean {
	if (!Array.isArray(params.matrix)) return false;
	const observations = params.matrix as OsvFixtureObservation[];
	const ecosystems = new Set(
		observations.flatMap((item) =>
			typeof item?.ecosystem === "string" ? [item.ecosystem] : [],
		),
	);
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
