import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { Dialog } from "../../../components/dialog";
import { ToastRegion } from "../../../components/toast-region";
import { Button, TextInput } from "../../../ui";
import {
	parseScansSearch,
	type ScanWorkspaceTab,
	normalizeScansSearch,
} from "../scans-route-search";
import { useScans } from "../scans-context";
import type { ScansController } from "../use-scans-controller";
import { useProjectDeleteController } from "../use-project-delete-controller";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { DastAssessmentPanel } from "./dast-assessment-panel";
import { FindingDetailPanel } from "./finding-detail-panel";
import { ProjectRail } from "./project-rail";
import { ScanContextBar } from "./scan-context-bar";
import { ScanLaunchCard } from "./scan-launch-card";
import { ScanOverviewTab } from "./scan-overview-tab";
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
		const requestedFinding =
			activeTab === "findings" ? search.findingId : undefined;
		if (
			!requestedFinding ||
			!c.findings.some((finding) => finding.id === requestedFinding)
		) {
			if (c.selectedFindingId) {
				c.setSelectedFindingId("");
				c.setSelectedFindingDetails(null);
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
	const selectProject = (projectId: string) => {
		c.setSelectedProjectId(projectId);
		c.setSelectedScanRunId("");
		move({ projectId });
	};
	const openProjectHistory = (project: (typeof c.projects)[number]) => {
		c.setSelectedProjectId(project.id);
		c.setSelectedScanRunId("");
		move({ projectId: project.id, tab: "history" });
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
			tab: "findings",
			findingId,
		});
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
	const selectedProfile = c.profiles.find(
		(profile) => profile.id === c.selectedProfileId,
	);
	const canStart =
		Boolean(c.selectedProjectId && c.selectedProfileId) &&
		(c.selectedProject?.pathPolicy === undefined ||
			c.selectedProject.pathPolicy.status === "allowed");

	return (
		<main className="scans-layout scan-workspace-layout">
			<div className="scan-workspace-shell">
				<ProjectRail
					projects={c.projects}
					selectedProjectId={c.selectedProjectId}
					onSelect={selectProject}
					onOpenHistory={openProjectHistory}
					onAdd={() => c.setShowNewProjectModal(true)}
					onDelete={projectDeletion.open}
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
					{selectedProfile?.coverageGaps?.length ? (
						<p className="workspace-coverage-notice">
							未実行の診断範囲: {selectedProfile.coverageGaps.join(", ")}
						</p>
					) : null}
					{!canStart && c.selectedProjectId ? (
						<p className="workspace-coverage-notice">
							保存済みパスを読み取れないため、スキャンを実行できません。
						</p>
					) : null}
					<ScanContextBar scan={c.selectedScanRun ?? null} />
					<ScanTabs activeTab={activeTab} onChange={changeTab} />
					{activeTab === "overview" ? (
						<ScanOverviewTab
							findings={c.findings}
							scanRuns={c.scanRuns}
							selectedScanRunId={c.selectedScanRunId}
							coverageGaps={
								c.diagnosticDashboard.diagnosticCoverage.coverageGaps
							}
							onSelectFinding={selectFinding}
						/>
					) : null}
					{activeTab === "findings" ? (
						<FindingsTab
							findings={c.findings}
							selectedFindingId={c.selectedFindingId}
							onSelect={selectFinding}
						/>
					) : null}
					{activeTab === "coverage" ? (
						<CoverageTab
							coverageGaps={
								c.diagnosticDashboard.diagnosticCoverage.coverageGaps
							}
						/>
					) : null}
					{activeTab === "history" ? (
						<HistoryTab
							selectedScanRunId={c.selectedScanRunId}
							scanRuns={c.scanRuns}
							onSelect={selectScan}
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
			<ToastRegion message={projectDeletion.toast} />
		</main>
	);
}

function FindingsTab({
	findings,
	selectedFindingId,
	onSelect,
}: {
	findings: ScansController["findings"];
	selectedFindingId: string;
	onSelect: (id: string) => void;
}) {
	return (
		<section className="workspace-tab-panel" role="tabpanel">
			<div className="workspace-section-heading">
				<h2>検出結果</h2>
				<span>{findings.length} 件</span>
			</div>
			{findings.length ? (
				<div className="workspace-findings-list">
					{findings.map((finding) => (
						<button
							key={finding.id}
							type="button"
							aria-pressed={finding.id === selectedFindingId}
							onClick={() => onSelect(finding.id)}
						>
							<span className={`severity-${finding.severity}`}>
								{finding.severity}
							</span>
							<strong>{finding.title}</strong>
							<small>{finding.sourceTool}</small>
						</button>
					))}
				</div>
			) : (
				<p className="workspace-empty">検出結果はありません。</p>
			)}
			{selectedFindingId ? (
				<div className="workspace-finding-detail">
					<FindingDetailPanel />
				</div>
			) : null}
		</section>
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

function HistoryTab({
	scanRuns,
	selectedScanRunId,
	onSelect,
}: {
	scanRuns: ScansController["scanRuns"];
	selectedScanRunId: string;
	onSelect: (id: string) => void;
}) {
	return (
		<section className="workspace-tab-panel" role="tabpanel">
			<div className="workspace-section-heading">
				<h2>スキャン履歴</h2>
				<span>{scanRuns.length} 件</span>
			</div>
			<div className="workspace-history-list">
				{scanRuns.map((scan) => (
					<button
						key={scan.id}
						type="button"
						className={scan.id === selectedScanRunId ? "selected" : ""}
						onClick={() => onSelect(scan.id)}
					>
						<strong>{scan.profile}</strong>
						<span>{scan.status}</span>
						<time dateTime={scan.createdAt}>
							{new Date(scan.createdAt).toLocaleString("ja-JP")}
						</time>
					</button>
				))}
			</div>
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
