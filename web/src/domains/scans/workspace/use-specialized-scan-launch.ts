import { useEffect, useState } from "react";
import {
	type AssessmentEngagement,
	type BusinessLogicScenarioSummary,
	type DynamicProfileConfig,
	type DynamicProfileTemplate,
	fetchBusinessLogicScenarios,
	fetchProjectAssessments,
	fetchProjectDynamicProfiles,
} from "../../../api";

export function useSpecializedScanLaunch(params: {
	active: boolean;
	selectedProjectId: string;
}) {
	const [releaseInputKind, setReleaseInputKind] = useState<
		"filesystem" | "image_ref" | "image_tar"
	>("filesystem");
	const [imageRef, setImageRef] = useState("");
	const [imageTar, setImageTar] = useState("");
	const [attestationSubject, setAttestationSubject] = useState("");
	const [supplyChainVerifier, setSupplyChainVerifier] = useState<
		"cosign" | "slsa"
	>("cosign");
	const [attestationBundle, setAttestationBundle] = useState("");
	const [trustPolicy, setTrustPolicy] = useState("");
	const [slsaProvenance, setSlsaProvenance] = useState("");
	const [slsaPolicy, setSlsaPolicy] = useState("");
	const [projectDynamicProfiles, setProjectDynamicProfiles] = useState<
		DynamicProfileConfig[]
	>([]);
	const [dynamicProfileTemplates, setDynamicProfileTemplates] = useState<
		DynamicProfileTemplate[]
	>([]);
	const [selectedProjectDynamicProfileId, setSelectedProjectDynamicProfileId] =
		useState("");
	const [assessmentEngagements, setAssessmentEngagements] = useState<
		AssessmentEngagement[]
	>([]);
	const [selectedAssessmentEngagementId, setSelectedAssessmentEngagementId] =
		useState("");
	const [activeAssessmentPlanJson, setActiveAssessmentPlanJson] = useState("");
	const [businessLogicScenarios, setBusinessLogicScenarios] = useState<
		BusinessLogicScenarioSummary[]
	>([]);
	const [selectedBusinessLogicScenarioId, setSelectedBusinessLogicScenarioId] =
		useState("");
	const [destructiveScanConsent, setDestructiveScanConsent] = useState(false);
	const [specializedLaunchLoading, setSpecializedLaunchLoading] =
		useState(false);
	const [specializedLaunchErrors, setSpecializedLaunchErrors] = useState<
		Partial<Record<"dynamic" | "engagements" | "businessLogic", string>>
	>({});

	useEffect(() => {
		setReleaseInputKind("filesystem");
		setImageRef("");
		setImageTar("");
		setAttestationSubject("");
		setSupplyChainVerifier("cosign");
		setAttestationBundle("");
		setTrustPolicy("");
		setSlsaProvenance("");
		setSlsaPolicy("");
		setSelectedProjectDynamicProfileId("");
		setSelectedAssessmentEngagementId("");
		setActiveAssessmentPlanJson("");
		setSelectedBusinessLogicScenarioId("");
		setDestructiveScanConsent(false);
		setSpecializedLaunchErrors({});
		if (!params.active || !params.selectedProjectId) {
			setProjectDynamicProfiles([]);
			setDynamicProfileTemplates([]);
			setAssessmentEngagements([]);
			setBusinessLogicScenarios([]);
			setSpecializedLaunchLoading(false);
			return;
		}
		let mounted = true;
		setSpecializedLaunchLoading(true);
		void Promise.allSettled([
			fetchProjectDynamicProfiles(params.selectedProjectId),
			fetchProjectAssessments(params.selectedProjectId),
			fetchBusinessLogicScenarios(params.selectedProjectId),
		]).then((results) => {
			if (!mounted) return;
			const [dynamicResult, engagementsResult, scenariosResult] = results;
			const errors: typeof specializedLaunchErrors = {};
			if (dynamicResult?.status === "fulfilled") {
				const dynamic = dynamicResult.value;
				setProjectDynamicProfiles(
					dynamic.configs.filter((item) => item.enabled),
				);
				setDynamicProfileTemplates(dynamic.templates);
				setSelectedProjectDynamicProfileId(
					dynamic.configs.find((item) => item.enabled)?.profileId ??
						dynamic.templates[0]?.id ??
						"",
				);
			} else {
				setProjectDynamicProfiles([]);
				setDynamicProfileTemplates([]);
				errors.dynamic = failureMessage(
					dynamicResult?.reason,
					"動的テスト候補を取得できませんでした。",
				);
			}
			if (engagementsResult?.status === "fulfilled") {
				const activeEngagements = engagementsResult.value.filter(
					(item) =>
						item.status === "active" &&
						item.purpose === "internal" &&
						["local", "ephemeral"].includes(item.environment),
				);
				setAssessmentEngagements(activeEngagements);
				setSelectedAssessmentEngagementId(activeEngagements[0]?.id ?? "");
			} else {
				setAssessmentEngagements([]);
				errors.engagements = failureMessage(
					engagementsResult?.reason,
					"Active診断のRoEを取得できませんでした。",
				);
			}
			if (scenariosResult?.status === "fulfilled") {
				setBusinessLogicScenarios(scenariosResult.value);
				setSelectedBusinessLogicScenarioId(scenariosResult.value[0]?.id ?? "");
			} else {
				setBusinessLogicScenarios([]);
				errors.businessLogic = failureMessage(
					scenariosResult?.reason,
					"ビジネスロジックシナリオを取得できませんでした。",
				);
			}
			setSpecializedLaunchErrors(errors);
			setSpecializedLaunchLoading(false);
		});
		return () => {
			mounted = false;
		};
	}, [params.active, params.selectedProjectId]);

	return {
		activeAssessmentPlanJson,
		assessmentEngagements,
		attestationBundle,
		attestationSubject,
		supplyChainVerifier,
		businessLogicScenarios,
		destructiveScanConsent,
		dynamicProfileTemplates,
		imageRef,
		imageTar,
		slsaPolicy,
		slsaProvenance,
		projectDynamicProfiles,
		releaseInputKind,
		selectedAssessmentEngagementId,
		selectedBusinessLogicScenarioId,
		selectedProjectDynamicProfileId,
		setActiveAssessmentPlanJson,
		setAttestationBundle,
		setAttestationSubject,
		setSupplyChainVerifier,
		setDestructiveScanConsent,
		setImageRef,
		setImageTar,
		setReleaseInputKind,
		setSlsaPolicy,
		setSlsaProvenance,
		setSelectedAssessmentEngagementId,
		setSelectedBusinessLogicScenarioId,
		setSelectedProjectDynamicProfileId,
		setTrustPolicy,
		specializedLaunchErrors,
		specializedLaunchLoading,
		trustPolicy,
	};
}

function failureMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export type SpecializedScanLaunchState = ReturnType<
	typeof useSpecializedScanLaunch
>;
