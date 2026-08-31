export const PROFILE_DISPLAY: Record<
	string,
	{ name: string; subtitle: string }
> = {
	baseline: {
		name: "標準スキャン",
		subtitle:
			"Gitleaks と OSV の secret/SCA baseline です。source SAST は含みません。",
	},
	"basic-security": {
		name: "基本セキュリティスキャン",
		subtitle:
			"コード実装、シークレット、依存関係、設定ミスの基本観点を確認します。",
	},
	"source-baseline": {
		name: "ソースコード重点スキャン",
		subtitle:
			"生成物を外した Gitleaks/OSV の secret/SCA baseline です。source SAST は含みません。",
	},
	secrets: {
		name: "シークレット漏えいスキャン",
		subtitle:
			"API キー、トークン、認証情報などがソースや履歴に混入していないか確認します。",
	},
	dependencies: {
		name: "依存関係脆弱性スキャン",
		subtitle:
			"manifest と lockfile から既知脆弱性のある依存パッケージを確認します。",
	},
	"dependency-manifest": {
		name: "依存マニフェストスキャン",
		subtitle:
			"installed dependency tree ではなく、manifest と lockfile に範囲を絞って確認します。",
	},
	iac: {
		name: "設定ファイル・IaC スキャン",
		subtitle: "設定ミス、IaC、デプロイ定義に含まれるリスクを確認します。",
	},
	artifact: {
		name: "ビルド成果物スキャン",
		subtitle:
			"dist、build、source map など、リリース成果物に残るシークレットや問題を確認します。",
	},
	"full-deep": {
		name: "全体深掘りスキャン",
		subtitle:
			"生成物、vendored code、installed dependencies まで広く確認します。",
	},
	"detailed-security": {
		name: "詳細スキャン",
		subtitle: "Gitleaks、OSV、Trivy で Static 検査を実行します。",
	},
	"semgrep-baseline": {
		name: "Semgrep SAST（任意 adapter）",
		subtitle: "明示的に導入・有効化した Semgrep engine で確認します。",
	},
	"web-app-baseline": {
		name: "Webアプリ標準診断",
		subtitle:
			"静的基本診断と自動起動 HTTP DAST 診断を同じ scan run で実行します。",
	},
	"runtime-http-check": {
		name: "実行時HTTP診断",
		subtitle:
			"プロジェクトの起動スクリプトから対象を自動判別し、HTTP実行時証跡を確認します。",
	},
	"runtime-web-safe": {
		name: "安全なWeb実行時診断",
		subtitle:
			"HTTP baseline、Nuclei safe、ZAP baseline を同じ自動起動対象で確認します。",
	},
	"runtime-zap-baseline": {
		name: "ZAP Baseline Passive Scan",
		subtitle:
			"固定Docker imageとbounded gatewayでローカル対象をpassive scanします。",
	},
	"sbom-inventory": {
		name: "CycloneDXソフトウェアインベントリ",
		subtitle: "検査対象のソフトウェア構成を SBOM artifact として保存します。",
	},
	"api-schema-readonly": {
		name: "APIスキーマ読み取り専用診断",
		subtitle:
			"検出できた API schema の read-only operation だけを bounded に確認します。",
	},
	"container-image-security": {
		name: "既存コンテナイメージ診断",
		subtitle: "明示された既存 image ref または tar だけを Trivy で確認します。",
	},
	"full-security-scan": {
		name: "総合セキュリティ診断",
		subtitle:
			"詳細な静的診断と HTTP DAST を実行します。必要な scanner が利用できない場合は、未実行として成功扱いにせず停止します。",
	},
	"secrets-dependencies-runtime": {
		name: "漏えい・依存関係・公開面診断",
		subtitle:
			"シークレット漏えい、依存関係、公開面を静的診断と HTTP 実行時証跡で確認します。",
	},
};

export const TOOL_DISPLAY: Record<string, { name: string; purpose: string }> = {
	semgrep: {
		name: "Semgrep",
		purpose: "コードの危険な実装パターン、設定ミス、脆弱な書き方を確認します。",
	},
	gitleaks: {
		name: "Gitleaks",
		purpose:
			"Git 履歴やファイルに残った API キー、トークン、認証情報を確認します。",
	},
	osv: {
		name: "OSV-Scanner",
		purpose:
			"manifest と lockfile から OSV の既知脆弱性がある依存を確認します。",
	},
	trivy: {
		name: "Trivy",
		purpose:
			"ファイルシステム視点で依存脆弱性、シークレット、IaC/設定ミスを確認します。",
	},
	"nuclei-safe": {
		name: "Nuclei Safe",
		purpose: "固定された安全な HTTP template set だけで公開状態を確認します。",
	},
	"zap-baseline": {
		name: "ZAP Baseline",
		purpose: "公式 ZAP baseline の passive alert を確認します。",
	},
	schemathesis: {
		name: "Schemathesis",
		purpose:
			"認証情報を渡さず read-only API operation を bounded に確認します。",
	},
};

export type ScanStepDisplay = {
	name: string;
	purpose: readonly string[];
};

export const SCAN_STEP_DISPLAY: Record<string, ScanStepDisplay> = {
	gitleaks: {
		name: "Gitleaks",
		purpose: [
			"Git 履歴やソースに含まれる API キー、トークン、認証情報を確認します。",
		],
	},
	osv: {
		name: "OSV-Scanner",
		purpose: [
			"manifest、lockfile、依存パッケージに含まれる既知の脆弱性を確認します。",
		],
	},
	trivy: {
		name: "Trivy",
		purpose: [
			"依存ライブラリ・OS パッケージの既知の脆弱性を確認します。",
			"Docker・IaC などの危険な設定を確認します。",
			"コードや設定ファイルに含まれるシークレットを確認します。",
		],
	},
	semgrep: {
		name: "Semgrep",
		purpose: ["ソースコードの危険な実装パターンや脆弱な書き方を確認します。"],
	},
	"sbom_export:trivy": {
		name: "Trivy SBOM",
		purpose: [
			"利用しているパッケージ、バージョン、依存関係を収集します。",
			"CycloneDX 形式のソフトウェア構成表を生成します。",
		],
	},
	"dast:http-baseline": {
		name: "HTTP Baseline DAST",
		purpose: [
			"Web アプリの HTTP 応答、公開ルート、セキュリティヘッダーを受動的に確認します。",
		],
	},
	"dast:web-passive-standard": {
		name: "Web Passive Standard DAST",
		purpose: [
			"自動起動した Web アプリの HTTP 応答と受動的な異常を確認します。",
		],
	},
	"dast:authenticated-readonly-standard": {
		name: "Authenticated Read-only DAST",
		purpose: [
			"認証済みの読み取り専用操作に限定して HTTP の安全性を確認します。",
		],
	},
	"runtime_scanner:nuclei-safe": {
		name: "Nuclei Safe",
		purpose: ["安全なテンプレートだけで公開 URL の既知の問題を確認します。"],
	},
	"runtime_scanner:zap-baseline": {
		name: "ZAP Baseline",
		purpose: ["Web アプリを変更せず、HTTP 通信から受動的な警告を確認します。"],
	},
	"api_schema_scan:schemathesis": {
		name: "Schemathesis",
		purpose: [
			"OpenAPI または GraphQL の読み取り専用操作を確認します。",
			"スキーマと実際のレスポンスの不整合を確認します。",
		],
	},
	"container_image_scan:trivy": {
		name: "Trivy Image Scan",
		purpose: [
			"コンテナイメージ内の OS・アプリ依存関係の既知の脆弱性を確認します。",
			"コンテナイメージに含まれる設定やシークレットを確認します。",
		],
	},
};

export const TOOL_SUBTITLES: Record<string, string> = Object.fromEntries(
	Object.entries(TOOL_DISPLAY).map(([id, display]) => [id, display.purpose]),
);

export function getProfileDisplay(
	id: string,
	fallbackName: string,
	fallbackSubtitle: string,
) {
	return (
		PROFILE_DISPLAY[id] ?? {
			name: fallbackName,
			subtitle: fallbackSubtitle,
		}
	);
}

export function getToolDisplay(id: string, fallbackName?: string) {
	return (
		TOOL_DISPLAY[id] ?? {
			name: fallbackName || id,
			purpose: "この scan tool が出力した結果を確認します。",
		}
	);
}

export function getScanStepDisplay(
	stepId: string,
	adapter: string,
	fallbackName: string,
): ScanStepDisplay {
	return (
		SCAN_STEP_DISPLAY[stepId] ??
		SCAN_STEP_DISPLAY[adapter] ?? {
			name: fallbackName,
			purpose: ["このスキャナーが設定された検査を実行しています。"],
		}
	);
}

export function formatScanOutcome(value: string | null | undefined): string {
	if (!value) return "未確定";
	const labels: Record<string, string> = {
		completed: "完了",
		completed_with_warnings: "完了（警告あり）",
		blocked: "ブロック済み",
		incomplete: "未完了",
		failed: "失敗",
		running: "実行中",
		queued: "待機中",
		cancelled: "キャンセル済み",
		timed_out: "タイムアウト",
		skipped: "スキップ",
		target_unreachable_from_container: "コンテナから対象に到達不能",
		authentication_required: "認証が必要",
		policy_rejected: "ポリシーで拒否",
		invalid_structured_output: "構造化出力が不正",
		execution_failed: "実行失敗",
	};
	return labels[value] ?? value.replace(/_/g, " ").toUpperCase();
}

export function formatScanReason(value: string | null | undefined): string {
	return formatScanOutcome(value);
}
