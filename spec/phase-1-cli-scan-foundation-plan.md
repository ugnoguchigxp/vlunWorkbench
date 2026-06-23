# Phase 1: CLI Scan Foundation Implementation Plan

## Purpose

この計画は、vulnWorkbench MVP の第一弾として、CLI主導のscan結果を保存し、後続のtool adapter、LLM review、UI reviewを載せられる基盤を実装するためのもの。

第一弾では、実際のSemgrep/Gitleaks/OSV/Trivy adapterやLLM reviewは実装しない。まず、scan domain、CLI command contract、artifact/finding/evidence保存基盤を固める。

この段階の完了条件は、LLMなし、実ツールadapterなしでも、fixtureまたは手元で用意したscan artifactをCLI経由で取り込み、DB上のscan、artifact、finding、evidenceとして確認できること。

## Source Concept

前提コンセプトは `spec/vuln-workbench-concept.md`。

守るべき原則は次の通り。

```text
CLI scan command
  -> raw artifacts / logs / SARIF / JSON
  -> deterministic parser / normalizer
  -> findings / evidence store
  -> LLM review
  -> human review / report
```

第一弾では、このうち次だけを実装対象にする。

```text
CLI scan command contract
  -> raw artifact registration
  -> deterministic fixture normalizer
  -> findings / evidence store
```

## Definition of Done

Phase 1 は、次を満たしたら完了とする。

- scan domain のDB schemaとDrizzle schemaが追加されている。
- project、scan、tool run、scan artifact、finding、evidence の関係が保存できる。
- CLI command がscan runを作成し、artifactを保存または登録できる。
- fixture artifactからdeterministicにfinding/evidenceを作れる。
- LLM provider未設定でも全Phase 1機能が動く。
- API経由でproject、scan、finding、evidenceを取得できる。
- 既存のchat/search/artifacts機能とscan artifactが混同されていない。
- `bun run verify` が通る。

## Non-Goals

Phase 1 では次を実装しない。

- Semgrep/Gitleaks/OSV/Trivyの実adapter
- Docker toolbox image
- 実scan toolの起動
- LLM review
- reviewer decision workflow
- Web UIの本格的なreview画面
- sandbox
- DAST
- fuzzing
- patch提案
- report生成
- RAGによるrepo探索
- LLMによる任意ファイル読取

## Baseline Step

実装開始前に、現在の基盤が通っていることを確認する。

Command:

```bash
bun run verify
```

Expected:

```text
OK typecheck
OK lint
OK format
OK test
OK build
OK verify complete
```

Failure handling:

- 既存のverifyが失敗する場合、Phase 1の実装には入らず、失敗箇所が既存不具合か計画前提の不足かを切り分ける。
- Phase 1で触る予定のない既存機能を広く修正しない。

## Domain Model

Phase 1 で追加する永続化対象は次の通り。

```text
projects
scan_runs
scan_events
tool_runs
scan_artifacts
findings
finding_evidence
```

### projects

ローカルrepoの登録単位。

Minimum fields:

```text
id
owner_user_id
name
repo_path
default_branch
metadata
created_at
updated_at
```

Rules:

- `repo_path` はローカル絶対pathを保存する。
- pathの存在確認は登録時に行う。
- Phase 1ではrepo内容のindexingはしない。
- 同一user内で同じrepo_pathを重複登録しない。

### scan_runs

1回のCLI scan contract実行を表す。

Minimum fields:

```text
id
project_id
profile
status
started_at
completed_at
created_by_user_id
summary
metadata
created_at
updated_at
```

Allowed status:

```text
queued
running
completed
failed
cancelled
```

Rules:

- Phase 1では永続queueは作らない。
- CLI実行中に `running`、正常終了時に `completed`、例外時に `failed` にする。
- LLM reviewの状態は持たない。

### scan_events

scanの進行と保存処理を追跡するイベント。

Minimum fields:

```text
id
scan_run_id
level
event_type
message
data
created_at
```

Allowed level:

```text
debug
info
warn
error
```

Initial event types:

```text
scan.started
artifact.registered
artifact.parse_started
artifact.parse_completed
finding.created
scan.completed
scan.failed
```

Rules:

- Phase 1ではSSE配信はしない。
- APIから時系列取得できればよい。

### tool_runs

将来のtool adapter実行結果を載せるための枠。

Minimum fields:

```text
id
scan_run_id
tool_name
tool_version
command
status
exit_code
started_at
completed_at
metadata
created_at
updated_at
```

Rules:

- Phase 1では実toolを起動しないため、fixture/import由来の `tool_run` を作れるようにする。
- `command` には再実行の参考になる非secret情報だけを入れる。
- stdout/stderr全文は直接ここに持たず、artifactとして保存する。

### scan_artifacts

raw artifact、log、normalized artifactへの参照。

Minimum fields:

```text
id
scan_run_id
tool_run_id
kind
format
path
sha256
size_bytes
metadata
created_at
```

Allowed kind:

```text
raw_result
stdout
stderr
log
normalized_result
source_snippet
```

Allowed format examples:

```text
json
sarif
text
markdown
```

Rules:

- DBには巨大contentを入れない。
- artifact本体は `artifacts/scans/<scanRunId>/...` に保存する。
- pathはworkspaceからの相対path、または設定済みartifact rootからの相対pathで保存する。
- `sha256` と `size_bytes` を必ず保存する。

### findings

deterministic normalizerで作成されたfinding。

Minimum fields:

```text
id
scan_run_id
project_id
source_tool
rule_id
title
description
severity
confidence
status
primary_location
fingerprint
metadata
created_at
updated_at
```

Allowed severity:

```text
info
low
medium
high
critical
unknown
```

Allowed confidence:

```text
static
```

Allowed status:

```text
open
```

Rules:

- Phase 1のfindingはCLI artifact由来のみ。
- LLM仮説由来findingは作らない。
- `fingerprint` は同一scan内の重複抑止に使う。
- Phase 1ではcross-scan dedupeはしない。

### finding_evidence

findingとartifact/source locationを結びつける。

Minimum fields:

```text
id
finding_id
kind
title
artifact_id
location
snippet
metadata
created_at
```

Allowed kind:

```text
tool-output
source-location
scan-log
```

Rules:

- Phase 1では `llm-review` evidence は作らない。
- source snippetはdeterministic parserが作れる場合だけ保存する。
- secret値は保存前にredactする。

## CLI Contract

Phase 1 のCLIは、実toolを起動するscanではなく、scan runを作成し、artifactを保存し、fixture normalizerを走らせる基盤CLIとする。

Command shape:

```bash
bun run scan:import -- \
  --project-id <project-id> \
  --profile baseline \
  --tool fixture \
  --artifact <path-to-json-or-sarif> \
  --format json
```

package script:

```json
{
  "scan:import": "bun run api/cli/scan-import.ts"
}
```

Inputs:

```text
project-id
profile
tool
artifact
format
```

Outputs:

```text
scanRunId
toolRunId
artifactIds
findingCount
evidenceCount
status
```

Output format:

```json
{
  "ok": true,
  "scanRunId": "...",
  "toolRunId": "...",
  "artifactIds": ["..."],
  "findingCount": 1,
  "evidenceCount": 2,
  "status": "completed"
}
```

Failure output:

```json
{
  "ok": false,
  "scanRunId": "...",
  "status": "failed",
  "message": "..."
}
```

Rules:

- CLIは標準出力にmachine-readable JSONを出す。
- エラー時も可能ならscan eventを保存する。
- artifact fileが存在しない場合、scan runは作らず入力エラーで終了してよい。
- projectが存在しない場合、scan runは作らず入力エラーで終了してよい。
- parser失敗時はscan runを `failed` にし、raw artifactは残す。

## Fixture Normalizer

Phase 1では、実tool adapterの代わりにfixture normalizerを実装する。

Purpose:

- DB schema、artifact保存、finding/evidence生成、API取得の流れを先に固める。
- 後続のSemgrep/Gitleaks等のadapterが従う保存契約を明確にする。

Fixture format:

```json
{
  "tool": "fixture",
  "results": [
    {
      "ruleId": "fixture.rule",
      "title": "Fixture finding",
      "description": "Synthetic finding for scan foundation verification.",
      "severity": "medium",
      "path": "src/example.ts",
      "startLine": 1,
      "endLine": 3,
      "snippet": "const value = input;",
      "evidence": [
        {
          "kind": "tool-output",
          "title": "Fixture raw result"
        }
      ]
    }
  ]
}
```

Rules:

- fixture normalizerはPhase 1検証専用。
- 実tool固有の複雑なmappingはここに入れない。
- 後続adapter実装時に共通interfaceへ寄せられるよう、入力と出力を明確に分ける。

## API Scope

Phase 1で追加するAPIは読み取り中心にする。

Endpoints:

```text
GET  /api/projects
POST /api/projects
GET  /api/projects/:projectId

GET  /api/scans/:scanRunId
GET  /api/scans/:scanRunId/events
GET  /api/scans/:scanRunId/artifacts
GET  /api/scans/:scanRunId/findings

GET  /api/findings/:findingId
```

Rules:

- 既存auth middlewareを使う。
- Phase 1ではWeb APIからscanを起動しない。
- CLIとAPIは同じDB schemaを使う。
- `api/routes/artifacts.route.ts` のconversation artifactとは別route、別tableとして扱う。

## Web Scope

Phase 1では本格UIを作らない。

実装してよい最小UI:

- Project list
- Project registration form
- Project detail内のscan list
- Scan detailへの最小リンク

実装しないUI:

- Finding review workflow
- LLM review panel
- Report view
- live progress
- graph/inspector

UIはPhase 1の必須完了条件ではない。APIとCLIで基盤が確認できることを優先する。

## Task Plan

### P0. Baseline and Scope Guard

Work:

- `bun run verify` を実装前に実行する。
- `spec/vuln-workbench-concept.md` と本計画の非目標を確認する。
- `plan.md` や既存READMEの大幅書き換えはしない。

Verification:

```bash
bun run verify
```

Expected:

```text
OK verify complete
```

Stop condition:

- verifyが既存状態で失敗する場合、Phase 1実装へ進まない。

### P1. Shared Domain Schemas

Work:

- `shared/schemas/scan.schema.ts` を追加する。
- project、scan、artifact、finding、evidence のAPI入出力schemaを定義する。
- enum値はPhase 1最小に限定する。

Verification:

```bash
bun run typecheck
bun run test
```

Expected:

- schemaの型がfrontend/backend双方でimport可能。
- Phase 1で使わないstatusやconfidenceを過剰に増やしていない。

Failure handling:

- 型循環が出た場合、DB型とAPI schemaを分離する。

### P2. Database Schema and Migration

Work:

- `api/db/schema.ts` にscan domain tablesを追加する。
- `drizzle/0002_scan_foundation.sql` を追加する。
- 外部キー、index、unique制約を追加する。
- existing `artifacts` tableは変更しない。

Verification:

```bash
DATABASE_URL=:memory: bun run db:migrate
bun run typecheck
```

Expected:

- migrationがclean DBに適用できる。
- Drizzle schemaがtypecheckを通る。

Failure handling:

- migrationとschemaがずれた場合、先にSQLを正としてDrizzle schemaを合わせる。

### P3. Scan Repositories

Work:

- `api/modules/scans/` を追加する。
- ProjectRepository、ScanRepository、ArtifactRepository、FindingRepositoryを実装する。
- 保存処理は小さく分け、CLIとrouteから再利用できる形にする。

Verification:

```bash
bun run test -- api/modules/scans
```

Expected:

- project作成、scan作成、artifact登録、finding/evidence作成のrepository testが通る。
- finding作成時にevidenceも紐づく。

Failure handling:

- repositoryが肥大化する場合、DB table単位ではなくworkflow単位のserviceを別に切る。

### P4. Artifact Storage

Work:

- `api/modules/scans/artifact-storage.ts` を追加する。
- 入力artifactを `artifacts/scans/<scanRunId>/raw/` にコピーする。
- sha256、size、relative pathを計算する。
- text log用の保存helperも用意する。

Verification:

```bash
bun run test -- api/modules/scans/artifact-storage
```

Expected:

- artifact copy後、DB保存用metadataを返せる。
- sha256が同じ入力で安定する。
- artifact root外へのpath traversalを拒否する。

Failure handling:

- path handlingが複雑になる場合、artifact rootを設定値ではなくPhase 1固定値にする。

### P5. Fixture Normalizer

Work:

- `api/modules/scans/normalizers/fixture.ts` を追加する。
- fixture JSON schemaを定義する。
- fixture resultをfinding/evidence DTOへ変換する。
- secret redaction helperを最小実装する。

Verification:

```bash
bun run test -- api/modules/scans/normalizers
```

Expected:

- fixture JSONからfinding/evidence DTOが生成される。
- severity未知値は `unknown` になる。
- snippet内の明らかなsecret token形状はredactされる。

Failure handling:

- redactionが過剰に複雑化する場合、Phase 1では明示的なfixture値のみを対象にする。

### P6. CLI Import Command

Work:

- `api/cli/scan-import.ts` を追加する。
- `package.json` に `scan:import` を追加する。
- CLI引数をparseし、project存在確認、scan run作成、artifact保存、fixture normalize、finding/evidence保存、JSON出力を行う。
- parser失敗時はscanを `failed` にし、eventを残す。
- repository testでは事前にprojectを作成してからCLI workflowを呼び出す。

Verification:

```bash
bun run scan:import -- --project-id <project-id> --profile baseline --tool fixture --artifact <fixture-path> --format json
```

Expected:

```json
{
  "ok": true,
  "status": "completed"
}
```

Failure handling:

- projectがない場合は入力エラーとしてscanを作らない。
- artifact保存後のnormalizer失敗ではscanを `failed` にし、raw artifactは残す。
- 手動確認でproject作成手段がまだない場合は、P7のProject API追加後にmanual smokeを行い、P6では自動テスト内のseed projectで確認する。

### P7. Read APIs

Work:

- `api/routes/projects.route.ts` を追加する。
- `api/routes/scans.route.ts` を追加する。
- `api/routes/findings.route.ts` を追加する。
- `api/app/hono.ts` にroute登録とauth middlewareを追加する。

Verification:

```bash
bun run test -- api/routes/projects.route.test.ts api/routes/scans.route.test.ts api/routes/findings.route.test.ts
```

Expected:

- auth済みuserが自分のproject/scan/findingだけ取得できる。
- scan artifactsはconversation artifacts routeに混ざらない。

Failure handling:

- route test setupが重い場合、repository testで保証した部分とroute auth部分を分ける。

### P8. Minimal Frontend Hooks

Work:

- `web/src/api.ts` にPhase 1 API clientを追加する。
- 本格UIは作らず、後続UI実装が使う型付きfetch関数だけ整える。
- 既存chat/search UIの構造変更はしない。

Verification:

```bash
bun run typecheck
bun run build
```

Expected:

- frontendが新schemaをimportしてbuildできる。
- 既存画面に表示崩れが発生しない。

Failure handling:

- UI変更が広がりそうなら、Phase 1ではAPI client追加だけで止める。

### P9. End-to-End Fixture Smoke

Work:

- `tests/fixtures/scans/fixture-finding.json` を追加する。
- 可能なら `api/modules/scans/scan-import.e2e.test.ts` を追加する。
- clean temp DBでproject作成、scan import、finding/evidence取得まで確認する。

Verification:

```bash
bun run test -- api/modules/scans/scan-import.e2e.test.ts
bun run verify
```

Expected:

- fixture artifactからscan/finding/evidenceが作られる。
- full verifyが通る。

Failure handling:

- e2e testが不安定なら、filesystem temp dirと`:memory:` DBの所有権をtest内に閉じる。

## Completion Review

Phase 1完了前に、次を確認する。

- `scan_artifacts` と既存 `artifacts` が用途・route・table上で分離されている。
- LLM providerへの依存がPhase 1 code pathに入っていない。
- 実tool adapterの実行ロジックが混入していない。
- fixture normalizerが将来adapterの代用品として本番扱いされない名前になっている。
- artifact本体、DB row、finding、evidenceをscanRunIdで追跡できる。
- `bun run verify` が通っている。

## Phase 2 Handoff

Phase 1が完了したら、Phase 2では最初の実tool adapterを1つだけ載せる。

推奨はSemgrep。

Phase 2の開始条件:

- Phase 1のfixture importが安定している。
- artifact保存とfinding/evidence保存の契約が変更なしで再利用できる。
- Semgrep JSONまたはSARIFをfixture normalizerとは別normalizerで取り込める見通しがある。

Phase 2で初めて扱うもの:

- toolboxまたはhost CLI経由の実Semgrep起動
- Semgrep artifact parser
- Semgrep finding mapping
- tool version capture
- scan profileの実体化

LLM reviewはPhase 2にも入れない。LLM reviewは、少なくとも1つの実tool adapterが安定してからPhase 3で扱う。
