import type {
	StaticIntelligenceEvidenceQuality,
	StaticIntelligenceExportV1,
	StaticIntelligenceRiskBand,
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
import {
	buildBaseSource,
	emptyRefs,
	hasAnyRef,
	inferApplicability,
	isHighRiskFileEntry,
	isScannerTuningCommunityEligible,
	isSecurityCommunityEligible,
	type MaterialBaseSource,
	refsFromCommunity,
	refsFromFileRiskEntry,
	renderGuardrailMaterialMarkdown,
	riskLabel,
	riskRank,
	sanitizeHandoffText,
	securityDedupKey,
	severityToRiskBand,
	sortApplicability,
	sortedUnique,
	sortGeneratedFrom,
	sortRefs,
	sourceRef,
	surfaceLabel,
} from "./guardrail-material-policy";
import {
	buildStaticIntelligenceKnowledgeSourceManifest,
	canonicalJson,
	sha256Hex,
} from "./knowledge-source-manifest";
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

export {
	compareMaterialRisk,
	renderGuardrailMaterialMarkdown,
} from "./guardrail-material-policy";
