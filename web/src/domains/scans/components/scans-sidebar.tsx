import {
	FolderOpen,
	ListChecks,
	Play,
	Plus,
	Shield,
	TerminalSquare,
	X,
} from "lucide-react";
import { Button, SelectInput, TextInput } from "../../../ui";
import { useScans } from "../scans-context";

const SCOPE_LABELS = {
	source: "Source",
	dependency_manifest: "Dependencies",
	artifact: "Artifacts",
	full_deep: "Full deep",
} as const;

export function ScansSidebar() {
	const c = useScans();
	const profile = c.profiles.find((item) => item.id === c.selectedProfileId);
	const selectedTarget = c.dastTargets.find(
		(target) => target.id === c.selectedDastTargetId,
	);
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
	const selectedDastProfile =
		dastProfiles.find((item) => item.id === c.selectedDastProfileId) ?? null;
	const canStartStatic =
		Boolean(c.selectedProjectId && c.selectedProfileId) &&
		c.timeoutSec > 0 &&
		!c.isScanning;
	const canSaveDastTarget =
		Boolean(c.selectedProjectId && c.dastTargetName && c.dastTargetOrigin) &&
		!c.dastLoading;
	const canStartDast =
		Boolean(
			c.selectedProjectId && c.selectedDastTargetId && c.selectedDastProfileId,
		) && !c.dastLoading;

	return (
		<section className="scans-panel">
			<div className="scans-launch">
				<div className="scans-launch-title">
					<h2>Scan Launch</h2>
					<p>Choose a local project folder, confirm scope, then start a run.</p>
				</div>

				<div className="scan-launch-section">
					<div className="scan-launch-section-title">
						<FolderOpen className="icon text-teal-700" />
						<span>Project folder</span>
					</div>
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
						<Button
							type="button"
							variant="secondary"
							onClick={() => c.setShowNewProjectModal(true)}
						>
							<Plus className="icon" />
							New Project
						</Button>
					</div>
				</div>

				<div className="scan-launch-section">
					<div className="scan-launch-section-title">
						<ListChecks className="icon text-indigo-700" />
						<span>Run type</span>
					</div>
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
						<div className="scan-launch-config">
							<label htmlFor="scans-profile-select">
								<span>Scan Profile</span>
								<SelectInput
									id="scans-profile-select"
									value={c.selectedProfileId}
									onChange={(event) =>
										c.setSelectedProfileId(event.target.value)
									}
									disabled={!c.selectedProjectId}
								>
									{c.profiles.map((item) => (
										<option key={item.id} value={item.id}>
											{item.name}
										</option>
									))}
								</SelectInput>
							</label>
							{profile ? (
								<div className="scan-profile-summary">
									<strong>{profile.description}</strong>
									{profile.scope ? (
										<div className="scan-tool-list">
											<span>{SCOPE_LABELS[profile.scope.intent]}</span>
											{profile.scope.includeGenerated ? (
												<span>Generated output</span>
											) : null}
											{profile.scope.includeInstalledDependencies ? (
												<span>Installed dependencies</span>
											) : null}
											{profile.scope.includeVendoredDependencies ? (
												<span>Vendored code</span>
											) : null}
										</div>
									) : null}
									<div className="scan-tool-list">
										{profile.tools.map((tool) => (
											<span key={tool.toolId}>
												{tool.displayName}
												{tool.required ? "" : " optional"}
											</span>
										))}
									</div>
								</div>
							) : null}
							<label htmlFor="scan-static-timeout">
								<span>Timeout (sec)</span>
								<TextInput
									id="scan-static-timeout"
									type="number"
									min={1}
									value={c.timeoutSec}
									onChange={(event) =>
										c.setTimeoutSec(Number(event.target.value))
									}
									disabled={!c.selectedProjectId}
								/>
							</label>
							<label className="scan-checkbox-row">
								<input
									type="checkbox"
									checked={c.continueOnToolFailure}
									onChange={(event) =>
										c.setContinueOnToolFailure(event.target.checked)
									}
									disabled={!c.selectedProjectId}
								/>
								<span>Continue when an optional tool fails</span>
							</label>
							<Button
								type="button"
								variant="primary"
								onClick={() => void c.handleStartScanProfile()}
								disabled={!canStartStatic}
								full
							>
								<Play className="icon" />
								{c.isScanning ? "Running Static Scan..." : "Start Static Scan"}
							</Button>
						</div>
					) : (
						<div className="scan-launch-config">
							{c.dastError ? (
								<p className="scan-inline-error">{c.dastError}</p>
							) : null}
							<Button
								type="button"
								variant="primary"
								onClick={() => void c.handleAutoDastRun()}
								disabled={!c.selectedProjectId || c.dastLoading}
								full
							>
								<Play className="icon" />
								{c.dastLoading
									? "Preparing Auto DAST..."
									: "Auto DAST HTTP Baseline"}
							</Button>
							{c.lastAutoDastTargetOrigin ? (
								<div className="scan-profile-summary">
									<strong>{c.lastAutoDastTargetOrigin}</strong>
									<span>Last auto target origin used for this project.</span>
								</div>
							) : null}
							<label htmlFor="scan-dast-target-name">
								<span>Target Name</span>
								<TextInput
									id="scan-dast-target-name"
									value={c.dastTargetName}
									onChange={(event) => c.setDastTargetName(event.target.value)}
									disabled={!c.selectedProjectId}
								/>
							</label>
							<label htmlFor="scan-dast-target-origin">
								<span>Target Origin</span>
								<TextInput
									id="scan-dast-target-origin"
									value={c.dastTargetOrigin}
									onChange={(event) =>
										c.setDastTargetOrigin(event.target.value)
									}
									placeholder="Manual target only, for example http://127.0.0.1:5173"
									disabled={!c.selectedProjectId}
								/>
							</label>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void c.handleCreateDastTarget()}
								disabled={!canSaveDastTarget}
								full
							>
								<Plus className="icon" />
								{c.dastLoading ? "Saving Target..." : "Save Target"}
							</Button>
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
							<div className="scan-profile-summary">
								<strong>
									{selectedTarget
										? selectedTarget.normalizedOrigin
										: "No manual DAST target selected"}
								</strong>
								<span>
									{selectedDastProfile
										? selectedDastProfile.description
										: "Use Auto DAST or save a manual target before running a saved-target DAST profile."}
								</span>
							</div>
							<Button
								type="button"
								variant="primary"
								onClick={() => void c.handleTriggerDastRun()}
								disabled={!canStartDast}
								full
							>
								<Play className="icon" />
								{c.dastLoading ? "Running DAST..." : "Start DAST"}
							</Button>
						</div>
					)}
				</div>
			</div>
			{c.showNewProjectModal ? <NewProjectModal /> : null}
			{c.selectedScanRunId ? <ScanReportControls /> : null}
		</section>
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
		<div className="scan-launch-section">
			<div className="scan-launch-section-title">
				<span>Scan Report</span>
			</div>
			<label>
				<span>Report Title</span>
				<input
					value={c.reportTitle}
					onChange={(event) => c.setReportTitle(event.target.value)}
				/>
			</label>
			{(
				[
					[
						"Include False Positives",
						c.includeFalsePositives,
						c.setIncludeFalsePositives,
					],
					["Include Deferred", c.includeDeferred, c.setIncludeDeferred],
					["Include Undecided", c.includeUndecided, c.setIncludeUndecided],
				] as const
			).map(([label, checked, setChecked]) => (
				<label className="scan-checkbox-row" key={label}>
					<input
						type="checkbox"
						checked={checked}
						onChange={(event) => setChecked(event.target.checked)}
					/>
					<span>{label}</span>
				</label>
			))}
			<Button
				type="button"
				variant="primary"
				onClick={() => void c.handleGenerateReport()}
				disabled={c.reportLoading || c.busy}
				full
			>
				{c.reportLoading ? "Generating..." : "Generate Report"}
			</Button>
			{c.reports[0] ? (
				<Button
					type="button"
					variant="secondary"
					onClick={() => {
						c.setSelectedReport(c.reports[0]);
						c.setViewingReport(true);
					}}
					full
				>
					View Latest Report
				</Button>
			) : null}
		</div>
	);
}
