import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { ScanRun } from "../../api";
import { Button } from "../../ui";
import {
	formatScanOutcome,
	getProfileDisplay,
} from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";
import type {
	ProjectOverviewAction,
	ProjectOverviewTone,
} from "./project-overview-view-model";

export function OverviewStatus({
	label,
	tone,
}: {
	label: string;
	tone: ProjectOverviewTone;
}) {
	return (
		<span className={`project-overview-status tone-${tone}`} role="status">
			<span aria-hidden="true" className="project-overview-status-dot" />
			{label}
		</span>
	);
}

export function OverviewAction({
	action,
	label,
	projectId,
	scanRunId,
	refreshing,
	onRefreshAnalysis,
}: {
	action: ProjectOverviewAction;
	label: string;
	projectId: string;
	scanRunId: string | null;
	refreshing: boolean;
	onRefreshAnalysis: () => void;
}) {
	if (action === "generate_intelligence" || action === "retry_intelligence") {
		return (
			<Button
				type="button"
				variant="primary"
				className="project-overview-primary-action"
				onClick={onRefreshAnalysis}
				disabled={refreshing || !scanRunId}
			>
				<RefreshCw className={refreshing ? "icon animate-spin" : "icon"} />
				{refreshing ? "生成中…" : label}
			</Button>
		);
	}
	if (action === "open_intelligence") {
		return (
			<Link
				to="/projects/$projectId/intelligence"
				params={{ projectId }}
				search={{ scanRunId: scanRunId ?? undefined }}
				className="project-open-link project-overview-primary-action"
			>
				{label}
				<ChevronRight className="icon" />
			</Link>
		);
	}
	return (
		<Link
			to="/scans"
			search={{
				projectId,
				scanRunId:
					action === "open_scan" ? (scanRunId ?? undefined) : undefined,
			}}
			className="project-open-link project-overview-primary-action"
		>
			{label}
			<ChevronRight className="icon" />
		</Link>
	);
}

export function RecentScanTable({
	projectId,
	scanRuns,
}: {
	projectId: string;
	scanRuns: ScanRun[];
}) {
	if (scanRuns.length === 0) {
		return (
			<div className="projects-empty compact">スキャン履歴はありません。</div>
		);
	}
	return (
		<div className="project-overview-table-wrap">
			<table className="project-overview-table" aria-label="最近のスキャン">
				<thead>
					<tr>
						<th>プロファイル</th>
						<th>状態</th>
						<th>実行日時</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{scanRuns.slice(0, 5).map((run) => {
						const profileName = getProfileDisplay(
							run.profile,
							run.profile,
							"",
						).name;
						const executedAt = formatDateTime(run.completedAt ?? run.createdAt);
						return (
							<tr key={run.id}>
								<td>{profileName}</td>
								<td>
									<span
										className={`project-overview-run-status status-${run.status}`}
									>
										{formatScanOutcome(run.status)}
									</span>
								</td>
								<td>{executedAt}</td>
								<td>
									<Link
										to="/scans"
										search={{ projectId, scanRunId: run.id }}
										aria-label={`${profileName}（${executedAt}）のスキャンを開く`}
									>
										開く
									</Link>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
