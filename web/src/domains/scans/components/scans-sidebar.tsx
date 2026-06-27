import {
	Eye,
	FileText,
	FolderOpen,
	Play,
	Plus,
	ScrollText,
	Sparkles,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, SelectInput, TextInput } from "../../../ui";
import {
	formatScanOutcome,
	getProfileDisplay,
	getToolDisplay,
} from "../scan-profile-display";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";
import { ActionQueuePanel } from "./action-queue-panel";

export function ScansToolbar() {
	const c = useScans();
	const selectedProfile = c.profiles.find(
		(item) => item.id === c.selectedProfileId,
	);
	const selectedProfileDisplay = selectedProfile
		? getProfileDisplay(
				selectedProfile.id,
				selectedProfile.name,
				selectedProfile.description,
			)
		: null;
	const selectedProfileSteps =
		selectedProfile?.steps ??
		selectedProfile?.tools.map((tool) => ({
			kind: "static_tool" as const,
			toolId: tool.toolId,
			displayName: tool.displayName,
			required: tool.required,
		})) ??
		[];
	const selectedProfileHasDast = selectedProfileSteps.some(
		(step) => step.kind === "dast",
	);
	const selectedProfileStepLabels = selectedProfileSteps.map((step) =>
		step.kind === "dast" ? "HTTP DAST診断" : getToolDisplay(step.toolId).name,
	);
	const canStartScan =
		Boolean(c.selectedProjectId && c.selectedProfileId) &&
		c.timeoutSec > 0 &&
		!c.isScanning;

	return (
		<section className="scans-toolbar">
			<div className="scans-toolbar-grid">
				<div className="scan-toolbar-section scan-toolbar-project-section">
					<div className="scan-project-select-row">
						<label htmlFor="scans-project-select">
							<span>登録済みプロジェクト</span>
							<SelectInput
								id="scans-project-select"
								value={c.selectedProjectId}
								onChange={(event) => c.setSelectedProjectId(event.target.value)}
							>
								<option value="">-- プロジェクトを選択 --</option>
								{c.projects.map((project) => (
									<option key={project.id} value={project.id}>
										{project.name}
									</option>
								))}
							</SelectInput>
						</label>
						<ToolbarIconButton
							label="新規プロジェクト"
							onClick={() => c.setShowNewProjectModal(true)}
						>
							<Plus className="icon" />
						</ToolbarIconButton>
					</div>
				</div>

				<div className="scan-toolbar-section">
					<div className="scan-launch-config scan-static-profile-row">
						<label
							className="scan-static-profile-field"
							htmlFor="scans-profile-select"
						>
							<span>スキャンプロファイル</span>
							<SelectInput
								id="scans-profile-select"
								value={c.selectedProfileId}
								onChange={(event) => c.setSelectedProfileId(event.target.value)}
								disabled={!c.selectedProjectId}
							>
								{c.profiles.map((item) => {
									const display = getProfileDisplay(
										item.id,
										item.name,
										item.description,
									);
									return (
										<option key={item.id} value={item.id}>
											{display.name}
										</option>
									);
								})}
							</SelectInput>
						</label>
						<div className="scan-static-profile-description">
							<strong>
								{selectedProfileDisplay?.name ?? "プロファイル未選択"}
							</strong>
							<p>
								{selectedProfileDisplay?.subtitle ??
									"プロジェクトを選択すると利用可能なスキャンプロファイルが表示されます。"}
							</p>
							{selectedProfileStepLabels.length > 0 ? (
								<small>{selectedProfileStepLabels.join(" / ")}</small>
							) : null}
							{selectedProfileHasDast ? (
								<p>
									実行対象はプロジェクトの起動スクリプトから自動判別され、HTTP
									DAST 証跡は同じスキャン結果に保存されます。
								</p>
							) : null}
						</div>
					</div>
				</div>

				<div className="scan-toolbar-section scan-toolbar-actions-section">
					<div className="scan-toolbar-actions">
						<ToolbarIconButton
							label={c.isScanning ? "スキャン実行中" : "スキャンを開始"}
							onClick={() => void c.handleStartScanProfile()}
							disabled={!canStartScan}
							variant="primary"
						>
							<Play className="icon" />
						</ToolbarIconButton>
						{c.selectedScanRunId ? <ScanReportControls /> : null}
					</div>
				</div>
			</div>
			{c.showNewProjectModal ? <NewProjectModal /> : null}
		</section>
	);
}

function ToolbarIconButton({
	children,
	disabled,
	label,
	onClick,
	variant = "secondary",
}: {
	children: ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
	variant?: "primary" | "secondary";
}) {
	return (
		<span className="scan-toolbar-tooltip" data-tooltip={label}>
			<button
				type="button"
				className={`scan-toolbar-icon-action ${variant}`}
				onClick={onClick}
				disabled={disabled}
				aria-label={label}
			>
				{children}
			</button>
		</span>
	);
}

export function ScansSidebar() {
	const c = useScans();
	return (
		<aside className="scans-panel scans-runs-sidebar">
			<ActionQueuePanel />
			<div className="scans-panel-header scans-history-head">
				<div>
					<h2>最近の実行</h2>
					<small className="scans-runs-count">
						選択中のプロジェクトに {c.scanRuns.length} 件
					</small>
				</div>
				{c.selectedProjectId ? (
					<Button
						type="button"
						variant="secondary"
						onClick={() => c.handleSelectScanRun(c.scanRuns[0]?.id ?? "")}
						disabled={!c.scanRuns[0]}
					>
						最新
					</Button>
				) : null}
			</div>
			<div className="scans-list runs-list">
				{c.scanRuns.length > 0 ? (
					c.scanRuns.map((run) => (
						<button
							type="button"
							key={run.id}
							className={`scan-item ${c.selectedScanRunId === run.id ? "active" : ""}`}
							onClick={() => c.handleSelectScanRun(run.id)}
						>
							<div className="finding-meta-row">
								<strong>{run.profile}</strong>
								<span
									className={`scan-status-badge badge-${run.status || "queued"}`}
								>
									{formatScanOutcome(run.status || "queued")}
								</span>
							</div>
							<small>{formatDateTime(run.createdAt)}</small>
						</button>
					))
				) : (
					<div className="tree-info">
						{c.selectedProjectId
							? "このプロジェクトの scan はまだありません。"
							: "scan を開始するには、プロジェクトフォルダを登録または選択してください。"}
					</div>
				)}
			</div>
		</aside>
	);
}

function NewProjectModal() {
	const c = useScans();
	return (
		<div className="scan-modal-backdrop" role="presentation">
			<div
				className="scan-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="scan-new-project-title"
			>
				<div className="scan-modal-header">
					<h2 id="scan-new-project-title">新規プロジェクト</h2>
					<button
						type="button"
						className="scan-modal-close"
						onClick={() => c.setShowNewProjectModal(false)}
						aria-label="新規プロジェクト dialog を閉じる"
					>
						<X className="icon" />
					</button>
				</div>
				<div className="scan-modal-body">
					<div className="scan-folder-path-row">
						<TextInput
							id="scan-project-folder-path"
							aria-label="プロジェクトフォルダ path"
							value={c.projectFolderPath}
							onChange={(event) => c.setProjectFolderPath(event.target.value)}
							placeholder="/Users/name/Code/project"
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void c.handleBrowseProjectFolder()}
							disabled={c.projectBrowseLoading}
							title="プロジェクトフォルダを選択"
						>
							<FolderOpen className="icon" />
							{c.projectBrowseLoading ? "開いています..." : "選択"}
						</Button>
					</div>
					{c.projectFolderPath ? (
						<div className="scan-project-summary">
							<strong>選択中のフォルダ</strong>
							<code>{c.projectFolderPath}</code>
						</div>
					) : (
						<div className="tree-info">
							フォルダが未選択です。「選択」からプロジェクトフォルダを指定してください。
						</div>
					)}
					<label htmlFor="scan-project-name">
						<span>プロジェクト名</span>
						<TextInput
							id="scan-project-name"
							value={c.projectNameInput}
							onChange={(event) => c.setProjectNameInput(event.target.value)}
							placeholder="プロジェクト名"
						/>
					</label>
					<label htmlFor="scan-project-default-branch">
						<span>既定ブランチ</span>
						<TextInput
							id="scan-project-default-branch"
							value={c.projectDefaultBranch}
							onChange={(event) =>
								c.setProjectDefaultBranch(event.target.value)
							}
							placeholder="main"
						/>
					</label>
				</div>
				<div className="scan-modal-actions">
					<Button
						type="button"
						variant="secondary"
						onClick={() => c.setShowNewProjectModal(false)}
					>
						キャンセル
					</Button>
					<Button
						type="button"
						variant="primary"
						onClick={() => void c.handleCreateProjectFromFolder()}
						disabled={
							c.projectCreateLoading ||
							!c.projectFolderPath.trim() ||
							!c.projectNameInput.trim()
						}
					>
						<Plus className="icon" />
						{c.projectCreateLoading ? "登録中..." : "プロジェクトを登録"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function ScanReportControls() {
	const c = useScans();
	const preview = c.reportQualityPreview;
	return (
		<div className="scan-report-controls">
			<label className="scan-review-filter">
				<span>handoff 対象</span>
				<select
					value={c.scanReviewFindingFilter}
					onChange={(event) =>
						c.setScanReviewFindingFilter(
							event.target.value as typeof c.scanReviewFindingFilter,
						)
					}
					disabled={c.scanReviewLoading || c.busy}
				>
					<option value="all">すべての finding</option>
					<option value="high_or_critical">高 / 緊急</option>
					<option value="weak_or_missing_evidence">証跡が弱い / 不足</option>
					<option
						value="new_or_regressed"
						disabled={c.scanComparison.status !== "available"}
					>
						新規 / 悪化
					</option>
				</select>
			</label>
			<div className="scan-report-actions">
				<ToolbarIconButton
					label={
						c.reportLoading ? "レポート生成中" : preview.toolbarActionLabel
					}
					onClick={() => void c.handleGenerateReport()}
					disabled={c.reportLoading || c.busy}
					variant="primary"
				>
					<FileText className="icon" />
				</ToolbarIconButton>
				<ToolbarIconButton
					label={`${preview.toolbarActionLabel}（LLM要約付き）`}
					onClick={() =>
						void c.handleGenerateReport("deterministic_with_llm_summary")
					}
					disabled={c.reportLoading || c.busy}
				>
					<Sparkles className="icon" />
				</ToolbarIconButton>
				<ToolbarIconButton
					label={
						c.scanReviewLoading
							? "スキャンレビュー中"
							: "スキャンレビューを実行"
					}
					onClick={() => void c.handleTriggerScanReview()}
					disabled={c.scanReviewLoading || c.busy}
				>
					<ScrollText className="icon" />
				</ToolbarIconButton>
				{c.reports[0] ? (
					<ToolbarIconButton
						label="最新レポートを表示"
						onClick={() => {
							c.setSelectedReport(c.reports[0]);
							c.setViewingReport(true);
						}}
					>
						<Eye className="icon" />
					</ToolbarIconButton>
				) : null}
			</div>
		</div>
	);
}
