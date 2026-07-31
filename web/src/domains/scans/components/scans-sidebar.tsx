import { Link } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { Button } from "../../../ui";
import { readDiffTargetDisplay } from "../diff-target-display";
import { formatScanOutcome } from "../scan-profile-display";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";
import { ActionQueuePanel } from "./action-queue-panel";

export { ScansToolbar } from "./scans-toolbar";

export function ScansSidebar() {
	const c = useScans();
	return (
		<aside className="scans-panel scans-runs-sidebar">
			<ActionQueuePanel />
			<div className="scans-panel-header scans-history-head">
				<div>
					<h2>最近の実行</h2>
					<small className="scans-runs-count">
						選択中のプロジェクトに {c.scanRuns.length} 件
					</small>
				</div>
				{c.selectedProjectId ? (
					<div className="scans-history-actions">
						{c.selectedScanRunId ? (
							<Link
								to="/projects/$projectId/intelligence"
								params={{ projectId: c.selectedProjectId }}
								search={{ scanRunId: c.selectedScanRunId } as never}
								className="scan-history-link"
							>
								<Network className="icon" />
								Intelligence
							</Link>
						) : null}
						<Button
							type="button"
							variant="secondary"
							onClick={() => c.handleSelectScanRun(c.scanRuns[0]?.id ?? "")}
							disabled={!c.scanRuns[0]}
						>
							最新
						</Button>
					</div>
				) : null}
			</div>
			<div className="scans-list runs-list">
				{c.scanRuns.length > 0 ? (
					c.scanRuns.map((run) => (
						<button
							type="button"
							key={run.id}
							className={`scan-item ${c.selectedScanRunId === run.id ? "active" : ""}`}
							onClick={() => c.handleSelectScanRun(run.id)}
						>
							<div className="finding-meta-row">
								<strong>{run.profile}</strong>
								<span
									className={`scan-status-badge badge-${run.status || "queued"}`}
								>
									{formatScanOutcome(run.status || "queued")}
								</span>
							</div>
							<small>{formatDateTime(run.createdAt)}</small>
							{readDiffTargetDisplay(run.metadata) ? (
								<small>{readDiffTargetDisplay(run.metadata)?.label}</small>
							) : null}
						</button>
					))
				) : (
					<div className="tree-info">
						{c.selectedProjectId
							? "このプロジェクトの scan はまだありません。"
							: "scan を開始するには、プロジェクトフォルダを登録または選択してください。"}
					</div>
				)}
			</div>
		</aside>
	);
}
