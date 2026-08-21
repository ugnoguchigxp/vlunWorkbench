import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { Dialog } from "../../../components/dialog";
import { ToastRegion } from "../../../components/toast-region";
import { Button, TextInput } from "../../../ui";
import { useScans } from "../scans-context";
import {
	buildClosedFindingSearch,
	normalizeScansSearch,
	parseScansSearch,
	resolveRequestedFindingId,
	type ScanWorkspaceTab,
} from "../scans-route-search";
import { useProjectDeleteController } from "../use-project-delete-controller";
import { useScanDeleteController } from "../use-scan-delete-controller";
import { DastAssessmentPanel } from "./dast-assessment-panel";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectRail } from "./project-rail";
import { ScanDeleteDialog } from "./scan-delete-dialog";
import { ScanLaunchCard } from "./scan-launch-card";
import { ScanProfileCatalogList } from "./scan-profile-catalog-list";
import { ScanOverviewTab } from "./scan-overview-tab";
import { ScanProgressPanel } from "./scan-progress-panel";
import { ScanReportWorkspace } from "./scan-report-workspace";
import { ScanTabs } from "./scan-tabs";

export function ScansWorkspacePage() {
	const c = useScans();
	const navigate = useNavigate({ from: "/scans" });
	const location = useRouterState({ select: (state) => state.location });
	const search = useMemo(
		() =>
			parseScansSearch(
				Object.fromEntries(new URLSearchParams(location.searchStr)),
			),
		[location.searchStr],
	);
	const activeTab = search.tab ?? "overview";
	useEffect(() => {
		const requestedFinding = resolveRequestedFindingId(
			{ tab: activeTab, findingId: search.findingId },
			c.findings.map((finding) => finding.id),
		);
		if (!requestedFinding) {
			if (c.selectedFindingId) {
				c.handleCloseFinding();
			}
			return;
		}
		if (requestedFinding !== c.selectedFindingId) {
			c.handleSelectFinding(requestedFinding);
		}
	}, [activeTab, c, search.findingId]);
	const move = useCallback(
		(next: Parameters<typeof normalizeScansSearch>[0]) => {
			void navigate({ to: "/scans", search: normalizeScansSearch(next) });
		},
		[navigate],
	);
	const projectDeletion = useProjectDeleteController({
		onDeleted: (projectId) => {
			c.setProjects((projects) =>
				projects.filter((project) => project.id !== projectId),
			);
			if (c.selectedProjectId === projectId) {
				c.setSelectedProjectId("");
				c.setSelectedScanRunId("");
			}
			move({});
		},
	});
	const scanDeletion = useScanDeleteController({
		onDeleted: (scanRunId) => {
			const remainingRuns = c.scanRuns.filter((scan) => scan.id !== scanRunId);
			c.setScanRuns(remainingRuns);
			if (c.selectedScanRunId !== scanRunId) return;
			const nextScanRunId = remainingRuns[0]?.id ?? "";
			c.setSelectedFindingId("");
			c.setSelectedFindingDetails(null);
			if (nextScanRunId) {
				c.handleSelectScanRun(nextScanRunId);
				move({
					projectId: c.selectedProjectId,
					scanRunId: nextScanRunId,
					tab: activeTab,
				});
				return;
			}
			c.setSelectedScanRunId("");
			move({ projectId: c.selectedProjectId });
		},
	});
	const selectProject = (projectId: string) => {
		c.setSelectedProjectId(projectId);
		c.setSelectedScanRunId("");
		move({ projectId });
	};
	const openProjectHistory = (project: (typeof c.projects)[number]) => {
		c.setSelectedProjectId(project.id);
		c.setSelectedScanRunId("");
		move({ projectId: project.id });
	};
	const selectScan = (scanRunId: string) => {
		c.handleSelectScanRun(scanRunId);
		move({ projectId: c.selectedProjectId, scanRunId, tab: activeTab });
	};
	const changeTab = (tab: ScanWorkspaceTab) => {
		move({
			projectId: c.selectedProjectId || undefined,
			scanRunId: c.selectedScanRunId || undefined,
			tab,
		});
	};
	const selectFinding = (findingId: string) => {
		c.handleSelectFinding(findingId);
		move({
			projectId: c.selectedProjectId,
			scanRunId: c.selectedScanRunId,
			tab: "overview",
			findingId,
		});
	};
	const closeFinding = () => {
		move(
			buildClosedFindingSearch({
				projectId: c.selectedProjectId || undefined,
				scanRunId: c.selectedScanRunId || undefined,
			}),
		);
	};
	const selectReport = (reportId: string) => {
		const report = c.reports.find((item) => item.id === reportId) ?? null;
		c.setSelectedReport(report);
		move({
			projectId: c.selectedProjectId,
			scanRunId: c.selectedScanRunId,
			tab: "report",
			reportId,
		});
	};
	const generateReport = () => {
		void c.handleGenerateReport("deterministic");
		changeTab("report");
	};
	const generateImprovementRequest = () => {
		void c.handleGenerateImprovementRequest();
	};
	const selectedProfile = c.profiles.find(
		(profile) => profile.id === c.selectedProfileId,
	);
	const progressProfile = c.progressScanRun
		? (c.profiles.find(
				(profile) => profile.id === c.progressScanRun?.profile,
			) ?? null)
		: null;
	const canStart =
		Boolean(c.selectedProjectId && c.selectedProfileId) &&
		!c.scanRunsLoading &&
		(c.selectedProject?.pathPolicy === undefined ||
			c.selectedProject.pathPolicy.status === "allowed");

	return (
		<main className="scans-layout scan-workspace-layout">
			<div className="scan-workspace-shell">
				<ProjectRail
					projects={c.projects}
					selectedProjectId={c.selectedProjectId}
					scanRuns={c.scanRuns}
					selectedScanRunId={c.selectedScanRunId}
					onSelect={selectProject}
					onSelectScan={selectScan}
					onOpenHistory={openProjectHistory}
					onAdd={() => c.setShowNewProjectModal(true)}
					onDelete={projectDeletion.open}
					onDeleteScan={scanDeletion.open}
				/>
				<section className="scan-workspace-main">
					<header className="workspace-page-header">
						<div>
							<p className="workspace-eyebrow">Security workspace</p>
							<h1>{c.selectedProject?.name ?? "スキャンワークスペース"}</h1>
						</div>
						<p>実行、結果確認、LLMレポートを一つの画面で進めます。</p>
					</header>
					<ScanLaunchCard
						profiles={c.profiles}
						selectedProfileId={c.selectedProfileId}
						scanTargetKind={c.scanTargetKind}
						disabled={!canStart}
						isScanning={c.isScanning}
						onProfileChange={c.setSelectedProfileId}
						onTargetChange={c.handleScanTargetKindChange}
						onStart={() => void c.handleStartScanProfile()}
					/>
					<ScanProfileCatalogList
						entries={c.catalogEntries}
						genericStartProfileIds={c.profiles.map((profile) => profile.id)}
					/>
					{selectedProfile?.capabilityRequirements?.length ? (
						<p className="workspace-coverage-notice">
							実行前の診断要件:{" "}
							{selectedProfile.capabilityRequirements
								.map((entry) => entry.capabilityId)
								.join(", ")}
						</p>
					) : null}
					{!canStart && c.selectedProjectId ? (
						<p className="workspace-coverage-notice">
							保存済みパスを読み取れないため、スキャンを実行できません。
						</p>
					) : null}
					<ScanProgressPanel
						scan={c.progressScanRun}
						profile={progressProfile}
						events={c.progressScanEvents}
					/>
					<ScanTabs activeTab={activeTab} onChange={changeTab} />
					{activeTab === "overview" ? (
						<ScanOverviewTab
							findings={c.findings}
							scanRuns={c.scanRuns}
							selectedScanRunId={c.selectedScanRunId}
							coverageGaps={
								c.diagnosticDashboard.diagnosticCoverage.coverageGaps
							}
							selectedFindingId={c.selectedFindingId}
							scanReviews={c.scanReviews}
							generatingImprovementRequest={c.improvementRequestLoading}
							onSelectFinding={selectFinding}
							onCloseFinding={closeFinding}
							onGenerateImprovementRequest={generateImprovementRequest}
						/>
					) : null}
					{activeTab === "coverage" ? (
						<CoverageTab
							coverageGaps={
								c.diagnosticDashboard.diagnosticCoverage.coverageGaps
							}
						/>
					) : null}
					{activeTab === "report" ? (
						<ScanReportWorkspace
							reports={c.reports}
							scanReviews={c.scanReviews}
							requestedReportId={search.reportId}
							generating={c.reportLoading}
							onSelectReport={selectReport}
							onGenerate={generateReport}
						/>
					) : null}
				</section>
			</div>
			<ProjectCreateDialog
				open={c.showNewProjectModal}
				path={c.projectFolderPath}
				branch={c.projectDefaultBranch}
				busy={c.projectBrowseLoading || c.projectCreateLoading}
				onPathChange={c.setProjectFolderPath}
				onBranchChange={c.setProjectDefaultBranch}
				onBrowse={() => void c.handleBrowseProjectFolder()}
				onClose={() => c.setShowNewProjectModal(false)}
				onCreate={() => void c.handleCreateProjectFromFolder()}
			/>
			<ProjectDeleteDialog
				project={projectDeletion.project}
				confirmation={projectDeletion.confirmation}
				error={projectDeletion.error}
				submitting={projectDeletion.submitting}
				canSubmit={projectDeletion.canSubmit}
				onConfirmationChange={projectDeletion.setConfirmation}
				onClose={projectDeletion.close}
				onConfirm={() => void projectDeletion.submit()}
			/>
			<ScanDeleteDialog
				scan={scanDeletion.scan}
				error={scanDeletion.error}
				submitting={scanDeletion.submitting}
				onClose={scanDeletion.close}
				onConfirm={() => void scanDeletion.submit()}
			/>
			<ToastRegion message={scanDeletion.toast ?? projectDeletion.toast} />
		</main>
	);
}

function CoverageTab({ coverageGaps }: { coverageGaps: number }) {
	return (
		<section className="workspace-tab-panel" role="tabpanel">
			<h2>カバレッジ</h2>
			<p>
				{coverageGaps === 0
					? "未確認のカバレッジギャップはありません。"
					: `${coverageGaps} 件のカバレッジギャップを確認してください。`}
			</p>
			<DastAssessmentPanel />
		</section>
	);
}

function ProjectCreateDialog({
	open,
	path,
	branch,
	busy,
	onPathChange,
	onBranchChange,
	onBrowse,
	onClose,
	onCreate,
}: {
	open: boolean;
	path: string;
	branch: string;
	busy: boolean;
	onPathChange: (value: string) => void;
	onBranchChange: (value: string) => void;
	onBrowse: () => void;
	onClose: () => void;
	onCreate: () => void;
}) {
	return (
		<Dialog open={open} title="新規プロジェクト" onClose={onClose}>
			<div className="workspace-delete-dialog-body">
				<label htmlFor="project-create-path">
					リポジトリパス
					<TextInput
						id="project-create-path"
						aria-label="プロジェクトフォルダ path"
						value={path}
						onChange={(event: ChangeEvent<HTMLInputElement>) =>
							onPathChange(event.target.value)
						}
					/>
				</label>
				<label htmlFor="project-create-branch">
					デフォルトブランチ
					<TextInput
						id="project-create-branch"
						aria-label="既定ブランチ"
						value={branch}
						onChange={(event: ChangeEvent<HTMLInputElement>) =>
							onBranchChange(event.target.value)
						}
					/>
				</label>
				<div className="workspace-dialog-actions">
					<Button
						type="button"
						variant="secondary"
						onClick={onBrowse}
						disabled={busy}
					>
						フォルダを選択
					</Button>
					<Button
						type="button"
						variant="primary"
						aria-label="プロジェクトを登録"
						onClick={onCreate}
						disabled={busy || !path.trim()}
					>
						登録
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
