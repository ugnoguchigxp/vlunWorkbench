import type {
	FileRiskIndexEntry,
	StaticIntelligenceEvidenceQuality,
	StaticIntelligenceExportV1,
	StaticIntelligenceRiskBand,
	StaticIntelligenceSeverity,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceGuardrailMaterial,
	StaticIntelligenceGuardrailMaterialGeneratedFrom,
	StaticIntelligenceGuardrailMaterialResult,
	StaticIntelligenceGuardrailMaterialType,
} from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import { staticIntelligenceGuardrailMaterialResultSchema } from "../../../shared/schemas/static-intelligence-guardrail-material.schema";
import type { StaticIntelligenceKnowledgeSourceManifest } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type {
	RiskCommunity,
	RiskCommunityConfidence,
	SecurityLandscape,
} from "../../../shared/schemas/static-intelligence-landscape.schema";
import type { AppDatabase } from "../../db";
import { buildRiskCommunities } from "./community-builder";
import { buildStaticIntelligenceExport } from "./export-builder";
import { compareSeverity } from "./file-risk-index";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import { canonicalJson, sha256Hex } from "./knowledge-source-manifest";
import { buildSecurityLandscape } from "./landscape-builder";

export type BuildStaticIntelligenceGuardrailMaterialInput = {
	exportPayload: StaticIntelligenceExportV1;
	sourceManifest: StaticIntelligenceKnowledgeSourceManifest;
	communities?: RiskCommunity[];
	landscape?: SecurityLandscape;
	type?: StaticIntelligenceGuardrailMaterialType;
	includeMarkdown?: boolean;
	generatedAt?: Date;
};

type GuardrailMaterialRefs = StaticIntelligenceGuardrailMaterial["refs"];
type GuardrailMaterialApplicability =
	StaticIntelligenceGuardrailMaterial["applicability"];
type GuardrailMaterialSuggestedDistillation =
	StaticIntelligenceGuardrailMaterial["suggestedDistillation"];

const MATERIAL_TYPE_ORDER: StaticIntelligenceGuardrailMaterialType[] = [
	"security_guardrail_material",
	"verification_recipe_material",
	"false_positive_lesson_material",
	"agent_actionability_lesson_material",
	"scanner_tuning_lesson_material",
];

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

export function buildStaticIntelligenceGuardrailMaterial(
	input: BuildStaticIntelligenceGuardrailMaterialInput,
): StaticIntelligenceGuardrailMaterialResult {
	const communities =
		input.communities ?? buildRiskCommunities(input.exportPayload);
	const landscape =
		input.landscape ?? buildSecurityLandscape(input.exportPayload, communities);
	const generatedAt = (input.generatedAt ?? new Date()).toISOString();
	const base = buildBaseSource(input.exportPayload, input.sourceManifest);
	const materials = sortMaterials(
		filterMaterialsByType(
			[
				...buildSecurityGuardrailMaterials(
					input.exportPayload,
					communities,
					base,
				),
				buildVerificationRecipeMaterial(input.exportPayload, base),
				buildActionabilityMaterial(input.exportPayload, landscape, base),
				...buildScannerTuningMaterials(input.exportPayload, communities, base),
			].filter((material): material is StaticIntelligenceGuardrailMaterial =>
				Boolean(material),
			),
			input.type,
		),
	);
	const result: StaticIntelligenceGuardrailMaterialResult = {
		ok: true,
		status: "completed",
		version: "v1",
		generatedAt,
		scanRunId: input.exportPayload.scan.id,
		sourceManifest: {
			sourceId: input.sourceManifest.source.sourceId,
			contentHash: input.sourceManifest.source.contentHash,
			exportHash: input.sourceManifest.source.exportHash,
		},
		filters: {
			...(input.type ? { type: input.type } : {}),
			includeMarkdown: input.includeMarkdown ?? false,
		},
		materials,
		degradedReasons: sortedUnique([
			...input.exportPayload.scanSummary.degradedReasons,
			...communities.flatMap((community) => community.degradedReasons),
		]),
	};

	if (input.includeMarkdown) {
		result.markdown = renderGuardrailMaterialMarkdown(result);
	}

	return staticIntelligenceGuardrailMaterialResultSchema.parse(result);
}

export async function buildStaticIntelligenceGuardrailMaterialForScan(
	db: AppDatabase,
	scanRunId: string,
	options: {
		type?: StaticIntelligenceGuardrailMaterialType;
		includeMarkdown?: boolean;
		generatedAt?: Date;
	} = {},
): Promise<StaticIntelligenceGuardrailMaterialResult> {
	const exportPayload = await buildStaticIntelligenceExport(db, scanRunId);
	const sourceManifest = buildStaticIntelligenceKnowledgeSourceManifest(
		exportPayload,
		options.generatedAt ? { generatedAt: options.generatedAt } : {},
	);
	const communities = buildRiskCommunities(exportPayload);
	const landscape = buildSecurityLandscape(exportPayload, communities);
	return buildStaticIntelligenceGuardrailMaterial({
		exportPayload,
		sourceManifest,
		communities,
		landscape,
		type: options.type,
		includeMarkdown: options.includeMarkdown,
		generatedAt: options.generatedAt,
	});
}

function buildSecurityGuardrailMaterials(
	exportPayload: StaticIntelligenceExportV1,
	communities: RiskCommunity[],
	base: MaterialBaseSource,
): StaticIntelligenceGuardrailMaterial[] {
	const deduped = new Map<string, StaticIntelligenceGuardrailMaterial>();
	for (const community of communities.filter(isSecurityCommunityEligible)) {
		const refs = refsFromCommunity(community);
		if (!hasAnyRef(refs)) continue;
		const material = makeMaterial({
			type: "security_guardrail_material",
			title: `Avoid recurring ${riskLabel(refs)} risk in ${surfaceLabel(refs)}`,
			summary: `Scanner-backed findings indicate recurring ${riskLabel(refs)} risk around ${surfaceLabel(refs)}. Prefer validating inputs and preserving evidence-backed verification before considering the issue resolved.`,
			sourceRefs: [
				base.manifestRef,
				base.scanRef,
				sourceRef("community", community.id),
			],
			refs,
			applicability: inferApplicability("security_guardrail_material", refs),
			suggestedDistillation: {
				contextStillType: "rule",
				polarity: "negative",
				avoid: `Treat scanner-backed ${riskLabel(refs)} risk as resolved without checking the referenced evidence and verification surface.`,
				prefer:
					"Use the referenced findings, evidence, and verification commands to drive a focused security fix.",
			},
			confidence: community.confidence,
			evidenceQuality: community.evidenceQuality,
			riskBand: severityToRiskBand(community.maxSeverity),
			generatedFrom: ["risk_community"],
			degradedReasons: community.degradedReasons,
			base,
		});
		deduped.set(securityDedupKey(material), material);
	}

	for (const entry of exportPayload.fileRiskIndex.filter(isHighRiskFileEntry)) {
		const refs = refsFromFileRiskEntry(entry);
		if (!hasAnyRef(refs)) continue;
		const material = makeMaterial({
			type: "security_guardrail_material",
			title: `Avoid recurring ${riskLabel(refs)} risk in ${surfaceLabel(refs)}`,
			summary: `Scanner-backed findings indicate recurring ${riskLabel(refs)} risk around ${surfaceLabel(refs)}. Prefer validating inputs and preserving evidence-backed verification before considering the issue resolved.`,
			sourceRefs: [
				base.manifestRef,
				base.scanRef,
				sourceRef("file_risk", entry.path),
			],
			refs,
			applicability: inferApplicability("security_guardrail_material", refs),
			suggestedDistillation: {
				contextStillType: "rule",
				polarity: "negative",
				avoid: `Treat scanner-backed ${riskLabel(refs)} risk as resolved without checking the referenced evidence and verification surface.`,
				prefer:
					"Use the referenced findings, evidence, and verification commands to drive a focused security fix.",
			},
			confidence: "medium",
			evidenceQuality: entry.evidenceQuality,
			riskBand: severityToRiskBand(entry.maxSeverity),
			generatedFrom: ["file_risk", "finding"],
			degradedReasons: entry.path === "unknown" ? ["unknown file path"] : [],
			base,
		});
		const key = securityDedupKey(material);
		if (!deduped.has(key)) deduped.set(key, material);
	}

	return [...deduped.values()];
}

function buildVerificationRecipeMaterial(
	exportPayload: StaticIntelligenceExportV1,
	base: MaterialBaseSource,
): StaticIntelligenceGuardrailMaterial | null {
	const handoff = exportPayload.handoff;
	if (!handoff) return null;
	const commands = handoff.verificationCommands.flatMap((command, index) =>
		sanitizeHandoffText(command, exportPayload.project.rootPath).map(
			(text) => ({
				text,
				ordinal: index + 1,
			}),
		),
	);
	const criteria = handoff.acceptanceCriteria.flatMap((criterion) =>
		sanitizeHandoffText(criterion, exportPayload.project.rootPath),
	);
	if (commands.length === 0 && criteria.length === 0) return null;

	return makeMaterial({
		type: "verification_recipe_material",
		title: "Use scan-level verification candidates before claiming remediation",
		summary:
			"Static Intelligence handoff data includes scan-level verification candidates. Treat them as candidate commands and acceptance checks until a separate run proves them.",
		sourceRefs: [
			base.manifestRef,
			base.scanRef,
			`handoff:${base.scanRunId}`,
			...commands.map((command) => `verification_command:${command.ordinal}`),
		],
		refs: emptyRefs(),
		applicability: inferApplicability(
			"verification_recipe_material",
			emptyRefs(),
		),
		suggestedDistillation: {
			contextStillType: "procedure",
			polarity: "positive",
			procedureSections: {
				useWhen: [
					"Use when a security scan handoff needs evidence-backed verification before a fix is considered complete.",
				],
				workflow: commands.map(
					(command) => `Treat \`${command.text}\` as a candidate command.`,
				),
				verification: [
					...criteria.map((criterion) => `Acceptance criterion: ${criterion}`),
					...commands.map(
						(command) =>
							`Execute and record the result of candidate command \`${command.text}\` before claiming completion.`,
					),
				],
				avoid: [
					"Do not claim verification commands passed unless they were executed.",
				],
			},
		},
		confidence: commands.length > 0 ? "medium" : "low",
		evidenceQuality: exportPayload.scanSummary.evidenceQuality,
		riskBand: exportPayload.scanSummary.riskBand,
		generatedFrom: ["handoff"],
		degradedReasons: [],
		base,
	});
}

function buildActionabilityMaterial(
	exportPayload: StaticIntelligenceExportV1,
	landscape: SecurityLandscape,
	base: MaterialBaseSource,
): StaticIntelligenceGuardrailMaterial | null {
	if (exportPayload.scan.findingCount === 0) return null;
	const gapReasons = sortedUnique([
		...landscape.remediation.openFocus,
		...exportPayload.scanSummary.degradedReasons,
	]);
	if (gapReasons.length === 0) return null;
	const weakFindingIds = sortedUnique([
		...landscape.evidence.missingEvidenceFindingIds,
		...landscape.evidence.weakEvidenceFindingIds,
	]);
	const refs = {
		...emptyRefs(),
		findingIds: weakFindingIds,
		evidenceRefs: sortedUnique(landscape.evidence.artifactBackedEvidenceRefs),
	};
	return makeMaterial({
		type: "agent_actionability_lesson_material",
		title: "Prepare evidence-backed security handoffs before implementation",
		summary:
			"Static Intelligence found incomplete actionability signals. A useful security handoff should carry evidence refs, acceptance criteria, and verification candidates before an implementation agent starts work.",
		sourceRefs: [base.manifestRef, base.scanRef, "landscape:remediation"],
		refs,
		applicability: inferApplicability(
			"agent_actionability_lesson_material",
			refs,
		),
		suggestedDistillation: {
			contextStillType: "procedure",
			polarity: "positive",
			procedureSections: {
				useWhen: [
					"Use when security scan output is incomplete, weak, or missing a concrete handoff.",
				],
				workflow: [
					"Collect stable finding and evidence refs before assigning implementation work.",
					"Add acceptance criteria that describe the required security outcome.",
					"Add verification command candidates without claiming they have passed.",
				],
				verification: [
					"Rerun the relevant scanner or targeted test after the fix.",
					"Review artifact-backed evidence before closing the finding.",
				],
				avoid: [
					"Do not ask an implementation agent to fix vague findings without evidence refs or verification criteria.",
				],
			},
		},
		confidence: weakFindingIds.length > 0 ? "medium" : "low",
		evidenceQuality: landscape.evidence.quality,
		riskBand: landscape.risk.band,
		generatedFrom: ["security_landscape", "scan_summary"],
		degradedReasons: gapReasons,
		base,
	});
}

function buildScannerTuningMaterials(
	exportPayload: StaticIntelligenceExportV1,
	communities: RiskCommunity[],
	base: MaterialBaseSource,
): StaticIntelligenceGuardrailMaterial[] {
	return communities
		.filter(isScannerTuningCommunityEligible)
		.map((community) => {
			const refs = refsFromCommunity(community);
			return makeMaterial({
				type: "scanner_tuning_lesson_material",
				title: `Review repeated weak ${riskLabel(refs)} scanner findings`,
				summary:
					"Repeated weak scanner findings can indicate a profile or rule-tuning opportunity, but the scanner output should be reviewed against artifact-backed evidence before any tuning decision.",
				sourceRefs: [
					base.manifestRef,
					base.scanRef,
					sourceRef("community", community.id),
				],
				refs,
				applicability: inferApplicability(
					"scanner_tuning_lesson_material",
					refs,
				),
				suggestedDistillation: {
					contextStillType: "procedure",
					polarity: "neutral",
					procedureSections: {
						useWhen: [
							"Use when repeated weak scanner findings appear for the same scanner or scanner rule.",
						],
						workflow: [
							"Inspect the scanner rule and compare each finding against artifact-backed evidence.",
							"Tune the scan profile only after review confirms the signal quality problem.",
						],
						verification: [
							"Rerun the scanner and compare finding count, rule distribution, and evidence quality.",
						],
						avoid: [
							"Do not blanket-ignore the scanner rule without evidence-backed review.",
						],
					},
				},
				confidence: community.confidence,
				evidenceQuality: community.evidenceQuality,
				riskBand: exportPayload.scanSummary.riskBand,
				generatedFrom: ["risk_community"],
				degradedReasons: community.degradedReasons,
				base,
			});
		});
}

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

function makeMaterial(input: {
	type: StaticIntelligenceGuardrailMaterialType;
	title: string;
	summary: string;
	sourceRefs: string[];
	refs: GuardrailMaterialRefs;
	applicability: GuardrailMaterialApplicability;
	suggestedDistillation: GuardrailMaterialSuggestedDistillation;
	confidence: RiskCommunityConfidence;
	evidenceQuality: StaticIntelligenceEvidenceQuality;
	riskBand: StaticIntelligenceRiskBand;
	generatedFrom: StaticIntelligenceGuardrailMaterialGeneratedFrom[];
	degradedReasons: string[];
	base: MaterialBaseSource;
}): StaticIntelligenceGuardrailMaterial {
	const materialWithoutHash = {
		type: input.type,
		title: input.title,
		summary: input.summary,
		source: {
			kind: "vulnWorkbench.static_intelligence" as const,
			sourceId: input.base.sourceId,
			scanRunId: input.base.scanRunId,
			sourceRefs: sortedUnique(input.sourceRefs),
			contentHash: input.base.contentHash,
		},
		applicability: sortApplicability(input.applicability),
		refs: sortRefs(input.refs),
		suggestedDistillation: input.suggestedDistillation,
		metadata: {
			confidence: input.confidence,
			evidenceQuality: input.evidenceQuality,
			riskBand: input.riskBand,
			generatedFrom: sortGeneratedFrom(input.generatedFrom),
			degradedReasons: sortedUnique(input.degradedReasons),
		},
	};
	const materialHash = sha256Hex(canonicalJson(materialWithoutHash));
	return {
		id: `guardrail_material:${input.type}:${materialHash.slice(0, 16)}`,
		candidateOnly: true,
		...materialWithoutHash,
		metadata: {
			...materialWithoutHash.metadata,
			materialHash,
		},
	};
}

function materialRiskRank(
	material: StaticIntelligenceGuardrailMaterial,
): number {
	return riskRank(material.metadata.riskBand);
}

function sortMaterials(
	materials: StaticIntelligenceGuardrailMaterial[],
): StaticIntelligenceGuardrailMaterial[] {
	return [...materials].sort((left, right) => {
		const typeDelta =
			MATERIAL_TYPE_ORDER.indexOf(left.type) -
			MATERIAL_TYPE_ORDER.indexOf(right.type);
		if (typeDelta !== 0) return typeDelta;
		const riskDelta = materialRiskRank(right) - materialRiskRank(left);
		if (riskDelta !== 0) return riskDelta;
		const titleDelta = left.title.localeCompare(right.title);
		if (titleDelta !== 0) return titleDelta;
		return left.id.localeCompare(right.id);
	});
}

function filterMaterialsByType(
	materials: StaticIntelligenceGuardrailMaterial[],
	type: StaticIntelligenceGuardrailMaterialType | undefined,
): StaticIntelligenceGuardrailMaterial[] {
	if (!type) return materials;
	return materials.filter((material) => material.type === type);
}

function inferApplicability(
	type: StaticIntelligenceGuardrailMaterialType,
	refs: GuardrailMaterialRefs,
): GuardrailMaterialApplicability {
	const haystack = [...refs.fileRefs, ...refs.ruleIds, ...refs.scanners].join(
		" ",
	);
	const lowered = haystack.toLowerCase();
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
	type: StaticIntelligenceGuardrailMaterialType,
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

function isSecurityCommunityEligible(community: RiskCommunity): boolean {
	if (isHighOrCritical(community.maxSeverity)) return true;
	if (community.basis.includes("same_scanner_rule")) return true;
	if (
		community.basis.includes("same_file") &&
		community.findingIds.length > 1
	) {
		return true;
	}
	if (community.basis.includes("semantic") && community.evidenceRefs.length > 0)
		return true;
	return false;
}

function isScannerTuningCommunityEligible(community: RiskCommunity): boolean {
	return (
		(community.basis.includes("same_scanner_rule") ||
			community.basis.includes("same_scanner")) &&
		["weak", "none", "unknown"].includes(community.evidenceQuality) &&
		community.findingIds.length >= 2
	);
}

function isHighRiskFileEntry(entry: FileRiskIndexEntry): boolean {
	return isHighOrCritical(entry.maxSeverity);
}

function isHighOrCritical(severity: StaticIntelligenceSeverity): boolean {
	return severity === "high" || severity === "critical";
}

function refsFromCommunity(community: RiskCommunity): GuardrailMaterialRefs {
	return sortRefs({
		findingIds: community.findingIds,
		evidenceRefs: community.evidenceRefs,
		artifactRefs: community.artifactRefs,
		fileRefs: community.fileRefs.filter(isSafeRelativePath),
		ruleIds: community.ruleIds,
		scanners: community.scannerRefs,
	});
}

function refsFromFileRiskEntry(
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

function emptyRefs(): GuardrailMaterialRefs {
	return {
		findingIds: [],
		evidenceRefs: [],
		artifactRefs: [],
		fileRefs: [],
		ruleIds: [],
		scanners: [],
	};
}

function hasAnyRef(refs: GuardrailMaterialRefs): boolean {
	return Object.values(refs).some((values) => values.length > 0);
}

function sortRefs(refs: GuardrailMaterialRefs): GuardrailMaterialRefs {
	return {
		findingIds: sortedUnique(refs.findingIds),
		evidenceRefs: sortedUnique(refs.evidenceRefs),
		artifactRefs: sortedUnique(refs.artifactRefs),
		fileRefs: sortedUnique(refs.fileRefs.filter(isSafeRelativePath)),
		ruleIds: sortedUnique(refs.ruleIds),
		scanners: sortedUnique(refs.scanners),
	};
}

function sortApplicability(
	applicability: GuardrailMaterialApplicability,
): GuardrailMaterialApplicability {
	return {
		domains: sortedUnique(applicability.domains),
		technologies: sortedUnique(applicability.technologies),
		changeTypes: sortedUnique(applicability.changeTypes),
	};
}

function sortGeneratedFrom(
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

function securityDedupKey(
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

function riskLabel(refs: GuardrailMaterialRefs): string {
	return refs.ruleIds[0] ?? refs.scanners[0] ?? "security";
}

function surfaceLabel(refs: GuardrailMaterialRefs): string {
	return refs.fileRefs[0] ?? refs.scanners[0] ?? "the scanned surface";
}

function severityToRiskBand(
	severity: StaticIntelligenceSeverity,
): StaticIntelligenceRiskBand {
	return SEVERITY_TO_RISK_BAND[severity];
}

function riskRank(riskBand: StaticIntelligenceRiskBand): number {
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

type MaterialBaseSource = {
	sourceId: string;
	scanRunId: string;
	contentHash: string;
	manifestRef: string;
	scanRef: string;
};

function buildBaseSource(
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

function sourceRef(kind: string, value: string): string {
	if (isUnsafeRefValue(value)) {
		return `${kind}:redacted:${sha256Hex(canonicalJson(value)).slice(0, 16)}`;
	}
	return `${kind}:${value}`;
}

function sanitizeHandoffText(
	text: string,
	projectRoot: string | undefined,
): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (isUnsafeRawText(trimmed)) return [];
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

function sortedUnique(values: string[]): string[] {
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
