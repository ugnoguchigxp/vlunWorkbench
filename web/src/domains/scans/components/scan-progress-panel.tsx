import {
	Check,
	CircleSlash2,
	Clock3,
	LoaderCircle,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ScanEvent, ScanProfile, ScanRun } from "../../../api";
import {
	buildScanProgressModel,
	isActiveScanRun,
	type ScanProgressItem,
} from "../scan-progress-model";

const stepStateLabels: Record<ScanProgressItem["state"], string> = {
	waiting: "待機",
	running: "実行中",
	completed: "完了",
	failed: "失敗",
	skipped: "スキップ",
	not_applicable: "対象外",
	blocked: "ブロック",
};

function formatTime(value: string): string {
	return new Intl.DateTimeFormat("ja-JP", {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function formatElapsed(startedAt: string | null, now: number): string | null {
	if (!startedAt) return null;
	const seconds = Math.max(
		0,
		Math.floor((now - new Date(startedAt).getTime()) / 1000),
	);
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
}

function StepIcon({ state }: { state: ScanProgressItem["state"] }) {
	if (state === "completed") return <Check aria-hidden="true" />;
	if (state === "running") return <LoaderCircle aria-hidden="true" />;
	if (state === "failed") return <X aria-hidden="true" />;
	if (state === "blocked") return <TriangleAlert aria-hidden="true" />;
	if (state === "skipped" || state === "not_applicable") {
		return <CircleSlash2 aria-hidden="true" />;
	}
	return <Clock3 aria-hidden="true" />;
}

export function ScanProgressPanel({
	scan,
	profile,
	events,
}: {
	scan: ScanRun | null;
	profile: ScanProfile | null;
	events: readonly ScanEvent[];
}) {
	const model = buildScanProgressModel({ scan, profile, events });
	const [now, setNow] = useState(() => Date.now());
	const progressStartedAt = model?.scan.startedAt ?? null;
	const progressActive = model ? isActiveScanRun(model.scan) : false;
	useEffect(() => {
		if (!progressStartedAt || !progressActive) return;
		setNow(Date.now());
		const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000);
		return () => globalThis.clearInterval(timer);
	}, [progressActive, progressStartedAt]);
	if (!model) return null;

	const elapsed = formatElapsed(
		model.scan.startedAt,
		isActiveScanRun(model.scan)
			? now
			: new Date(model.scan.completedAt ?? model.scan.updatedAt).getTime(),
	);
	const current = model.current;
	const next = model.items.find((item) => item.state === "waiting") ?? null;
	const focusStep = current ?? (isActiveScanRun(model.scan) ? next : null);
	return (
		<section className="workspace-scan-progress" aria-label="スキャン進捗">
			<header className="workspace-scan-progress-header">
				<div>
					<span>スキャンの進捗</span>
					<strong>{profile?.name ?? model.scan.profile}</strong>
				</div>
				<div className="workspace-scan-progress-meta">
					<span className={`workspace-scan-status ${model.scan.status}`}>
						{model.statusLabel}
					</span>
					<div>
						{elapsed ? <span>経過 {elapsed}</span> : null}
						<time dateTime={model.scan.startedAt ?? model.scan.createdAt}>
							{model.scan.startedAt ? "開始" : "受付"}{" "}
							{formatTime(model.scan.startedAt ?? model.scan.createdAt)}
						</time>
					</div>
				</div>
			</header>

			<div className="workspace-scan-progress-summary">
				<div className="workspace-scan-overall-progress">
					<span>全体進捗</span>
					<strong>
						終了した工程 {model.terminalCount} / {model.items.length}
					</strong>
					<div
						className="workspace-scan-progress-track"
						role="progressbar"
						aria-label="スキャン全体の進捗"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={model.percentage}
					>
						<span style={{ width: `${model.percentage}%` }} />
					</div>
				</div>
				<div className="workspace-scan-current-step" aria-live="polite">
					<span>
						{current
							? "現在の工程内容"
							: isActiveScanRun(model.scan)
								? "次の工程内容"
								: "完了時の工程状態"}
					</span>
					{focusStep ? (
						<>
							<strong>{focusStep.name}</strong>
							<ul>
								{focusStep.purpose.map((purpose) => (
									<li key={purpose}>{purpose}</li>
								))}
							</ul>
							{current ? (
								<LoaderCircle
									className="workspace-scan-current-spinner"
									aria-hidden="true"
								/>
							) : null}
						</>
					) : (
						<strong>
							{model.scan.status === "queued"
								? "スキャン開始を待っています"
								: isActiveScanRun(model.scan)
									? "次の工程を準備しています"
									: "すべての工程が終了しました"}
						</strong>
					)}
				</div>
			</div>

			{model.loadingSteps ? (
				<p className="workspace-scan-progress-loading">
					実行計画を確定しています。確定したスキャナー工程から順次追加します。
				</p>
			) : null}
			<ol
				className="workspace-scan-progress-steps"
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: The horizontally scrollable step list needs a keyboard focus target. */
				tabIndex={0}
				aria-label="スキャン工程一覧"
			>
				{model.items.map((item, index) => (
					<li key={item.stepId} className={`state-${item.state}`}>
						<span className="workspace-scan-step-number">{index + 1}</span>
						<span className="workspace-scan-step-icon">
							<StepIcon state={item.state} />
						</span>
						<strong>{item.name}</strong>
						<span>{stepStateLabels[item.state]}</span>
					</li>
				))}
			</ol>
			{model.latestUpdate ? (
				<p className="workspace-scan-progress-latest">
					直近の更新: {model.latestUpdate}
				</p>
			) : null}
		</section>
	);
}
