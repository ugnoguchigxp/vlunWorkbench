export function parseOptionalScannerAdapterIds(
	value = process.env.VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS ?? "",
): string[] {
	return [
		...new Set(
			value
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean),
		),
	];
}

export function isOptionalScannerAdapterEnabled(id: string): boolean {
	return parseOptionalScannerAdapterIds().includes(id);
}
