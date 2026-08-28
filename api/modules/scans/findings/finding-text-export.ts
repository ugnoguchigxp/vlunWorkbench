type ScanForFindingExport = {
	id: string;
	profile: string;
	status: string;
	startedAt: Date | string | null;
	completedAt: Date | string | null;
	createdAt: Date | string;
};

type FindingForTextExport = {
	id: string;
	sourceTool: string;
	ruleId: string;
	title: string;
	description: string;
	severity: string;
	confidence: string;
	status: string;
	primaryLocation: Record<string, unknown> | null;
	fingerprint: string;
	metadata: Record<string, unknown>;
	createdAt: Date | string;
	updatedAt: Date | string;
};

export function buildFindingTextExport(
	scan: ScanForFindingExport,
	findings: FindingForTextExport[],
): string {
	const lines = [
		"# vulnWorkbench scan result export",
		"# Stored scanner findings only; AI summaries and remediation instructions are not included.",
		"",
		"[scan]",
		`id = ${tomlString(scan.id)}`,
		`profile = ${tomlString(scan.profile)}`,
		`status = ${tomlString(scan.status)}`,
		`finding_count = ${findings.length}`,
		`created_at = ${tomlString(toIsoString(scan.createdAt))}`,
	];

	appendOptionalDate(lines, "started_at", scan.startedAt);
	appendOptionalDate(lines, "completed_at", scan.completedAt);

	for (const finding of findings) {
		lines.push(
			"",
			"[[findings]]",
			`id = ${tomlString(finding.id)}`,
			`source_tool = ${tomlString(finding.sourceTool)}`,
			`rule_id = ${tomlString(finding.ruleId)}`,
			`severity = ${tomlString(finding.severity)}`,
			`confidence = ${tomlString(finding.confidence)}`,
			`status = ${tomlString(finding.status)}`,
			`title = ${tomlString(finding.title)}`,
			`description = ${tomlString(finding.description)}`,
			`primary_location_json = ${tomlString(stableJson(finding.primaryLocation))}`,
			`fingerprint = ${tomlString(finding.fingerprint)}`,
			`metadata_json = ${tomlString(stableJson(finding.metadata))}`,
			`created_at = ${tomlString(toIsoString(finding.createdAt))}`,
			`updated_at = ${tomlString(toIsoString(finding.updatedAt))}`,
		);
	}

	return `${lines.join("\n")}\n`;
}

export function buildFindingTextExportFilename(scanRunId: string): string {
	const safeId = scanRunId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 36);
	return `scan-results-${safeId || "export"}.txt`;
}

function appendOptionalDate(
	lines: string[],
	key: string,
	value: Date | string | null,
): void {
	if (value === null) return;
	lines.push(`${key} = ${tomlString(toIsoString(value))}`);
}

function toIsoString(value: Date | string): string {
	if (value instanceof Date) return value.toISOString();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function tomlString(value: string): string {
	return JSON.stringify(value);
}

function stableJson(value: unknown): string {
	return JSON.stringify(sortJsonValue(value)) ?? "null";
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, nested]) => [key, sortJsonValue(nested)]),
	);
}
