import { createHash } from "node:crypto";
import type { ScanCapabilityRequirementEntry } from "../../../shared/schemas/scan-capability.schema";
import {
	type ScanProfileCatalogEntry,
	type ScanProfileLegacyAssociation,
	scanProfileCatalogEntrySchema,
	scanProfileLegacyAssociationSchema,
} from "../../../shared/schemas/scan-profile-catalog.schema";

const CATALOG_VERSION = 1;
const ALL_RESULT_POLICIES = ["advisory", "gate"] as const;

function capabilities(
	entries: ScanCapabilityRequirementEntry[],
): ScanCapabilityRequirementEntry[] {
	return entries;
}

function catalogEntry(
	entry: Omit<ScanProfileCatalogEntry, "schemaVersion" | "catalogVersion">,
): ScanProfileCatalogEntry {
	return scanProfileCatalogEntrySchema.parse({
		schemaVersion: 1,
		catalogVersion: CATALOG_VERSION,
		...entry,
	});
}

export const SCAN_PROFILE_CATALOG = [
	catalogEntry({
		id: "change-gate",
		displayOrder: 10,
		displayName: "変更差分セキュリティゲート",
		experienceKind: "scanner_preset",
		description:
			"変更範囲をGitleaks、OSV-Scanner、Trivy、zizmorと、有効化済みのSemgrepで確認します。zizmorはCI workflow変更時だけ適用します。",
		availability: "stable",
		safetyClass: "R0",
		launchMode: "profile_orchestrator",
		launchDestination: "scan_workspace",
		strictness: "strict",
		defaultResultPolicy: "gate",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["working_tree", "commit", "range"],
		requiredInputs: [{ kind: "source_target", requirement: "required" }],
		capabilityRequirements: capabilities([
			{ capabilityId: "secret_detection", requirement: "required" },
			{ capabilityId: "sca", requirement: "required_if_applicable" },
			{ capabilityId: "iac_config", requirement: "required_if_applicable" },
			{ capabilityId: "source_sast", requirement: "required_if_applicable" },
			{
				capabilityId: "cicd_workflow_integrity",
				requirement: "required_if_applicable",
			},
		]),
		executionVariants: [
			{
				id: "source-diff",
				executionProfileRef: "change-gate",
				requiredInputKinds: ["source_target"],
				forbiddenInputKinds: [],
			},
		],
		environmentRequirementCodes: [],
		limitationCodes: [],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "source-assurance",
		displayOrder: 20,
		displayName: "ソースセキュリティ保証",
		experienceKind: "scanner_preset",
		description:
			"リポジトリ全体をGitleaks、OSV-Scanner、Trivy、zizmorと、有効化済みのSemgrepで確認します。zizmorはCI workflowの権限・注入・参照固定を検査します。",
		availability: "stable",
		safetyClass: "R0",
		launchMode: "profile_orchestrator",
		launchDestination: "scan_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [{ kind: "source_target", requirement: "required" }],
		capabilityRequirements: capabilities([
			{ capabilityId: "secret_detection", requirement: "required" },
			{ capabilityId: "sca", requirement: "required" },
			{ capabilityId: "iac_config", requirement: "required" },
			{ capabilityId: "source_sast", requirement: "required_if_applicable" },
			{
				capabilityId: "cicd_workflow_integrity",
				requirement: "required_if_applicable",
			},
		]),
		executionVariants: [
			{
				id: "source-full",
				executionProfileRef: "source-assurance",
				requiredInputKinds: ["source_target"],
				forbiddenInputKinds: [],
			},
		],
		environmentRequirementCodes: [],
		limitationCodes: [],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "dependency-supply-chain",
		displayOrder: 30,
		displayName: "依存関係・サプライチェーン保証",
		experienceKind: "scanner_preset",
		description:
			"OSV-Scannerで依存関係、TrivyでCycloneDX SBOMを確認し、Cosignのオフライン署名束検証またはslsa-verifierのsource・builder・ref検証を選択して実行します。",
		availability: "stable",
		safetyClass: "R0",
		launchMode: "profile_orchestrator",
		launchDestination: "scan_workspace",
		strictness: "strict",
		defaultResultPolicy: "gate",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "source_target", requirement: "required" },
			{ kind: "attestation_subject", requirement: "required" },
			{ kind: "attestation_bundle", requirement: "required_if_applicable" },
			{ kind: "trust_policy", requirement: "required_if_applicable" },
			{ kind: "slsa_provenance", requirement: "required_if_applicable" },
			{ kind: "slsa_policy", requirement: "required_if_applicable" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "sca", requirement: "required" },
			{ capabilityId: "sbom", requirement: "required" },
			{ capabilityId: "provenance_integrity", requirement: "required" },
		]),
		executionVariants: [
			{
				id: "offline-attestation",
				executionProfileRef: "dependency-supply-chain",
				requiredInputKinds: [
					"source_target",
					"attestation_subject",
					"attestation_bundle",
					"trust_policy",
				],
				forbiddenInputKinds: ["slsa_provenance", "slsa_policy"],
			},
			{
				id: "slsa-provenance",
				executionProfileRef: "dependency-supply-chain-slsa",
				requiredInputKinds: [
					"source_target",
					"attestation_subject",
					"slsa_provenance",
					"slsa_policy",
				],
				forbiddenInputKinds: ["attestation_bundle", "trust_policy"],
			},
		],
		environmentRequirementCodes: ["cosign_or_slsa_verifier_required"],
		limitationCodes: ["slsa_verifier_requires_sigstore_trust_root_network"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "release-artifact",
		displayOrder: 40,
		displayName: "リリース成果物・コンテナ診断",
		experienceKind: "scanner_preset",
		description:
			"Trivy等で既存のビルド成果物またはdigest固定済みコンテナイメージを確認します。",
		availability: "stable",
		safetyClass: "R0",
		launchMode: "profile_orchestrator",
		launchDestination: "scan_workspace",
		strictness: "strict",
		defaultResultPolicy: "gate",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "source_target", requirement: "required_if_applicable" },
			{ kind: "image_ref", requirement: "required_if_applicable" },
			{ kind: "image_tar", requirement: "required_if_applicable" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "artifact_container", requirement: "required" },
			{ capabilityId: "secret_detection", requirement: "advisory" },
			{ capabilityId: "iac_config", requirement: "advisory" },
		]),
		executionVariants: [
			{
				id: "filesystem-artifact",
				executionProfileRef: "artifact",
				requiredInputKinds: ["source_target"],
				forbiddenInputKinds: ["image_ref", "image_tar"],
			},
			{
				id: "container-image-ref",
				executionProfileRef: "container-image-security",
				requiredInputKinds: ["image_ref"],
				forbiddenInputKinds: ["image_tar"],
			},
			{
				id: "container-image-tar",
				executionProfileRef: "container-image-security",
				requiredInputKinds: ["image_tar"],
				forbiddenInputKinds: ["image_ref"],
			},
		],
		environmentRequirementCodes: [],
		limitationCodes: ["artifact_scope_only"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "dynamic-verification",
		displayOrder: 50,
		displayName: "動的テスト検証",
		experienceKind: "assessment_workflow",
		description:
			"隔離されたworkspaceでproject承認済みの標準テストを実行します。sanitizer/fuzzは専用Labで扱います。",
		availability: "experimental",
		safetyClass: "R1",
		launchMode: "dedicated_flow",
		launchDestination: "dynamic_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "source_target", requirement: "required" },
			{ kind: "execution_consent", requirement: "required" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "dynamic_tests", requirement: "required" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["isolated_workspace_required"],
		limitationCodes: ["standard_test_templates_only"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "sanitizer-fuzz-lab",
		displayOrder: 55,
		displayName: "Sanitizer・ファズ診断ラボ",
		experienceKind: "lab",
		description:
			"組み込みsanitizer/fuzz recipeを実験的な隔離環境で実行します。",
		availability: "experimental",
		safetyClass: "R1",
		launchMode: "dedicated_flow",
		launchDestination: "dynamic_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [{ kind: "execution_consent", requirement: "required" }],
		capabilityRequirements: capabilities([
			{ capabilityId: "sanitizer_fuzz", requirement: "required" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["isolated_workspace_required"],
		limitationCodes: ["experimental_runtime_matrix"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "custom-dynamic-lab",
		displayOrder: 56,
		displayName: "任意動的実行ラボ",
		experienceKind: "advanced_runner",
		description: "保存済みcommand/configを実験的な隔離環境で実行します。",
		availability: "experimental",
		safetyClass: "R1",
		launchMode: "dedicated_flow",
		launchDestination: "dynamic_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [{ kind: "execution_consent", requirement: "required" }],
		capabilityRequirements: capabilities([
			{ capabilityId: "dynamic_tests", requirement: "required" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["isolated_workspace_required"],
		limitationCodes: ["user_defined_execution", "experimental_runtime_matrix"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "runtime-passive",
		displayOrder: 60,
		displayName: "安全な実行時Web診断",
		experienceKind: "scanner_preset",
		description: "自動起動したローカル対象へbounded passive DASTを実行します。",
		availability: "stable",
		safetyClass: "R2",
		launchMode: "profile_orchestrator",
		launchDestination: "scan_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "source_target", requirement: "required" },
			{ kind: "runtime_target", requirement: "required_if_applicable" },
			{ kind: "auto_start_plan", requirement: "required_if_applicable" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "passive_dast", requirement: "required" },
			{ capabilityId: "browser_client", requirement: "advisory" },
			{ capabilityId: "api_schema_contract", requirement: "advisory" },
		]),
		executionVariants: [
			{
				id: "auto-project-start",
				executionProfileRef: "runtime-web-safe",
				requiredInputKinds: ["source_target"],
				forbiddenInputKinds: [],
			},
		],
		environmentRequirementCodes: ["runtime_target_required"],
		limitationCodes: ["passive_only"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "authenticated-web",
		displayOrder: 70,
		displayName: "認証付きWeb診断",
		experienceKind: "assessment_workflow",
		description: "認証contextを用いる専用DAST workflowです。",
		availability: "experimental",
		safetyClass: "R2",
		launchMode: "dedicated_flow",
		launchDestination: "dast_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "runtime_target", requirement: "required" },
			{ kind: "auth_context_ref", requirement: "required" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "authentication_session", requirement: "required" },
			{ capabilityId: "passive_dast", requirement: "required" },
			{ capabilityId: "browser_client", requirement: "required" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["auth_context_required"],
		limitationCodes: ["oauth_oidc_mfa_not_covered"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "api-readonly",
		displayOrder: 80,
		displayName: "読み取り専用API診断",
		experienceKind: "scanner_preset",
		description:
			"qualification済みのOpenAPIまたはQuery-only GraphQL schemaを検出し、任意の認証contextをgateway境界で適用して読み取り専用operationに限定します。",
		availability: "experimental",
		safetyClass: "R2",
		launchMode: "profile_orchestrator",
		launchDestination: "scan_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [{ kind: "source_target", requirement: "required" }],
		capabilityRequirements: capabilities([
			{ capabilityId: "api_schema_contract", requirement: "required" },
			{ capabilityId: "authentication_session", requirement: "advisory" },
		]),
		executionVariants: [
			{
				id: "auto-discovered-schema",
				executionProfileRef: "api-schema-readonly",
				requiredInputKinds: ["source_target"],
				forbiddenInputKinds: [],
			},
		],
		environmentRequirementCodes: ["schema_required"],
		limitationCodes: ["graphql_query_only", "api_auth_header_context_only"],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "active-technical-lab",
		displayOrder: 90,
		displayName: "Active技術診断ラボ",
		experienceKind: "lab",
		description:
			"RoEとreset可能な使い捨てtargetを必須とするactive DAST workflowです。",
		availability: "experimental",
		safetyClass: "R3",
		launchMode: "dedicated_flow",
		launchDestination: "dast_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "disposable_target_ref", requirement: "required" },
			{ kind: "rules_of_engagement_ref", requirement: "required" },
			{ kind: "execution_consent", requirement: "required" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "active_dast", requirement: "required" },
			{ capabilityId: "authentication_session", requirement: "advisory" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["disposable_target_required", "roe_required"],
		limitationCodes: [],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "business-logic-lab",
		displayOrder: 100,
		displayName: "ビジネスロジック診断ラボ",
		experienceKind: "lab",
		description:
			"シナリオと使い捨てtargetを使うビジネスロジック専用workflowです。",
		availability: "experimental",
		safetyClass: "R3",
		launchMode: "dedicated_flow",
		launchDestination: "business_logic_workspace",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [
			{ kind: "disposable_target_ref", requirement: "required" },
			{ kind: "scenario_ref", requirement: "required" },
			{ kind: "rules_of_engagement_ref", requirement: "required" },
			{ kind: "execution_consent", requirement: "required" },
		],
		capabilityRequirements: capabilities([
			{ capabilityId: "business_logic", requirement: "required" },
			{ capabilityId: "authentication_session", requirement: "advisory" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["disposable_target_required", "roe_required"],
		limitationCodes: [],
		replacementProfileId: null,
	}),
	catalogEntry({
		id: "remediation-verification",
		displayOrder: 110,
		displayName: "修正確認",
		experienceKind: "assessment_workflow",
		description: "findingと元の安全境界を引き継いで修正を再検証します。",
		availability: "experimental",
		safetyClass: "mixed",
		launchMode: "dedicated_flow",
		launchDestination: "finding_verification",
		strictness: "strict",
		defaultResultPolicy: "advisory",
		allowedResultPolicies: [...ALL_RESULT_POLICIES],
		gateSeverityThreshold: "high",
		supportedTargets: ["full"],
		requiredInputs: [{ kind: "finding_ref", requirement: "required" }],
		capabilityRequirements: capabilities([
			{ capabilityId: "remediation_retest", requirement: "required" },
		]),
		executionVariants: [],
		environmentRequirementCodes: ["finding_required"],
		limitationCodes: ["original_safety_boundary_required"],
		replacementProfileId: null,
	}),
] as const;

const LEGACY_FULL_SECURITY_CATALOG_ENTRY = catalogEntry({
	id: "legacy-full-security-scan",
	displayOrder: 1_000,
	displayName: "従来の総合セキュリティスキャン",
	experienceKind: "advanced_runner",
	description:
		"互換維持のために残す従来の複合scan presetです。professional campaignと同等ではありません。",
	availability: "deprecated",
	safetyClass: "mixed",
	launchMode: "profile_orchestrator",
	launchDestination: "scan_workspace",
	strictness: "strict",
	defaultResultPolicy: "advisory",
	allowedResultPolicies: [...ALL_RESULT_POLICIES],
	gateSeverityThreshold: "high",
	supportedTargets: ["full"],
	requiredInputs: [{ kind: "source_target", requirement: "required" }],
	capabilityRequirements: capabilities([
		{ capabilityId: "secret_detection", requirement: "required" },
		{ capabilityId: "source_sast", requirement: "advisory" },
		{ capabilityId: "sca", requirement: "required" },
		{ capabilityId: "iac_config", requirement: "required" },
		{ capabilityId: "sbom", requirement: "required" },
		{ capabilityId: "passive_dast", requirement: "required" },
		{
			capabilityId: "api_schema_contract",
			requirement: "required_if_applicable",
		},
	]),
	executionVariants: [
		{
			id: "legacy-composite",
			executionProfileRef: "full-security-scan",
			requiredInputKinds: ["source_target"],
			forbiddenInputKinds: [],
		},
	],
	environmentRequirementCodes: [],
	limitationCodes: ["legacy_execution_preserved"],
	replacementProfileId: "source-assurance",
});

const LEGACY_ASSOCIATIONS = [
	["agent-output", "source-assurance"],
	["baseline", "source-assurance"],
	["source-baseline", "source-assurance"],
	["diff-source-baseline", "change-gate"],
	["diff-basic-security", "change-gate"],
	["basic-security", "source-assurance"],
	["dependency-manifest", "dependency-supply-chain"],
	["artifact", "release-artifact"],
	["full-deep", "source-assurance"],
	["detailed-security", "source-assurance"],
	["semgrep-baseline", "source-assurance"],
	["web-app-baseline", "runtime-passive"],
	["runtime-web-safe", "runtime-passive"],
	["sbom-inventory", "dependency-supply-chain"],
	["api-schema-readonly", "api-readonly"],
	["container-image-security", "release-artifact"],
	["runtime-zap-baseline", "runtime-passive"],
	["runtime-http-check", "runtime-passive"],
	["full-security-scan", "legacy-full-security-scan"],
	["security-inventory-best-effort", "source-assurance"],
	["secrets-dependencies-runtime", "runtime-passive"],
	["runtime-zap-active-lab", "active-technical-lab"],
	["api-zap-active-lab", "active-technical-lab"],
] as const;

export const SCAN_PROFILE_LEGACY_ASSOCIATIONS = LEGACY_ASSOCIATIONS.map(
	([legacyProfileId, canonicalProfileId]) =>
		scanProfileLegacyAssociationSchema.parse({
			legacyProfileId,
			canonicalProfileId,
			migrationKind: "legacy_preset",
		}),
);

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function hashCatalogEntry(entry: ScanProfileCatalogEntry): string {
	return `sha256:${createHash("sha256")
		.update(canonicalJson(entry))
		.digest("hex")}`;
}

export function validateScanProfileCatalog(): void {
	const ids = new Set<string>();
	const displayOrders = new Set<number>();
	for (const entry of SCAN_PROFILE_CATALOG) {
		if (ids.has(entry.id) || displayOrders.has(entry.displayOrder)) {
			throw new Error("scan_profile_catalog_duplicate_id_or_order");
		}
		ids.add(entry.id);
		displayOrders.add(entry.displayOrder);
		if (!entry.allowedResultPolicies.includes(entry.defaultResultPolicy)) {
			throw new Error(
				`scan_profile_catalog_default_policy_not_allowed:${entry.id}`,
			);
		}
		if (
			entry.allowedResultPolicies.includes("gate") &&
			entry.gateSeverityThreshold === null
		) {
			throw new Error(
				`scan_profile_catalog_gate_threshold_missing:${entry.id}`,
			);
		}
		if (
			(entry.launchMode === "unavailable") !==
			(entry.launchDestination === null)
		) {
			throw new Error(
				`scan_profile_catalog_launch_destination_invalid:${entry.id}`,
			);
		}
		if (
			entry.launchMode !== "profile_orchestrator" &&
			entry.executionVariants.length > 0
		) {
			throw new Error(`scan_profile_catalog_non_generic_variant:${entry.id}`);
		}
		if (
			entry.launchMode === "profile_orchestrator" &&
			entry.executionVariants.length === 0
		) {
			throw new Error(
				`scan_profile_catalog_missing_execution_variant:${entry.id}`,
			);
		}
		const variantIds = new Set<string>();
		for (const variant of entry.executionVariants) {
			if (variantIds.has(variant.id)) {
				throw new Error(
					`scan_profile_catalog_duplicate_variant_id:${entry.id}:${variant.id}`,
				);
			}
			variantIds.add(variant.id);
		}
		for (let index = 0; index < entry.executionVariants.length; index++) {
			const variant = entry.executionVariants[index];
			if (!variant) continue;
			for (
				let otherIndex = index + 1;
				otherIndex < entry.executionVariants.length;
				otherIndex++
			) {
				const otherVariant = entry.executionVariants[otherIndex];
				if (!otherVariant) continue;
				if (variantsCanOverlap(variant, otherVariant)) {
					throw new Error(
						`scan_profile_catalog_ambiguous_execution_variants:${entry.id}`,
					);
				}
			}
		}
	}
	const legacyIds = new Set<string>();
	for (const association of SCAN_PROFILE_LEGACY_ASSOCIATIONS) {
		if (legacyIds.has(association.legacyProfileId)) {
			throw new Error(
				`scan_profile_catalog_duplicate_legacy_association:${association.legacyProfileId}`,
			);
		}
		legacyIds.add(association.legacyProfileId);
		if (
			!ids.has(association.canonicalProfileId) &&
			association.canonicalProfileId !== LEGACY_FULL_SECURITY_CATALOG_ENTRY.id
		) {
			throw new Error(
				`scan_profile_catalog_unknown_canonical_association:${association.legacyProfileId}`,
			);
		}
	}
	for (const target of ["full", "commit", "range", "working_tree"] as const) {
		const defaultEntry = getCatalogEntry(
			resolveDefaultCatalogProfileId(target),
		);
		if (
			defaultEntry?.availability !== "stable" ||
			defaultEntry.launchMode !== "profile_orchestrator" ||
			!defaultEntry.supportedTargets.includes(target)
		) {
			throw new Error(`scan_profile_catalog_invalid_default:${target}`);
		}
	}
}

function variantsCanOverlap(
	left: ScanProfileCatalogEntry["executionVariants"][number],
	right: ScanProfileCatalogEntry["executionVariants"][number],
): boolean {
	return (
		left.requiredInputKinds.every(
			(kind) => !right.forbiddenInputKinds.includes(kind),
		) &&
		right.requiredInputKinds.every(
			(kind) => !left.forbiddenInputKinds.includes(kind),
		)
	);
}

validateScanProfileCatalog();

export function getCatalogEntry(
	id: string,
): ScanProfileCatalogEntry | undefined {
	return SCAN_PROFILE_CATALOG.find((entry) => entry.id === id);
}

export function getCatalogEntryForResolution(
	id: string,
): ScanProfileCatalogEntry | undefined {
	return id === LEGACY_FULL_SECURITY_CATALOG_ENTRY.id
		? LEGACY_FULL_SECURITY_CATALOG_ENTRY
		: getCatalogEntry(id);
}

export function getLegacyProfileAssociation(
	legacyProfileId: string,
): ScanProfileLegacyAssociation | undefined {
	return SCAN_PROFILE_LEGACY_ASSOCIATIONS.find(
		(association) => association.legacyProfileId === legacyProfileId,
	);
}

export function listPublicCatalogEntries(): ScanProfileCatalogEntry[] {
	return [...SCAN_PROFILE_CATALOG].sort(
		(left, right) => left.displayOrder - right.displayOrder,
	);
}

export function listGenericStartCatalogProfileIds(): string[] {
	return SCAN_PROFILE_CATALOG.filter(
		(entry) =>
			entry.launchMode === "profile_orchestrator" &&
			entry.availability === "stable" &&
			entry.executionVariants.some(
				(variant) =>
					variant.requiredInputKinds.every(
						(kind) => kind === "source_target",
					) && variant.forbiddenInputKinds.length === 0,
			),
	).map((entry) => entry.id);
}

export function resolveDefaultCatalogProfileId(
	target: "full" | "commit" | "range" | "working_tree",
): string {
	return target === "full" ? "source-assurance" : "change-gate";
}
