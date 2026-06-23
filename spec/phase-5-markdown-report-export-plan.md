# Phase 5: Markdown Report Export Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 5として、保存済みfinding/evidence、LLM review、人間のdecisionからMarkdown reportを生成、保存、exportするためのもの。

Phase 5は新しい診断を行わない。Phase 1から4までで作られた一次証拠、LLM review、reviewer decisionを、人間が共有できる報告書へ整形する後段処理である。

## Source Baseline

前提文書:

- `spec/vuln-workbench-concept.md`
- `spec/phase-4-reviewer-decision-workflow-plan.md`

前提実装:

- scan run、tool run、artifact、finding、evidenceが保存されている。
- LLM reviewがfinding単位で保存されている。
- reviewer decisionがfinding単位で保存されている。
- finding detailでevidence/review/decisionを参照できる。

実装前に確認する現在のDB/API前提:

- migrationsは `0001_initial.sql` から `0004_finding_decisions.sql` まで順番に適用できる。
- `scan_artifacts.kind` は現状 `raw_result`, `stdout`, `stderr`, `log`, `normalized_result`, `source_snippet` を扱う。
- `GET /api/scans/:id/findings` はfindingとlatest decisionを返せる。
- `GET /api/findings/:id` はevidence、latest review、latest decisionを返せる。

## Scope

Phase 5で実装するもの。

- report artifact用DB model
- report生成用のdeterministic builder
- Markdown template
- `report:scan` CLI command
- scan report API
- report preview/download UI
- report artifact保存
- report生成テスト

Phase 5で実装しないもの。

- 新しいscan tool adapter
- LLMによる追加調査
- LLMによるreport内容の自由生成
- PDF/HTML export
- patch提案の自動生成
- CI連携
- report承認workflow

## Definition of Done

Phase 5は、次を満たしたら完了とする。

- scan run IDを指定してMarkdown reportを生成できる。
- reportは既存finding/evidence/review/decisionだけから作られる。
- accepted / needs_fix / false_positive / deferred の扱いが明確である。
- raw artifact ID、tool名、rule ID、location、decisionが追跡可能である。
- report生成結果がartifactとして保存される。
- 同じscan dataと同じoptionsで再実行したMarkdown本文が同一になる。
- CLIとAPIの両方からreportを生成できる。
- UIでlatest reportをpreview/downloadできる。
- LLM provider未設定でもreport生成できる。
- `bun run verify` が通る。

## Source of Truth

Report builderの入力はDBに保存済みのrecordだけに限定する。

許可する入力:

```text
scan_runs
tool_runs
scan_artifacts metadata
findings
finding_evidence
finding_reviews
finding_decisions
projects metadata
```

禁止する入力:

```text
LLMへの追加問い合わせ
repo file systemの追加読取
raw artifact全文の無制限展開
現在時刻を本文へ直接埋め込むこと
未保存のUI state
```

Report本文に時刻を出す場合は、scan/review/decision/report recordに保存済みのtimestampだけを使う。生成時刻は `scan_reports.created_at` としてDBに保存してよいが、Markdown本文のdeterministic outputには含めない。

## Deterministic Output Policy

同じscan dataと同じoptionsから同じMarkdownを出すため、次を固定する。

- finding section orderはdecision bucket、severity rank、source tool、rule ID、location path、start line、finding IDの順にsortする。
- decision bucket orderは `needs_fix`, `accepted`, `deferred`, `false_positive`, `undecided` とする。
- severity orderは `critical`, `high`, `medium`, `low`, `info`, `unknown` とする。
- latest decisionは `createdAt desc, id desc` で決める。
- latest reviewは `createdAt desc, id desc` で決める。
- evidence orderはkind、title、createdAt、idでsortする。
- artifact reference orderはkind、format、idでsortする。
- Markdown heading text、section order、empty state textを固定する。
- missing review/decisionは明示的に `Not reviewed` / `Undecided` と出す。

## Report Content Model

Markdown reportの最小構成:

```text
title
scan summary
tool summary
decision summary
accepted / needs_fix findings
deferred findings
false positives
undecided findings
appendix: raw artifact references
appendix: review references
```

各finding sectionの最小項目:

```text
finding id
source tool
rule id
severity
decision
decision reason
primary location
evidence summary
LLM review summary if available
remediation direction if available
raw artifact references
```

Reportは「LLMが発見した問題」ではなく、「CLIが検出し、人間が判断した結果」として表現する。

Decision stateの扱い:

```text
needs_fix:
  修正対象として主セクションに出す。

accepted:
  有効な問題として主セクションに出す。

deferred:
  判断保留として別セクションに出す。

false_positive:
  誤検知として別セクションに出す。defaultでは含めるが、CLI/API optionで除外できる。

undecided:
  decisionが未登録のfinding。defaultでは含める。
```

LLM reviewの扱い:

- latest completed reviewがある場合だけsummary、false positive assessment、evidence strength、remediation directionを引用する。
- failed/running reviewは本文の判断根拠としては使わず、appendixでstatusだけ参照する。
- review outputを一次証拠として表現しない。

## Data Model

Phase 5ではreport専用tableを追加し、Markdown本文は `scan_artifacts` に保存する。

追加migration:

```text
drizzle/0005_scan_reports.sql
```

追加table:

```text
scan_reports
  id
  scan_run_id
  artifact_id
  format
  title
  summary
  options
  status
  error_message
  generated_by_user_id
  created_at
  updated_at
```

`scan_artifacts` には次を追加する。

```text
kind = report
format = markdown
metadata.reportId
```

必要なschema更新:

- `scanArtifactKindSchema` に `report` を追加する。
- `scanReportSchema` を shared schemaへ追加する。
- report作成request schemaを追加する。

Artifact storageにはMarkdown text保存用のmethodを追加する。

候補:

```text
ArtifactStorage.saveTextArtifact(scanRunId, "reports", markdown, filename)
```

既存の `saveLog` をreport保存に流用しない。reportはlogではなく成果物なので、pathは `reports/<report-id>.md` にする。

Report保存はatomicに扱う。

```text
1. report rowをrunningで作る
2. Markdownをbuildする
3. artifact storageへ保存する
4. scan_artifacts rowを作る
5. report rowをcompletedに更新する
```

途中で失敗した場合はreport rowをfailedにし、completed扱いにしない。

## CLI Contract

追加script:

```json
{
  "report:scan": "bun run api/cli/report-scan.ts"
}
```

Command shape:

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown
```

Optional inputs:

```text
--include-false-positives true|false
--include-deferred true|false
--include-undecided true|false
--title <title>
--output <path>
```

Required behavior:

- stdoutはmachine-readable JSONだけにする。
- LLM設定は読まない。
- report生成でfinding/evidence/review/decisionを変更しない。
- output pathが指定された場合もartifact storageへ保存する。
- output pathへ書く場合はartifact storageへ保存した本文と同一contentにする。

Successful output:

```json
{
  "ok": true,
  "scanRunId": "...",
  "reportId": "...",
  "artifactId": "...",
  "status": "completed",
  "sha256": "..."
}
```

Failure output:

```json
{
  "ok": false,
  "scanRunId": "...",
  "reportId": "...",
  "status": "failed",
  "message": "Failed to save report artifact"
}
```

## API Contract

追加API:

```text
POST /api/scans/:id/reports
GET  /api/scans/:id/reports
GET  /api/scan-reports/:id
GET  /api/scan-reports/:id/download
```

Required behavior:

- project ownershipを確認する。
- report生成は保存済みデータだけを使う。
- report downloadはMarkdown textとして返す。
- download responseは `Content-Type: text/markdown; charset=utf-8` を返す。
- download responseは `Content-Disposition` に安定したfilenameを設定する。
- report artifact pathを直接公開しない。
- failed reportはdownloadできない。

`POST /api/scans/:id/reports` request:

```json
{
  "format": "markdown",
  "title": "Security Report",
  "includeFalsePositives": true,
  "includeDeferred": true,
  "includeUndecided": true
}
```

Response:

```json
{
  "report": {
    "id": "...",
    "scanRunId": "...",
    "artifactId": "...",
    "format": "markdown",
    "status": "completed",
    "title": "Security Report",
    "summary": "..."
  }
}
```

## Frontend Scope

- scan detailまたはScans画面にReport panelを追加する。
- report生成buttonを置く。
- latest reportのpreviewを表示する。
- download linkを表示する。
- report生成中、失敗、完了を表示する。
- report optionsは最小限にする。false positive / deferred / undecided のinclude toggleだけでよい。

## Implementation Steps

### P0: Baseline Inspection

- Phase 4後のdecision response shapeを確認する。
- artifact storageにMarkdown保存できるか確認する。
- Scans UIのscan/detail構成を確認する。
- current migrationsの最終番号を確認する。
- report builder用に必要なrepository queryを洗い出す。

Completion criteria:

- report builderに必要なinputが揃っている。
- report保存方式が決まっている。
- `0005_scan_reports.sql` として追加する前提が確認できている。

### P1: Schema and Repository

- `scan_reports` migrationを追加する。
- `scan_artifacts.kind = report` をschemaへ追加する。
- shared schemaを追加する。
- repositoryを追加する。

Completion criteria:

- report recordをcreate/list/getできる。
- artifactとreport recordの紐づきが確認できる。
- failed reportを保存できる。

### P2: Report Builder

- scan/finding/evidence/review/decisionを集約するbuilderを追加する。
- Markdown templateを追加する。
- decision state別のsection分けを実装する。
- deterministic sort policyを実装する。
- snapshot/golden fixtureを追加する。

Completion criteria:

- fixture dataから安定したMarkdownが生成できる。
- 同じfixtureで2回buildして同一文字列になる。
- missing review/decisionがあってもreport生成が壊れない。
- LLM provider未設定でもbuilderが動く。

### P3: CLI and API

- `report:scan` CLIを追加する。
- report APIを追加する。
- download endpointを追加する。
- output pathへの書き出しを追加する。

Completion criteria:

- CLI/APIで同じbuilderを使う。
- stdout/API responseはreport IDとartifact IDを返す。
- failed pathでもmachine-readable JSONを返す。
- download endpointがMarkdown textを返す。

### P4: UI

- report panelを追加する。
- generate/preview/downloadを実装する。
- latest reportとreport historyを表示する。

Completion criteria:

- UIからreportを生成し、preview/downloadできる。
- failed reportのerrorが表示される。

### P5: Verification

- builder unit testを追加する。
- CLI smoke testを追加する。
- route testを追加する。
- fresh migration testを実行する。
- full verifyを実行する。

Completion criteria:

- `bun run verify` が通る。
- `git diff --check` が通る。
- fresh DBで `0005_scan_reports.sql` まで適用できる。

## Verification Commands

```bash
bun run test
bun run verify
git diff --check
```

個別確認:

```bash
rm -f /tmp/vuln-workbench-phase5-fresh.sqlite
DATABASE_URL=file:/tmp/vuln-workbench-phase5-fresh.sqlite bun run db:migrate
bun run report:scan -- --scan-run-id <scan-run-id> --format markdown
bun run report:scan -- --scan-run-id <scan-run-id> --format markdown --output /tmp/vuln-report.md
```

Expected results:

- fresh migrationが `0001` から `0005` まで順に通る。
- Markdown report artifactが保存される。
- report本文にdecision、evidence、raw artifact referenceが含まれる。
- 同じscan/optionsで2回生成したMarkdown本文が一致する。
- output pathの本文とartifact storageの本文が一致する。
- LLM provider未設定でも成功する。
- download endpointが `text/markdown` を返す。

Failure handling:

- reportに必要なdecisionが欠ける場合は、missingとして出力し生成は止めない。
- artifact保存に失敗した場合はreport recordをcompleted扱いにしない。
- API authorization failureはproject ownership checkを優先して直す。
- deterministic snapshotが揺れる場合はsort key、timestamp使用、空section表現を先に直す。
- output pathとartifact contentがずれる場合は書き出し順序を見直し、同じMarkdown stringを使う。

## Stop Conditions

- LLMにreport本文を自由生成させたくなる。
- report生成のために新しいscanを実行したくなる。
- report生成時にfinding statusやdecisionを書き換えたくなる。
- PDF/HTML exportを同時に入れたくなる。
- generatedAtやランダムIDをMarkdown本文へ埋め込み、同一入力で差分が出る設計にしたくなる。

## Handoff to Phase 6

Phase 6では、Semgrep以外のCLI tool adapterを追加する。Phase 5 reportは、複数toolのfindingが増えても同じreport builderで扱える必要がある。
