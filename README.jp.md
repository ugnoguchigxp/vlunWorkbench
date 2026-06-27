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

## できること

- ローカルリポジトリを project として登録します。
- Semgrep、Gitleaks、OSV、Trivy、scan profile、DAST、reproduction、dynamic verification を bounded CLI path で実行します。
- raw artifact、正規化済み finding、evidence、scan event、review、report、diagnostic をローカル SQLite に保存します。
- 保存済みデータだけから scan review bundle を作ります。
- finding review、scan review、report summary を LLM task route に基づいて実行します。
- scan-level の `improvementRequest` / handoff prompt を生成し、実装作業へ渡せる形にします。
- executive risk summary、workflow completion、evidence quality、scan comparison、report readiness、zero-finding coverage、action queue などの decision-grade signal を表示します。
- deterministic section と任意の LLM summary を含む Markdown report を出力します。

## プロダクト境界

vulnWorkbench は、証跡生成と LLM による解釈を明確に分離します。

| 領域 | 責務 |
| --- | --- |
| CLI tools | scanner output、log、artifact、deterministic evidence を生成する。 |
| Normalizers | tool output を安定した finding / evidence record に変換する。 |
| Reproduction / dynamic / DAST | bounded な runtime confirmation signal を追加する。 |
| LLM review | 保存済み context を要約し、implementation handoff instruction を作る。 |
| Reports | risk、evidence quality、handoff status、verification、coverage を Markdown にまとめる。 |
| Human Decision | 任意の互換・監査 record。必須の triage gate ではない。 |

非ゴール:

- LLM による自由形式のリポジトリ監査。
- patch の自動適用。
- 外部承認 workflow。
- finding 0 件を安全証明として扱うこと。
- scan-level LLM handoff が存在するのに、human `Decision` 未入力を通常 blocker として扱うこと。

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

LLM API key は host 側に置きます。scanner container や scan 対象 project に LLM credential を渡してはいけません。

## CLI Workflows

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

### Individual Scanners

```bash
bun run scan:semgrep -- --project-id <project-id>
bun run scan:gitleaks -- --project-id <project-id>
bun run scan:osv -- --project-id <project-id>
bun run scan:trivy -- --project-id <project-id>
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
| `api/providers/` | Azure / OpenAI-compatible / Codex provider adapter と router。 |
| `shared/schemas/` | 共有 Zod schema。 |
| `shared/report-sections.ts` | UI と builder で共有する report section contract。 |
| `web/src/domains/scans/` | scan UI domain、view model、decision-grade helper、panel。 |
| `drizzle/` | SQL migration。 |
| `spec/` | product concept と実装計画。 |
| `scripts/verify.ts` | repository verification pipeline。 |

legacy の knowledge / search / chat file も残っていますが、現在の product center は scan evidence、LLM handoff、report readiness です。

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

古い phase document も履歴として有用ですが、現在の product direction は保存済み診断証跡から LLM implementation handoff を作ることです。
