# Phase 7: Scan Profile Orchestration and Static MVP Hardening Plan

## Purpose

この計画は、vulnWorkbench の Phase 7 として、Phase 6 までに追加した複数 CLI security tool を scan profile として束ね、静的/依存/secret/IaC 診断の MVP v1 を閉じるためのもの。

Phase 7 の到達点は、profile ID を指定すると 1 つの scan run 内で複数 tool が実行され、保存済み artifact / finding / evidence をもとに summary、grouping、review、decision、report まで確認できる状態である。

重要な責務境界:

- heavy scan work は `scan:profile` CLI に委譲する。
- API/UI は profile 選択、CLI 起動、保存済み結果の表示に限定する。
- LLM は scan 実行や source 探索をしない。LLM review は保存済み finding/evidence/artifact snippet のレビューだけを行う。
- report は保存済み DB record と artifact だけから deterministic に生成する。

Phase 7 は動的検証基盤ではない。Docker toolbox、sandbox reproduction、fuzzing、DAST は後続 Phase で扱う。

## Source Baseline

前提実装:

- scan run / tool run / artifact / finding / evidence が保存できる。
- Semgrep/Gitleaks/OSV-Scanner/Trivy adapter が host CLI runner と deterministic normalizer を持つ。
- 各 tool CLI は raw JSON/stdout/stderr artifact、tool metadata、finding/evidence を保存できる。
- LLM review、reviewer decision、Markdown report export が存在する。
- `scan_runs.status` は `queued | running | completed | failed | cancelled` の既存 enum を使う。

実装前に CLI で確認する baseline:

```bash
bun run scan:semgrep -- --project-id <project-id> --profile semgrep-baseline
bun run scan:gitleaks -- --project-id <project-id> --profile gitleaks-baseline
bun run scan:osv -- --project-id <project-id> --profile osv-baseline
bun run scan:trivy -- --project-id <project-id> --profile trivy-baseline
```

確認すること:

- 各 command が JSON stdout だけを返す。
- 各 command が独立した scan run を作成する現状を把握する。
- Phase 7 の profile runner では、個別 CLI をそのまま直列実行して複数 scan run を作らない。
- 既存 adapter/normalizer の実処理を共有関数へ切り出し、1 つの scan run に複数 tool run を追加できる境界を作る。

## Scope

Phase 7 で実装するもの。

- static scan profile config
- `GET /api/scan-profiles`
- `scan:profile` CLI
- 1 scan run 内で複数 tool を順番に実行する profile runner
- profile runner から既存 adapter/normalizer を呼ぶ共有 tool execution 境界
- tool ごとの required/optional、timeout、option 設定
- partial failure の保存と profile outcome metadata
- scan summary builder
- cross-tool grouping の最小実装
- `GET /api/scans/:id/summary`
- `GET /api/scans/:id/groups`
- UI の profile selector、scan start、summary/group 表示
- multi-tool static MVP fixture
- report で multi-tool scan summary/grouping を参照できる最小拡張

Phase 7 で実装しないもの。

- Docker toolbox runner
- sandbox reproduction
- sanitizer/fuzzing
- DAST/browser automation
- CI 連携
- patch workflow
- tool install automation
- tool version pinning
- parallel execution
- durable background queue
- cross-tool finding merge/delete
- LLM による repository/source 探索

## Definition of Done

Phase 7 は、次を満たしたら完了とする。

- `bun run scan:profile -- --project-id <project-id> --profile baseline` で profile scan を実行できる。
- profile scan は 1 つの `scan_runs` record と、profile 内 tool 分の `tool_runs` を作る。
- tool ごとの raw JSON/stdout/stderr artifact が保存される。
- finding/evidence は tool ごとに保存され、既存の review/decision/report flow で扱える。
- 1 つの optional tool が失敗しても、他 tool の結果が消えない。
- required tool が失敗した場合の scan outcome が deterministic に保存される。
- `scan_runs.status` は既存 enum のまま使い、partial success は `scan_runs.metadata.profileOutcome` に保存する。
- summary API が tool 別 status、finding count、severity count、artifact count、error を返す。
- grouping API が deterministic group key と finding IDs を返す。
- grouping は finding を削除/上書きしない。
- UI から profile を選択して scan を開始し、summary/grouped findings を確認できる。
- report が multi-tool scan の summary と grouping を表示できる。
- LLM provider 未設定でも profile scan と report 生成が完了する。
- `bun run verify` が通る。

## Scan Profile Model

Phase 7 では DB 管理ではなく static config で開始する。保存場所は `api/modules/scans/profiles.ts` を第一候補にする。UI と CLI の型共有が必要なら `shared/schemas/scan-profile.schema.ts` を追加する。

Profile 例:

```text
baseline:
  semgrep default static rules
  gitleaks detect
  osv-scanner recursive manifest/lockfile scan
  trivy filesystem vuln/secret/config scan

secrets:
  gitleaks detect
  trivy filesystem secret scan

dependencies:
  osv-scanner recursive manifest/lockfile scan
  trivy filesystem vulnerability scan

iac:
  semgrep IaC rules if configured
  trivy config scan
```

Profile config fields:

```text
id
name
description
enabled
defaultTimeoutSec
tools[]
```

Tool entry fields:

```text
toolId
displayName
required
timeoutSec
options
failurePolicy
```

`failurePolicy`:

```text
fail_profile:
  required tool failure should make profileOutcome failed unless another required tool completed and policy says partial is allowed

warn_and_continue:
  optional tool failure should be recorded but should not discard completed tool results
```

Phase 7 では、profile config を API response に出すときに実行 command 文字列や host path をそのまま出さない。表示用には tool ID、name、required、timeout、説明だけを返す。

## Orchestration Policy

Profile runner の原則:

- tool 実行は逐次にする。
- profile runner が scan run を 1 つ作る。
- 各 adapter はその scan run に tool run、artifact、finding、evidence を追加する。
- stdout は profile runner でも JSON だけにする。
- raw artifact は tool ごとに保存する。
- `scan_events` に profile/tool lifecycle event を記録する。
- profile outcome は tool run 結果から導出する。
- downstream mutation は必要な DB 更新が成功してから完了扱いにする。

Status 方針:

```text
scan_runs.status = completed:
  profile runner自体は完走した。
  profileOutcome は completed または completed_with_warnings。

scan_runs.status = failed:
  setup failure、project lookup failure、required tool全滅、またはDB/artifact保存に失敗した。

scan_runs.status = cancelled:
  Phase 7では新規cancel APIは作らない。既存cancelled値は壊さない。
```

`scan_runs.metadata.profile`:

```json
{
  "profileId": "baseline",
  "profileVersion": 1,
  "profileOutcome": "completed_with_warnings",
  "continueOnToolFailure": true,
  "toolOrder": ["semgrep", "gitleaks", "osv", "trivy"],
  "toolResults": [
    {
      "toolId": "semgrep",
      "toolRunId": "...",
      "required": true,
      "status": "completed",
      "findingCount": 3,
      "error": null
    }
  ]
}
```

`completed_with_warnings` は DB enum ではなく metadata value として扱う。shared `scanRunStatusSchema` に追加しない。

## Tool Execution Boundary

Phase 6 の個別 CLI は、それぞれ独立 scan run を作る前提になっている可能性がある。Phase 7 では個別 CLI を profile runner からそのまま shell 実行しない。

実装方針:

```text
scan:semgrep CLI
  parse args
  create scan run
  call runSemgrepIntoScan(...)

scan:profile CLI
  parse args
  create one scan run
  call runSemgrepIntoScan(...)
  call runGitleaksIntoScan(...)
  call runOsvIntoScan(...)
  call runTrivyIntoScan(...)
```

共有関数の候補:

```text
runToolIntoExistingScan({
  db,
  project,
  scanRunId,
  toolId,
  profileToolOptions,
  artifactStorage,
  timeoutSec
})
```

この境界で守ること:

- source/repo scan は tool runner が CLI process として実行する。
- LLM は呼ばない。
- API route から adapter/normalizer を直接呼ばない。
- shell interpolation を避け、argv 配列で process を起動する。
- tool unavailable、timeout、invalid JSON、parse warning を tool result として保存する。
- tool が失敗しても、既に保存済みの他 tool result を消さない。

## Profile Outcome Rules

Profile outcome は deterministic に計算する。

```text
completed:
  required tools all completed
  optional tools either completed or skipped without error

completed_with_warnings:
  required tools all completed
  at least one optional tool failed, timed out, or produced parse warnings
  at least one required tool completed with non-fatal parse warnings but saved deterministic findings/evidence

failed:
  setup failure
  no required tool completed
  any required tool failed, timed out, or produced no valid result
  artifact/DB save failure after scan run creation
```

`continueOnToolFailure=true` の場合:

- required tool が 1 つ失敗しても後続 tool を実行してよい。
- ただし最終 outcome は required tool の成功/失敗から計算するため、required failure があれば `profileOutcome=failed` にする。

`continueOnToolFailure=false` の場合:

- required tool failure で後続 tool を実行しない。
- scan run は failed にする。

## Scan Summary

Phase 7 では `scan_summaries` table を追加しない。summary は DB の保存済み record から deterministic に build し、必要なら `scan_runs.summary` と `scan_runs.metadata.profileSummary` に snapshot を保存する。

Summary builder input:

- scan run
- tool runs
- artifacts
- findings
- evidence
- latest decisions
- completed reviews count

Summary response:

```json
{
  "scanRunId": "...",
  "profileId": "baseline",
  "profileOutcome": "completed_with_warnings",
  "tools": [
    {
      "toolId": "semgrep",
      "toolRunId": "...",
      "status": "completed",
      "required": true,
      "exitCode": 0,
      "findingCount": 3,
      "severityCounts": {
        "critical": 0,
        "high": 1,
        "medium": 2,
        "low": 0,
        "info": 0,
        "unknown": 0
      },
      "artifactCount": 3,
      "error": null
    }
  ],
  "totals": {
    "findingCount": 7,
    "artifactCount": 12,
    "reviewedFindingCount": 2,
    "decidedFindingCount": 1
  }
}
```

Summary builder は source file を読まない。保存済み DB record と artifact metadata だけを見る。

## Cross-Tool Grouping

Phase 7 では dedupe を完璧にしない。finding を削除/統合せず、表示用 group を deterministic に計算する。

DB table は追加しない。最小実装では `GET /api/scans/:id/groups` が on-demand で group を返す。report で snapshot が必要な場合は report 生成時に同じ builder を呼ぶ。

Grouping key 候補:

```text
dependency:
  ecosystem + packageName + installedVersion + advisoryId

secret:
  detector/ruleId + primaryLocation.path

source:
  sourceTool category + ruleId + primaryLocation.path + startLine

iac/config:
  ruleId + target/resource path
```

Group response:

```json
{
  "groups": [
    {
      "id": "sha256:<stable-key>",
      "groupKey": "dependency:npm:lodash:4.17.20:GHSA-...",
      "title": "lodash 4.17.20 advisory group",
      "severity": "high",
      "findingIds": ["..."],
      "sourceTools": ["osv", "trivy"],
      "metadata": {
        "strategy": "dependency"
      }
    }
  ]
}
```

Grouping rules:

- group ID は stable key から生成する。
- finding order は severity rank、sourceTool、ruleId、path、line、id で sort する。
- severity は group 内の最大 severity にする。
- group には finding IDs だけを入れ、finding row を変更しない。
- grouping failure は summary/API error に閉じ込め、finding/evidence/report artifact を消さない。

## CLI Contract

追加 script:

```json
{
  "scan:profile": "bun run api/cli/scan-profile.ts"
}
```

Command shape:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline
```

Options:

```text
--timeout-sec <seconds>
--continue-on-tool-failure true|false
--output-summary <path>
--dry-run true|false
```

`--dry-run true`:

- tool を実行しない。
- profile config、tool order、required/optional、resolved timeout を JSON stdout に出す。
- scan run は作らない。

Success JSON:

```json
{
  "ok": true,
  "scanRunId": "...",
  "profileId": "baseline",
  "status": "completed",
  "profileOutcome": "completed_with_warnings",
  "toolResults": [
    {
      "toolId": "semgrep",
      "toolRunId": "...",
      "status": "completed",
      "findingCount": 3
    }
  ]
}
```

Failure JSON:

```json
{
  "ok": false,
  "scanRunId": "...",
  "profileId": "baseline",
  "status": "failed",
  "profileOutcome": "failed",
  "message": "Required tool failed: semgrep",
  "toolResults": []
}
```

CLI stdout は JSON だけにする。progress log は `scan_events` または stderr に出す。

## API Contract

追加 API:

```text
GET  /api/scan-profiles
POST /api/projects/:id/scans
GET  /api/scans/:id/summary
GET  /api/scans/:id/groups
```

Required behavior:

- project ownership を確認する。
- `GET /api/scan-profiles` は static config の表示用 subset を返す。
- `POST /api/projects/:id/scans` は heavy scan work を API process 内で直接実行しない。
- `POST /api/projects/:id/scans` は local MVP では `scan:profile` CLI を argv 配列で起動する bridge として実装してよい。
- API bridge は CLI JSON stdout を parse し、scanRunId/profileOutcome/toolResults を返す。
- API bridge は shell string を組み立てない。
- timeout、exit code、stderr tail を明確な error にする。
- summary/groups は保存済み DB record だけから build する。

Request:

```json
{
  "profile": "baseline",
  "continueOnToolFailure": true,
  "timeoutSec": 600
}
```

Response:

```json
{
  "scan": {
    "id": "...",
    "status": "completed",
    "profile": "baseline"
  },
  "profileOutcome": "completed_with_warnings",
  "toolResults": []
}
```

Phase 7 では background job queue を作らない。API の同期 bridge が実用上長すぎる場合は、Phase 7 実装を止めて job queue の別計画を作る。

## Frontend Scope

- Scans 画面に profile selector を追加する。
- profile の tool list、required/optional、timeout を表示する。
- Run scan button を追加する。
- 実行中/成功/失敗/警告を表示する。
- scan summary panel を追加する。
- tool 別 status、finding count、severity count、artifact count を表示する。
- grouped findings を最小表示する。
- group から元 finding detail へ移動できるようにする。

UI は source file を読まない。API の scan summary/groups/findings/artifacts response だけを表示する。

## Report Integration

既存 report builder は multi-tool finding を扱える前提だが、Phase 7 では次を最小追加する。

- Scan Summary に profile ID と profile outcome を表示する。
- Tool Summary に profile order と required/optional を表示する。
- Appendix に grouping snapshot を表示する。
- grouping が取得できなくても report 生成は止めない。

Report builder は引き続き deterministic にする。生成時に scan を再実行しない。LLM に report 本文を生成させない。

## Implementation Steps

### P0: Baseline Inspection

- `git status --short` で作業前の未コミット変更を把握する。
- Phase 6 tool CLIs の JSON stdout、exit code、scan run 作成箇所を確認する。
- scan run/tool run status と metadata の現状を確認する。
- UI の Scans 導線と既存 API route を確認する。

Completion criteria:

- profile runner が再利用する adapter/normalizer 境界が明確である。
- 個別 CLI をそのまま呼ぶと複数 scan run になるかどうかが確認済みである。

### P1: Profile Config and Schema

- static profile config を追加する。
- profile response schema を追加する。
- `GET /api/scan-profiles` を追加する。
- invalid profile ID の error を定義する。

Completion criteria:

- CLI/API/UI が同じ profile list を参照できる。
- `--dry-run true` で tool order と required/optional が確認できる。

### P2: Shared Tool Execution Boundary

- 既存個別 CLI から「既存 scan run に tool result を追加する処理」を切り出す。
- Semgrep/Gitleaks/OSV/Trivy を同じ interface で呼べるようにする。
- tool unavailable、timeout、invalid JSON、parse warning を tool result として返す。
- 既存個別 CLI の挙動を壊さない。

Completion criteria:

- 個別 CLI は引き続き単体 scan run を作れる。
- profile runner は同じ tool logic を 1 scan run 内で再利用できる。

### P3: Profile Runner CLI

- `api/cli/scan-profile.ts` を追加する。
- profile runner が scan run を 1 つ作る。
- tool を profile order で逐次実行する。
- partial failure と profile outcome を metadata に保存する。
- stdout JSON と `--output-summary` を実装する。

Completion criteria:

- baseline profile で複数 tool run が同じ scan run に保存される。
- optional tool failure でも completed tool の artifact/finding が残る。

### P4: Summary and Grouping Builders

- scan summary builder を追加する。
- grouping builder を追加する。
- `GET /api/scans/:id/summary` を追加する。
- `GET /api/scans/:id/groups` を追加する。

Completion criteria:

- tool 別 finding count と severity count が返る。
- deterministic grouping が返る。
- grouping failure で primary finding/evidence を失わない。

### P5: API Bridge and UI

- `POST /api/projects/:id/scans` を追加する。
- API bridge から `scan:profile` CLI を argv 配列で起動する。
- profile selector と scan execution UI を追加する。
- summary/group 表示を追加する。

Completion criteria:

- UI から baseline profile scan を実行できる。
- UI は保存済み result を表示し、source scan を直接行わない。

### P6: Report and Fixture Verification

- report に profile summary/grouping snapshot を追加する。
- multi-tool fixture を追加する。
- CLI scan -> summary -> grouping -> report の流れを確認する。

Completion criteria:

- multi-tool scan report に tool summary と grouping が含まれる。
- LLM review/decision は任意の後続作業として成立し、profile execution の必須依存になっていない。

## Verification Commands

基本確認:

```bash
git diff --check
bun run test
bun run verify
```

Profile dry-run:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --dry-run true
```

Expected:

- scan run は作られない。
- JSON stdout に profile ID、tool order、required/optional、timeout が出る。

Profile execution:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --continue-on-tool-failure true \
  --output-summary /tmp/vuln-workbench-profile-summary.json
```

Expected:

- scan run が 1 つ作られる。
- tool runs が profile 内 tool 分作られる。
- findings/evidence/artifacts が tool ごとに保存される。
- summary JSON が stdout と output file で一致する。
- failed optional tool が他 tool result を消さない。

API summary:

```bash
curl -s http://localhost:<port>/api/scans/<scan-run-id>/summary
curl -s http://localhost:<port>/api/scans/<scan-run-id>/groups
```

Expected:

- summary は tool 別 status/finding/severity/artifact count を含む。
- groups は stable group ID と finding IDs を含む。

Report:

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown \
  --output /tmp/vuln-workbench-profile-report.md
```

Expected:

- report が生成される。
- report に profile outcome、tool summary、grouping appendix が含まれる。
- report 生成中に scan tool や LLM は実行されない。

Failure handling:

- adapter failure は該当 `tool_runs` と profile metadata に閉じ込める。
- setup failure は `scan_runs.status=failed` にする。
- optional failure は `profileOutcome=completed_with_warnings` にする。
- required failure は `profileOutcome=failed` にする。`continueOnToolFailure=true` は後続 tool を続けるだけで、required failure を warning 扱いにはしない。
- grouping failure で finding/evidence/report artifact を削除しない。
- API bridge が CLI JSON を parse できない場合、stderr tail を含む明確な error にする。

## Stop Conditions

- Docker toolbox を同時に入れたくなる。
- parallel execution を必須にしたくなる。
- durable queue がないと UX を成立させられない。
- grouping のために finding row を削除/上書きしたくなる。
- LLM review を profile execution に必須化したくなる。
- API process 内で adapter/normalizer を直接実行したくなる。
- source file を UI/API/LLM が読んで補完したくなる。
- `scan_runs.status` enum に `completed_with_warnings` を追加したくなる。

## Handoff to Phase 8

Phase 8 では、Phase 7 の profile runner が使う tool execution backend を Docker toolbox に差し替え可能にする。

Phase 7 から Phase 8 に渡す必要があるもの:

- profile runner の tool execution interface
- profile config の tool options
- tool result metadata
- artifact storage path contract
- timeout/resource option の表現
- API/UI の runner 非依存な summary/group 表示
