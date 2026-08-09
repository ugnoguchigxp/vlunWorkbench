import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw } from "lucide-react";
import type {
	ProjectIntelligenceProject,
	ProjectIntelligenceView,
} from "../../api";
import { Button } from "../../ui";
import { formatDateTime } from "../scans/scans-utils";
import { StatusBadge } from "./project-detail-sections";

export function IntelligenceGenerationContext({
	project,
	view,
	scanRunId,
	refreshing,
	onRefresh,
}: {
	project: ProjectIntelligenceProject;
	view: ProjectIntelligenceView;
	scanRunId: string;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	const generation = view.generation;
	return (
		<section className="intelligence-generation-context" aria-busy={refreshing}>
			<div className="intelligence-generation-copy">
				<span>Persisted Intelligence generation</span>
				<div className="intelligence-generation-title">
					<strong title={generation?.generationId ?? undefined}>
						{generation?.generationId ?? "未生成"}
					</strong>
					<StatusBadge status={generation?.status ?? "missing"} />
				</div>
				<small>
					{generation
						? `${formatDateTime(generation.generatedAt)} · source ${view.selectedScan?.profile ?? "unknown"}`
						: "この分析スナップショットにはgenerationがありません。"}
				</small>
			</div>
			<section
				className="intelligence-generation-readiness"
				aria-label="生成データの準備状態"
			>
				<ReadinessItem
					label="Structure"
					status={view.readiness.codeStructure.status}
				/>
				<ReadinessItem
					label="Evidence"
					status={view.readiness.evidenceGraph.status}
				/>
				<ReadinessItem
					label="Handoff"
					status={view.readiness.ontologyHandoff.status}
				/>
			</section>
			<div className="project-section-actions">
				<Button
					type="button"
					variant="secondary"
					onClick={onRefresh}
					disabled={refreshing}
				>
					<RefreshCw className={`icon${refreshing ? " spinning" : ""}`} />
					{refreshing ? "更新中…" : "Intelligenceを更新"}
				</Button>
				<Link
					to="/scans"
					search={{ projectId: project.id, scanRunId }}
					className="project-open-link"
				>
					Scan Workspaceで証跡を見る
					<ChevronRight className="icon" />
				</Link>
			</div>
		</section>
	);
}

function ReadinessItem({ label, status }: { label: string; status: string }) {
	return (
		<span className={`intelligence-readiness-pill status-${status}`}>
			{label}
			<strong>{status}</strong>
		</span>
	);
}
