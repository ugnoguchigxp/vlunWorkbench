import { readFile, writeFile } from "node:fs/promises";
import { EnvSchema } from "../api/app/env";

const descriptions: Partial<Record<keyof typeof EnvSchema.shape, string>> = {
	NODE_ENV: "動作環境。development / test / production。既定development。",
	HOST: "待受アドレス。LAN公開時は認証とHTTPS構成を確認する。",
	PORT: "待受ポート。1〜65535。",
	DATABASE_URL: "SQLite DBパス。書込みはWriter経由。",
	CONTENT_ROOT: "knowledgeのローカルコンテンツ保存先。",
	WIKI_STORAGE_BACKEND: "knowledge保存方式。local / azure-blob。",
	AZURE_STORAGE_CONNECTION_STRING: "Azure Blob接続文字列。秘密。",
	WIKI_BLOB_CONTAINER: "knowledge保存先コンテナ名。",
	WIKI_BLOB_PREFIX: "knowledge Blob名のprefix。",
	EXA_API_KEY: "Exa検索資格情報。秘密。",
	BRAVE_SEARCH_API_KEY: "Brave検索資格情報。秘密。",
	OPENAI_API_KEY: "OpenAI互換provider資格情報。秘密。",
	OPENAI_BASE_URL: "OpenAI互換APIのURL。送信先制限も確認する。",
	CODEX_SDK_TIMEOUT_MS: "SDK呼出し期限（ミリ秒）。保存済みruntime設定が優先。",
	AZURE_OPENAI_ENDPOINT: "Azure OpenAI endpoint URL。",
	AZURE_OPENAI_API_KEY: "Azure OpenAI資格情報。秘密。",
	AZURE_OPENAI_DEPLOYMENT: "Azure chat deployment名。",
	AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT: "Azure embedding deployment名。",
	LLM_PROVIDER_ALLOWED_HOSTS:
		"外向きprovider通信の許可host一覧（カンマ区切り）。",
	LLM_SETTINGS_ENCRYPTION_KEY: "保存するLLM資格情報の暗号化鍵。秘密。",
	LLM_SETTINGS_PREVIOUS_ENCRYPTION_KEYS:
		"鍵ローテーション時の旧LLM暗号化鍵一覧。秘密。",
	DAST_AUTH_ENCRYPTION_KEY: "保存するDAST認証情報の暗号化鍵。秘密。",
	DAST_AUTH_PREVIOUS_ENCRYPTION_KEYS: "旧DAST暗号化鍵一覧。秘密。",
	APP_URL: "ブラウザから利用するアプリURL。originはCORSへ含まれる。",
	CORS_ORIGINS: "許可するブラウザorigin一覧（カンマ区切り）。",
	AUTH_COOKIE_SECURE: "Secure cookie。HTTPS環境ではtrue。",
	AUTH_COOKIE_SAME_SITE:
		"Cookie SameSite。lax / strict / none。noneにはSecureが必要。",
	JWT_ACCESS_EXPIRES_IN: "access token有効期間（例15m）。",
	JWT_REFRESH_EXPIRES_IN: "refresh token有効期間（例7d）。",
	JWT_SECRET: "JWT署名鍵。32文字以上。productionは開発用既定鍵を拒否。秘密。",
	SECURITY_HEADERS_MODE:
		"HTTPS関連headerの方式。auto / http / https。既定auto。",
	TRUST_PROXY: "信頼proxyによる転送headerの利用。",
	TRUSTED_PROXY_CIDRS: "信頼するproxyのCIDR一覧。",
	CSP_MODE:
		"report-only / enforce。productionは既定enforce、それ以外report-only。",
	SCAN_EXECUTION_MODE:
		"docker / host。未指定の既定docker。保存済みruntime設定が優先。",
	ALLOW_HOST_SCANNER_EXECUTION:
		"host選択を許可する。既定false（developmentで明示host設定がある場合はtrue）。trueだけではhostを選択しない。",
	SCAN_DOCKER_IMAGE: "scanner image。保存済みruntime設定が優先。",
	PROJECT_ALLOWED_ROOTS:
		"共通の許可ディレクトリ（カンマ区切り）。空は拒否。実体パスで判定。",
	STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS:
		"MCPの追加許可ルート。共通PROJECT_ALLOWED_ROOTSとの両方を満たす必要がある。",
	STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY:
		"registered_only（既定）/ create_within_allowed_roots。",
	NIGHTWORKERS_INTEGRATION_ENABLED: "NightWorkers統合APIの有効化。",
	NIGHTWORKERS_INTEGRATION_AUTO_CREATE_PROJECTS:
		"許可内projectの自動登録。所有者制約は維持。",
	NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES:
		"統合APIで許可するprofile ID一覧。",
	NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED:
		"Security Intelligence APIの有効化。",
	NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED:
		"内部: Security Intelligenceの認可比較観測。",
	NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS:
		"Security Intelligence対象project UUID一覧。",
	NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED:
		"内部: workspace grantの有効化。",
	VULN_WORKBENCH_SCAN_EXECUTION_PLAN_V2: "内部: execution plan v2の有効化。",
};

export function renderEnvReference(): string {
	const rows = Object.entries(EnvSchema.shape).map(([key, schema]) => {
		let description = descriptions[key as keyof typeof EnvSchema.shape];
		if (!description && key.startsWith("VULN_WORKBENCH_RUNTIME_")) {
			description = `隔離runtimeの${key.slice("VULN_WORKBENCH_RUNTIME_".length).toLowerCase()}。初期値。資格確認で保存したruntime設定が優先。`;
		}
		if (!description && key === "VULN_WORKBENCH_MAVEN_RESOLVER_IMAGE")
			description = "Maven依存解決専用image。";
		if (!description && /^(NIGHTWORKERS_|VULN_WORKBENCH_)/.test(key)) {
			const unit = /_BYTES$/.test(key)
				? "bytes"
				: /_SECONDS$|_SEC$/.test(key)
					? "秒"
					: /_HOURS$/.test(key)
						? "時間"
						: "件数または資源量";
			description = `${key.replace(/^(NIGHTWORKERS_|VULN_WORKBENCH_)/, "").toLowerCase()}の上限・設定（${unit}）。有効範囲はEnvSchemaとruntime設定schemaに従う。`;
		}
		if (!description)
			throw new Error(`Environment key needs documentation: ${key}`);
		const empty = schema.safeParse(undefined);
		const optional = empty.success ? "省略可" : "必須";
		return `| \`${key}\` | ${optional} | ${description} |`;
	});
	return `# 環境変数リファレンス\n\nEnvSchemaから生成。編集はscripts/generate-env-reference.tsへ。\n\nすべて起動時に読取り、変更にはプロセス再起動が必要です。省略可は機能が利用可能という意味ではありません。暗号化鍵・送信先・許可ルートなどは利用機能に応じて必要です。ここに実環境の値は出力しません。\n\nSQLite保存済みruntime設定は環境変数の初期値より優先します。PROJECT_ALLOWED_ROOTSは環境設定のみで、管理者が.envへ設定します。既定値の最終解決はreadAppEnvとruntimeSettingsFromAppEnvが正です。.env.exampleは最小構成と任意例です。\n\n生成: \`bun run env:reference\`、照合: \`bun run env:reference -- --check\`。\n\n| キー | 起動時入力 | 用途 |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
}

if (import.meta.main) {
	const output = "spec/generated/environment.md";
	const rendered = renderEnvReference();
	if (process.argv.includes("--check")) {
		if ((await readFile(output, "utf8")) !== rendered)
			throw new Error("environment_reference_stale");
	} else await writeFile(output, rendered);
}
