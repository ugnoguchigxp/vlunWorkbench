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
				<Shield className="icon text-teal-700" /> サンドボックス再現確認
			</h3>
			<p>隔離された Docker コンテナ内で検証チェックを実行します。</p>
			{c.reproError ? <p className="badge-failed">{c.reproError}</p> : null}
			{c.reproProfiles.length > 0 ? (
				<div className="decision-panel">
					<label htmlFor="reproduction-profile-select">
						<span>制限付き検証プロファイル</span>
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
									{profile.isApplicable ? "" : " (適用不可)"}
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
						サンドボックス実行
					</Button>
				</div>
			) : (
				<p>利用可能な再現確認プロファイルはありません。</p>
			)}
			<RunCardList
				title="サンドボックス実行履歴"
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
				emptyText="この finding には再現確認の実行履歴がありません。"
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
				<Shield className="icon text-teal-700" /> 動的サンドボックス検証
			</h3>
			<p>
				プロジェクト定義の検証チェックを制限付き Docker
				サンドボックスで実行します。
			</p>
			{c.dynamicError ? <p className="badge-failed">{c.dynamicError}</p> : null}
			{c.dynamicProfiles.length > 0 ? (
				<div className="decision-panel">
					<label htmlFor="dynamic-profile-select">
						<span>動的検証プロファイル</span>
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
							Docker
							サンドボックス内でプロジェクトスクリプトを実行することに同意します。
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
						サンドボックス実行
					</Button>
				</div>
			) : (
				<p>動的検証プロファイルは設定されていません。</p>
			)}
			<RunCardList
				title="動的サンドボックス実行履歴"
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
				emptyText="この finding には動的検証の実行履歴がありません。"
			/>
		</div>
	);
}
