import {
	browseProjectFolder,
	cancelScan,
	createProject,
	createProjectDastAuthContext,
	fetchReproductionRun,
	fetchScans,
	preflightScan,
	previewScan,
	type ScanTargetKind,
	saveProjectDastProfile,
	saveProjectDastTarget,
	startScan,
	triggerActiveAssessment,
	triggerBusinessLogicScenario,
	triggerFindingReproduction,
	triggerProjectDastRun,
	triggerProjectDynamicRun,
} from "../../../api";
import { formatScanPreflightFailure } from "../scan-preflight-display";
import type { ScansActionScope } from "./scans-action-scope";

export function buildScanWorkspaceActions(scope: ScansActionScope) {
	const {
		buildSelectedScanTarget,
		activeAssessmentPlanJson,
		attestationBundle,
		attestationSubject,
		supplyChainVerifier,
		continueOnToolFailure,
		dastAuthStatusPath,
		dastAuthContexts,
		dastBearerToken,
		dastIdentityRole,
		dastProfileConfigs,
		dastProfiles,
		dastTargetOrigin,
		destructiveScanConsent,
		diffPreview,
		diffPreviewCurrent,
		diffPreviewInputKey,
		diffPreviewRequestIdRef,
		isScanning,
		imageRef,
		imageTar,
		projectDefaultBranch,
		projectFolderPath,
		profiles,
		projects,
		releaseInputKind,
		scanTargetKind,
		scanProjectCodeExecutionConsent,
		selectedProfileId,
		selectedAssessmentEngagementId,
		selectedBusinessLogicScenarioId,
		selectedDastAuthContextId,
		selectedDastTargetId,
		selectedFindingId,
		selectedProjectDynamicProfileId,
		selectedReproProfile,
		selectedProjectId,
		selectedScanRunId,
		slsaPolicy,
		slsaProvenance,
		setDiffBaseRef,
		setDiffHeadRef,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setDastAuthContexts,
		setDastProfileConfigs,
		setDastTargets,
		setDestructiveScanConsent,
		setErrorText,
		setIsScanning,
		setProjectBrowseLoading,
		setProjectCreateLoading,
		setProjectFolderPath,
		setProjects,
		setScanDetailTab,
		setScanListTab,
		setScanRuns,
		setScanProjectCodeExecutionConsent,
		setScanTargetKind,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedProfileId,
		setSelectedProjectId,
		setSelectedScanRunId,
		setShowNewProjectModal,
		setShowRunScanForm,
		setDastBearerToken,
		setSelectedDastAuthContextId,
		setSelectedDastTargetId,
		trustPolicy,
	} = scope;

	const handleScanTargetKindChange = (kind: ScanTargetKind) => {
		setScanProjectCodeExecutionConsent(false);
		setDestructiveScanConsent(false);
		setScanTargetKind(kind);
		const project = projects.find(
			(item: { id: string; defaultBranch?: string }) =>
				item.id === selectedProjectId,
		);
		setDiffBaseRef(
			kind === "range"
				? (project?.defaultBranch ?? "main")
				: kind === "working_tree"
					? "HEAD"
					: "",
		);
		setDiffHeadRef("HEAD");
	};

	const handleScanProfileChange = (profileId: string) => {
		setScanProjectCodeExecutionConsent(false);
		setDestructiveScanConsent(false);
		setSelectedProfileId(profileId);
		const selected = profiles.find(
			(profile: { id: string; supportedTargets?: ScanTargetKind[] }) =>
				profile.id === profileId,
		);
		const supportedTargets = selected?.supportedTargets ?? ["full"];
		if (!supportedTargets.includes(scanTargetKind)) {
			handleScanTargetKindChange(supportedTargets[0] ?? "full");
		}
	};

	const handlePreviewDiffTarget = async () => {
		if (!selectedProjectId || !selectedProfileId || scanTargetKind === "full")
			return;
		const target = buildSelectedScanTarget();
		if (target.kind === "full") return;
		if (
			("head" in target && !target.head) ||
			(target.kind === "range" && !target.base)
		) {
			setDiffPreviewError("base/head refを入力してください。");
			return;
		}
		const requestId = ++diffPreviewRequestIdRef.current;
		setDiffPreviewLoading(true);
		setDiffPreviewError(null);
		try {
			const preview = await previewScan(selectedProjectId, {
				profile: selectedProfileId,
				target,
			});
			if (diffPreviewRequestIdRef.current === requestId) {
				setDiffPreview(preview);
				setDiffPreviewResolvedInputKey(diffPreviewInputKey);
			}
		} catch (error) {
			if (diffPreviewRequestIdRef.current === requestId) {
				setDiffPreview(null);
				setDiffPreviewResolvedInputKey(null);
				setDiffPreviewError(
					error instanceof Error
						? error.message
						: "差分previewに失敗しました。",
				);
			}
		} finally {
			if (diffPreviewRequestIdRef.current === requestId) {
				setDiffPreviewLoading(false);
			}
		}
	};

	const handleStartScanProfile = async () => {
		if (isScanning || !selectedProjectId || !selectedProfileId) return;
		const project = projects.find(
			(item: { id: string; pathPolicy?: { status?: string } }) =>
				item.id === selectedProjectId,
		);
		if (project?.pathPolicy?.status !== "allowed") {
			setErrorText("このプロジェクトのパスを読み取れないため実行できません。");
			return;
		}
		setIsScanning(true);
		setErrorText(null);
		try {
			const apiAuthContext =
				selectedProfileId === "api-readonly" && selectedDastAuthContextId
					? dastAuthContexts.find(
							(context) => context.id === selectedDastAuthContextId,
						)
					: undefined;
			if (selectedProfileId === "dynamic-verification") {
				if (!scanProjectCodeExecutionConsent) {
					throw new Error("Docker隔離環境でのコード実行に同意してください。");
				}
				if (!selectedProjectDynamicProfileId) {
					throw new Error("適用可能な動的テストを選択してください。");
				}
				const result = await triggerProjectDynamicRun(selectedProjectId, {
					profileId: selectedProjectDynamicProfileId,
					consentProjectCodeExecution: true,
					runner: "docker",
					network: "none",
				});
				await completeDedicatedLaunch(result.scanRunId);
				return;
			}
			if (selectedProfileId === "authenticated-web") {
				if (
					!selectedDastAuthContextId &&
					(!dastBearerToken.trim() || !dastIdentityRole.trim())
				) {
					throw new Error(
						"有効な認証コンテキストまたはBearer tokenが必要です。",
					);
				}
				const targetConfigId = await ensureDastTarget();
				let authContextId = selectedDastAuthContextId;
				if (!authContextId) {
					const created = await createProjectDastAuthContext(
						selectedProjectId,
						{
							targetConfigId,
							identityRole: dastIdentityRole.trim(),
							label: "認証付きWeb診断",
							secret: { kind: "bearer_token", token: dastBearerToken },
							loginFlow: [],
							successAssertions: [
								{
									kind: "status",
									path: dastAuthStatusPath.trim() || "/",
									expected: [200, 204],
								},
							],
							expiresAt: new Date(
								Date.now() + 24 * 60 * 60 * 1000,
							).toISOString(),
						},
					);
					authContextId = created.authContext.id;
					setDastAuthContexts((current) => [
						...current.filter((item) => item.id !== created.authContext.id),
						created.authContext,
					]);
					setSelectedDastAuthContextId(authContextId);
					setDastBearerToken("");
				}
				const profileId = "authenticated-readonly-standard";
				let profileConfig = dastProfileConfigs.find(
					(item) =>
						item.profileId === profileId &&
						item.targetConfigId === targetConfigId &&
						item.enabled,
				);
				if (
					!profileConfig &&
					dastProfiles.find((item) => item.id === profileId)?.requiresRoutes
				) {
					const createdProfile = (
						await saveProjectDastProfile(selectedProjectId, {
							targetConfigId,
							profileId,
							displayName: "認証付きWeb診断",
							routePathsJson: [dastAuthStatusPath.trim() || "/"],
							checkOptionsJson: { screenshotEnabled: false },
						})
					).config;
					profileConfig = createdProfile;
					setDastProfileConfigs((current) => [
						...current.filter((item) => item.id !== createdProfile.id),
						createdProfile,
					]);
				}
				const result = await triggerProjectDastRun(selectedProjectId, {
					targetConfigId,
					catalogProfileId: "authenticated-web",
					profileId,
					profileConfigId: profileConfig?.id,
					runner: "host",
					authContextId,
					identityRole: dastIdentityRole.trim(),
				});
				await completeDedicatedLaunch(result.scanRunId ?? undefined);
				return;
			}
			if (selectedProfileId === "active-technical-lab") {
				if (!destructiveScanConsent) {
					throw new Error("Active診断の状態変更とリセットに同意してください。");
				}
				if (!selectedAssessmentEngagementId) {
					throw new Error("有効な内部RoEを選択してください。");
				}
				const plan = parseObjectJson(
					activeAssessmentPlanJson,
					"Active診断計画",
				);
				const targetConfigId = await ensureDastTarget();
				const result = await triggerActiveAssessment(selectedProjectId, {
					...plan,
					destructiveConsent: true,
					engagementId: selectedAssessmentEngagementId,
					targetConfigId,
				});
				await completeDedicatedLaunch(result.result.scanRunId);
				return;
			}
			if (selectedProfileId === "business-logic-lab") {
				if (!destructiveScanConsent) {
					throw new Error("シナリオの状態変更とcleanupに同意してください。");
				}
				if (!selectedBusinessLogicScenarioId) {
					throw new Error(
						"検証済みビジネスロジックシナリオを選択してください。",
					);
				}
				const result = await triggerBusinessLogicScenario(
					selectedBusinessLogicScenarioId,
					{ destructiveConsent: true },
				);
				await completeDedicatedLaunch(result.result.scanRunId);
				return;
			}
			if (selectedProfileId === "remediation-verification") {
				if (!selectedFindingId || !selectedReproProfile) {
					throw new Error("findingと適用可能な再検証方法を選択してください。");
				}
				const result = await triggerFindingReproduction(selectedFindingId, {
					profileId: selectedReproProfile,
				});
				if (!result.reproductionRunId) {
					throw new Error("修正確認runを作成できませんでした。");
				}
				const scanRunId = result.scanRunId
					? result.scanRunId
					: (await fetchReproductionRun(result.reproductionRunId))
							.reproductionRun.scanRunId;
				await completeDedicatedLaunch(scanRunId);
				return;
			}
			const target = buildSelectedScanTarget();
			if (target.kind !== "full" && !diffPreviewCurrent) {
				throw new Error("差分を確認してからscanを開始してください。");
			}
			const preflight = await preflightScan(selectedProjectId, {
				profile: selectedProfileId,
				target,
				consentProjectCodeExecution: scanProjectCodeExecutionConsent,
				allowExperimental: selectedProfileId === "api-readonly",
				...(apiAuthContext
					? {
							authContextId: apiAuthContext.id,
							identityRole: apiAuthContext.identityRole,
						}
					: {}),
				...(selectedProfileId === "release-artifact" &&
				releaseInputKind === "image_ref"
					? { imageRef: requiredValue(imageRef, "Image ref") }
					: {}),
				...(selectedProfileId === "release-artifact" &&
				releaseInputKind === "image_tar"
					? { imageTar: requiredValue(imageTar, "Image tar path") }
					: {}),
				...(selectedProfileId === "dependency-supply-chain"
					? requireAttestationInputs()
					: {}),
			});
			if (preflight.mode === "enforced" && preflight.status === "blocked") {
				throw new Error(formatScanPreflightFailure(preflight));
			}
			const res = await startScan(selectedProjectId, {
				profile: selectedProfileId,
				continueOnToolFailure,
				consentProjectCodeExecution: scanProjectCodeExecutionConsent,
				target,
				allowExperimental: selectedProfileId === "api-readonly",
				...(apiAuthContext
					? {
							authContextId: apiAuthContext.id,
							identityRole: apiAuthContext.identityRole,
						}
					: {}),
				...(selectedProfileId === "release-artifact" &&
				releaseInputKind === "image_ref"
					? { imageRef: requiredValue(imageRef, "Image ref") }
					: {}),
				...(selectedProfileId === "release-artifact" &&
				releaseInputKind === "image_tar"
					? { imageTar: requiredValue(imageTar, "Image tar path") }
					: {}),
				...(selectedProfileId === "dependency-supply-chain"
					? requireAttestationInputs()
					: {}),
				expectedPreflightBindingHash: preflight.bindingHash,
				expectedPlanHash: preflight.executionPlan.planHash,
				expectedCatalogEntryHash: preflight.profileResolution.catalogEntryHash,
				...(target.kind !== "full" && diffPreviewCurrent && diffPreview
					? { expectedTargetDigest: diffPreview.target.targetDigest }
					: {}),
			});
			setScanRuns(await fetchScans(selectedProjectId));
			if (res.scan?.id) {
				setSelectedScanRunId(res.scan.id);
				setSelectedFindingId("");
				setSelectedFindingDetails(null);
				setScanListTab("runs");
				setScanDetailTab("review");
			}
			setDiffPreview(null);
			setDiffPreviewResolvedInputKey(null);
			setScanProjectCodeExecutionConsent(false);
			setShowRunScanForm(false);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "scan の実行に失敗しました。",
			);
		} finally {
			setIsScanning(false);
		}

		async function ensureDastTarget(): Promise<string> {
			if (selectedDastTargetId) return selectedDastTargetId;
			const origin = requiredValue(dastTargetOrigin, "ローカルtarget origin");
			const created = await saveProjectDastTarget(selectedProjectId, {
				name: `プロファイル target ${new URL(origin).origin}`,
				origin,
				allowedPathsJson: ["/"],
				maxDepth: 2,
				maxRequests: 100,
				rateLimitPerSec: 2,
				timeoutSec: 120,
			});
			setDastTargets((current) => [
				...current.filter((item) => item.id !== created.target.id),
				created.target,
			]);
			setSelectedDastTargetId(created.target.id);
			return created.target.id;
		}

		function requireAttestationInputs() {
			const subject = requiredValue(attestationSubject, "検証対象ファイル");
			return supplyChainVerifier === "slsa"
				? {
						attestationSubject: subject,
						slsaProvenance: requiredValue(slsaProvenance, " SLSA provenance"),
						slsaPolicy: requiredValue(slsaPolicy, "SLSA期待値ポリシー"),
					}
				: {
						attestationSubject: subject,
						attestationBundle: requiredValue(
							attestationBundle,
							"Cosign bundle",
						),
						trustPolicy: requiredValue(trustPolicy, "検証用公開鍵"),
					};
		}

		async function completeDedicatedLaunch(scanRunId?: string) {
			const runs = await fetchScans(selectedProjectId);
			setScanRuns(runs);
			if (scanRunId) setSelectedScanRunId(scanRunId);
			setSelectedFindingId("");
			setSelectedFindingDetails(null);
			setScanListTab("runs");
			setScanDetailTab("review");
			setScanProjectCodeExecutionConsent(false);
			setDestructiveScanConsent(false);
			setShowRunScanForm(false);
		}
	};

	const handleCancelScan = async () => {
		if (!selectedScanRunId) return;
		setErrorText(null);
		try {
			const scan = await cancelScan(selectedScanRunId);
			setScanRuns((runs) =>
				runs.map((item) => (item.id === scan.id ? scan : item)),
			);
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "scan の取消に失敗しました。",
			);
		}
	};

	const handleSelectProjectFolder = (path: string) => {
		setProjectFolderPath(path);
	};

	const handleBrowseProjectFolder = async () => {
		setProjectBrowseLoading(true);
		setErrorText(null);
		try {
			const res = await browseProjectFolder();
			if (res.path) handleSelectProjectFolder(res.path);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "プロジェクトフォルダの選択に失敗しました。",
			);
		} finally {
			setProjectBrowseLoading(false);
		}
	};

	const handleCreateProjectFromFolder = async () => {
		const repoPath = projectFolderPath.trim();
		if (!repoPath) return;

		setProjectCreateLoading(true);
		setErrorText(null);
		try {
			const created = await createProject({
				repoPath,
				defaultBranch: projectDefaultBranch.trim() || "main",
			});
			setProjects((prev) => {
				const others = prev.filter((item) => item.id !== created.id);
				return [created, ...others];
			});
			setSelectedProjectId(created.id);
			setProjectFolderPath(created.repoPath);
			setShowNewProjectModal(false);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "プロジェクトフォルダの登録に失敗しました。",
			);
		} finally {
			setProjectCreateLoading(false);
		}
	};

	return {
		handleBrowseProjectFolder,
		handleCancelScan,
		handleCreateProjectFromFolder,
		handlePreviewDiffTarget,
		handleScanProfileChange,
		handleScanTargetKindChange,
		handleSelectProjectFolder,
		handleStartScanProfile,
	};
}

function requiredValue(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label}を入力してください。`);
	return normalized;
}

function parseObjectJson(
	value: string,
	label: string,
): Record<string, unknown> {
	const source = requiredValue(value, label);
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new Error(`${label}は有効なJSONで入力してください。`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${label}はJSON objectで入力してください。`);
	}
	return parsed as Record<string, unknown>;
}
