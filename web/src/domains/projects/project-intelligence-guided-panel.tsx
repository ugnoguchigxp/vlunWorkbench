import {
	Check,
	ChevronLeft,
	ChevronRight,
	Circle,
	RotateCcw,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { Finding, FindingDecision } from "../../api";
import { Button, SelectInput, TextArea } from "../../ui";
import { buildDecisionWorkflow } from "../scans/decision-workflow";
import { IntelligenceFindingDetail } from "./project-intelligence-finding-detail";
import {
	buildGuidedVisibleQueue,
	countGuidedProgress,
	GUIDED_DECISION_ACTIONS,
	GUIDED_REASON_OPTIONS,
	type GuidedDecision,
} from "./project-intelligence-workspace-model";
import type { FindingDetail } from "./use-intelligence-workspace-data";

type ResourceStatus = "idle" | "loading" | "loaded" | "failed";

export function IntelligenceGuidedPanel({
	projectId,
	scanRunId,
	exportPayload,
	findings,
	findingsStatus,
	findingsError,
	onReloadFindings,
	details,
	detailStatus,
	detailErrors,
	onLoadFinding,
	onSaveDecision,
}: {
	projectId: string;
	scanRunId: string;
	exportPayload: StaticIntelligenceExportV1;
	findings: Finding[];
	findingsStatus: ResourceStatus;
	findingsError: string | null;
	onReloadFindings: () => void;
	details: Record<string, FindingDetail>;
	detailStatus: Record<string, ResourceStatus>;
	detailErrors: Record<string, string | null>;
	onLoadFinding: (findingId: string, force?: boolean) => Promise<void>;
	onSaveDecision: (
		findingId: string,
		input: {
			decision: GuidedDecision;
			reason: FindingDecision["reason"];
			comment?: string;
			linkedReviewId?: string;
		},
	) => Promise<FindingDecision>;
}) {
	const [scope, setScope] = useState<"undecided" | "all">("undecided");
	const [severity, setSeverity] = useState("all");
	const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
		null,
	);
	const [pinnedFindingId, setPinnedFindingId] = useState<string | null>(null);
	const [pendingDecision, setPendingDecision] = useState<GuidedDecision | null>(
		null,
	);
	const [reason, setReason] = useState<FindingDecision["reason"] | "">("");
	const [comment, setComment] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const queue = useMemo(
		() =>
			buildGuidedVisibleQueue(findings, {
				scope,
				severity,
				pinnedFindingId,
			}),
		[findings, pinnedFindingId, scope, severity],
	);
	const progress = useMemo(() => countGuidedProgress(findings), [findings]);
	const selectedIndex = queue.findIndex(
		(finding) => finding.id === selectedFindingId,
	);
	const selectedFinding = selectedIndex >= 0 ? queue[selectedIndex] : null;
	const detail = selectedFinding ? (details[selectedFinding.id] ?? null) : null;
	const workflow = detail
		? buildDecisionWorkflow({
				finding: detail.finding,
				evidence: detail.evidence,
				latestDecision: detail.latestDecision,
				latestReview: detail.latestReview,
				reportOptions: {
					includeDeferred: false,
					includeFalsePositives: false,
					includeUndecided: false,
				},
			})
		: null;

	useEffect(() => {
		if (
			selectedFindingId &&
			queue.some((item) => item.id === selectedFindingId)
		)
			return;
		setSelectedFindingId(queue[0]?.id ?? null);
	}, [queue, selectedFindingId]);

	useEffect(() => {
		if (selectedFindingId) void onLoadFinding(selectedFindingId);
		setPendingDecision(null);
		setReason("");
		setComment("");
		setSaveError(null);
		setSaveMessage(null);
	}, [onLoadFinding, selectedFindingId]);

	const move = (offset: number) => {
		const next = queue[selectedIndex + offset];
		if (next) {
			setPinnedFindingId(null);
			setSelectedFindingId(next.id);
		}
	};

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!selectedFinding || !pendingDecision || !reason || saving) return;
		setSaving(true);
		setSaveError(null);
		setSaveMessage(null);
		setPinnedFindingId(selectedFinding.id);
		try {
			await onSaveDecision(selectedFinding.id, {
				decision: pendingDecision,
				reason,
				comment: comment.trim() || undefined,
				linkedReviewId: detail?.latestReview?.id,
			});
			setSaveMessage(
				"互換Decisionを保存しました。内容を確認してから次へ進んでください。",
			);
			setPendingDecision(null);
			setReason("");
			setComment("");
		} catch (error) {
			setPinnedFindingId(null);
			setSaveError(
				error instanceof Error
					? error.message
					: "Decisionを保存できませんでした。",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="intelligence-guided-layout">
			<aside className="intelligence-guided-sidebar">
				<header>
					<div>
						<span>確認の進捗</span>
						<strong>
							{progress.completed} / {progress.total}
						</strong>
					</div>
					<span>{progress.remaining}件 未記録</span>
				</header>
				<progress value={progress.completed} max={Math.max(progress.total, 1)}>
					{progress.completed} / {progress.total}
				</progress>
				<div className="intelligence-filter-row">
					<label htmlFor="intelligence-guided-scope">
						<span>対象</span>
						<SelectInput
							id="intelligence-guided-scope"
							value={scope}
							onChange={(event) => {
								setPinnedFindingId(null);
								setScope(event.target.value as typeof scope);
							}}
						>
							<option value="undecided">未確認のみ</option>
							<option value="all">全件</option>
						</SelectInput>
					</label>
					<label htmlFor="intelligence-guided-severity">
						<span>Severity</span>
						<SelectInput
							id="intelligence-guided-severity"
							value={severity}
							onChange={(event) => {
								setPinnedFindingId(null);
								setSeverity(event.target.value);
							}}
						>
							<option value="all">すべて</option>
							{["critical", "high", "medium", "low", "info", "unknown"].map(
								(value) => (
									<option key={value} value={value}>
										{value}
									</option>
								),
							)}
						</SelectInput>
					</label>
				</div>
				{findingsError ? (
					<div className="intelligence-inline-error" role="alert">
						<span>{findingsError}</span>
						<Button
							type="button"
							variant="secondary"
							onClick={onReloadFindings}
						>
							<RotateCcw className="icon" /> 再試行
						</Button>
					</div>
				) : null}
				<ul className="intelligence-guided-queue" aria-label="確認対象Finding">
					{queue.map((finding, index) => (
						<li key={finding.id}>
							<button
								type="button"
								className={finding.id === selectedFindingId ? "selected" : ""}
								onClick={() => {
									if (finding.id !== selectedFindingId) {
										setPinnedFindingId(null);
										setSelectedFindingId(finding.id);
									}
								}}
							>
								{finding.latestDecision ? (
									<Check className="icon" />
								) : (
									<Circle className="icon" />
								)}
								<span>
									<small>
										{String(index + 1).padStart(2, "0")} · {finding.severity}
									</small>
									<strong>{finding.title}</strong>
								</span>
							</button>
						</li>
					))}
					{["idle", "loading"].includes(findingsStatus) &&
					queue.length === 0 ? (
						<p role="status">Findingを読み込んでいます…</p>
					) : queue.length === 0 && !findingsError ? (
						<p>条件に一致するFindingはありません。</p>
					) : null}
				</ul>
			</aside>

			<section className="intelligence-guided-main" aria-label="現在のFinding">
				<div className="intelligence-guided-nav">
					<div>
						<span>ガイド方式</span>
						<strong>
							{selectedIndex >= 0
								? `${selectedIndex + 1} / ${queue.length}`
								: "対象なし"}
						</strong>
					</div>
					<div>
						<Button
							type="button"
							variant="secondary"
							onClick={() => move(-1)}
							disabled={selectedIndex <= 0}
						>
							<ChevronLeft className="icon" /> 前へ
						</Button>
						<Button
							type="button"
							variant="secondary"
							onClick={() => move(1)}
							disabled={selectedIndex < 0 || selectedIndex >= queue.length - 1}
						>
							次へ <ChevronRight className="icon" />
						</Button>
					</div>
				</div>

				<IntelligenceFindingDetail
					projectId={projectId}
					scanRunId={scanRunId}
					finding={selectedFinding}
					detail={detail}
					status={
						selectedFinding
							? (detailStatus[selectedFinding.id] ?? "idle")
							: "idle"
					}
					error={
						selectedFinding ? (detailErrors[selectedFinding.id] ?? null) : null
					}
					graph={exportPayload.graph}
					onRetry={() => {
						if (selectedFinding) void onLoadFinding(selectedFinding.id, true);
					}}
				/>

				{workflow ? (
					<section className="projects-band intelligence-guided-workflow">
						<div className="projects-section-head">
							<div>
								<h2>確認ステップ</h2>
								<p>
									証跡と既存記録を確認してから、必要な場合だけ互換Decisionを保存します。
								</p>
							</div>
						</div>
						<ol className="intelligence-guided-steps">
							<li className="complete">
								<Check className="icon" />
								<span>
									<strong>検出内容と場所</strong>
									<small>上のFinding詳細を確認</small>
								</span>
							</li>
							<li
								className={
									workflow.evidenceChecklist.some((item) => item.available)
										? "complete"
										: "warning"
								}
							>
								<Check className="icon" />
								<span>
									<strong>Evidence</strong>
									<small>
										{
											workflow.evidenceChecklist.filter(
												(item) => item.available,
											).length
										}{" "}
										/ {workflow.evidenceChecklist.length}項目を確認可能
									</small>
								</span>
							</li>
							<li
								className={
									workflow.latestReview || workflow.latestDecision
										? "complete"
										: "pending"
								}
							>
								<Check className="icon" />
								<span>
									<strong>既存レビューと記録</strong>
									<small>
										{workflow.latestDecision
											? "Decision記録あり"
											: workflow.latestReview
												? "レビューあり"
												: "既存記録なし"}
									</small>
								</span>
							</li>
							<li className="pending">
								<Circle className="icon" />
								<span>
									<strong>次の行動</strong>
									<small>
										Scan Workspaceで追加確認、または下で互換記録を保存
									</small>
								</span>
							</li>
						</ol>
						<div className="intelligence-evidence-checklist">
							{workflow.evidenceChecklist.map((item) => (
								<div
									key={item.id}
									className={item.available ? "available" : "missing"}
								>
									{item.available ? (
										<Check className="icon" />
									) : (
										<Circle className="icon" />
									)}
									<span>
										<strong>{item.label}</strong>
										<small>{item.reference ?? "未取得"}</small>
									</span>
								</div>
							))}
						</div>
						<fieldset className="intelligence-decision-actions">
							<legend className="intelligence-visually-hidden">
								互換Decisionの選択
							</legend>
							{GUIDED_DECISION_ACTIONS.map((action) => (
								<button
									type="button"
									key={action.value}
									className={pendingDecision === action.value ? "selected" : ""}
									onClick={() => {
										setPendingDecision(action.value);
										setSaveError(null);
										setSaveMessage(null);
									}}
								>
									<strong>{action.label}</strong>
									<small>{action.description}</small>
								</button>
							))}
						</fieldset>
						{pendingDecision ? (
							<form
								className="intelligence-decision-form"
								onSubmit={handleSubmit}
							>
								<div className="intelligence-compatibility-note">
									<strong>互換Decisionとして保存します</strong>
									<p>
										これは既存互換レコードへの注釈であり、スキャン単位の正式なLLM
										handoffを置き換えません。
									</p>
								</div>
								<label htmlFor="intelligence-guided-reason">
									<span>理由（必須）</span>
									<SelectInput
										id="intelligence-guided-reason"
										required
										value={reason}
										onChange={(event) =>
											setReason(
												event.target.value as FindingDecision["reason"] | "",
											)
										}
									>
										<option value="">選択してください</option>
										{GUIDED_REASON_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</SelectInput>
								</label>
								<label htmlFor="intelligence-guided-comment">
									<span>補足（任意）</span>
									<TextArea
										id="intelligence-guided-comment"
										rows={3}
										value={comment}
										onChange={(event) => setComment(event.target.value)}
									/>
								</label>
								{saveError ? (
									<p className="intelligence-inline-error" role="alert">
										{saveError}
									</p>
								) : null}
								<div className="project-section-actions">
									<Button
										type="button"
										variant="secondary"
										onClick={() => setPendingDecision(null)}
										disabled={saving}
									>
										キャンセル
									</Button>
									<Button
										type="submit"
										variant="primary"
										disabled={!reason || saving}
									>
										{saving ? "保存中…" : "互換Decisionを保存"}
									</Button>
								</div>
							</form>
						) : null}
						{saveMessage ? (
							<p className="intelligence-save-success" role="status">
								{saveMessage}
							</p>
						) : null}
					</section>
				) : null}
			</section>
		</div>
	);
}
