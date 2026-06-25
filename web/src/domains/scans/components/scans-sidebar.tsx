import { Sparkles } from "lucide-react";
import { Button, SelectInput } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";
import { DastPanel } from "./dast-panel";

export function ScansSidebar() {
	const c = useScans();
	const profile = c.profiles.find((item) => item.id === c.selectedProfileId);
	return (
		<section className="scans-panel">
			<div className="scans-panel-header">
				<h2>Scans</h2>
				<label htmlFor="scans-project-select">
					<span>Select Project</span>
					<SelectInput
						id="scans-project-select"
						value={c.selectedProjectId}
						onChange={(event) => c.setSelectedProjectId(event.target.value)}
					>
						<option value="" disabled>
							-- Select Project --
						</option>
						{c.projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.name}
							</option>
						))}
					</SelectInput>
				</label>
				{c.selectedProjectId ? (
					<Button
						type="button"
						variant="secondary"
						onClick={() => c.setShowRunScanForm(!c.showRunScanForm)}
						disabled={c.isScanning}
						full
					>
						<Sparkles className="icon text-indigo-600" />
						{c.showRunScanForm
							? "Hide Run Scan Settings"
							: "Run New Scan Profile"}
					</Button>
				) : null}
			</div>
			{c.showRunScanForm && c.selectedProjectId ? (
				<div className="scans-panel-header">
					<label htmlFor="scans-profile-select">
						<span>Scan Profile</span>
						<SelectInput
							id="scans-profile-select"
							value={c.selectedProfileId}
							onChange={(event) => c.setSelectedProfileId(event.target.value)}
						>
							{c.profiles.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</SelectInput>
					</label>
					{profile ? (
						<small>
							{profile.description} Tools:{" "}
							{profile.tools
								.map((tool: { displayName: string }) => tool.displayName)
								.join(", ")}
						</small>
					) : null}
					<label>
						<span>Timeout (sec)</span>
						<input
							type="number"
							value={c.timeoutSec}
							onChange={(event) => c.setTimeoutSec(Number(event.target.value))}
						/>
					</label>
					<label>
						<input
							type="checkbox"
							checked={c.continueOnToolFailure}
							onChange={(event) =>
								c.setContinueOnToolFailure(event.target.checked)
							}
						/>{" "}
						Continue on Fail
					</label>
					<Button
						type="button"
						variant="primary"
						onClick={() => void c.handleStartScanProfile()}
						disabled={c.isScanning}
						full
					>
						{c.isScanning ? "Running Scan Profile..." : "Start Profile Scan"}
					</Button>
				</div>
			) : null}
			{c.selectedProjectId ? (
				<div className="scans-panel-header">
					<DastPanel />
				</div>
			) : null}
			<div className="scans-list">
				{c.scanRuns.length > 0 ? (
					c.scanRuns.map((run) => (
						<button
							type="button"
							key={run.id}
							className={`scan-item ${c.selectedScanRunId === run.id ? "active" : ""}`}
							onClick={() => c.setSelectedScanRunId(run.id)}
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
					<div className="tree-info">No scans found for this project.</div>
				)}
			</div>
			{c.selectedScanRunId ? <ScanReportControls /> : null}
		</section>
	);
}

function ScanReportControls() {
	const c = useScans();
	return (
		<div className="scans-panel-header">
			<h2>Scan Report</h2>
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
				<label key={label}>
					<input
						type="checkbox"
						checked={checked}
						onChange={(event) => setChecked(event.target.checked)}
					/>{" "}
					{label}
				</label>
			))}
			<Button
				type="button"
				variant="primary"
				onClick={() => void c.handleGenerateReport()}
				disabled={c.reportLoading || c.busy}
			>
				{c.reportLoading ? "Generating..." : "Generate"}
			</Button>
			{c.reports[0] ? (
				<Button
					type="button"
					variant="secondary"
					onClick={() => {
						c.setSelectedReport(c.reports[0]);
						c.setViewingReport(true);
					}}
				>
					View Latest
				</Button>
			) : null}
		</div>
	);
}
