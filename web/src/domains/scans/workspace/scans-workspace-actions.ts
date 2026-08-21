import {
	browseProjectFolder,
	cancelScan,
	createProject,
	fetchScans,
	preflightScan,
	previewScan,
	type ScanTargetKind,
	startScan,
} from "../../../api";
import { formatScanPreflightFailure } from "../scan-preflight-display";
import type { ScansActionScope } from "./scans-action-scope";

export function buildScanWorkspaceActions(scope: ScansActionScope) {
	const {
		buildSelectedScanTarget,
		continueOnToolFailure,
		diffPreview,
		diffPreviewCurrent,
		diffPreviewInputKey,
		diffPreviewRequestIdRef,
		isScanning,
		projectDefaultBranch,
		projectFolderPath,
		projects,
		scanTargetKind,
		scanProjectCodeExecutionConsent,
		selectedProfileId,
		selectedProjectId,
		selectedScanRunId,
		setDiffBaseRef,
		setDiffHeadRef,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
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
		setSelectedProjectId,
		setSelectedScanRunId,
		setShowNewProjectModal,
		setShowRunScanForm,
		timeoutSec,
	} = scope;

	const handleScanTargetKindChange = (kind: ScanTargetKind) => {
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
		if (
			isScanning ||
			!selectedProjectId ||
			!selectedProfileId ||
			timeoutSec <= 0
		)
			return;
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
			const target = buildSelectedScanTarget();
			if (target.kind !== "full" && !diffPreviewCurrent) {
				throw new Error("差分を確認してからscanを開始してください。");
			}
			const preflight = await preflightScan(selectedProjectId, {
				profile: selectedProfileId,
				target,
				consentProjectCodeExecution: scanProjectCodeExecutionConsent,
			});
			if (preflight.mode === "enforced" && preflight.status === "blocked") {
				throw new Error(formatScanPreflightFailure(preflight));
			}
			const res = await startScan(selectedProjectId, {
				profile: selectedProfileId,
				continueOnToolFailure,
				consentProjectCodeExecution: scanProjectCodeExecutionConsent,
				timeoutSec,
				target,
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
		handleScanTargetKindChange,
		handleSelectProjectFolder,
		handleStartScanProfile,
	};
}
