import type { ScanImprovementRequest, ScanReview } from "../../api";

export type ScanImprovementRequestQualityCheck = {
	id:
		| "objective"
		| "scope"
		| "findings"
		| "tasks"
		| "acceptance"
		| "verification"
		| "non_goals"
		| "context_limit";
	label: string;
	status: "ready" | "missing" | "partial";
	reason: string;
};

export type ScanImprovementRequestView = {
	available: boolean;
	sourceReviewId: string | null;
	title: string;
	objective: string;
	handoffPrompt: string;
	request: ScanImprovementRequest | null;
	qualityChecks: ScanImprovementRequestQualityCheck[];
	readiness: "ready" | "partial" | "missing";
};

export type ScanReviewFailureCategory =
	| "provider_failure"
	| "json_schema_validation_failure"
	| "japanese_language_validation_failure"
	| "bundle_reference_violation"
	| "unknown";

export type ScanReviewFailureView = {
	category: ScanReviewFailureCategory;
	label: string;
	rawError: string;
	nextAction: string;
};

const emptyView = (
	reason = "completed scan review の improvementRequest がありません。",
): ScanImprovementRequestView => ({
	available: false,
	sourceReviewId: null,
	title: "",
	objective: "",
	handoffPrompt: "",
	request: null,
	readiness: "missing",
	qualityChecks: [
		{
			id: "objective",
			label: "目的",
			status: "missing",
			reason,
		},
	],
});

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

export function getScanImprovementRequest(
	review: ScanReview | null | undefined,
): ScanImprovementRequest | null {
	if (review?.status !== "completed") return null;
	const value = review.output?.improvementRequest;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<ScanImprovementRequest>;
	if (
		typeof candidate.title !== "string" ||
		typeof candidate.objective !== "string" ||
		typeof candidate.handoffPrompt !== "string" ||
		!hasText(candidate.handoffPrompt) ||
		!isStringArray(candidate.scope) ||
		!Array.isArray(candidate.priorityPlan) ||
		!Array.isArray(candidate.implementationTasks) ||
		!isStringArray(candidate.acceptanceCriteria) ||
		!isStringArray(candidate.verificationCommands) ||
		!isStringArray(candidate.constraints) ||
		!isStringArray(candidate.nonGoals)
	) {
		return null;
	}
	return candidate as ScanImprovementRequest;
}

const hasText = (value: string) => value.trim().length > 0;

export function hasScanImprovementRequest(
	review: ScanReview | null | undefined,
): boolean {
	return getScanImprovementRequest(review) !== null;
}

const reviewTime = (review: ScanReview): number =>
	new Date(review.completedAt ?? review.createdAt).getTime() || 0;

const latestFirst = (a: ScanReview, b: ScanReview): number => {
	const timeDiff = reviewTime(b) - reviewTime(a);
	return timeDiff !== 0 ? timeDiff : b.id.localeCompare(a.id);
};

const mentionsContextLimit = (request: ScanImprovementRequest): boolean => {
	const text = [...request.constraints, request.handoffPrompt]
		.join("\n")
		.toLowerCase();
	return [
		"保存済み",
		"stored",
		"saved context",
		"bundle",
		"scan bundle",
		"evidence",
		"context",
	].some((needle) => text.includes(needle.toLowerCase()));
};

function buildQualityChecks(
	request: ScanImprovementRequest,
): ScanImprovementRequestQualityCheck[] {
	const referencedFindingCount =
		request.priorityPlan.reduce(
			(total, item) => total + item.findingIds.length,
			0,
		) +
		request.implementationTasks.reduce(
			(total, item) => total + item.findingIds.length,
			0,
		);
	const hasCoverageScope =
		request.scope.some((item) =>
			/0\s*件|zero|カバレッジ|coverage/i.test(item),
		) || /0\s*件|zero|カバレッジ|coverage/i.test(request.handoffPrompt);

	return [
		{
			id: "objective",
			label: "目的",
			status: hasText(request.objective) ? "ready" : "missing",
			reason: hasText(request.objective)
				? "依頼目的があります。"
				: "依頼目的がありません。",
		},
		{
			id: "scope",
			label: "対象範囲",
			status: request.scope.length > 0 ? "ready" : "missing",
			reason:
				request.scope.length > 0
					? "対象範囲があります。"
					: "対象範囲がありません。",
		},
		{
			id: "findings",
			label: "対象 finding",
			status:
				referencedFindingCount > 0
					? "ready"
					: hasCoverageScope
						? "partial"
						: "missing",
			reason:
				referencedFindingCount > 0
					? "対象 finding ID が参照されています。"
					: hasCoverageScope
						? "finding 0 件のカバレッジ確認として扱えます。"
						: "対象 finding または zero-finding scope がありません。",
		},
		{
			id: "tasks",
			label: "実装タスク",
			status: request.implementationTasks.length > 0 ? "ready" : "missing",
			reason:
				request.implementationTasks.length > 0
					? "実装タスクがあります。"
					: "実装タスクがありません。",
		},
		{
			id: "acceptance",
			label: "受け入れ条件",
			status: request.acceptanceCriteria.length > 0 ? "ready" : "missing",
			reason:
				request.acceptanceCriteria.length > 0
					? "受け入れ条件があります。"
					: "受け入れ条件がありません。",
		},
		{
			id: "verification",
			label: "検証",
			status: request.verificationCommands.length > 0 ? "ready" : "partial",
			reason:
				request.verificationCommands.length > 0
					? "検証コマンドがあります。"
					: "検証コマンドが未指定です。",
		},
		{
			id: "non_goals",
			label: "非ゴール",
			status: request.nonGoals.length > 0 ? "ready" : "missing",
			reason:
				request.nonGoals.length > 0
					? "非ゴールがあります。"
					: "非ゴールがありません。",
		},
		{
			id: "context_limit",
			label: "根拠制約",
			status: mentionsContextLimit(request) ? "ready" : "partial",
			reason: mentionsContextLimit(request)
				? "保存済み context / bundle / evidence の制約があります。"
				: "根拠を保存済み context に限定する制約が弱いです。",
		},
	];
}

export function buildScanImprovementRequestView(
	reviews: ScanReview[],
): ScanImprovementRequestView {
	const reviewsWithRequest = reviews
		.filter(
			(item) => item.status === "completed" && item.output?.improvementRequest,
		)
		.sort(latestFirst);
	if (reviewsWithRequest.length === 0) return emptyView();
	const selected = reviewsWithRequest
		.map((review) => ({ review, request: getScanImprovementRequest(review) }))
		.find((item) => item.request);
	if (!selected?.request)
		return emptyView("improvementRequest の形式が不正です。");
	const request = selected.request;
	const checks = buildQualityChecks(request);
	const missingCount = checks.filter(
		(item) => item.status === "missing",
	).length;
	const partialCount = checks.filter(
		(item) => item.status === "partial",
	).length;
	const readiness =
		!hasText(request.handoffPrompt) || missingCount > 0
			? "missing"
			: partialCount > 0
				? "partial"
				: "ready";
	return {
		available: hasText(request.handoffPrompt),
		sourceReviewId: selected.review.id,
		title: request.title,
		objective: request.objective,
		handoffPrompt: request.handoffPrompt,
		request,
		qualityChecks: checks,
		readiness,
	};
}

const section = (title: string, body: string | string[]): string => {
	const lines = Array.isArray(body)
		? body.filter(hasText).map((item) => `- ${item}`)
		: [body].filter(hasText);
	return lines.length > 0 ? `## ${title}\n${lines.join("\n")}` : "";
};

export function buildScanImprovementRequestMarkdown(
	request: ScanImprovementRequest,
): string {
	const parts = [
		`# ${request.title}`,
		section("目的", request.objective),
		section("対象範囲", request.scope),
		request.priorityPlan.length > 0
			? `## 優先計画\n${request.priorityPlan
					.map((item) => {
						const ids = item.findingIds.length
							? ` (${item.findingIds.join(", ")})`
							: "";
						return `- ${item.priority}: ${item.rationale}${ids}`;
					})
					.join("\n")}`
			: "",
		request.implementationTasks.length > 0
			? `## 実装タスク\n${request.implementationTasks
					.map((task) => {
						const refs = task.findingIds.length
							? `\nfinding ID: ${task.findingIds.join(", ")}`
							: "";
						return `### ${task.title}\n${task.body}${refs}`;
					})
					.join("\n\n")}`
			: "",
		section("受け入れ条件", request.acceptanceCriteria),
		request.verificationCommands.length > 0
			? `## 検証コマンド\n\`\`\`bash\n${request.verificationCommands.join("\n")}\n\`\`\``
			: "",
		section("制約", request.constraints),
		section("非ゴール", request.nonGoals),
		section("引き継ぎプロンプト", request.handoffPrompt),
	];
	return `${parts.filter(hasText).join("\n\n")}\n`;
}

export function classifyScanReviewFailure(
	error: string | null | undefined,
): ScanReviewFailureView | null {
	if (!error) return null;
	if (
		error.includes("llm_structured_output_validation_failed") &&
		error.includes("Japanese review text is required")
	) {
		return {
			category: "japanese_language_validation_failure",
			label: "日本語検証エラー",
			rawError: error,
			nextAction: "scan review を再実行してください。",
		};
	}
	if (error.includes("llm_provider_execution_failed")) {
		return {
			category: "provider_failure",
			label: "Provider 実行エラー",
			rawError: error,
			nextAction: "provider route/API key を確認してから再実行してください。",
		};
	}
	if (error.includes("referenced findings not in bundle")) {
		return {
			category: "bundle_reference_violation",
			label: "Bundle 参照エラー",
			rawError: error,
			nextAction: "現在の scan bundle で scan review を再実行してください。",
		};
	}
	if (/json|schema|validation/i.test(error)) {
		return {
			category: "json_schema_validation_failure",
			label: "JSON/schema 検証エラー",
			rawError: error,
			nextAction:
				"再実行し、続く場合は prompt/schema の不一致を確認してください。",
		};
	}
	return {
		category: "unknown",
		label: "不明なエラー",
		rawError: error,
		nextAction: "raw error を確認してください。",
	};
}
