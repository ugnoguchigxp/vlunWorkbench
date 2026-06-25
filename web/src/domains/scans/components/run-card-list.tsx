import { Download } from "lucide-react";
import { durationSeconds, formatDateTime } from "../scans-utils";

type Artifact = { id: string; kind: string; format?: string };
type Evidence = { id: string; title: string; snippet?: string | null };
type Run = {
	id: string;
	profileId: string;
	status: string;
	outcome: string | null;
	runner: string;
	commandJson: string[] | null;
	exitCode: number | null;
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	createdAt: string;
};

export function RunCardList({
	artifactHref,
	artifactsByRun,
	emptyText,
	evidenceByRun,
	expandedRunId,
	getProfileLabel,
	onToggle,
	runs,
	title,
}: {
	artifactHref: (runId: string, artifactId: string) => string;
	artifactsByRun: Record<string, Artifact[]>;
	emptyText: string;
	evidenceByRun: Record<string, Evidence[]>;
	expandedRunId: string | null;
	getProfileLabel: (profileId: string) => string;
	onToggle: (runId: string) => void;
	runs: Run[];
	title: string;
}) {
	if (runs.length === 0) return <p className="tree-info">{emptyText}</p>;
	return (
		<div className="detail-section">
			<h4 className="detail-section-title">
				{title} ({runs.length})
			</h4>
			{runs.map((run) => {
				const expanded = expandedRunId === run.id;
				const artifacts = artifactsByRun[run.id] ?? [];
				const evidence = evidenceByRun[run.id] ?? [];
				return (
					<div className="scan-item" key={run.id}>
						<button
							type="button"
							className="scan-item"
							onClick={() => onToggle(run.id)}
						>
							<div className="finding-meta-row">
								<strong>{getProfileLabel(run.profileId)}</strong>
								<span className={`scan-status-badge badge-${run.status}`}>
									{run.status}
								</span>
							</div>
							<small>
								{formatDateTime(run.createdAt)}
								{run.outcome ? ` / ${run.outcome.replace(/_/g, " ")}` : ""}
							</small>
						</button>
						{expanded ? (
							<div className="detail-section">
								<div className="review-meta">
									<span>Runner: {run.runner}</span>
									{run.exitCode !== null ? (
										<span>Exit: {run.exitCode}</span>
									) : null}
									{durationSeconds(
										run.startedAt,
										run.createdAt,
										run.completedAt,
									) ? (
										<span>
											Duration:{" "}
											{durationSeconds(
												run.startedAt,
												run.createdAt,
												run.completedAt,
											)}
										</span>
									) : null}
								</div>
								{run.summary ? <p>{run.summary}</p> : null}
								{run.commandJson ? (
									<pre className="remediation-box">
										<code>{run.commandJson.join(" ")}</code>
									</pre>
								) : null}
								{run.errorMessage ? (
									<p className="badge-failed">Error: {run.errorMessage}</p>
								) : null}
								{evidence.map((item) => (
									<div className="assessment-card" key={item.id}>
										<strong>{item.title}</strong>
										{item.snippet ? (
											<pre className="remediation-box">
												<code>{item.snippet}</code>
											</pre>
										) : null}
									</div>
								))}
								<div className="finding-meta-row">
									{artifacts.map((artifact) => (
										<a
											href={artifactHref(run.id, artifact.id)}
											key={artifact.id}
											rel="noreferrer"
											target="_blank"
										>
											<Download size={12} /> {artifact.kind}
											{artifact.format ? ` (${artifact.format})` : ""}
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
