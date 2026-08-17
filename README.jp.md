# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-%23E36022.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE.md)

[English](README.md) | 日本語

vulnWorkbench は、スキャナー出力を証跡付き診断結果と実装可能なレポートへ自動変換するローカル脆弱性ワークベンチです。

このプロダクトは、LLM がリポジトリを自由に探索して finding を発明する前提ではありません。重い証跡生成は CLI スキャナー、sandbox reproduction、dynamic check、DAST が担当します。scan 完了後、自動パイプラインが scanner の決定論的な事実を保持したまま、保存済み finding を証跡制約付き LLM で評価し、統合 Markdown report を出力します。LLM 出力には criticality、誤検知可能性、exploitability、業務影響、優先度、修正案、証跡参照、仮定、不明点、implementation handoff が含まれます。

Human `Decision` record は任意の互換・監査注釈として残っています。診断、review、report 生成、retry、export の完了条件にはなりません。現在の主経路は次の通りです。

```text
local project
  -> CLI scanners / reproduction / dynamic / DAST
  -> normalized findings, evidence, artifacts, events
  -> deterministic consolidated report
  -> automatic evidence-constrained LLM criticality assessment
  -> final Markdown report / implementation handoff
```

LLM route が利用不能、または構造化出力が拒否された場合も、deterministic report は明示的な limitation code 付きで完了します。認可、active scan の許可、credential、network policy、resource limit は引き続き server 側の安全契約であり、LLM へ委譲しません。

これはプロによるペネトレーションテストの完全代替ではありません。Phase 50の
versioned assetには、任意Semgrep adapter向けの5言語45本のoffline rule、8 ecosystemの
prepared OSV database、明示選択式のdisposable target向けZAP active profile、
deterministic application/threat model、bounded business-logic scenarioが
含まれます。一方、現在のmeasured capability claimは`not_met`です。固定済み
OWASP Benchmarkの実測値はrecall `0.7088`、precision `0.6946`、false-positive
rate `0.3121`であり、固定済みJuice Shop catalogはeligible 20 scenarioに対して
実行証跡がまだありません。認証付き検査は設定済みroute、identity、object、
operationだけを対象とします。network、cloud、AD、mobile、wireless、social
engineering、browser authentication、production active attack、無制限fuzzingは
experimentalまたはプロダクト境界外です。

vulnWorkbench は、隣接する coding-agent system 向けの Static Intelligence source でもあります。scanner-backed diagnostic evidence、軽量な code structure facts、file risk、semantic candidates、risk communities、guardrail material、read-only MCP tools を公開します。ただし、これは source layer です。NightWorkers は ontology、task compilation、queue admission、implementation、verification orchestration を担当し、contextStill は generalized knowledge、reusable procedure、retrieval を担当します。

## できること

- ローカルリポジトリを project として登録します。
- core の Gitleaks、OSV、Trivy adapter と、明示的に有効化した任意 scanner、scan profile、DAST、reproduction、dynamic verification を bounded CLI path で実行します。
- raw artifact、正規化済み finding、evidence、scan event、review、report、diagnostic をローカル SQLite に保存します。
- 保存済みデータだけから scan review bundle を作ります。
- finding review、scan review、report summary を LLM task route に基づいて実行します。
- scan 成功後に scan-level criticality 診断と最終 report 生成を自動実行します。
- scan-level の `improvementRequest` / handoff prompt を生成し、実装作業へ渡せる形にします。
- executive risk summary、workflow completion、evidence quality、scan comparison、report readiness、zero-finding coverage、action queue などの decision-grade signal を表示します。
- deterministic section と任意の LLM summary を含む Markdown report を出力します。
- 保存済み診断証跡から Static Intelligence export、agent-query bundle、semantic search index、risk community、security landscape summary、guardrail material を生成します。
- TypeScript / JavaScript project から redacted lightweight code structure snapshot を抽出します。対象は file、import、export、package edge、route / handler / schema / worker / test / config tag です。
- discovery、manifest、evidence bundle、verification command candidate、guardrail material、code structure snapshot の read-only Static Intelligence MCP surface を提供します。

## プロダクト境界

vulnWorkbench は、証跡生成と LLM による解釈を明確に分離します。

| 領域 | 責務 |
| --- | --- |
| CLI tools | scanner output、log、artifact、deterministic evidence を生成する。 |
| Normalizers | tool output を安定した finding / evidence record に変換する。 |
| Reproduction / dynamic / DAST | bounded な runtime confirmation signal を追加する。 |
| LLM review | 保存済み証跡から criticality と remediation を自動評価し、implementation handoff instruction を作る。 |
| Static Intelligence | scanner-backed evidence、code structure facts、semantic candidate、community、landscape、guardrail material を read model として公開する。 |
| Read-only MCP | DB table access、scanner execution、verification execution、contextStill mutation なしで、外部 agent が Static Intelligence bundle を発見・取得できるようにする。 |
| Reports | risk、evidence quality、handoff status、verification、coverage を Markdown にまとめる。 |
| Human Decision | 任意の互換・監査 record。必須の triage gate ではない。 |

非ゴール:

- LLM による自由形式のリポジトリ監査。
- patch の自動適用。
- 外部承認 workflow。
- finding 0 件を安全証明として扱うこと。
- scan-level LLM handoff が存在するのに、human `Decision` 未入力を通常 blocker として扱うこと。
- scanner、artifact、reproduction、verification の裏付けなしに、code structure facts、semantic similarity、LLM review text を confirmed vulnerability evidence として扱うこと。
- MCP を contextStill registration、NightWorkers task creation、scanner execution、verification command execution の write path として使うこと。
- 外部corpusの性能値と対象固有business workflowのcoverageなしに、プロ診断と
  同等だと主張すること。

## 主な UI ワークフロー

1. ローカル project を登録します。
2. static scan profile または個別 scanner を実行します。
3. deterministic report と証跡制約付き LLM 診断の自動完了を待ちます。
4. finding、evidence、scanner artifact、criticality、業務影響、修正案、仮定、不明点、limitation code を確認します。
5. 自動生成された handoff quality check を確認します。
   - objective
   - scope
   - finding reference または zero-finding coverage scope
   - implementation tasks
   - acceptance criteria
   - verification commands
   - non-goals
   - saved-context limitation
6. handoff prompt を直接使うか、統合 Markdown report を export します。
7. 自動診断 readiness を確認します。
   - `ready`
   - `ready_with_limitations`
   - `failed`
8. 必要な場合だけ、失敗または limitation 付きの LLM / report stage を retry します。
9. legacy report readiness view では次の状態も表示されます。
   - `submission_ready`
   - `internal_review`
   - `incomplete`
manual finding review と `Decision` record は任意注釈であり、この workflow を block しません。Report controls には、これらの注釈に対する互換 filter が残る場合があります。

## Quick Start

fresh clone からの推奨手順:

```bash
bun install
bun run bootstrap
bun run dev
```

`bun run bootstrap` は、必要に応じて `.env` を `.env.example` から作成し、SQLite migration を適用し、local admin user を作成または確認し、login URL と credential を表示します。2回目以降の実行では、既存 admin password は既定で保持されます。

開発サーバー:

```text
http://localhost:29831
```

bootstrap 時に local admin password を再発行する場合:

```bash
bun run bootstrap -- --reset-admin-password
```

bootstrap 後の local readiness を確認する場合:

```bash
bun run bootstrap:check
```

より細かく制御したい場合は、手動 setup も使えます。

```bash
cp .env.example .env
bun run db:migrate
bun run db:seed
```

`bun run db:seed` は local admin user `admin@example.com` を作成または更新します。password を指定しない場合は、生成された password が JSON で出力されます。

```bash
SEED_ADMIN_PASSWORD='<password>' bun run db:seed
printf '%s\n' '<password>' | bun run db:seed -- --password-stdin
bun run db:seed -- --keep-existing-password
```

### SQLite Writer プロセス

ファイル DB への SQLite 書込みは、DB ごとに1つの Writer プロセスが直列化します。Web server、CLI、worker はそれぞれ読取り専用接続を持ちますが、Drizzle の `insert`、`update`、`delete` はすべて Unix socket 上の Writer Client を経由します。Client は最初の更新時に Writer を遅延起動します。`bun run db:writer` で明示起動することもでき、migration も同じ Writer 境界を使います。

DB ファイルはプロセスロックで保護されるため、2つ目の Writer は別の書込み接続を開かず失敗します。通常の Writer request は更新文だけを受け付け、読取りは各プロセス内、migration DDL は migration 操作だけに限定されます。稼働中の instance は `bun run db:writer:health`、production code に別の SQLite 書込み経路が増えていないかは `bun run db:boundary` で検査できます。

Writer に接続できない場合、mutation は直接接続へ fallback せず失敗します。Client は記録された process が存在しない stale lock を除去し、owner 情報のない lock も5秒経過後に回復します。`<database-path>.writer-lock` を手動削除する前に、health command と OS の process 確認で Writer が動いていないことを確認してください。

Writer protocol versionをまたぐupgradeではWriterを再起動してください。Clientは互換性を推測せず、古いWriterとの接続を拒否します。Migration履歴にはSHA-256 checksumを記録し、適用済みmigration fileの後からの変更を拒否します。

## LLM Routing

LLM work は task route によって実行先が決まります。重要な task は次の通りです。

| Task | 用途 |
| --- | --- |
| `finding_review` | 1件の finding と保存済み evidence をレビューする。 |
| `scan_review` | scan-level risk summary と implementation handoff を生成する。 |
| `report_summary` | 生成済み report に任意の LLM summary を追加する。 |

設定は UI から行うか、CLI で修復できます。

```bash
bun run api/cli/llm-route-repair.ts -- \
  --provider <provider-endpoint-id> \
  --model <model-name> \
  --tasks finding_review,scan_review,report_summary
```

起動前または信頼境界に関わる環境変数:

| Variable | 目的 |
| --- | --- |
| `DATABASE_URL` | SQLite database path。既定は `file:./data/vuln-workbench.sqlite`。 |
| `JWT_SECRET` | JWT signing secret。production では必ず変更する。 |
| `APP_URL` | public app origin と cookie/CORS の基準。 |
| `CORS_ORIGINS` | 追加で許可する origin。 |

LLM endpoint、model、task routing、暗号化されたprovider credentialは
**Settings > LLM Providers**で管理します。従来のOpenAI/Azure環境変数は、
既存環境との互換性を保つbootstrap値として利用できます。
scannerの実行方式、host実行許可、Docker imageとresource上限、scanner出力上限、
Codex SDK timeoutは **Settings > Runtime Settings** で設定し、検証後にSQLiteへ
保存されます。従来の環境変数は、既存環境からの移行互換性のため、Runtime
Settingsを最初に保存するまでの初期値としてのみ利用されます。
認証DASTの暗号化キーも同画面で入力または自動生成できます。この値はAPIでは
write-onlyとして扱われ、SQLiteへの保存前に`JWT_SECRET`を使ってラップされます。
環境変数で管理する場合は、従来どおり`DAST_AUTH_ENCRYPTION_KEY`を利用できます。
通常調整しないcapability rolloutの既定値はrelease policyとして
`api/config/appDefaults.ts`に集約しています。

LLM API key は host 側に置きます。scanner container や scan 対象 project に LLM credential を渡してはいけません。Docker scanではmemory、CPU、memory-swap、PID上限を常に適用し、stdout、stderr、構造化結果fileが設定byte上限を超えた場合は失敗として扱います。

### Codex SDK live contract test

Codex SDK の実モデル疎通は通常の `bun run test` / `bun run verify` には含まれません。
次の opt-in command だけが、指定modelで課金対象の Codex turn を1回実行します。

```bash
VULN_WORKBENCH_CODEX_LIVE=1 \
bun run verify:codex-live -- \
  --model <利用可能なモデル>
```

実行には `OPENAI_API_KEY` または `CODEX_API_KEY` が必要です。個人の
`~/.codex` auth cache は再利用せず、一時 `HOME` / `CODEX_HOME` と空の
read-only working directory を使用します。成功時はmodel、duration、token usage、
thread ID、validation結果などの非機密metadataだけを出力し、prompt、response本文、
credentialは出力しません。
既定timeoutは180秒で、`--timeout-ms`により1,000〜300,000ミリ秒の範囲で変更できます。

## CLI Workflows

### 外部 agent 向け Security Oracle

外部 orchestrator は、別 DB の内部 ID ではなく repository path を渡します。
CLI は vulnWorkbench 側の project を解決または作成し、stdout に JSON object
を 1 件だけ返します。
外部 contract は意図的に path-only です。scan profile、review policy、output
format、timeout は呼び出し元から渡さず、vulnWorkbench 側が決めます。

利用可能な scan が得られた後、Oracle は設定済みの `scan_review` route を実行し、
保存された handoff prompt を `review.improvementRequest` として返します。review route
未設定または失敗は成功に見せず `inconclusive` になり、high / critical finding が
ある場合は `security_action_required` が優先されます。

```bash
bun run oracle:security -- --project-path /path/to/repo
```

### Profile Scan

Web UI から開始した scan は `queued` として受理され、HTTP 202 を返します。UI は
保存済み scan state を poll し、取消もできます。終端状態は `scan_runs` が正です。
server 再起動時は古い Web-owned queued/running scan だけを failed に回復し、独立した
CLI scan は書き換えません。

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --timeout-sec 600 \
  --report-output report.md
```

直接 CLI から実行した scan でも、自動診断は既定で有効です。LLM が成功した場合、
`--report-output` には LLM 評価を含む report が出力され、失敗時は limitation を記録した
deterministic report が出力されます。scanner のみを意図する場合に限り
`--automated-diagnostic false` を指定してください。

`baseline` は基本的な static profile です。より広い static coverage が必要な場合:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile detailed-security \
  --timeout-sec 1200 \
  --report-output detailed-report.md
```

Phase 41 の focused profile は、対象 repository に dependency・設定・script を追加せず、bounded な CLI / Docker 実行だけで追加証跡を生成します。

```bash
bun run scan:profile -- --project-path /path/to/repo --profile runtime-web-safe --json
bun run scan:profile -- --project-path /path/to/repo --profile sbom-inventory --json
bun run scan:profile -- --project-path /path/to/repo --profile api-schema-readonly --json
bun run scan:profile -- --project-path /path/to/repo --profile container-image-security --image-ref local/app:tag --json
```

`full-security-scan` は既存 static tool、CycloneDX SBOM、coverage-awareなWeb Passive Standard DAST、Nuclei safe、ZAP baseline、schema が検出できた場合の Schemathesis を順に実行します。Nuclei は固定 safe template set、ZAP は passive baseline、Schemathesis は credential を渡さず GET/HEAD/OPTIONS に限定します。runtimeの計画上限は合計250 requestです。schema 不在、通信失敗、認証失敗、budget打ち切りは「脆弱性なし」ではなく coverage gap / limitation として出力します。

### Individual Scanners

```bash
bun run scan:semgrep -- --project-id <project-id>
bun run scan:gitleaks -- --project-id <project-id>
bun run scan:osv -- --project-id <project-id>
bun run scan:trivy -- --project-id <project-id>
bun run scan:sbom -- --project-id <project-id>
bun run scan:trivy-image -- --project-id <project-id> --image-ref local/app:tag
```

任意Semgrep adapterを明示的に有効化した場合は、リポジトリ所有・tree hash 済みの`curated-sast-v1`を
使用します。内訳は5言語45 rule、各言語6 security family以上で、release
fixtureはpositive 90件、negative 90件です。registryを使う探索実行は
`--config auto`を明示し、その実行は再現不能として記録され、自動レポートも
制限付きreadyになります。
LGPL engineはcore toolboxにも標準profileにも含めません。導入方法とadapter
契約は[`docs/scanner-adapters.md`](docs/scanner-adapters.md)を参照してください。

### 実測security capability

固定済みcorpusとoffline scanner dataを準備・検証してから外部gateを実行します。

```bash
bun run scanner-data:prepare -- .cache/scanner-data/phase-50
bun run security-corpora:prepare
bun run security-corpora:verify
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
  bun run benchmark:all
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
  bun run verify:professional-capability
```

結果は`.artifacts/professional-capability-release-report.json`へ保存されます。
全gateの合格に加え、`VULN_WORKBENCH_PASSING_BENCHMARK_RUN_ID`が永続化済みpassing
run UUIDを参照する場合だけclaimを`met`にできます。観測不足、null denominator、
stale/tampered data、cleanup失敗、passing run未指定のいずれかがあれば
`not_met`のままです。

ZAP activeは既定profileには含まれません。実行には
`runtime-zap-active-lab`または`api-zap-active-lab`の明示選択、feature flag、
有効なinternal Rules of Engagement、local/ephemeral private target、method/path
budget、reset contractが必要です。runnerはLinux Dockerのinternal networkと
bounded gatewayを使い、credentialをZAPへ返しません。browser login/token refreshと
production targetは対象外です。

### Scan Review / Handoff

```bash
bun run review:scan -- \
  --scan-run-id <scan-run-id> \
  --task scan_review
```

Scan review は `scan_reviews.output` に structured output を保存します。ここに `improvementRequest` が含まれます。

UI では handoff scope を選べます。

- all findings
- high / critical
- weak or missing evidence
- new or regressed

### Reproduction

```bash
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile gitleaks-recheck
```

### Dynamic Verification

```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test
```

### DAST

auto-target mode は、project metadata から可能な場合に local target を起動します。

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --profile web-passive-standard \
  --auto-target true
```

保存済み target を指定する場合:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile web-passive-standard
```

標準DASTはconfigured/source/OpenAPI/HTML/redirect/common probeから
same-origin route inventoryを作り、depth、request、response byte、durationの
上限を強制します。execution status、verdict、coverageは別々に保存されます。
finding 0件でもcoverageが`covered`でなければ`no_findings_observed`にはならず、
`inconclusive`または`not_tested`になります。旧`http-baseline`は明示指定時だけ
利用できます。

認証済みread-only実行では
`--profile authenticated-readonly-standard --auth-context-id <id>
--identity-role <role>`を指定し、保存contextにURL/selector/statusの成功assertionを
必須とします。credentialは暗号化され、read APIからは返りません。owned
vulnerable/fixed gateは次で確認できます。

```bash
bun run verify:phase-51-baseline
bun run verify:dast-capability
```

### Report Export

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown \
  --title "セキュリティレポート" \
  --summary-mode deterministic \
  --output report.md
```

LLM summary 付き:

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --summary-mode deterministic_with_llm_summary \
  --output report-with-summary.md
```

Report include control:

```bash
--include-false-positives true|false
--include-deferred true|false
--include-undecided true|false
```

### Static Intelligence

Static Intelligence command は、coding agent と sibling system 向けの CLI-first source contract です。

登録済み scan の primary persisted generation を生成します。code structure snapshot と Static Intelligence export は同じ `generationId` で versioning され、Project Intelligence、manifest、MCP は同じ世代を読みます。

```bash
bun run intelligence:build -- \
  --scan-run-id <scan-run-id> \
  --include-semantic false \
  --pretty true
```

Project Intelligence の Refresh Analysis は selected scan の derived generation だけを更新します。scanner、review、verification command、report、context registration、task creation は実行しません。

scanner-backed evidence と file risk を export します。

```bash
bun run intelligence:export -- --scan-run-id <scan-run-id>
```

現行の Project Structure snapshot を抽出します。

```bash
bun run intelligence:project-structure -- \
  --project-path <project-path> \
  --output project-structure.json
```

agent-facing query bundle を取得します。

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind project_overview

bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind evidence_bundle \
  --finding-id <finding-id>

bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind verification_commands
```

candidate knowledge source と guardrail material を発見・取得します。

```bash
bun run intelligence:knowledge-source -- --scan-run-id <scan-run-id>
bun run intelligence:guardrail-material -- --scan-run-id <scan-run-id>
```

LLM や MCP client を介さず、MCP と同じ persisted project-exploration
catalog contract を CLI から取得します。

```bash
bun run intelligence:exploration-catalog -- \
  --scan-run-id <scan-run-id> \
  --generation-id <generation-id> \
  --path api/routes/example.ts \
  --term routing \
  --term schema
```

focus を複数指定する場合は `--path`、`--module-id`、`--term` を繰り返します。
stdout には machine-readable JSON を一件だけ出力し、repository の scan や mutation は行いません。

Static Intelligence MCP wrapper を確認します。

```bash
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

`STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS` に、MCPから参照可能なrepository rootの親ディレクトリをカンマ区切りの絶対パスで設定してください。未設定時はfail-closedです。
`STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY`の既定値は`registered_only`です。明示的に管理されたfixtureまたはonboarding環境だけ`create_within_allowed_roots`を使用します。MCP requestからこのpolicyを上書きすることはできません。

副作用を持つ明示的なActionは次の1つだけです。

- `vuln_prepare_project_intelligence({ projectPath })`

このActionは永続prepare jobをqueueへ追加し、background workerがstructure-only source recordとStatic Intelligence generationをpublishします。Semgrep、Gitleaks、OSV、Trivyなどの外部security scannerは起動しません。同じcanonical path・同じsource fingerprintの同時要求は1jobへ集約され、fresh generationは再利用されます。

以下はすべてread-only Queryです。

- `vuln_get_project_intelligence_status`
- `vuln_list_knowledge_sources`
- `vuln_get_knowledge_source_manifest`
- `vuln_get_guardrail_material`
- `vuln_get_evidence_bundle`
- `vuln_get_verification_commands`
- `vuln_get_project_structure_snapshot`
- `vuln_get_project_exploration_catalog`

path-first Queryはcanonicalな `{ projectPath }` をstrictに要求し、symlink aliasと内部ID selectorを拒否します。current sourceのreadではready prepare jobに記録されたexact generationを選択し、過去のlatest generationは`stale`としてのみ公開します。未準備なら `not_prepared` と次のActionを返し、Query自身はproject、scan、prepare job、generationを作りません。finding指定は `projectPath + findingFingerprint` を使用し、曖昧なfingerprintは `AMBIGUOUS_FINDING` になります。raw artifact body / evidence snippetは公開しません。

`vuln_get_project_exploration_catalog` の `focus.paths`、`focus.modules`、`focus.terms` は任意です。deterministicかつboundedなcandidateだけを返し、source bodyを公開しません。運用とNightWorkers側の受け入れ条件は [NightWorkers path-first MCP handoff](docs/nightworkers-static-intelligence-mcp.md) を参照してください。

## API Surface

| Method | Path | 目的 |
| --- | --- | --- |
| `GET` | `/api/health` | health check。 |
| `POST` | `/api/auth/login` | login して httpOnly cookie を設定する。 |
| `POST` | `/api/auth/refresh` | refresh token rotation。 |
| `GET` | `/api/auth/me` | 現在の user。 |
| `GET` | `/api/projects` | project 一覧。 |
| `POST` | `/api/projects` | local repository project 登録。 |
| `POST` | `/api/projects/:projectId/scans` | app から scan profile を実行する。 |
| `GET` | `/api/scans?projectId=<id>` | scan run 一覧。 |
| `GET` | `/api/scans/:scanRunId` | scan run detail。 |
| `GET` | `/api/scans/:scanRunId/findings` | latest review / decision metadata 付き finding。 |
| `GET` | `/api/scans/:scanRunId/artifacts` | scan artifact。 |
| `GET` | `/api/scans/:scanRunId/reviews` | scan-level review と handoff output。 |
| `POST` | `/api/scans/:scanRunId/reviews` | scan-level LLM review を実行する。 |
| `GET` | `/api/scans/:scanRunId/diagnostics` | 自動診断の status、readiness、provenance hash、limitation。 |
| `POST` | `/api/scans/:scanRunId/diagnostics/retry` | retry 可能な失敗または limitation 付き自動診断を再実行する。 |
| `POST` | `/api/scans/:scanRunId/reports` | Markdown report を生成する。 |
| `GET` | `/api/scan-reports/:reportId` | report metadata。 |
| `GET` | `/api/scan-reports/:reportId/download` | 生成済み Markdown report を download する。 |
| `GET` | `/api/findings/:findingId` | finding detail と evidence。 |
| `GET` | `/api/findings/:findingId/reviews` | finding-level review history。 |
| `POST` | `/api/findings/:findingId/reviews` | finding-level LLM review。 |
| `GET` | `/api/finding-reviews/:reviewId` | finding review detail。 |
| `GET` | `/api/findings/:findingId/decisions` | 任意の互換 Decision history。 |
| `POST` | `/api/findings/:findingId/decisions` | 任意の互換 Decision record。 |
| `GET` | `/api/finding-decisions/:decisionId` | Decision record detail。 |
| `GET` | `/api/findings/:findingId/reproductions` | reproduction history。 |
| `POST` | `/api/findings/:findingId/reproductions` | reproduction run。 |
| `GET` | `/api/projects/:projectId/dynamic-runs` | dynamic verification history。 |
| `POST` | `/api/projects/:projectId/dynamic-runs` | dynamic verification。 |
| `GET` | `/api/projects/:projectId/dast-runs` | DAST history。 |
| `POST` | `/api/projects/:projectId/dast-runs` | DAST run。 |
| `GET` | `/api/settings/llm` | LLM provider / task-route settings。 |

Protected endpoint には auth cookie が必要です。frontend は 401 を受けると `/api/auth/refresh` を一度試し、成功した場合だけ元の request を再実行します。

## Architecture

| Path | 役割 |
| --- | --- |
| `api/app/` | Hono app composition、server bootstrap、runtime env parsing。 |
| `api/db/schema.ts` | project、scan、finding、review、decision、report、DAST、reproduction、dynamic verification、settings の SQLite/Drizzle schema。 |
| `api/routes/` | HTTP route layer。 |
| `api/cli/` | scan、review、report、diagnostic、migration、seed、auth の CLI entrypoint。 |
| `api/modules/scans/` | scan runner、normalizer、bundle、report、repository、artifact storage。 |
| `api/modules/reviews/` | finding review bundle / runner。 |
| `api/system-context/` | 型付き S11tnext prompt catalog binding、provider execution、prompt-message audit identity。 |
| `contexts/` | `system` / `user` provider message の authoring source。 |
| `api/modules/dast/` | DAST target preparation、runner、repository、normalization。 |
| `api/modules/reproductions/` | sandboxed reproduction profile と execution。 |
| `api/modules/dynamic/` | dynamic verification profile と execution。 |
| `api/modules/llm-settings/` | provider endpoint と task route persistence。 |
| `api/modules/static-intelligence/` | Static Intelligence export、semantic search、agent query、risk community、security landscape、guardrail material、MCP tool、code structure extraction。 |
| `api/providers/` | Azure / OpenAI-compatible / Codex provider adapter と router。 |
| `shared/schemas/` | 共有 Zod schema。 |
| `shared/report-sections.ts` | UI と builder で共有する report section contract。 |
| `web/src/domains/scans/` | scan UI domain、view model、decision-grade helper、panel。 |
| `drizzle/` | SQL migration。 |
| `spec/` | product concept と実装計画。 |
| `scripts/verify.ts` | repository verification pipeline。 |

legacy の knowledge / search / chat file も残っていますが、現在の product center は scan evidence、LLM handoff、report readiness です。Static Intelligence はその上に agent-facing source layer を追加するものであり、scanner evidence を置き換えたり、vulnWorkbench を implementation executor にしたりするものではありません。

## Decision-Grade Models

frontend では、可能な限り pure derivation logic を React state から分離しています。

| Helper | 責務 |
| --- | --- |
| `scan-improvement-request.ts` | `improvementRequest` の type-safe extraction と quality check。 |
| `decision-grade-view.ts` | scan-level executive summary、workflow、comparison、report preview の aggregation。 |
| `risk-summary.ts` | executive risk band、score、key driver、recommended focus。 |
| `workflow-completion.ts` | completion stage、checklist、next best action。 |
| `evidence-quality.ts` | evidence strength と data completeness。 |
| `scan-comparison.ts` | baseline comparison と match confidence。 |
| `report-quality.ts` | report readiness、submission level、generation warning、section state。 |

この分離は意図的です。component は derived model を表示し、raw `scan_reviews.output` を直接 parse したり、report readiness を ad hoc に再解釈したりしない方針です。

## Security Boundary

- command は shell string ではなく structured args として組み立てます。
- runtime artifact は artifact storage path に隔離します。
- scanner output は LLM review / report 利用前に normalize / redact します。
- secret value は finding、log、artifact、LLM-facing context で必要に応じて redact します。
- Docker-based toolbox、reproduction、dynamic、DAST flow は Docker socket を mount しません。
- scan 対象 project environment に LLM provider credential を渡してはいけません。
- DAST は local target または明示的に設定した target に限定します。
- dynamic / reproduction / fuzzing-style check は profile、timeout、artifact policy によって bounded にします。
- LLM review は保存済み scan / finding / evidence context を使います。bundle に含まれない raw repository file、web page、log、runtime state を見たかのように書いてはいけません。
- Static Intelligence export と MCP output は candidate-only read model です。raw artifact body、evidence snippet、private root path、secret value を agent-facing payload に含めてはいけません。
- Code structure snapshot は file path、import/export facts、content hash、package name、tag を含みます。source code body や任意の string literal は含めず、snapshot enrichment は scan project と一致する場合だけ受け入れます。

## Development

```bash
bun run bootstrap
bun run bootstrap:check
bun run s11tnext:check
bun run typecheck
bun run lint
bun run format
bun run test
bun run build
bun run verify
bun run verify:strict
```

`bun run verify` は高速なlocal gateです。commit済みのS11tnext catalog pairを確認してから、
typecheck、lint、format check、test、build、bundle、audit、artifact trackingを実行します。
`bun run verify:strict` はcloseout gateで、さらにWeb/critical coverageとbrowser E2Eを実行します。

LLMへ送る固定のsystem/userメッセージは`contexts/**/*.context.toml`で管理します。変更時は
`bun run s11tnext:lint`、`bun run s11tnext:build`を実行し、
`.s11tnext/catalog.json`と`.s11tnext/catalog.generated.ts`を同時にcommitしてください。
provider経路では生成された`invocation.role`を使用し、監査には本文を複製せず
`messageHash`と`promptSequenceHash`を保存します。

Static Intelligence source contract については、fixture gate も使います。

```bash
bun run fixture:static-intelligence-source
```

期待結果は、stdout に `ok: true` の JSON object が1件だけ出ること、MCP tool name が揃っていること、redaction check が通ること、hash / material id が安定していること、final output に temp path や unsafe marker string が含まれないことです。失敗した場合は、MCP / knowledge-source surface に依存する前に failed check 名を確認します。

### Test Runner Split

`bun:sqlite` を import しない frontend/domain test は Vitest で直接実行できます。

```bash
bunx vitest run web/src/domains/scans/report-quality.test.ts
```

`bun:sqlite` を import する API / scan-module test は Bun 経由で実行してください。

```bash
bun test api/modules/scans/scan-review-runner.test.ts
bun test api/modules/scans/report-builder.test.ts
```

package の `test` script と `scripts/verify.ts` はこの分離を反映しています。

## Git 差分ターゲットスキャン

`diff-source-baseline` profileでは、commit、merge-baseを使うrange、現在の
working treeで変更されたファイルを対象にできます。変更可能なworking treeは、
実行前にpreviewで対象digestを固定します。

```bash
bun run scan:profile -- \
  --project-path . \
  --profile diff-source-baseline \
  --target working-tree \
  --base HEAD \
  --include-untracked true \
  --preview true
```

commitは`--target commit --head <ref>`、branch相当のrangeは
`--target range --base <ref> --head <ref>`を使用します。Scans UIにも同じ
target選択、coverage preview、target digest表示があります。

V1はresolved target snapshotにある変更ファイルをwhole-fileで検査します。
そのためfindingは変更ファイルまたは変更後の依存状態に関連しますが、選択した
commitがfindingを新規導入したことは証明しません。削除、除外、binary、未対応、
size上限超過のpathはcoverage recordとして残ります。diff scanを理由にLLM
reviewが自動実行されることはありません。

## NightWorkers Security Scan Provider

feature flag配下の`/api/integrations/nightworkers/v1` APIで、NightWorkersから
scope付きproject security scan、再開可能なevent、redaction済みfinding、
非同期Markdown reportを利用できます。integration認証には専用のhash保存
bearer credentialを使用し、browser cookieは受け付けません。

migration順序、credentialの作成・rotation・revoke、canary、monitoring、
rollbackは
[NightWorkers security scan provider runbook](docs/nightworkers-security-scan-provider-runbook.md)
に従ってください。

## Operational Checks

migration の適用:

```bash
bun run db:migrate
```

local SQLite に `finding_decisions.metadata` migration が適用済みか確認する場合:

```bash
sqlite3 data/vuln-workbench.sqlite "select count(*) from pragma_table_info('finding_decisions') where name='metadata';"
```

期待値:

```text
1
```

`artifacts/` 配下の scan / reproduction / DAST / dynamic / report output は生成データであり、commit しません。commit 前に tracked artifact state を確認します。

```bash
git ls-files artifacts
git diff --cached --name-only -- artifacts
```

## Concept と進行中の計画書

`spec/README.md`を仕様書のcanonical indexとして使用します。security/releaseの
active completion planは`spec/phase-56-capability-product-completion-plan.md`です。
長期conceptとintegration pilotはindex内で別に分類します。

完了または置換された実装計画書は`spec/.archived/`へ移します。この隠しディレクトリは
LLMの通常探索対象に含めず、明示的な履歴監査を依頼された場合だけ参照します。
