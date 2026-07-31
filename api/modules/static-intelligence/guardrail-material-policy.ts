import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
	StaticIntelligenceRiskBand,
	StaticIntelligenceSeverity,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceGuardrailMaterial,
	StaticIntelligenceGuardrailMaterialGeneratedFrom,
	StaticIntelligenceGuardrailMaterialResult,
} from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import type { StaticIntelligenceKnowledgeSourceManifest } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type { RiskCommunity } from "../../../shared/schemas/static-intelligence-landscape.schema";
import { compareSeverity } from "./file-risk-index";
import { canonicalJson, sha256Hex } from "./knowledge-source-manifest";

export type GuardrailMaterialRefs = StaticIntelligenceGuardrailMaterial["refs"];
export type GuardrailMaterialApplicability =
	StaticIntelligenceGuardrailMaterial["applicability"];

const SEVERITY_TO_RISK_BAND: Record<
	StaticIntelligenceSeverity,
	StaticIntelligenceRiskBand
> = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
	info: "low",
	unknown: "unknown",
};

const MATERIAL_TYPE_ORDER: StaticIntelligenceGuardrailMaterial["type"][] = [
	"security_guardrail_material",
	"verification_recipe_material",
	"false_positive_lesson_material",
	"agent_actionability_lesson_material",
	"scanner_tuning_lesson_material",
];

export type MaterialBaseSource = {
	sourceId: string;
	scanRunId: string;
	contentHash: string;
	manifestRef: string;
	scanRef: string;
};

export function renderGuardrailMaterialMarkdown(
	result: StaticIntelligenceGuardrailMaterialResult,
): string {
	const counts = MATERIAL_TYPE_ORDER.map((type) => ({
		type,
		count: result.materials.filter((material) => material.type === type).length,
	})).filter((entry) => entry.count > 0);
	const lines = [
		"# Static Intelligence Guardrail Material",
		"",
		`- Source: ${result.sourceManifest.sourceId}`,
		`- Content hash: ${result.sourceManifest.contentHash}`,
		`- Materials: ${result.materials.length}`,
		...counts.map((entry) => `- ${entry.type}: ${entry.count}`),
	];
	for (const material of result.materials) {
		lines.push(
			"",
			`## ${material.title}`,
			"",
			`- Type: ${material.type}`,
			`- Summary: ${material.summary}`,
			`- Source refs: ${material.source.sourceRefs.join(", ")}`,
			`- Finding refs: ${material.refs.findingIds.join(", ") || "none"}`,
			`- Evidence refs: ${material.refs.evidenceRefs.join(", ") || "none"}`,
			`- Distillation: ${material.suggestedDistillation.contextStillType}/${material.suggestedDistillation.polarity}`,
		);
	}
	return lines.join("\n");
}

export function inferApplicability(
	type: StaticIntelligenceGuardrailMaterial["type"],
	refs: GuardrailMaterialRefs,
): GuardrailMaterialApplicability {
	const lowered = [...refs.fileRefs, ...refs.ruleIds, ...refs.scanners]
		.join(" ")
		.toLowerCase();
	return {
		domains: sortedUnique([
			"security",
			...(refs.findingIds.length > 0 ? ["application_security"] : []),
			...(isDependencySignal(lowered) ? ["dependency_security"] : []),
			...(isSecretSignal(lowered) ? ["secret_handling"] : []),
			...(isInputValidationSignal(lowered) ? ["input_validation"] : []),
		]),
		technologies: sortedUnique(refs.fileRefs.flatMap(technologiesForFile)),
		changeTypes: changeTypesForMaterialType(type),
	};
}

function technologiesForFile(path: string): string[] {
	if (path === "unknown") return [];
	const lowered = path.toLowerCase();
	if (lowered.endsWith(".ts") || lowered.endsWith(".tsx"))
		return ["typescript"];
	if (
		lowered.endsWith(".js") ||
		lowered.endsWith(".jsx") ||
		lowered.endsWith(".mjs") ||
		lowered.endsWith(".cjs")
	) {
		return ["javascript"];
	}
	if (lowered.endsWith(".py")) return ["python"];
	if (lowered.endsWith(".rb")) return ["ruby"];
	if (lowered.endsWith(".go")) return ["go"];
	if (lowered.endsWith(".rs")) return ["rust"];
	if (lowered.endsWith(".java") || lowered.endsWith(".kt")) return ["jvm"];
	if (
		lowered.endsWith("package.json") ||
		lowered.endsWith("package-lock.json") ||
		lowered.endsWith("bun.lock") ||
		lowered.endsWith("yarn.lock") ||
		lowered.endsWith("pnpm-lock.yaml")
	) {
		return ["node"];
	}
	if (
		lowered.endsWith("dockerfile") ||
		lowered.endsWith(".yaml") ||
		lowered.endsWith(".yml") ||
		lowered.endsWith(".tf")
	) {
		return ["infrastructure"];
	}
	return [];
}

function changeTypesForMaterialType(
	type: StaticIntelligenceGuardrailMaterial["type"],
): string[] {
	switch (type) {
		case "security_guardrail_material":
			return ["security_fix"];
		case "verification_recipe_material":
			return ["verification"];
		case "agent_actionability_lesson_material":
			return ["planning", "review"];
		case "scanner_tuning_lesson_material":
			return ["scanner_tuning"];
		case "false_positive_lesson_material":
			return ["review"];
	}
}

export function isSecurityCommunityEligible(community: RiskCommunity): boolean {
	if (isHighOrCritical(community.maxSeverity)) return true;
	if (community.basis.includes("same_scanner_rule")) return true;
	if (
		community.basis.includes("same_file") &&
		community.findingIds.length > 1
	) {
		return true;
	}
	return (
		community.basis.includes("semantic") && community.evidenceRefs.length > 0
	);
}

export function isScannerTuningCommunityEligible(
	community: RiskCommunity,
): boolean {
	return (
		(community.basis.includes("same_scanner_rule") ||
			community.basis.includes("same_scanner")) &&
		["weak", "none", "unknown"].includes(community.evidenceQuality) &&
		community.findingIds.length >= 2
	);
}

export function isHighRiskFileEntry(entry: FileRiskIndexEntry): boolean {
	return isHighOrCritical(entry.maxSeverity);
}

function isHighOrCritical(severity: StaticIntelligenceSeverity): boolean {
	return severity === "high" || severity === "critical";
}

export function refsFromCommunity(
	community: RiskCommunity,
): GuardrailMaterialRefs {
	return sortRefs({
		findingIds: community.findingIds,
		evidenceRefs: community.evidenceRefs,
		artifactRefs: community.artifactRefs,
		fileRefs: community.fileRefs.filter(isSafeRelativePath),
		ruleIds: community.ruleIds,
		scanners: community.scannerRefs,
	});
}

export function refsFromFileRiskEntry(
	entry: FileRiskIndexEntry,
): GuardrailMaterialRefs {
	return sortRefs({
		findingIds: entry.findingIds,
		evidenceRefs: entry.evidenceRefs,
		artifactRefs: entry.artifactRefs,
		fileRefs: isSafeRelativePath(entry.path) ? [entry.path] : [],
		ruleIds: entry.ruleIds,
		scanners: entry.scanners,
	});
}

export function emptyRefs(): GuardrailMaterialRefs {
	return {
		findingIds: [],
		evidenceRefs: [],
		artifactRefs: [],
		fileRefs: [],
		ruleIds: [],
		scanners: [],
	};
}

export function hasAnyRef(refs: GuardrailMaterialRefs): boolean {
	return Object.values(refs).some((values) => values.length > 0);
}

export function sortRefs(refs: GuardrailMaterialRefs): GuardrailMaterialRefs {
	return {
		findingIds: sortedUnique(refs.findingIds),
		evidenceRefs: sortedUnique(refs.evidenceRefs),
		artifactRefs: sortedUnique(refs.artifactRefs),
		fileRefs: sortedUnique(refs.fileRefs.filter(isSafeRelativePath)),
		ruleIds: sortedUnique(refs.ruleIds),
		scanners: sortedUnique(refs.scanners),
	};
}

export function sortApplicability(
	applicability: GuardrailMaterialApplicability,
): GuardrailMaterialApplicability {
	return {
		domains: sortedUnique(applicability.domains),
		technologies: sortedUnique(applicability.technologies),
		changeTypes: sortedUnique(applicability.changeTypes),
	};
}

export function sortGeneratedFrom(
	values: StaticIntelligenceGuardrailMaterialGeneratedFrom[],
): StaticIntelligenceGuardrailMaterialGeneratedFrom[] {
	const order: StaticIntelligenceGuardrailMaterialGeneratedFrom[] = [
		"finding",
		"file_risk",
		"risk_community",
		"security_landscape",
		"handoff",
		"scan_summary",
	];
	return [...new Set(values)].sort(
		(left, right) => order.indexOf(left) - order.indexOf(right),
	);
}

export function securityDedupKey(
	material: StaticIntelligenceGuardrailMaterial,
): string {
	return [
		material.type,
		material.refs.findingIds.join(","),
		material.refs.ruleIds.join(","),
		material.refs.scanners.join(","),
		material.refs.fileRefs.join(","),
	].join("|");
}

export function riskLabel(refs: GuardrailMaterialRefs): string {
	return refs.ruleIds[0] ?? refs.scanners[0] ?? "security";
}

export function surfaceLabel(refs: GuardrailMaterialRefs): string {
	return refs.fileRefs[0] ?? refs.scanners[0] ?? "the scanned surface";
}

export function severityToRiskBand(
	severity: StaticIntelligenceSeverity,
): StaticIntelligenceRiskBand {
	return SEVERITY_TO_RISK_BAND[severity];
}

export function riskRank(riskBand: StaticIntelligenceRiskBand): number {
	switch (riskBand) {
		case "critical":
			return 5;
		case "high":
			return 4;
		case "medium":
			return 3;
		case "low":
			return 2;
		case "none":
			return 1;
		case "unknown":
			return 0;
	}
}

export function buildBaseSource(
	exportPayload: StaticIntelligenceExportV1,
	sourceManifest: StaticIntelligenceKnowledgeSourceManifest,
): MaterialBaseSource {
	return {
		sourceId: sourceManifest.source.sourceId,
		scanRunId: exportPayload.scan.id,
		contentHash: sourceManifest.source.contentHash,
		manifestRef: `manifest:${sourceManifest.source.sourceId}`,
		scanRef: `scan:${exportPayload.scan.id}`,
	};
}

function isSafeRelativePath(path: string): boolean {
	if (!path.trim()) return false;
	if (path === "unknown") return true;
	if (path.startsWith("/") || path.startsWith("~")) return false;
	if (/^[a-zA-Z]:[\\/]/.test(path)) return false;
	if (path.includes("/Users/") || path.includes("/home/")) return false;
	return true;
}

export function sourceRef(kind: string, value: string): string {
	if (isUnsafeRefValue(value)) {
		return `${kind}:redacted:${sha256Hex(canonicalJson(value)).slice(0, 16)}`;
	}
	return `${kind}:${value}`;
}

export function sanitizeHandoffText(
	text: string,
	projectRoot: string | undefined,
): string[] {
	const trimmed = text.trim();
	if (!trimmed || isUnsafeRawText(trimmed)) return [];
	return [redactHomePaths(redactProjectRoot(trimmed, projectRoot))];
}

function redactProjectRoot(
	text: string,
	projectRoot: string | undefined,
): string {
	if (!projectRoot) return text;
	return text.split(projectRoot).join("<project-root>");
}

function redactHomePaths(text: string): string {
	return text
		.replaceAll(/\/Users\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/\/home\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/[A-Za-z]:\\Users\\[^\s"'`)]+/g, "<redacted-path>");
}

function isUnsafeRefValue(value: string): boolean {
	return !isSafeRelativePath(value) || isUnsafeRawText(value);
}

function isUnsafeRawText(value: string): boolean {
	return /rawContent|raw_content|rawArtifact|raw_artifact|raw artifact|rawEvidence|raw_evidence|raw evidence|snippet|stdout|stderr/i.test(
		value,
	);
}

export function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function isDependencySignal(value: string): boolean {
	return /dependency|package|lockfile|package\.json|cve|osv|trivy/.test(value);
}

function isSecretSignal(value: string): boolean {
	return /secret|token|private.?key|credential|gitleaks/.test(value);
}

function isInputValidationSignal(value: string): boolean {
	return /injection|xss|sqli|sql|command|path.?traversal|validation/.test(
		value,
	);
}

export function compareMaterialRisk(
	left: StaticIntelligenceRiskBand,
	right: StaticIntelligenceRiskBand,
): number {
	return compareSeverity(riskBandToSeverity(left), riskBandToSeverity(right));
}

function riskBandToSeverity(
	riskBand: StaticIntelligenceRiskBand,
): StaticIntelligenceSeverity {
	if (riskBand === "none") return "info";
	return riskBand;
}
