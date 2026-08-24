export type OptionalScannerSelection = "disabled" | "preferred" | "required";

function parseIds(value: string): string[] {
	return [
		...new Set(
			value
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean),
		),
	];
}

export function parseOptionalScannerAdapterIds(
	value = process.env.VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS ?? "",
): string[] {
	return parseIds(value);
}

export function optionalScannerSelection(
	id: string,
	params: {
		preferredIds?: readonly string[];
		requiredIds?: readonly string[];
	} = {},
): OptionalScannerSelection {
	const requiredIds =
		params.requiredIds ??
		parseIds(process.env.VULN_WORKBENCH_REQUIRED_SCANNER_ADAPTERS ?? "");
	if (requiredIds.includes(id)) return "required";
	const preferredIds = params.preferredIds ?? parseOptionalScannerAdapterIds();
	return preferredIds.includes(id) ? "preferred" : "disabled";
}

export function isOptionalScannerAdapterEnabled(id: string): boolean {
	return optionalScannerSelection(id) !== "disabled";
}
