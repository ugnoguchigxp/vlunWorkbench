# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-%23E36022.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE.md)

[English](README.md) | 日本語

vulnWorkbench は、スキャナー出力を実装に渡せるリスク handoff へ変換するためのローカル脆弱性ワークベンチです。

このプロダクトは、LLM がリポジトリを自由に探索して finding を発明する前提ではありません。重い証跡生成は CLI スキャナー、sandbox reproduction、dynamic check、DAST が担当します。LLM 層は保存済みの scan context をレビューし、scan-level の implementation handoff を作ります。handoff には、対象範囲、優先リスク、実装タスク、受け入れ条件、検証コマンド、非ゴール、次の LLM または実装者へそのまま渡せる prompt が含まれます。

Human `Decision` record は互換性と監査 metadata のために残っていますが、主ワークフローではありません。現在の主経路は次の通りです。

```text
local project
  -> CLI scanners / reproduction / dynamic / DAST
  -> normalized findings, evidence, artifacts, events
  -> scan review
  -> LLM implementation handoff
  -> report readiness preview
  -> Markdown report / next implementation task
```

vulnWorkbench は、隣接する coding-agent system 向けの Static Intelligence source でもあります。scanner-backed diagnostic evidence、軽量な code structure facts、file risk、semantic candidates、risk communities、guardrail material、read-only MCP tools を公開します。ただし、これは source layer です。NightWorkers は ontology、task compilation、queue admission、implementation、verification orchestration を担当し、contextStill は generalized knowledge、reusable procedure、retrieval を担当します。

## できること

- ローカルリポジトリを project として登録します。
- Semgrep、Gitleaks、OSV、Trivy、scan profile、DAST、reproduction、dynamic verification を bounded CLI path で実行します。
- raw artifact、正規化済み finding、evidence、scan event、review、report、diagnostic をローカル SQLite に保存します。
- 保存済みデータだけから scan review bundle を作ります。
- finding review、scan review、report summary を LLM task route に基づいて実行します。
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
| LLM review | 保存済み context を要約し、implementation handoff instruction を作る。 |
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

## 主な UI ワークフロー

1. ローカル project を登録します。
2. static scan profile または個別 scanner を実行します。
3. finding、evidence、tool artifact、scan diagnostic を確認します。
4. Scan Review を実行して scan-level LLM handoff を生成します。
5. handoff quality check を確認します。
   - objective
   - scope
   - finding reference または zero-finding coverage scope
   - implementation tasks
   - acceptance criteria
   - verification commands
   - non-goals
   - saved-context limitation
6. handoff prompt を直接使うか、Markdown として export します。
7. report readiness を確認します。
   - `submission_ready`
   - `internal_review`
   - `incomplete`
8. deterministic Markdown report または LLM-summary report を生成します。

Report controls では、handoff scope と、false positive / deferred / LLM handoff 未作成 finding の include toggle を設定できます。

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

主な環境変数:

| Variable | 目的 |
| --- | --- |
| `DATABASE_URL` | SQLite database path。既定は `file:./data/vuln-workbench.sqlite`。 |
| `JWT_SECRET` | JWT signing secret。production では必ず変更する。 |
| `APP_URL` | public app origin と cookie/CORS の基準。 |
| `CORS_ORIGINS` | 追加で許可する origin。 |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint。 |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key。 |
| `AZURE_OPENAI_DEPLOYMENT` | 既定の Azure chat deployment。 |
| `OPENAI_API_KEY` | OpenAI-compatible provider key。 |
| `OPENAI_BASE_URL` | OpenAI-compatible provider base URL。 |
| `CODEX_SDK_TIMEOUT_MS` | Codex SDK review/report timeout。単位はミリ秒で、既定は `600000`。 |
| `SCAN_EXECUTION_MODE` | scanner runner の一元ポリシー。`host` または `docker`。development は host、production は Docker が既定。 |
| `ALLOW_HOST_SCANNER_EXECUTION` | host scanner 実行を明示的に許可する。production の既定は `false`。 |
| `SCAN_DOCKER_IMAGE` | Docker scanner policy が使う toolbox image。 |
| `PROJECT_ALLOWED_ROOTS` | Web/APIから登録・scanできるproject rootのカンマ区切り一覧。developmentの未設定時はcurrent working directory、productionの未設定時はfail-closed。 |

LLM API key は host 側に置きます。scanner container や scan 対象 project に LLM credential を渡してはいけません。

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

`full-security-scan` は既存 static tool、CycloneDX SBOM、HTTP baseline、Nuclei safe、ZAP baseline、schema が検出できた場合の Schemathesis を順に実行します。Nuclei は固定 safe template set、ZAP は passive baseline、Schemathesis は credential を渡さず GET/HEAD/OPTIONS に限定します。schema 不在や image input 不在は「脆弱性なし」ではなく coverage gap として出力します。

### Individual Scanners

```bash
bun run scan:semgrep -- --project-id <project-id>
bun run scan:gitleaks -- --project-id <project-id>
bun run scan:osv -- --project-id <project-id>
bun run scan:trivy -- --project-id <project-id>
bun run scan:sbom -- --project-id <project-id>
bun run scan:trivy-image -- --project-id <project-id> --image-ref local/app:tag
```

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
  --profile http-baseline \
  --auto-target true
```

保存済み target を指定する場合:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile http-baseline
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
```

`bun run verify` が closeout gate です。commit済みのS11tnext catalog pairを確認してから、
typecheck、lint、format check、test、buildを実行します。

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

プロダクト境界と、未完了の計画書:

- `spec/vuln-workbench-concept.md`
- `spec/static-intelligence-layer-concept.md`
- `spec/contextstill-static-intelligence-bridge-concept.md`
- `spec/project-scan-exploration-reduction-mcp-concept.md`
- `spec/static-intelligence-coding-agent-consumer-companion-plan.md`
- `spec/phase-46-security-release-readiness-plan.md`

実装済みの計画書は working tree から削除し、Git history で参照します。
