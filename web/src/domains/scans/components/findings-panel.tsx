import { SelectInput } from "../../../ui";
import { useScans } from "../scans-context";
import { getSeverityClass, shortPath } from "../scans-utils";

export function FindingsPanel() {
	const c = useScans();
	return (
		<section className="scans-panel scans-findings-col">
			<div className="scans-panel-header">
				<h2>Findings</h2>
				<small>
					{c.displayedFindings.length} findings shown ({c.findings.length}{" "}
					total)
				</small>
			</div>
			<div className="scans-panel-header">
				<div className="finding-meta-row">
					<button
						type="button"
						className="demo-button secondary"
						onClick={() => {
							c.setFindingsViewMode("list");
							c.setSelectedGroupId("");
						}}
					>
						List ({c.findings.length})
					</button>
					<button
						type="button"
						className="demo-button secondary"
						onClick={() => c.setFindingsViewMode("grouped")}
					>
						Grouped ({c.scanGroups.length})
					</button>
				</div>
				{c.findingsViewMode === "grouped" && c.scanGroups.length > 0 ? (
					<label htmlFor="findings-group-select">
						<span>Select Group</span>
						<SelectInput
							id="findings-group-select"
							value={c.selectedGroupId}
							onChange={(event) => c.setSelectedGroupId(event.target.value)}
						>
							<option value="">-- All Groups --</option>
							{c.scanGroups.map((group) => (
								<option key={group.id} value={group.id}>
									[{group.severity.toUpperCase()}] {group.title} (
									{group.findingIds.length})
								</option>
							))}
						</SelectInput>
					</label>
				) : null}
			</div>
			<div className="scans-list">
				{c.displayedFindings.length > 0 ? (
					c.displayedFindings.map((finding) => (
						<button
							type="button"
							key={finding.id}
							className={`finding-item ${c.selectedFindingId === finding.id ? "active" : ""}`}
							onClick={() => {
								c.setSelectedFindingId(finding.id);
								c.setViewingReport(false);
							}}
						>
							<div className="finding-meta-row">
								<span
									className={`severity-badge ${getSeverityClass(finding.severity)}`}
								>
									{finding.severity}
								</span>
								<small>{finding.sourceTool}</small>
								<span
									className={`decision-badge badge-${finding.latestDecision?.decision ?? "open"}`}
								>
									{(finding.latestDecision?.decision ?? "Open").replace(
										"_",
										" ",
									)}
								</span>
							</div>
							<h4 className="finding-title">{finding.title}</h4>
							{finding.primaryLocation?.path ? (
								<div className="finding-loc">
									{shortPath(finding.primaryLocation.path)}
									{finding.primaryLocation.startLine
										? `:${finding.primaryLocation.startLine}`
										: ""}
								</div>
							) : null}
						</button>
					))
				) : (
					<div className="tree-info">Select a scan run to view findings.</div>
				)}
			</div>
		</section>
	);
}
