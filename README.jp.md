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

LLM API key は host 側に置きます。scanner container や scan 対象 project に LLM credential を渡してはいけません。

## CLI Workflows

### 外部 agent 向け Security Oracle

外部 orchestrator は、別 DB の内部 ID ではなく repository path を渡します。
CLI は vulnWorkbench 側の project を解決または作成し、stdout に JSON object
を 1 件だけ返します。
外部 contract は意図的に path-only です。scan profile、review policy、output
format、timeout は呼び出し元から渡さず、vulnWorkbench 側が決めます。

```bash
bun run oracle:security -- --project-path /path/to/repo
```

### Profile Scan

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

Project Intelligence の Refresh Analysis は selected scan の derived generation だけを更新します。scanner、review、verification command、report、context registration、task creation は実行しません。以下の export / code-structure command は low-level compatibility path として残ります。

scanner-backed evidence と file risk を export します。

```bash
bun run intelligence:export -- --scan-run-id <scan-run-id>
```

redacted code structure snapshot を抽出します。

```bash
bun run intelligence:code-structure -- \
  --project-path <project-path> \
  --project-id <project-id> \
  --output code-structure.json
```

snapshot を export に付与します。export は、snapshot が scan project に属していることを検証してから含めます。

```bash
bun run intelligence:export -- \
  --scan-run-id <scan-run-id> \
  --code-structure-snapshot code-structure.json
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

read-only MCP wrapper を確認します。

```bash
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

MCP tool は read-only です。

- `vuln_list_knowledge_sources`
- `vuln_get_knowledge_source_manifest`
- `vuln_get_guardrail_material`
- `vuln_get_evidence_bundle`
- `vuln_get_verification_commands`
- `vuln_get_code_structure_snapshot`

これらは persisted generation を読み、対応する tool では optional generation pinning を受け付け、candidate-only JSON を返します。analysis refresh、contextStill knowledge 登録、NightWorkers task 作成、scanner 実行、verification command 実行、raw artifact body / evidence snippet の公開は行いません。Ontology Handoff は NightWorkers 向け evidence-backed material であり、vulnWorkbench は canonical Ontology / Task Compiler を所有しません。

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
| `api/modules/reviews/` | finding review bundle / prompt / runner。 |
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
bun run typecheck
bun run lint
bun run format
bun run test
bun run build
bun run verify
```

`bun run verify` が closeout gate です。typecheck、lint、format check、test、build を実行します。

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

## Planning Documents

現在特に重要な計画書:

- `spec/vuln-workbench-concept.md`
- `spec/phase-21-llm-handoff-primary-workflow-plan.md`
- `spec/phase-22-report-readiness-and-export-quality-plan.md`
- `spec/phase-23-decision-grade-signal-accuracy-plan.md`
- `spec/phase-24-maintainability-and-operational-readiness-plan.md`
- `spec/phase-25-unified-scan-profile-dast-plan.md`
- `spec/static-intelligence-layer-concept.md`
- `spec/contextstill-static-intelligence-bridge-concept.md`
- `spec/phase-32-static-intelligence-agent-query-plan.md`
- `spec/phase-36-static-intelligence-readonly-mcp-wrapper-plan.md`
- `spec/phase-37-static-intelligence-knowledge-source-e2e-fixture-plan.md`
- `spec/phase-38-static-intelligence-code-structure-layer-mvp-plan.md`

古い phase document も履歴として有用ですが、現在の product direction は保存済み診断証跡から LLM implementation handoff と Static Intelligence source bundle を作ることです。
