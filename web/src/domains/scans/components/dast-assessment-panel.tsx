import { KeyRound, Play, Radar, RefreshCw, ShieldOff } from "lucide-react";
import { Button, SelectInput, TextInput } from "../../../ui";
import type { DastCoverageSummary } from "../../../api";
import { useScans } from "../scans-context";

export function DastAssessmentPanel() {
	const c = useScans();
	const selectedProfile = c.dastProfiles.find(
		(profile) => profile.id === c.selectedDastProfileId,
	);
	const authenticated = selectedProfile?.requiresAuth === true;
	const targetAuthContexts = c.dastAuthContexts.filter(
		(context) => context.targetConfigId === c.selectedDastTargetId,
	);
	const selectedAuth = targetAuthContexts.find(
		(context) => context.id === c.selectedDastAuthContextId,
	);
	const canRun =
		Boolean(c.selectedProjectId && c.selectedDastProfileId) &&
		(!authenticated ||
			Boolean(
				c.selectedDastTargetId &&
					selectedAuth?.status === "active" &&
					selectedAuth.targetConfigId === c.selectedDastTargetId &&
					c.dastIdentityRole.trim().length > 0,
			));

	return (
		<section className="dast-assessment-panel" aria-label="DAST実行とcoverage">
			<header>
				<div>
					<span className="eyebrow">Runtime assessment</span>
					<h2>DAST coverage / verdict</h2>
				</div>
				<p>
					finding件数と走査完了度を分離し、未走査・通信失敗・認証失敗を合格表示しません。
				</p>
			</header>

			<div className="dast-control-grid">
				<label htmlFor="dast-profile">
					<span>DASTプロファイル</span>
					<SelectInput
						id="dast-profile"
						value={c.selectedDastProfileId}
						onChange={(event) => c.setSelectedDastProfileId(event.target.value)}
						disabled={!c.selectedProjectId || c.dastLoading}
					>
						{c.dastProfiles
							.filter((profile) => profile.enabled)
							.map((profile) => (
								<option key={profile.id} value={profile.id}>
									{profile.displayName}
									{profile.id === "http-baseline" ? "（旧smoke）" : ""}
								</option>
							))}
					</SelectInput>
				</label>
				<label htmlFor="dast-target">
					<span>保存済みtarget</span>
					<SelectInput
						id="dast-target"
						value={c.selectedDastTargetId}
						onChange={(event) => c.setSelectedDastTargetId(event.target.value)}
						disabled={c.dastLoading}
					>
						<option value="">自動起動targetを使用</option>
						{c.dastTargets.map((target) => (
							<option key={target.id} value={target.id}>
								{target.name} — {target.normalizedOrigin}
							</option>
						))}
					</SelectInput>
				</label>
				<label htmlFor="dast-target-origin">
					<span>手動target origin（任意）</span>
					<TextInput
						id="dast-target-origin"
						type="url"
						value={c.dastTargetOrigin}
						onChange={(event) => c.setDastTargetOrigin(event.target.value)}
						placeholder="http://127.0.0.1:3000"
						disabled={c.dastLoading}
					/>
				</label>
				<div className="dast-control-actions">
					<Button
						type="button"
						variant="secondary"
						onClick={() => void c.handleCreateDastTarget()}
						disabled={c.dastLoading || !c.dastTargetOrigin.trim()}
					>
						targetを保存
					</Button>
					<Button
						type="button"
						variant="primary"
						onClick={() => void c.handleTriggerDastRun()}
						disabled={c.dastLoading || !canRun}
					>
						<Play className="icon" />
						{c.dastLoading ? "実行中" : "read-only DASTを実行"}
					</Button>
				</div>
			</div>

			{authenticated ? (
				<div className="dast-auth-panel">
					<div className="dast-auth-heading">
						<KeyRound className="icon" />
						<div>
							<strong>認証済みread-only</strong>
							<small>
								Bearer tokenは暗号化保存され、作成・更新後に再表示されません。
							</small>
						</div>
					</div>
					<div className="dast-control-grid">
						<label htmlFor="dast-auth-context">
							<span>認証コンテキスト</span>
							<SelectInput
								id="dast-auth-context"
								value={c.selectedDastAuthContextId}
								onChange={(event) => {
									c.setSelectedDastAuthContextId(event.target.value);
									const context = c.dastAuthContexts.find(
										(item) => item.id === event.target.value,
									);
									if (context) c.setDastIdentityRole(context.identityRole);
								}}
							>
								<option value="">新規作成</option>
								{targetAuthContexts.map((context) => (
									<option key={context.id} value={context.id}>
										{context.label} — {context.identityRole} ({context.status})
									</option>
								))}
							</SelectInput>
						</label>
						<label htmlFor="dast-identity-role">
							<span>Identity role</span>
							<TextInput
								id="dast-identity-role"
								value={c.dastIdentityRole}
								onChange={(event) => c.setDastIdentityRole(event.target.value)}
								autoComplete="off"
							/>
						</label>
						<label htmlFor="dast-auth-status-path">
							<span>認証確認path</span>
							<TextInput
								id="dast-auth-status-path"
								value={c.dastAuthStatusPath}
								onChange={(event) =>
									c.setDastAuthStatusPath(event.target.value)
								}
								placeholder="/api/me"
							/>
						</label>
						<label htmlFor="dast-auth-label">
							<span>Label</span>
							<TextInput
								id="dast-auth-label"
								value={c.dastAuthLabel}
								onChange={(event) => c.setDastAuthLabel(event.target.value)}
							/>
						</label>
						<label className="dast-secret-field" htmlFor="dast-bearer-token">
							<span>Bearer token（保存後は消去）</span>
							<TextInput
								id="dast-bearer-token"
								type="password"
								value={c.dastBearerToken}
								onChange={(event) => c.setDastBearerToken(event.target.value)}
								autoComplete="new-password"
							/>
						</label>
						<div className="dast-control-actions">
							<Button
								type="button"
								variant="secondary"
								onClick={() => void c.handleCreateDastAuthContext()}
								disabled={
									c.dastLoading || !c.selectedDastTargetId || !c.dastBearerToken
								}
							>
								<KeyRound className="icon" />
								作成
							</Button>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void c.handleRotateDastAuthContext()}
								disabled={
									c.dastLoading ||
									!c.selectedDastAuthContextId ||
									selectedAuth?.authKind !== "bearer_token" ||
									!c.dastBearerToken
								}
							>
								<RefreshCw className="icon" />
								rotate
							</Button>
							<Button
								type="button"
								variant="destructive"
								onClick={() => void c.handleRevokeDastAuthContext()}
								disabled={c.dastLoading || !c.selectedDastAuthContextId}
							>
								<ShieldOff className="icon" />
								revoke
							</Button>
						</div>
					</div>
				</div>
			) : null}

			{c.dastError ? (
				<p className="badge-failed" role="alert">
					{c.dastError}
				</p>
			) : null}
			{c.lastAutoDastTargetOrigin ? (
				<p className="dast-limitation">
					直近の自動起動target: {c.lastAutoDastTargetOrigin}
				</p>
			) : null}

			<div className="dast-run-list">
				{c.dastRuns.length === 0 ? (
					<p className="dast-limitation">DAST runはまだありません。</p>
				) : (
					c.dastRuns.slice(0, 20).map((run) => {
						const coverage = coverageSummary(run.coverageSummary);
						const expanded = c.expandedDastRunId === run.id;
						return (
							<article className="dast-run-card" key={run.id}>
								<button
									type="button"
									className="dast-run-summary"
									onClick={() => void c.handleToggleDastRun(run.id)}
									aria-expanded={expanded}
								>
									<Radar className="icon" />
									<span>
										<strong>{run.profileId}</strong>
										<small>{run.targetOrigin}</small>
									</span>
									<StatusBadge
										label={run.verdict ?? "unknown_legacy"}
										status={run.coverageStatus ?? "gap"}
									/>
									<span>
										{coverage
											? `${coverage.attemptedRouteCount}/${coverage.actionableKnownRouteCount} routes`
											: "coverage unknown"}
									</span>
								</button>
								{expanded ? (
									<div className="dast-run-detail">
										<div className="dast-metric-grid">
											<Metric label="Known" value={coverage?.knownRouteCount} />
											<Metric
												label="Attempted"
												value={coverage?.attemptedRouteCount}
											/>
											<Metric
												label="Succeeded"
												value={coverage?.successfulRouteCount}
											/>
											<Metric
												label="Not tested"
												value={coverage?.notTestedRouteCount}
											/>
											<Metric label="Requests" value={coverage?.requestCount} />
											<Metric label="Depth" value={coverage?.maxDepthReached} />
										</div>
										<p>
											制約:{" "}
											{run.limitationCodes.length
												? run.limitationCodes.join(", ")
												: "記録なし"}
										</p>
										<RouteTable routes={c.dastRunRoutes[run.id] ?? []} />
									</div>
								) : null}
							</article>
						);
					})
				)}
			</div>
		</section>
	);
}

function coverageSummary(
	value: DastCoverageSummary | Record<string, never>,
): DastCoverageSummary | null {
	return typeof (value as Partial<DastCoverageSummary>).attemptedRouteCount ===
		"number"
		? (value as DastCoverageSummary)
		: null;
}

function StatusBadge({
	label,
	status,
}: {
	label: string;
	status: "covered" | "partial" | "gap";
}) {
	return <span className={`dast-status-badge status-${status}`}>{label}</span>;
}

function Metric({
	label,
	value,
}: {
	label: string;
	value: number | undefined;
}) {
	return (
		<div>
			<small>{label}</small>
			<strong>{value ?? "—"}</strong>
		</div>
	);
}

function RouteTable({
	routes,
}: {
	routes: Array<{
		id: string;
		method: string;
		path: string;
		state: string;
		statusCode: number | null;
		limitationCode: string | null;
	}>;
}) {
	if (routes.length === 0)
		return <p className="dast-limitation">route inventoryはありません。</p>;
	return (
		<div className="dast-route-table-wrap">
			<table className="dast-route-table">
				<thead>
					<tr>
						<th>Method</th>
						<th>Path</th>
						<th>State</th>
						<th>Status</th>
						<th>Limitation</th>
					</tr>
				</thead>
				<tbody>
					{routes.slice(0, 50).map((route) => (
						<tr key={route.id}>
							<td>{route.method}</td>
							<td>{route.path}</td>
							<td>{route.state}</td>
							<td>{route.statusCode ?? "—"}</td>
							<td>{route.limitationCode ?? "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
