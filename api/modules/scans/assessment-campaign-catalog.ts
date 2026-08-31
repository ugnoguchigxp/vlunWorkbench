import { createHash } from "node:crypto";
import {
	type AssessmentCampaignCatalogEntry,
	assessmentCampaignCatalogEntrySchema,
} from "../../../shared/schemas/assessment-campaign.schema";
import { canonicalJson } from "./execution/diff/diff-scan-plan";

export const ASSESSMENT_CAMPAIGN_CATALOG = [
	assessmentCampaignCatalogEntrySchema.parse({
		schemaVersion: 1,
		id: "professional-full",
		displayName: "プロフェッショナル総合診断",
		description:
			"qualified child runと人手レビューを束ねるassessment campaignです。",
		availability: "planned",
		launchMode: "unavailable",
		childProfileIds: [
			"change-gate",
			"source-assurance",
			"dependency-supply-chain",
			"release-artifact",
			"dynamic-verification",
			"sanitizer-fuzz-lab",
			"runtime-passive",
			"authenticated-web",
			"api-readonly",
			"active-technical-lab",
			"business-logic-lab",
			"remediation-verification",
		],
		capabilityRequirements: [
			{
				capabilityId: "secret_detection",
				requirement: "required_if_applicable",
			},
			{ capabilityId: "source_sast", requirement: "required_if_applicable" },
			{ capabilityId: "sca", requirement: "required_if_applicable" },
			{ capabilityId: "iac_config", requirement: "required_if_applicable" },
			{ capabilityId: "sbom", requirement: "required_if_applicable" },
			{
				capabilityId: "provenance_integrity",
				requirement: "required_if_applicable",
			},
			{
				capabilityId: "artifact_container",
				requirement: "required_if_applicable",
			},
			{ capabilityId: "dynamic_tests", requirement: "required_if_applicable" },
			{ capabilityId: "sanitizer_fuzz", requirement: "required_if_applicable" },
			{ capabilityId: "passive_dast", requirement: "required_if_applicable" },
			{ capabilityId: "browser_client", requirement: "required_if_applicable" },
			{
				capabilityId: "authentication_session",
				requirement: "required_if_applicable",
			},
			{
				capabilityId: "api_schema_contract",
				requirement: "required_if_applicable",
			},
			{
				capabilityId: "authorization_matrix",
				requirement: "required_if_applicable",
			},
			{ capabilityId: "active_dast", requirement: "required_if_applicable" },
			{ capabilityId: "business_logic", requirement: "required_if_applicable" },
			{
				capabilityId: "remediation_retest",
				requirement: "required_if_applicable",
			},
		],
		humanReviewRequired: true,
		limitationCodes: [
			"campaign_scheduler_not_integrated",
			"human_review_required",
		],
	}),
] as const;

export function listAssessmentCampaignCatalogEntries(): AssessmentCampaignCatalogEntry[] {
	return [...ASSESSMENT_CAMPAIGN_CATALOG];
}

export function getAssessmentCampaignCatalogEntry(id: string) {
	return ASSESSMENT_CAMPAIGN_CATALOG.find((entry) => entry.id === id);
}

export function hashAssessmentCampaignCatalogEntry(
	entry: AssessmentCampaignCatalogEntry,
) {
	return `sha256:${createHash("sha256")
		.update(canonicalJson(entry))
		.digest("hex")}`;
}
