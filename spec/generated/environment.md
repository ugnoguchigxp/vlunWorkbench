# 環境変数リファレンス

EnvSchemaから生成。編集はscripts/generate-env-reference.tsへ。

すべて起動時に読取り、変更にはプロセス再起動が必要です。省略可は機能が利用可能という意味ではありません。暗号化鍵・送信先・許可ルートなどは利用機能に応じて必要です。ここに実環境の値は出力しません。

SQLite保存済みruntime設定は環境変数の初期値より優先します。PROJECT_ALLOWED_ROOTSは環境設定のみで、管理者が.envへ設定します。既定値の最終解決はreadAppEnvとruntimeSettingsFromAppEnvが正です。.env.exampleは最小構成と任意例です。

生成: `bun run env:reference`、照合: `bun run env:reference -- --check`。

| キー | 起動時入力 | 用途 |
| --- | --- | --- |
| `NODE_ENV` | 省略可 | 動作環境。development / test / production。既定development。 |
| `HOST` | 省略可 | 待受アドレス。LAN公開時は認証とHTTPS構成を確認する。 |
| `PORT` | 省略可 | 待受ポート。1〜65535。 |
| `DATABASE_URL` | 省略可 | SQLite DBパス。書込みはWriter経由。 |
| `CONTENT_ROOT` | 省略可 | knowledgeのローカルコンテンツ保存先。 |
| `WIKI_STORAGE_BACKEND` | 省略可 | knowledge保存方式。local / azure-blob。 |
| `AZURE_STORAGE_CONNECTION_STRING` | 省略可 | Azure Blob接続文字列。秘密。 |
| `WIKI_BLOB_CONTAINER` | 省略可 | knowledge保存先コンテナ名。 |
| `WIKI_BLOB_PREFIX` | 省略可 | knowledge Blob名のprefix。 |
| `EXA_API_KEY` | 省略可 | Exa検索資格情報。秘密。 |
| `BRAVE_SEARCH_API_KEY` | 省略可 | Brave検索資格情報。秘密。 |
| `OPENAI_API_KEY` | 省略可 | OpenAI互換provider資格情報。秘密。 |
| `OPENAI_BASE_URL` | 省略可 | OpenAI互換APIのURL。送信先制限も確認する。 |
| `CODEX_SDK_TIMEOUT_MS` | 省略可 | SDK呼出し期限（ミリ秒）。保存済みruntime設定が優先。 |
| `AZURE_OPENAI_ENDPOINT` | 省略可 | Azure OpenAI endpoint URL。 |
| `AZURE_OPENAI_API_KEY` | 省略可 | Azure OpenAI資格情報。秘密。 |
| `AZURE_OPENAI_DEPLOYMENT` | 省略可 | Azure chat deployment名。 |
| `AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT` | 省略可 | Azure embedding deployment名。 |
| `LLM_PROVIDER_ALLOWED_HOSTS` | 省略可 | 外向きprovider通信の許可host一覧（カンマ区切り）。 |
| `LLM_SETTINGS_ENCRYPTION_KEY` | 省略可 | 保存するLLM資格情報の暗号化鍵。秘密。 |
| `LLM_SETTINGS_PREVIOUS_ENCRYPTION_KEYS` | 省略可 | 鍵ローテーション時の旧LLM暗号化鍵一覧。秘密。 |
| `DAST_AUTH_ENCRYPTION_KEY` | 省略可 | 保存するDAST認証情報の暗号化鍵。秘密。 |
| `DAST_AUTH_PREVIOUS_ENCRYPTION_KEYS` | 省略可 | 旧DAST暗号化鍵一覧。秘密。 |
| `APP_URL` | 省略可 | ブラウザから利用するアプリURL。originはCORSへ含まれる。 |
| `CORS_ORIGINS` | 省略可 | 許可するブラウザorigin一覧（カンマ区切り）。 |
| `AUTH_COOKIE_SECURE` | 省略可 | Secure cookie。HTTPS環境ではtrue。 |
| `AUTH_COOKIE_SAME_SITE` | 省略可 | Cookie SameSite。lax / strict / none。noneにはSecureが必要。 |
| `JWT_ACCESS_EXPIRES_IN` | 省略可 | access token有効期間（例15m）。 |
| `JWT_REFRESH_EXPIRES_IN` | 省略可 | refresh token有効期間（例7d）。 |
| `SECURITY_HEADERS_MODE` | 省略可 | HTTPS関連headerの方式。auto / http / https。既定auto。 |
| `TRUST_PROXY` | 省略可 | 信頼proxyによる転送headerの利用。 |
| `TRUSTED_PROXY_CIDRS` | 省略可 | 信頼するproxyのCIDR一覧。 |
| `CSP_MODE` | 省略可 | report-only / enforce。productionは既定enforce、それ以外report-only。 |
| `SCAN_EXECUTION_MODE` | 省略可 | docker / host。未指定の既定docker。保存済みruntime設定が優先。 |
| `ALLOW_HOST_SCANNER_EXECUTION` | 省略可 | host選択を許可する。既定false（developmentで明示host設定がある場合はtrue）。trueだけではhostを選択しない。 |
| `SCAN_DOCKER_IMAGE` | 省略可 | scanner image。保存済みruntime設定が優先。 |
| `VULN_WORKBENCH_MAVEN_RESOLVER_IMAGE` | 省略可 | Maven依存解決専用image。 |
| `VULN_WORKBENCH_DOCKER_MEMORY` | 省略可 | docker_memoryの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_DOCKER_CPUS` | 省略可 | docker_cpusの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_DOCKER_PIDS_LIMIT` | 省略可 | docker_pids_limitの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_SCANNER_STDOUT_LIMIT_BYTES` | 省略可 | scanner_stdout_limit_bytesの上限・設定（bytes）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_SCANNER_STDERR_LIMIT_BYTES` | 省略可 | scanner_stderr_limit_bytesの上限・設定（bytes）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_WEB_PROCESS_CONCURRENCY` | 省略可 | web_process_concurrencyの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_WEB_SCAN_QUEUE_LIMIT` | 省略可 | web_scan_queue_limitの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_WEB_SCAN_STEP_TIMEOUT_MAX_SEC` | 省略可 | web_scan_step_timeout_max_secの上限・設定（秒）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_WEB_SCAN_WALL_CLOCK_TIMEOUT_SEC` | 省略可 | web_scan_wall_clock_timeout_secの上限・設定（秒）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `VULN_WORKBENCH_SCAN_EXECUTION_PLAN_V2` | 省略可 | 内部: execution plan v2の有効化。 |
| `VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE` | 省略可 | 隔離runtimeのnamespace_owner_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_NODE_IMAGE` | 省略可 | 隔離runtimeのnode_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE` | 省略可 | 隔離runtimeのmaterializer_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE` | 省略可 | 隔離runtimeのregistry_proxy_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_PROBE_IMAGE` | 省略可 | 隔離runtimeのprobe_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE` | 省略可 | 隔離runtimeのhttp_executor_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_DOCKER_DAEMON_IDENTITY_HASH` | 省略可 | 隔離runtimeのdocker_daemon_identity_hash。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH` | 省略可 | 隔離runtimeのqualification_hash。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_POSTGRES_IMAGE` | 省略可 | 隔離runtimeのpostgres_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_MYSQL_IMAGE` | 省略可 | 隔離runtimeのmysql_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE` | 省略可 | 隔離runtimeのnuclei_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_ZAP_IMAGE` | 省略可 | 隔離runtimeのzap_image。初期値。資格確認で保存したruntime設定が優先。 |
| `VULN_WORKBENCH_RUNTIME_SCHEMATHESIS_IMAGE` | 省略可 | 隔離runtimeのschemathesis_image。初期値。資格確認で保存したruntime設定が優先。 |
| `PROJECT_ALLOWED_ROOTS` | 省略可 | 共通の許可ディレクトリ（カンマ区切り）。空は拒否。実体パスで判定。 |
| `STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS` | 省略可 | MCPの追加許可ルート。共通PROJECT_ALLOWED_ROOTSとの両方を満たす必要がある。 |
| `STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY` | 省略可 | registered_only（既定）/ create_within_allowed_roots。 |
| `NIGHTWORKERS_INTEGRATION_ENABLED` | 省略可 | NightWorkers統合APIの有効化。 |
| `NIGHTWORKERS_INTEGRATION_AUTO_CREATE_PROJECTS` | 省略可 | 許可内projectの自動登録。所有者制約は維持。 |
| `NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES` | 省略可 | 統合APIで許可するprofile ID一覧。 |
| `NIGHTWORKERS_INTEGRATION_PREVIEW_TTL_SECONDS` | 省略可 | integration_preview_ttl_secondsの上限・設定（秒）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_INTEGRATION_IDEMPOTENCY_TTL_HOURS` | 省略可 | integration_idempotency_ttl_hoursの上限・設定（時間）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_INTEGRATION_MAX_CONCURRENT_SCANS` | 省略可 | integration_max_concurrent_scansの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_INTEGRATION_MAX_FINDING_PAGE_SIZE` | 省略可 | integration_max_finding_page_sizeの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_INTEGRATION_MAX_EVENT_PAGE_SIZE` | 省略可 | integration_max_event_page_sizeの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_INTEGRATION_MAX_REPORT_BYTES` | 省略可 | integration_max_report_bytesの上限・設定（bytes）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_INTEGRATION_MAX_REQUEST_BYTES` | 省略可 | integration_max_request_bytesの上限・設定（bytes）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_REPORT_RUNNER_CONCURRENCY` | 省略可 | report_runner_concurrencyの上限・設定（件数または資源量）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED` | 省略可 | Security Intelligence APIの有効化。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED` | 省略可 | 内部: Security Intelligenceの認可比較観測。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS` | 省略可 | Security Intelligence対象project UUID一覧。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_MAX_RESPONSE_BYTES` | 省略可 | security_intelligence_max_response_bytesの上限・設定（bytes）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED` | 省略可 | 内部: workspace grantの有効化。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_TTL_SECONDS` | 省略可 | security_intelligence_workspace_grant_ttl_secondsの上限・設定（秒）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_MAX_REQUEST_BYTES` | 省略可 | security_intelligence_workspace_grant_max_request_bytesの上限・設定（bytes）。有効範囲はEnvSchemaとruntime設定schemaに従う。 |
| `JWT_SECRET` | 省略可 | JWT署名鍵。32文字以上。productionは開発用既定鍵を拒否。秘密。 |
