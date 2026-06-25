import { Download, Shield } from "lucide-react";
import { Button, SelectInput } from "../../../ui";
import { useScans } from "../scans-context";

export function DastPanel() {
	const c = useScans();
	const profiles = c.dastProfiles.filter(
		(profile) =>
			profile.enabled &&
			(profile.id === "http-baseline" ||
				c.dastProfileConfigs.some(
					(config) =>
						config.profileId === profile.id &&
						config.targetConfigId === c.selectedDastTargetId &&
						config.enabled,
				)),
	);
	return (
		<div className="detail-section">
			<div className="finding-meta-row">
				<strong>
					<Shield className="icon text-teal-700" /> DAST
				</strong>
			</div>
			{c.dastError ? <p className="badge-failed">{c.dastError}</p> : null}
			<label>
				<span>Target Name</span>
				<input
					value={c.dastTargetName}
					onChange={(event) => c.setDastTargetName(event.target.value)}
				/>
			</label>
			<label>
				<span>Local Target Origin</span>
				<input
					value={c.dastTargetOrigin}
					onChange={(event) => c.setDastTargetOrigin(event.target.value)}
				/>
			</label>
			<Button
				type="button"
				variant="secondary"
				onClick={() => void c.handleCreateDastTarget()}
				disabled={c.dastLoading || !c.dastTargetName || !c.dastTargetOrigin}
				full
			>
				Save DAST Target
			</Button>
			<label htmlFor="dast-target-select">
				<span>Saved Target</span>
				<SelectInput
					id="dast-target-select"
					value={c.selectedDastTargetId}
					onChange={(event) => c.setSelectedDastTargetId(event.target.value)}
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
					onChange={(event) => c.setSelectedDastProfileId(event.target.value)}
				>
					{profiles.map((profile) => (
						<option key={profile.id} value={profile.id}>
							{profile.displayName}
						</option>
					))}
				</SelectInput>
			</label>
			<Button
				type="button"
				variant="primary"
				onClick={() => void c.handleTriggerDastRun()}
				disabled={
					c.dastLoading || !c.selectedDastTargetId || !c.selectedDastProfileId
				}
				full
			>
				{c.dastLoading ? "Running DAST..." : "Run HTTP Baseline"}
			</Button>
			{c.dastRuns.slice(0, 5).map((run) => {
				const expanded = c.expandedDastRunId === run.id;
				const evidence = c.dastRunEvidence[run.id] ?? [];
				const artifacts = c.dastRunArtifacts[run.id] ?? [];
				return (
					<div className="scan-item" key={run.id}>
						<button
							type="button"
							className="scan-item"
							onClick={() => void c.handleToggleDastRun(run.id)}
						>
							<div className="finding-meta-row">
								<strong>{run.profileId}</strong>
								<span className={`scan-status-badge badge-${run.status}`}>
									{run.outcome ?? run.status}
								</span>
							</div>
						</button>
						{expanded ? (
							<div className="detail-section">
								{run.summary ? <p>{run.summary}</p> : null}
								{evidence.map((item) => (
									<small key={item.id}>{item.title}</small>
								))}
								<div className="finding-meta-row">
									{artifacts.map((artifact) => (
										<a
											key={artifact.id}
											href={`/api/dast-runs/${run.id}/artifacts/${artifact.id}`}
											target="_blank"
											rel="noreferrer"
										>
											<Download size={12} /> {artifact.kind}
										</a>
									))}
								</div>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
