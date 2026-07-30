import { Activity, Braces, CheckCircle2, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	type ActiveAssessmentRunSummary,
	type BusinessLogicScenarioSummary,
	createThreatModelRun,
	fetchActiveAssessmentRuns,
	fetchBusinessLogicScenarios,
	fetchThreatModelRun,
	fetchThreatModelRuns,
	type ThreatModelRunDetail,
	type ThreatModelRunSummary,
} from "../../api";
import { Button } from "../../ui";
import { SummaryTile } from "./project-detail-sections";

export function SecurityCapabilityPanel({ projectId }: { projectId: string }) {
	const [runs, setRuns] = useState<ThreatModelRunSummary[]>([]);
	const [detail, setDetail] = useState<ThreatModelRunDetail | null>(null);
	const [scenarios, setScenarios] = useState<BusinessLogicScenarioSummary[]>(
		[],
	);
	const [activeRuns, setActiveRuns] = useState<ActiveAssessmentRunSummary[]>(
		[],
	);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextRuns, nextScenarios, nextActiveRuns] = await Promise.all([
				fetchThreatModelRuns(projectId),
				fetchBusinessLogicScenarios(projectId),
				fetchActiveAssessmentRuns(projectId),
			]);
			setRuns(nextRuns);
			setScenarios(nextScenarios);
			setActiveRuns(nextActiveRuns);
			const currentRun = nextRuns.find((run) => run.current);
			setDetail(currentRun ? await fetchThreatModelRun(currentRun.id) : null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [projectId]);
	useEffect(() => {
		void load();
	}, [load]);
	const generate = async () => {
		setCreating(true);
		setError(null);
		try {
			const created = await createThreatModelRun(projectId);
			setDetail(created);
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setCreating(false);
		}
	};
	const statuses = detail?.hypotheses.reduce<Record<string, number>>(
		(output, item) => {
			output[item.status] = (output[item.status] ?? 0) + 1;
			return output;
		},
		{},
	);
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Threat &amp; Business-Logic Capability</h2>
					<p>
						Hypotheses remain separate from confirmed findings until bounded
						executable evidence observes a violation.
					</p>
				</div>
				<Button
					type="button"
					onClick={() => void generate()}
					disabled={loading || creating}
				>
					{creating ? "Generating…" : "Generate model"}
				</Button>
			</div>
			{error ? <p className="form-error">{error}</p> : null}
			{loading ? (
				<p>Loading capability state…</p>
			) : (
				<div className="projects-summary-grid">
					<SummaryTile
						icon={<Braces className="icon" />}
						label="Model Snapshot"
						value={detail?.snapshot?.snapshotHash.slice(0, 18) ?? "not tested"}
					/>
					<SummaryTile
						icon={<Shield className="icon" />}
						label="Hypotheses"
						value={String(detail?.hypotheses.length ?? 0)}
					/>
					<SummaryTile
						icon={<Activity className="icon" />}
						label="Observed"
						value={String(statuses?.observed ?? 0)}
					/>
					<SummaryTile
						icon={<CheckCircle2 className="icon" />}
						label="Business Scenarios"
						value={String(scenarios.length)}
					/>
					<SummaryTile
						icon={<Activity className="icon" />}
						label="ZAP Active"
						value={
							activeRuns.find((run) => run.kind === "zap_active")?.status ??
							"not tested"
						}
					/>
				</div>
			)}
			{runs[0]?.limitations.length ? (
				<p>
					Limitations: {runs[0].limitations.join(" / ")}. Not-tested and
					inconclusive states are not counted as findings.
				</p>
			) : null}
		</section>
	);
}
