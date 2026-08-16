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
import { ScanProjectCodeConsent } from "./scan-project-code-consent";

const folderNameFromPath = (value: string): string => {
	const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
	return normalized.split("/").at(-1) || normalized || "repository";
};

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
	const supportedTargets = selectedProfile?.supportedTargets ?? ["full"];
	const selectedTargetSupported = supportedTargets.includes(c.scanTargetKind);
	const diffTargetSelected = c.scanTargetKind !== "full";
	const targetReady = !diffTargetSelected || c.diffPreviewCurrent;
	const canStartScan =
		Boolean(c.selectedProjectId && c.selectedProfileId) &&
		c.selectedProject?.pathPolicy?.status === "allowed" &&
		c.timeoutSec > 0 &&
		selectedTargetSupported &&
		targetReady &&
		!c.isScanning &&
		!c.scanRuns.some(
			(run) => run.status === "queued" || run.status === "running",
		);
	const selectedScanActive =
		c.selectedScanRun?.status === "queued" ||
		c.selectedScanRun?.status === "running";
	const latestEvent = c.scanEvents.at(-1);

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
										{folderNameFromPath(project.repoPath)}
										{project.pathPolicy?.status === "allowed"
											? ""
											: "（実行不可）"}
									</option>
								))}
							</SelectInput>
							{c.selectedProject &&
							c.selectedProject.pathPolicy?.status !== "allowed" ? (
								<small role="alert">
									保存済みパスが存在しないか、読み取りできません。
								</small>
							) : null}
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
							{selectedProfile?.coverageGaps?.length ? (
								<p role="status" className="badge-failed">
									未実行の診断範囲: {selectedProfile.coverageGaps.join(", ")}
								</p>
							) : null}
							{selectedProfileHasDast ? (
								<>
									<p>
										実行対象はプロジェクトの起動スクリプトから自動判別され、HTTP
										DAST 証跡は同じスキャン結果に保存されます。
									</p>
									<ScanProjectCodeConsent
										checked={c.scanProjectCodeExecutionConsent}
										onChange={c.setScanProjectCodeExecutionConsent}
									/>
								</>
							) : null}
						</div>
					</div>
					<div className="scan-diff-target-config">
						<label htmlFor="scans-target-select">
							<span>Scan target</span>
							<SelectInput
								id="scans-target-select"
								value={c.scanTargetKind}
								onChange={(event) =>
									c.handleScanTargetKindChange(
										event.target.value as typeof c.scanTargetKind,
									)
								}
								disabled={!selectedProfile}
							>
								{supportedTargets.map((target) => (
									<option key={target} value={target}>
										{target === "full"
											? "リポジトリ全体"
											: target === "working_tree"
												? "作業ツリー"
												: target === "commit"
													? "コミット"
													: "ブランチ差分"}
									</option>
								))}
							</SelectInput>
						</label>
						{diffTargetSelected ? (
							<>
								<label htmlFor="scans-diff-base">
									<span>
										{c.scanTargetKind === "commit"
											? "Base（任意）"
											: "Base ref"}
									</span>
									<TextInput
										id="scans-diff-base"
										value={c.diffBaseRef}
										onChange={(event) => c.setDiffBaseRef(event.target.value)}
										placeholder={
											c.scanTargetKind === "commit"
												? "親commitを自動選択"
												: c.scanTargetKind === "range"
													? "main"
													: "HEAD"
										}
									/>
								</label>
								{c.scanTargetKind !== "working_tree" ? (
									<label htmlFor="scans-diff-head">
										<span>Head ref</span>
										<TextInput
											id="scans-diff-head"
											value={c.diffHeadRef}
											onChange={(event) => c.setDiffHeadRef(event.target.value)}
											placeholder="HEAD"
										/>
									</label>
								) : (
									<label className="scan-diff-untracked">
										<input
											type="checkbox"
											checked={c.diffIncludeUntracked}
											onChange={(event) =>
												c.setDiffIncludeUntracked(event.target.checked)
											}
										/>
										未追跡ファイルを含める
									</label>
								)}
								<Button
									type="button"
									variant="secondary"
									onClick={() => void c.handlePreviewDiffTarget()}
									disabled={c.diffPreviewLoading || !c.selectedProjectId}
								>
									<Eye className="icon" />
									{c.diffPreviewLoading ? "確認中..." : "差分を確認"}
								</Button>
							</>
						) : null}
					</div>
					{c.diffPreviewError ? (
						<p role="alert" className="badge-failed">
							{c.diffPreviewError}
						</p>
					) : null}
					{c.diffPreview ? (
						<div className="scan-diff-preview" role="status">
							<strong>
								変更 {c.diffPreview.coverage.changed}件 / scan対象{" "}
								{c.diffPreview.coverage.scannable}件
							</strong>
							<small>
								削除 {c.diffPreview.coverage.deleted} / 除外{" "}
								{c.diffPreview.coverage.excluded} / 未対応{" "}
								{c.diffPreview.coverage.unsupported +
									c.diffPreview.coverage.tooLarge}
							</small>
							<ul>
								{c.diffPreview.entries.slice(0, 100).map((entry) => (
									<li key={`${entry.status}:${entry.path}`}>
										<code>{entry.path}</code> — {entry.status}
										{entry.disposition !== "scan"
											? ` (${entry.reasonCode ?? entry.disposition})`
											: ""}
									</li>
								))}
							</ul>
							{c.diffPreview.entries.length > 100 ? (
								<small>ほか {c.diffPreview.entries.length - 100}件</small>
							) : null}
						</div>
					) : null}
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
			{selectedScanActive ? (
				<div className="scan-project-summary" role="status">
					<strong>
						{formatScanOutcome(c.selectedScanRun?.status ?? "queued")}
					</strong>
					<span>{latestEvent?.message ?? "スキャンを開始しています。"}</span>
					<Button
						type="button"
						variant="secondary"
						onClick={() => void c.handleCancelScan()}
					>
						<X className="icon" />
						取消
					</Button>
				</div>
			) : null}
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
						disabled={c.projectCreateLoading || !c.projectFolderPath.trim()}
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
