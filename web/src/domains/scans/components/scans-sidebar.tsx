import {
	Eye,
	FileText,
	FolderOpen,
	Play,
	Plus,
	ScrollText,
	Shield,
	Sparkles,
	TerminalSquare,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, SelectInput, TextInput } from "../../../ui";
import { getProfileDisplay } from "../scan-profile-display";
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
	const dastProfiles = c.dastProfiles.filter(
		(item) =>
			item.enabled &&
			(item.id === "http-baseline" ||
				c.dastProfileConfigs.some(
					(config) =>
						config.profileId === item.id &&
						config.targetConfigId === c.selectedDastTargetId &&
						config.enabled,
				)),
	);
	const canStartStatic =
		Boolean(c.selectedProjectId && c.selectedProfileId) &&
		c.timeoutSec > 0 &&
		!c.isScanning;
	const canSaveDastTarget =
		Boolean(c.selectedProjectId && c.dastTargetOrigin.trim()) && !c.dastLoading;
	const canStartDast =
		Boolean(c.selectedProjectId && c.selectedDastProfileId) && !c.dastLoading;

	return (
		<section className="scans-toolbar">
			<div className="scans-toolbar-grid">
				<div className="scan-toolbar-section scan-toolbar-project-section">
					<div className="scan-project-select-row">
						<label htmlFor="scans-project-select">
							<span>Registered Project</span>
							<SelectInput
								id="scans-project-select"
								value={c.selectedProjectId}
								onChange={(event) => c.setSelectedProjectId(event.target.value)}
							>
								<option value="">-- Select Project --</option>
								{c.projects.map((project) => (
									<option key={project.id} value={project.id}>
										{project.name}
									</option>
								))}
							</SelectInput>
						</label>
						<ToolbarIconButton
							label="New Project"
							onClick={() => c.setShowNewProjectModal(true)}
						>
							<Plus className="icon" />
						</ToolbarIconButton>
					</div>
				</div>

				<div className="scan-toolbar-section">
					<div className="scan-mode-tabs" role="tablist" aria-label="Scan type">
						<button
							type="button"
							className={c.launchMode === "static" ? "active" : ""}
							onClick={() => c.setLaunchMode("static")}
						>
							<TerminalSquare className="icon" />
							Static tools
						</button>
						<button
							type="button"
							className={c.launchMode === "dast" ? "active" : ""}
							onClick={() => c.setLaunchMode("dast")}
						>
							<Shield className="icon" />
							DAST
						</button>
					</div>

					{c.launchMode === "static" ? (
						<div className="scan-launch-config scan-static-profile-row">
							<label
								className="scan-static-profile-field"
								htmlFor="scans-profile-select"
							>
								<span>Scan Profile</span>
								<SelectInput
									id="scans-profile-select"
									value={c.selectedProfileId}
									onChange={(event) =>
										c.setSelectedProfileId(event.target.value)
									}
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
										"Project を選択すると利用可能な Static scan profile が表示されます。"}
								</p>
							</div>
						</div>
					) : (
						<div className="scan-launch-config">
							{c.dastError ? (
								<p className="scan-inline-error">{c.dastError}</p>
							) : null}
							<div className="scan-dast-auto-target">
								<strong>Auto target</strong>
								<p>
									{c.lastAutoDastTargetOrigin
										? `前回の自動判別: ${c.lastAutoDastTargetOrigin}`
										: "Auto DAST は選択中 Project の package scripts から起動先 origin を判別して実行します。"}
								</p>
							</div>
							<label htmlFor="scan-dast-target-origin">
								<span>Manual Target Origin</span>
								<TextInput
									id="scan-dast-target-origin"
									value={c.dastTargetOrigin}
									onChange={(event) =>
										c.setDastTargetOrigin(event.target.value)
									}
									placeholder="Optional override, for example http://127.0.0.1:5173"
									disabled={!c.selectedProjectId}
								/>
							</label>
							<label htmlFor="dast-target-select">
								<span>Saved Target</span>
								<SelectInput
									id="dast-target-select"
									value={c.selectedDastTargetId}
									onChange={(event) =>
										c.setSelectedDastTargetId(event.target.value)
									}
									disabled={!c.selectedProjectId}
								>
									<option value="">-- Select Target --</option>
									{c.dastTargets.map((target) => (
										<option
											key={target.id}
											value={target.id}
											disabled={!target.enabled}
										>
											{target.name} ({target.normalizedOrigin})
										</option>
									))}
								</SelectInput>
							</label>
							<label htmlFor="dast-profile-select">
								<span>DAST Profile</span>
								<SelectInput
									id="dast-profile-select"
									value={c.selectedDastProfileId}
									onChange={(event) =>
										c.setSelectedDastProfileId(event.target.value)
									}
									disabled={!c.selectedProjectId}
								>
									{dastProfiles.map((item) => (
										<option key={item.id} value={item.id}>
											{item.displayName}
										</option>
									))}
								</SelectInput>
							</label>
						</div>
					)}
				</div>

				<div className="scan-toolbar-section scan-toolbar-actions-section">
					<div className="scan-toolbar-actions">
						{c.launchMode === "static" ? (
							<ToolbarIconButton
								label={
									c.isScanning ? "Running Static Scan" : "Start Static Scan"
								}
								onClick={() => void c.handleStartScanProfile()}
								disabled={!canStartStatic}
								variant="primary"
							>
								<Play className="icon" />
							</ToolbarIconButton>
						) : (
							<>
								<ToolbarIconButton
									label={
										c.dastLoading
											? "Preparing Auto DAST"
											: "Auto DAST HTTP Baseline (auto-detect target)"
									}
									onClick={() => void c.handleAutoDastRun()}
									disabled={!c.selectedProjectId || c.dastLoading}
									variant="primary"
								>
									<Play className="icon" />
								</ToolbarIconButton>
								<ToolbarIconButton
									label={c.dastLoading ? "Saving Target" : "Save Target"}
									onClick={() => void c.handleCreateDastTarget()}
									disabled={!canSaveDastTarget}
								>
									<Plus className="icon" />
								</ToolbarIconButton>
								<ToolbarIconButton
									label={c.dastLoading ? "Running DAST" : "Start DAST"}
									onClick={() => void c.handleTriggerDastRun()}
									disabled={!canStartDast}
									variant="primary"
								>
									<Shield className="icon" />
								</ToolbarIconButton>
							</>
						)}
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
					<h2>Recent Runs</h2>
					<small className="scans-runs-count">
						{c.scanRuns.length} runs in selected project
					</small>
				</div>
				{c.selectedProjectId ? (
					<Button
						type="button"
						variant="secondary"
						onClick={() => c.handleSelectScanRun(c.scanRuns[0]?.id ?? "")}
						disabled={!c.scanRuns[0]}
					>
						Latest
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
									{run.status || "queued"}
								</span>
							</div>
							<small>{formatDateTime(run.createdAt)}</small>
						</button>
					))
				) : (
					<div className="tree-info">
						{c.selectedProjectId
							? "No scans found for this project."
							: "Register or select a project folder to start scanning."}
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
					<h2 id="scan-new-project-title">New Project</h2>
					<button
						type="button"
						className="scan-modal-close"
						onClick={() => c.setShowNewProjectModal(false)}
						aria-label="Close new project dialog"
					>
						<X className="icon" />
					</button>
				</div>
				<div className="scan-modal-body">
					<div className="scan-folder-path-row">
						<TextInput
							id="scan-project-folder-path"
							aria-label="Project folder path"
							value={c.projectFolderPath}
							onChange={(event) => c.setProjectFolderPath(event.target.value)}
							placeholder="/Users/name/Code/project"
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void c.handleBrowseProjectFolder()}
							disabled={c.projectBrowseLoading}
							title="Browse for a project folder"
						>
							<FolderOpen className="icon" />
							{c.projectBrowseLoading ? "Opening..." : "Browse"}
						</Button>
					</div>
					{c.projectFolderPath ? (
						<div className="scan-project-summary">
							<strong>Selected folder</strong>
							<code>{c.projectFolderPath}</code>
						</div>
					) : (
						<div className="tree-info">
							No folder selected. Use Browse to choose the project folder.
						</div>
					)}
					<label htmlFor="scan-project-name">
						<span>Project Name</span>
						<TextInput
							id="scan-project-name"
							value={c.projectNameInput}
							onChange={(event) => c.setProjectNameInput(event.target.value)}
							placeholder="Project name"
						/>
					</label>
					<label htmlFor="scan-project-default-branch">
						<span>Default Branch</span>
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
						Cancel
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
						{c.projectCreateLoading ? "Registering..." : "Register Project"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function ScanReportControls() {
	const c = useScans();
	return (
		<>
			<ToolbarIconButton
				label={c.reportLoading ? "Generating Report" : "Generate Report"}
				onClick={() => void c.handleGenerateReport()}
				disabled={c.reportLoading || c.busy}
				variant="primary"
			>
				<FileText className="icon" />
			</ToolbarIconButton>
			<ToolbarIconButton
				label="Generate LLM Summary Report"
				onClick={() =>
					void c.handleGenerateReport("deterministic_with_llm_summary")
				}
				disabled={c.reportLoading || c.busy}
			>
				<Sparkles className="icon" />
			</ToolbarIconButton>
			<ToolbarIconButton
				label={c.scanReviewLoading ? "Reviewing Scan" : "Run Scan Review"}
				onClick={() => void c.handleTriggerScanReview()}
				disabled={c.scanReviewLoading || c.busy}
			>
				<ScrollText className="icon" />
			</ToolbarIconButton>
			{c.reports[0] ? (
				<ToolbarIconButton
					label="View Latest Report"
					onClick={() => {
						c.setSelectedReport(c.reports[0]);
						c.setViewingReport(true);
					}}
				>
					<Eye className="icon" />
				</ToolbarIconButton>
			) : null}
		</>
	);
}
