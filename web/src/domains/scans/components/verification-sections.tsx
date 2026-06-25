import { RefreshCw, Shield } from "lucide-react";
import { Button, SelectInput } from "../../../ui";
import { useScans } from "../scans-context";
import { RunCardList } from "./run-card-list";

export function VerificationSections() {
	return (
		<>
			<ReproductionSection />
			<DynamicSection />
		</>
	);
}

function ReproductionSection() {
	const c = useScans();
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<Shield className="icon text-teal-700" /> Sandbox Reproduction
			</h3>
			<p>Run verification checks in an isolated Docker container.</p>
			{c.reproError ? <p className="badge-failed">{c.reproError}</p> : null}
			{c.reproProfiles.length > 0 ? (
				<div className="decision-panel">
					<label htmlFor="reproduction-profile-select">
						<span>Bounded Verification Profile</span>
						<SelectInput
							id="reproduction-profile-select"
							value={c.selectedReproProfile}
							onChange={(event) =>
								c.setSelectedReproProfile(event.target.value)
							}
						>
							{c.reproProfiles.map((profile) => (
								<option
									key={profile.id}
									value={profile.id}
									disabled={!profile.isApplicable}
								>
									{profile.displayName}
									{profile.isApplicable ? "" : " (Not Applicable)"}
								</option>
							))}
						</SelectInput>
					</label>
					<Button
						type="button"
						variant="primary"
						onClick={() => void c.handleTriggerReproduction()}
						disabled={c.reproLoading || c.busy || !c.selectedReproProfile}
					>
						{c.reproLoading ? (
							<RefreshCw className="icon animate-spin" />
						) : (
							<Shield className="icon" />
						)}
						Trigger Sandbox Run
					</Button>
				</div>
			) : (
				<p>No reproduction profiles available.</p>
			)}
			<RunCardList
				title="Sandbox Run History"
				runs={c.reproRuns}
				expandedRunId={c.expandedReproRunId}
				artifactsByRun={c.reproRunArtifacts}
				evidenceByRun={c.reproRunEvidence}
				onToggle={(runId) => void c.handleToggleReproRun(runId)}
				getProfileLabel={(profileId) =>
					c.reproProfiles.find((profile) => profile.id === profileId)
						?.displayName ?? profileId
				}
				artifactHref={(runId, artifactId) =>
					`/api/reproduction-runs/${runId}/artifacts/${artifactId}`
				}
				emptyText="No reproduction runs recorded for this finding."
			/>
		</div>
	);
}

function DynamicSection() {
	const c = useScans();
	const selected = c.dynamicProfiles.find(
		(profile) => profile.profileId === c.selectedDynamicProfile,
	);
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<Shield className="icon text-teal-700" /> Dynamic Sandbox Verification
			</h3>
			<p>
				Run project-defined verification checks in a bounded Docker sandbox.
			</p>
			{c.dynamicError ? <p className="badge-failed">{c.dynamicError}</p> : null}
			{c.dynamicProfiles.length > 0 ? (
				<div className="decision-panel">
					<label htmlFor="dynamic-profile-select">
						<span>Dynamic Verification Profile</span>
						<SelectInput
							id="dynamic-profile-select"
							value={c.selectedDynamicProfile}
							onChange={(event) => {
								c.setSelectedDynamicProfile(event.target.value);
								c.setAllowProjectScriptsConsent(false);
							}}
						>
							{c.dynamicProfiles.map((profile) => (
								<option
									key={profile.id}
									value={profile.profileId}
									disabled={!profile.enabled}
								>
									{profile.displayName} ({profile.dynamicKind.toUpperCase()})
								</option>
							))}
						</SelectInput>
					</label>
					{selected ? <code>{selected.commandJson.join(" ")}</code> : null}
					{selected?.allowProjectScripts ? (
						<label>
							<input
								type="checkbox"
								checked={c.allowProjectScriptsConsent}
								onChange={(event) =>
									c.setAllowProjectScriptsConsent(event.target.checked)
								}
							/>{" "}
							I consent to executing project scripts in the Docker sandbox.
						</label>
					) : null}
					<Button
						type="button"
						variant="primary"
						onClick={() => void c.handleTriggerDynamic()}
						disabled={
							c.dynamicLoading ||
							c.busy ||
							!c.selectedDynamicProfile ||
							!!(selected?.allowProjectScripts && !c.allowProjectScriptsConsent)
						}
					>
						{c.dynamicLoading ? (
							<RefreshCw className="icon animate-spin" />
						) : (
							<Shield className="icon" />
						)}
						Trigger Sandbox Run
					</Button>
				</div>
			) : (
				<p>No dynamic verification profiles configured.</p>
			)}
			<RunCardList
				title="Dynamic Sandbox Run History"
				runs={c.dynamicRuns}
				expandedRunId={c.expandedDynamicRunId}
				artifactsByRun={c.dynamicRunArtifacts}
				evidenceByRun={c.dynamicRunEvidence}
				onToggle={(runId) => void c.handleToggleDynamicRun(runId)}
				getProfileLabel={(profileId) =>
					c.dynamicProfiles.find((profile) => profile.profileId === profileId)
						?.displayName ?? profileId
				}
				artifactHref={(runId, artifactId) =>
					`/api/dynamic-runs/${runId}/artifacts/${artifactId}`
				}
				emptyText="No dynamic verification runs recorded for this finding."
			/>
		</div>
	);
}
