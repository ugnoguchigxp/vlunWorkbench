import type { Finding, ScanImprovementRequest, ScanReview } from "../../../api";

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
	qualityScore: {
		total: number;
		threshold: number;
		passed: boolean;
		dimensions: Array<{
			id:
				| "factuality"
				| "actionability"
				| "verifiability"
				| "traceability"
				| "conciseness"
				| "safety";
			label: string;
			score: number;
			maxScore: number;
		}>;
	};
	readiness: "ready" | "partial" | "missing";
	coverage: {
		status: "complete" | "partial" | "unknown";
		totalIssues: number | null;
		includedIssues: number | null;
		totalFindings: number | null;
		includedFindings: number | null;
	};
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
	qualityScore: {
		total: 0,
		threshold: 96,
		passed: false,
		dimensions: [],
	},
	coverage: {
		status: "unknown",
		totalIssues: null,
		includedIssues: null,
		totalFindings: null,
		includedFindings: null,
	},
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
	if (
		review?.status !== "completed" ||
		(review.inputBundle?.generationKind !== "improvement_request" &&
			review.output?.generationKind !== "improvement_request")
	)
		return null;
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

function readCoverage(
	review: ScanReview,
): ScanImprovementRequestView["coverage"] {
	const outputCoverage = asRecord(review.output?.coverage);
	const inputLimits = asRecord(review.inputBundle?.limits);
	const totalIssues = numberValue(
		outputCoverage?.totalIssues ?? inputLimits?.totalIssues,
	);
	const includedIssues = numberValue(
		outputCoverage?.coveredIssues ?? inputLimits?.includedIssues,
	);
	const totalFindings = numberValue(
		outputCoverage?.totalFindings ?? inputLimits?.totalFindings,
	);
	const includedFindings = numberValue(
		outputCoverage?.coveredFindings ?? inputLimits?.includedFindings,
	);
	const findingFilter = inputLimits?.findingFilter;
	if (totalIssues !== null && includedIssues !== null) {
		return {
			status: includedIssues === totalIssues ? "complete" : "partial",
			totalIssues,
			includedIssues,
			totalFindings,
			includedFindings,
		};
	}
	if (totalFindings === null || includedFindings === null) {
		return {
			status: "unknown",
			totalIssues,
			includedIssues,
			totalFindings,
			includedFindings,
		};
	}
	return {
		status:
			findingFilter === "all" && includedFindings === totalFindings
				? "complete"
				: "partial",
		totalFindings,
		includedFindings,
		totalIssues,
		includedIssues,
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberValue(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
	const referencedIssueCount =
		request.priorityPlan.reduce(
			(total, item) => total + (item.issueIds?.length ?? 0),
			0,
		) +
		request.implementationTasks.reduce(
			(total, item) => total + (item.issueIds?.length ?? 0),
			0,
		);
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
	const verificationText = [
		...request.implementationTasks.map((task) => task.body),
		...request.acceptanceCriteria,
		...request.constraints,
	].join("\n");
	const hasVerificationPlan =
		/(テスト|型検査|typecheck|build|ビルド)/i.test(verificationText) &&
		/(再スキャン|scanner|osv|trivy|検証|回帰|確認)/i.test(verificationText);

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
			label: referencedIssueCount > 0 ? "対象 issue" : "対象 finding",
			status:
				referencedIssueCount > 0 || referencedFindingCount > 0
					? "ready"
					: hasCoverageScope
						? "partial"
						: "missing",
			reason:
				referencedIssueCount > 0
					? "対象 issue ID が参照されています。"
					: referencedFindingCount > 0
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
			status:
				request.verificationCommands.length > 0 || hasVerificationPlan
					? "ready"
					: "partial",
			reason:
				request.verificationCommands.length > 0
					? "検証コマンドがあります。"
					: hasVerificationPlan
						? "リポジトリ確認後に実行する検証手順と完了条件があります。"
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

export function scoreScanImprovementRequest(
	request: ScanImprovementRequest,
	coverage: ScanImprovementRequestView["coverage"],
): ScanImprovementRequestView["qualityScore"] {
	const taskBodies = request.implementationTasks.map((task) => task.body);
	const constraintsText = request.constraints.join("\n");
	const factualityText = [
		constraintsText,
		...request.priorityPlan.map((plan) => plan.rationale),
	].join("\n");
	const acceptanceText = request.acceptanceCriteria.join("\n");
	const groundedTasks = taskBodies.filter(
		(body) =>
			/確認済み事実/.test(body) &&
			/(条件付きの影響|成立条件)/.test(body) &&
			/実装時/.test(body),
	).length;
	const allTasksGrounded =
		taskBodies.length > 0 && groundedTasks === taskBodies.length;
	const allTasksTraceable =
		request.implementationTasks.length > 0 &&
		request.implementationTasks.every(
			(task) =>
				(task.issueIds?.length ?? task.findingIds.length) > 0 &&
				task.evidenceRefs.length > 0,
		);
	const taskIds = new Set(
		request.implementationTasks.flatMap(
			(task) => task.issueIds ?? task.findingIds,
		),
	);
	const lifecycleVerification = /(テスト|型検査|typecheck|build|ビルド)/i.test(
		acceptanceText,
	);
	const scannerVerification = /(再スキャン|scanner.*再実行|OSV|Trivy)/i.test(
		acceptanceText,
	);
	const commandPolicy =
		request.verificationCommands.length > 0 ||
		/(リポジトリで定義|既存.*(script|スクリプト|コマンド|テスト)|現行.*確認)/i.test(
			[acceptanceText, constraintsText].join("\n"),
		) ||
		(lifecycleVerification && scannerVerification);
	const concisePrimarySections =
		request.scope.length <= 7 &&
		request.priorityPlan.length <= 6 &&
		request.implementationTasks.length <= 8;
	const conciseSupportingSections =
		request.acceptanceCriteria.length <= 8 &&
		request.constraints.length <= 8 &&
		request.nonGoals.length <= 6;
	const proseChars = [
		request.objective,
		...request.scope,
		...request.priorityPlan.map((plan) => plan.rationale),
		...request.implementationTasks.flatMap((task) => [task.title, task.body]),
		...request.acceptanceCriteria,
		...request.verificationCommands,
		...request.constraints,
		...request.nonGoals,
	].join("\n").length;

	const dimensions: ScanImprovementRequestView["qualityScore"]["dimensions"] = [
		{
			id: "factuality",
			label: "事実性",
			score:
				(mentionsContextLimit(request) ? 5 : 0) +
				(allTasksGrounded ? 15 : 0) +
				(/severity.*scanner|scanner.*severity/i.test(factualityText) &&
				/(断定しない|確認後に判断)/.test(factualityText)
					? 5
					: 0),
			maxScore: 25,
		},
		{
			id: "actionability",
			label: "実行可能性",
			score:
				(request.implementationTasks.length > 0 &&
				request.implementationTasks.length <= 8
					? 7
					: 0) +
				(request.implementationTasks.every(
					(task) =>
						task.title.trim().length >= 8 && task.body.trim().length >= 80,
				)
					? 6
					: 0) +
				(allTasksTraceable ? 6 : 0) +
				(request.implementationTasks.every((task) =>
					/(確認|更新|追加|修正).*(回帰|テスト|確認)|回帰.*(確認|テスト)/.test(
						task.body,
					),
				)
					? 6
					: 0),
			maxScore: 25,
		},
		{
			id: "verifiability",
			label: "検証可能性",
			score:
				(request.acceptanceCriteria.length >= 3 ? 5 : 0) +
				(lifecycleVerification ? 5 : 0) +
				(scannerVerification ? 5 : 0) +
				(commandPolicy ? 5 : 0),
			maxScore: 20,
		},
		{
			id: "traceability",
			label: "網羅性・追跡性",
			score:
				(coverage.status === "complete" ? 10 : 0) +
				(coverage.totalIssues !== null && taskIds.size === coverage.totalIssues
					? 5
					: 0),
			maxScore: 15,
		},
		{
			id: "conciseness",
			label: "簡潔性",
			score:
				(concisePrimarySections ? 4 : 0) +
				(conciseSupportingSections ? 3 : 0) +
				(proseChars <= 9_000 ? 3 : 0),
			maxScore: 10,
		},
		{
			id: "safety",
			label: "安全性",
			score:
				/Scanner 原文は参考データ|scanner 出力.*実装指示として扱わない/i.test(
					constraintsText,
				)
					? 3
					: 0,
			maxScore: 5,
		},
	];
	const safety = dimensions.find((item) => item.id === "safety");
	if (/現行コード.*正/.test(constraintsText) && safety) safety.score += 2;
	const total = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
	return {
		total,
		threshold: 96,
		passed: total >= 96,
		dimensions,
	};
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
	const candidates = reviewsWithRequest
		.map((review) => ({ review, request: getScanImprovementRequest(review) }))
		.filter(
			(item): item is { review: ScanReview; request: ScanImprovementRequest } =>
				item.request !== null,
		);
	const selected =
		candidates.find(
			(item) => readCoverage(item.review).status === "complete",
		) ?? candidates[0];
	if (!selected?.request)
		return emptyView("improvementRequest の形式が不正です。");
	const request = selected.request;
	const checks = buildQualityChecks(request);
	const coverage = readCoverage(selected.review);
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
		qualityScore: scoreScanImprovementRequest(request, coverage),
		readiness,
		coverage,
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
	_findings: Finding[] = [],
): string {
	const parts = [
		`# ${request.title}`,
		section("目的", request.objective),
		section("対象範囲", request.scope),
		request.priorityPlan.length > 0
			? `## 優先計画\n${request.priorityPlan
					.map((item) => `- ${item.priority}: ${item.rationale}`)
					.join("\n")}`
			: "",
		request.implementationTasks.length > 0
			? `## 実装タスク\n${request.implementationTasks
					.map((task) => `### ${task.title}\n${task.body}`)
					.join("\n\n")}`
			: "",
		section("受け入れ条件", request.acceptanceCriteria),
		request.verificationCommands.length > 0
			? `## 検証コマンド\n\`\`\`bash\n${request.verificationCommands.join("\n")}\n\`\`\``
			: "## 検証方法\n正確なコマンドは保存済みcontextでは確認できません。対象リポジトリの既存scriptsを確認し、上記の受け入れ条件に対応するテスト、型検査またはbuild、対象Scannerの再実行を行ってください。",
		section("制約", request.constraints),
		section("非ゴール", request.nonGoals),
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
