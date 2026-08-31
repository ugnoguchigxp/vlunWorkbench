import type { ScanRun } from "../../api";
import {
	describeScanPreflightReason,
	readScanPreflightDisplay,
} from "./scan-preflight-display";

export type ScanFailureDisplay = {
	title: string;
	explanation: string;
	nextAction: string;
	assurance: string;
	terminationReason: string | null;
	reasonCodes: string[];
	technicalMessage: string | null;
	noScannerExecution: boolean;
};

const preExecutionTerminationReasons = new Set([
	"plan_changed",
	"preflight_changed",
	"preflight_failed",
]);

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function planBlockerCodes(metadata: Record<string, unknown>): string[] {
	const plan = metadata.executionPlan;
	if (!plan || typeof plan !== "object") return [];
	return stringArray((plan as Record<string, unknown>).blockerCodes);
}

export function buildScanFailureDisplay(
	scan: ScanRun | null | undefined,
): ScanFailureDisplay | null {
	if (!scan || (scan.status !== "failed" && scan.status !== "cancelled")) {
		return null;
	}
	const terminationReason = stringValue(scan.metadata.terminationReason);
	const preflight = readScanPreflightDisplay(scan.metadata);
	const blockedPreflightCodes =
		preflight?.checks
			.filter((check) => check.status === "blocked")
			.flatMap((check) => check.reasonCode ?? []) ?? [];
	const blockedPlanCodes = planBlockerCodes(scan.metadata);
	const profileLimitationCodes = stringArray(
		scan.metadata.profileLimitationCodes,
	).filter((code) => !preExecutionTerminationReasons.has(code));
	const reasonCodes = [
		...new Set([
			...blockedPreflightCodes,
			...blockedPlanCodes,
			...profileLimitationCodes,
		]),
	];
	const primaryCheck = preflight?.checks.find(
		(check) => check.status === "blocked" && check.required,
	);
	const primaryReason =
		primaryCheck?.reasonCode ??
		blockedPlanCodes[0] ??
		(terminationReason && preExecutionTerminationReasons.has(terminationReason)
			? profileLimitationCodes[0]
			: null);
	const reasonDisplay = describeScanPreflightReason(
		primaryReason,
		primaryCheck?.action,
	);
	const noScannerExecution = Boolean(
		terminationReason && preExecutionTerminationReasons.has(terminationReason),
	);

	if (scan.status === "cancelled") {
		return {
			title: "スキャンは中止されました",
			explanation:
				"処理が完了する前に中止されたため、結果とカバレッジは確定していません。",
			nextAction: "必要であれば、実行条件を確認してもう一度開始してください。",
			assurance:
				"表示中の検出数だけでは、安全性を判断できません。完了したスキャンの結果を使用してください。",
			terminationReason,
			reasonCodes,
			technicalMessage: scan.summary,
			noScannerExecution: false,
		};
	}

	const title = primaryReason
		? reasonDisplay.heading
		: terminationReason === "plan_changed"
			? "実行条件が変わったため、スキャンを開始できませんでした"
			: "スキャンを完了できませんでした";
	const explanation = primaryReason
		? reasonDisplay.cause
		: terminationReason === "plan_changed"
			? "事前確認後に実行計画が変わったため、安全のため開始前に停止しました。"
			: "実行中にエラーが発生し、結果を確定できませんでした。";

	return {
		title,
		explanation,
		nextAction: primaryReason
			? reasonDisplay.nextAction
			: "技術情報を確認して原因を解消し、もう一度実行してください。",
		assurance: noScannerExecution
			? "スキャナーは実行されていません。「検出 0 件」や「カバレッジ確認済み」を意味しません。"
			: "この実行の結果は不完全です。完了済みスキャンと同じ根拠には使用できません。",
		terminationReason,
		reasonCodes,
		technicalMessage: scan.summary,
		noScannerExecution,
	};
}
