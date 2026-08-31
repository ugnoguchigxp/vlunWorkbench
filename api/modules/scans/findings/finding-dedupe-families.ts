import type { FindingIssueKind } from "../../../../shared/schemas/finding-group.schema";

type FindingFamilyInput = {
	sourceTool: string;
	ruleId: string;
	metadata: Record<string, unknown> | null | undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const list = (value: unknown): string[] =>
	typeof value === "string"
		? [value]
		: Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];

const normalized = (values: Iterable<string>) =>
	[...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b),
	);

const normalizeCwe = (value: string): string | null => {
	const match = value.match(/CWE[-_ ]?(\d+)/i);
	return match ? `cwe:${match[1]}` : null;
};

const normalizeRule = (ruleId: string) =>
	ruleId
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-");

/**
 * Returns only concrete, scanner-independent families when possible. Unknown
 * mappings deliberately do not create a cross-scanner merge candidate.
 */
export function findingFamilyKeys(input: FindingFamilyInput): string[] {
	const metadata = input.metadata ?? {};
	const risk = asRecord(metadata.risk);
	const cwes = normalized([
		...list(metadata.cwe),
		...list(metadata.cweId),
		...list(metadata.cweIds),
		...list(risk?.cwe),
		...list(risk?.cweIds),
	])
		.map(normalizeCwe)
		.filter((value): value is string => value !== null);
	if (cwes.length > 0) return cwes;

	const explicitFamily = normalized([
		...list(metadata.family),
		...list(metadata.familyKey),
		...list(metadata.detectorFamily),
		...list(metadata.policyFamily),
		...list(metadata.templateId),
		...list(metadata.pluginId),
	]);
	if (explicitFamily.length > 0) {
		return explicitFamily.map((value) => `family:${normalizeRule(value)}`);
	}

	if (input.sourceTool.toLowerCase() === "osv") {
		return ["family:dependency-advisory"];
	}
	if (/^(CVE|GHSA)-/i.test(input.ruleId)) {
		return ["family:dependency-advisory"];
	}

	// A tool-scoped rule still enables same-tool deduplication but can never
	// accidentally merge an unrelated rule from another scanner.
	const rule = normalizeRule(input.ruleId);
	return rule
		? [`rule:${input.sourceTool.trim().toLowerCase()}:${rule}`]
		: ["family:unknown"];
}

export function hasConcreteFamily(identity: { familyKeys: string[] }): boolean {
	return identity.familyKeys.some((key) => key !== "family:unknown");
}

export function inferIssueKind(input: FindingFamilyInput): FindingIssueKind {
	const tool = input.sourceTool.trim().toLowerCase();
	const rule = input.ruleId.trim().toLowerCase();
	const metadata = input.metadata ?? {};
	const findingClass = typeof metadata.class === "string" ? metadata.class : "";
	if (
		tool === "osv" ||
		/^(cve|ghsa)-/.test(input.ruleId) ||
		typeof metadata.vulnerabilityId === "string" ||
		typeof metadata.advisoryId === "string"
	) {
		return "dependency";
	}
	if (
		tool === "gitleaks" ||
		findingClass === "secret" ||
		typeof metadata.detectorFamily === "string"
	) {
		return "secret";
	}
	if (
		findingClass === "config" ||
		/(terraform|kubernetes|dockerfile|\.iac\.|iac[-_:])/.test(rule)
	) {
		return "iac";
	}
	if (tool === "zap" || tool === "nuclei") return "web";
	if (tool === "schemathesis" || tool === "dredd") return "api";
	if (tool === "semgrep" || tool === "codeql") return "source";
	return "unknown";
}
