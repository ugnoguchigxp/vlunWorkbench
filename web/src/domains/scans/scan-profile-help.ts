import type { ScanProfile, ScanTargetKind } from "../../api";

export type ScannerHelpId =
	| "gitleaks"
	| "osv"
	| "trivy"
	| "semgrep"
	| "zizmor"
	| "cosign"
	| "slsa-verifier"
	| "nuclei"
	| "zap"
	| "schemathesis";

export type ScannerHelpItem = {
	id: ScannerHelpId;
	name: string;
	category: string;
	summary: string;
	target: string;
	detects: readonly string[];
	characteristics: readonly string[];
};

export const SCANNER_HELP_ITEMS: readonly ScannerHelpItem[] = [
	{
		id: "semgrep",
		name: "Semgrep",
		category: "SAST（ソースコード静的解析）",
		summary:
			"ソースコードを実行せず、構文とデータの流れをルールに照らして危険な実装パターンを探します。",
		target:
			"プロファイルの対象範囲に含まれるソースコードです。全体スキャンではリポジトリ全体、差分スキャンでは変更対象を中心に確認します。",
		detects: [
			"ユーザー入力が危険なAPIへ渡る実装や、インジェクションにつながるデータフロー",
			"パストラバーサル、SSRF、危険なデシリアライズなど、ルール化された脆弱な実装パターン",
			"安全でないAPIの使い方や、技術スタック別ルールに一致するセキュリティ上の問題",
		],
		characteristics: [
			"このプロジェクトが管理する curated-sast-v1 を使用します。現在の内蔵ルールはJavaScript、TypeScript、Python、Java、Goに対応します。",
			"コードは実行しないため、実際に攻撃可能かどうかは実行時検証やレビューで確認する必要があります。",
			"任意アダプターです。Semgrepが有効化されていない場合は実行せず、SASTの未確認範囲として扱います。",
		],
	},
	{
		id: "gitleaks",
		name: "Gitleaks",
		category: "シークレット検出",
		summary:
			"リポジトリ内に誤って保存された認証情報らしい文字列を、専用ルールで探します。",
		target:
			"プロファイルの対象ファイルです。Git metadataを含む直接診断では履歴も確認し、差分・限定スコープでは対象として切り出したファイルだけを確認します。",
		detects: [
			"APIキー、アクセストークン、秘密鍵、パスワードなどの認証情報",
			"サービス固有の形式や、シークレットらしいパターンに一致する文字列",
		],
		characteristics: [
			"検出結果に含まれる秘密値は保存前にマスクします。",
			"資格情報が現在も有効かどうかは確認しません。テスト値や無効な値が検出される場合があります。",
		],
	},
	{
		id: "osv",
		name: "OSV-Scanner",
		category: "SCA（依存関係診断）",
		summary:
			"利用しているパッケージ名とバージョンをOSVの脆弱性情報に照合します。",
		target:
			"package manifest、lockfile、SBOMなどの依存関係情報です。設定によりMavenの推移依存も専用環境で解決します。",
		detects: [
			"直接依存・解決済み推移依存に含まれる既知の脆弱性",
			"影響を受けるバージョン範囲に一致するパッケージ",
		],
		characteristics: [
			"アプリ独自コードの脆弱な書き方は検査しません。",
			"manifestやlockfileから解決できない依存は、診断範囲に入らないことがあります。",
		],
	},
	{
		id: "trivy",
		name: "Trivy",
		category: "依存関係・設定・成果物診断",
		summary:
			"ファイルシステムやコンテナイメージを複数の観点で確認するスキャナーです。",
		target:
			"リポジトリのファイル、IaC・設定ファイル、ビルド成果物、指定済みコンテナイメージまたはimage tarです。",
		detects: [
			"アプリ依存パッケージやOSパッケージに含まれる既知の脆弱性",
			"Docker、Kubernetes、IaCなどの危険な設定",
			"ファイルやイメージに含まれるシークレットらしい情報",
		],
		characteristics: [
			"依存関係・シークレット・設定ミスのうち、プロファイルで指定された検査だけを実行します。",
			"サプライチェーンプロファイルではCycloneDX SBOMの生成にも使用します。SBOMの構成要素自体はfindingではありません。",
		],
	},
	{
		id: "zizmor",
		name: "zizmor",
		category: "CI/CDワークフロー静的解析",
		summary:
			"GitHub Actionsと関連する自動化定義を、CI/CD固有の攻撃経路に着目して確認します。",
		target:
			".github/workflows配下のworkflow、composite actionのaction.yml、pre-commit設定です。対象ファイルがない場合は適用対象外になります。",
		detects: [
			"式展開や入力値を介したテンプレートインジェクションの危険",
			"過剰な権限、危険なトリガーや、固定されていない外部Action参照",
			"GitHub Actionsのセキュリティルールに反する設定",
		],
		characteristics: [
			"オフラインで静的に解析し、workflow自体は実行しません。",
			"差分プロファイルでは、監査対象のworkflow関連ファイルが変更された場合だけ適用します。",
		],
	},
	{
		id: "cosign",
		name: "Cosign",
		category: "署名・provenance検証",
		summary:
			"成果物に対応する署名付きSLSA provenance bundleを、指定された公開鍵で検証します。",
		target: "ユーザーが指定した成果物、Cosign bundle、検証用公開鍵です。",
		detects: [
			"署名が不正、または信頼する公開鍵で検証できないprovenance",
			"provenanceのsubjectと検証対象成果物が一致しない状態",
		],
		characteristics: [
			"一般的な脆弱性スキャンではなく、成果物の由来と完全性を確認する検証ツールです。",
			"このプロジェクトではオフライン署名束の検証に使用します。",
		],
	},
	{
		id: "slsa-verifier",
		name: "slsa-verifier",
		category: "SLSA provenance検証",
		summary:
			"成果物のSLSA provenanceが期待するsource、builder、refに結び付いているかを検証します。",
		target: "ユーザーが指定した成果物、SLSA provenance、期待値ポリシーです。",
		detects: [
			"成果物とprovenanceの不一致",
			"期待するソースリポジトリ、ビルダー、ブランチやタグ参照から外れたビルド",
			"検証できない、または不正なprovenance",
		],
		characteristics: [
			"パッケージ脆弱性は探さず、ビルド由来の信頼性を確認します。",
			"Sigstoreのtrust root更新のため、検証時にネットワークが必要になる場合があります。",
		],
	},
	{
		id: "nuclei",
		name: "Nuclei Safe",
		category: "安全制限付きWeb診断",
		summary:
			"安全性を確認済みの固定テンプレートだけを使い、起動中のWebアプリをHTTP経由で確認します。",
		target:
			"このアプリがローカルで自動起動したloopbackのHTTP/HTTPS originです。任意の外部URLは対象にしません。",
		detects: [
			"固定テンプレートに一致する既知の公開設定や露出",
			"HTTP応答から確認できる、テンプレート化された安全な診断項目",
		],
		characteristics: [
			"外部コールバックを使わず、レート・並列数・リトライ・リクエスト数に上限を設けています。",
			"搭載した安全テンプレート以外のNucleiテンプレートは実行しません。",
		],
	},
	{
		id: "zap",
		name: "OWASP ZAP",
		category: "DAST（Web動的診断）",
		summary:
			"実際のHTTP通信を観察または送信し、Webアプリの実行時の問題を確認します。",
		target:
			"自動起動したローカルWebアプリ、明示許可されたローカル・プライベートネットワークの対象、またはRoEに紐づく使い捨て対象です。公開インターネットの任意URLは対象にしません。",
		detects: [
			"セキュリティヘッダー不足、Cookie属性、情報露出など、HTTP応答から分かる問題",
			"Active診断では、許可された対象にテストリクエストを送り確認できるWeb脆弱性",
		],
		characteristics: [
			"通常の実行時プロファイルではZAP Baselineの受動診断だけを使用し、状態変更を狙う攻撃は行いません。",
			"Active診断はR3の専用Labだけで実行し、RoE、使い捨て対象、リセット手順、明示同意が必要です。",
		],
	},
	{
		id: "schemathesis",
		name: "Schemathesis",
		category: "APIスキーマ動的診断",
		summary:
			"APIスキーマからテスト入力を生成し、実際のレスポンスが契約どおりかを確認します。",
		target:
			"自動検出・qualification済みのOpenAPI、またはQuery-only GraphQL schemaと、そのローカル実行対象です。",
		detects: [
			"スキーマと実レスポンスの不整合、予期しないステータス、サーバーエラー",
			"入力の組み合わせによって表面化する読み取り専用APIの異常",
		],
		characteristics: [
			"OpenAPIではGET・HEAD・OPTIONS、GraphQLではQueryだけに制限します。",
			"リクエスト数・速度・タイムアウトを制限し、更新系operationは実行しません。",
		],
	},
] as const;

type ProfileScannerReference = {
	id: ScannerHelpId;
	note?: string;
};

type ProfileHelp = {
	target: string;
	checks: readonly string[];
	scanners: readonly ProfileScannerReference[];
};

const PROFILE_HELP: Record<string, ProfileHelp> = {
	"change-gate": {
		target:
			"作業ツリー、コミット、またはブランチ間の変更ファイルです。依存関係ファイルとCI workflowは、関連する変更がある場合に確認します。",
		checks: [
			"変更に混入したシークレット、既知の依存脆弱性、IaC・設定ミス",
			"GitHub Actionsの危険な設定と、Semgrep有効時の脆弱なコードパターン",
		],
		scanners: [
			{ id: "gitleaks" },
			{ id: "osv", note: "依存関係の変更がある場合" },
			{ id: "trivy" },
			{ id: "zizmor", note: "CI workflowの変更がある場合" },
			{ id: "semgrep", note: "アダプターが有効な場合" },
		],
	},
	"source-assurance": {
		target:
			"リポジトリ全体のソースコード、依存関係ファイル、設定・IaC、GitHub Actions workflowです。",
		checks: [
			"シークレット、既知の依存脆弱性、危険な設定、CI workflowの問題",
			"Semgrep有効時は、ソースコードの危険な実装パターンとデータフロー",
		],
		scanners: [
			{ id: "gitleaks" },
			{ id: "osv" },
			{ id: "trivy" },
			{ id: "zizmor", note: "対象workflowがある場合" },
			{ id: "semgrep", note: "アダプターが有効な場合" },
		],
	},
	"dependency-supply-chain": {
		target:
			"依存関係のmanifest・lockfile、プロジェクトのソフトウェア構成、指定した成果物とprovenanceです。",
		checks: [
			"依存パッケージの既知脆弱性とCycloneDX SBOM",
			"成果物の署名付きprovenance、または期待するsource・builder・refとの一致",
		],
		scanners: [
			{ id: "osv" },
			{ id: "trivy", note: "SBOM生成" },
			{ id: "cosign", note: "Cosign方式を選んだ場合" },
			{ id: "slsa-verifier", note: "SLSA方式を選んだ場合" },
		],
	},
	"release-artifact": {
		target:
			"既存のビルド成果物、digest固定済みコンテナイメージ、または保存済みimage tarです。自動ビルドは行いません。",
		checks: [
			"成果物やイメージに含まれる既知のパッケージ脆弱性、シークレット、危険な設定",
		],
		scanners: [
			{ id: "gitleaks", note: "ファイルシステム成果物の場合" },
			{ id: "trivy" },
		],
	},
	"dynamic-verification": {
		target:
			"Docker隔離workspace内のプロジェクトと、プロジェクトで承認済みの標準テストです。",
		checks: [
			"テスト実行で再現する異常やセキュリティ上の失敗。検査内容は選択したテスト定義に従います。",
		],
		scanners: [],
	},
	"sanitizer-fuzz-lab": {
		target:
			"隔離環境で実行可能な、組み込みsanitizer・fuzz recipeの対象コードです。",
		checks: [
			"sanitizerが報告する不正なメモリアクセスや未定義動作、fuzz入力で発生するクラッシュや異常",
		],
		scanners: [],
	},
	"custom-dynamic-lab": {
		target:
			"保存済みのcommand・configで明示された、隔離workspace内の実行対象です。",
		checks: [
			"固定の検出項目はありません。ユーザーが保存した診断コマンドの検査範囲に従います。",
		],
		scanners: [],
	},
	"runtime-passive": {
		target:
			"破棄可能なsnapshotから自動起動した、ローカルWebアプリのHTTP応答と公開ルートです。",
		checks: [
			"セキュリティヘッダー、公開状態、既知の安全テンプレート、ZAPの受動アラート",
			"リクエスト上限付きの受動診断だけを行い、状態変更を狙う攻撃は実行しません。",
		],
		scanners: [{ id: "nuclei" }, { id: "zap", note: "Baseline受動診断" }],
	},
	"authenticated-web": {
		target:
			"保存済み認証contextで到達できるWeb画面・HTTP応答と、読み取り専用の認証済み操作です。",
		checks: [
			"匿名診断では見えない認証後の公開面と、認証セッションを使った受動的なWeb診断項目",
		],
		scanners: [{ id: "zap", note: "認証付き・読み取り専用" }],
	},
	"api-readonly": {
		target:
			"自動検出・qualification済みのOpenAPI、またはQuery-only GraphQL schemaとローカルAPIです。",
		checks: [
			"API契約とレスポンスの不整合、予期しないエラー、読み取り専用入力で表面化する異常",
		],
		scanners: [{ id: "schemathesis" }],
	},
	"active-technical-lab": {
		target:
			"RoEで許可され、リセット可能であることを確認した使い捨てWeb/API対象です。",
		checks: [
			"トランザクション、認可マトリクス、またはZAP Activeで確認する技術的なWeb脆弱性",
		],
		scanners: [{ id: "zap", note: "ZAP Active方式を選んだ場合" }],
	},
	"business-logic-lab": {
		target: "定義済みシナリオとRoEに紐づく、リセット可能な使い捨て対象です。",
		checks: [
			"業務上の状態遷移、認可、回数・順序・金額など、シナリオで定義した不変条件の違反",
		],
		scanners: [],
	},
	"remediation-verification": {
		target: "選択したfinding、その証跡、元スキャンの対象範囲と安全境界です。",
		checks: [
			"元findingが修正後も再現するか、または解消したか。使用する検証方法はfindingの種類に応じて決まります。",
		],
		scanners: [],
	},
};

const targetKindLabels: Record<ScanTargetKind, string> = {
	full: "リポジトリ全体または指定した入力",
	working_tree: "作業ツリーの変更",
	commit: "指定コミット",
	range: "ブランチ間の差分",
};

const capabilityScannerIds: Partial<Record<string, readonly ScannerHelpId[]>> =
	{
		secret_detection: ["gitleaks"],
		source_sast: ["semgrep"],
		cicd_workflow_integrity: ["zizmor"],
		sca: ["osv"],
		iac_config: ["trivy"],
		sbom: ["trivy"],
		provenance_integrity: ["cosign", "slsa-verifier"],
		artifact_container: ["trivy"],
		passive_dast: ["nuclei", "zap"],
		authentication_session: ["zap"],
		api_schema_contract: ["schemathesis"],
		active_dast: ["zap"],
	};

export function getProfileHelp(profile: ScanProfile): ProfileHelp {
	const known = PROFILE_HELP[profile.id];
	if (known) return known;
	const supportedTargets = profile.supportedTargets ?? ["full"];
	const scanners = Array.from(
		new Set(
			(profile.capabilityRequirements ?? []).flatMap(
				(requirement) => capabilityScannerIds[requirement.capabilityId] ?? [],
			),
		),
	).map((id) => ({ id }));
	return {
		target: supportedTargets
			.map((target) => targetKindLabels[target])
			.join("、"),
		checks: [profile.description],
		scanners,
	};
}

export function getScannerHelpItem(id: ScannerHelpId): ScannerHelpItem {
	const item = SCANNER_HELP_ITEMS.find((candidate) => candidate.id === id);
	if (!item) throw new Error(`scan_scanner_help_missing:${id}`);
	return item;
}
