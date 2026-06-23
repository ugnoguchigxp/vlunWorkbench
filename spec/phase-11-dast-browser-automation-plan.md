# Phase 11: DAST and Browser Automation Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 11として、Web app向けの限定的なDAST/browser automation診断を追加するためのもの。

Phase 11は、local dev serverや明示許可されたtargetに対して、scope検証済みのHTTP/browser checksを実行する。外部targetへの無制限scanではない。

## Source Baseline

前提実装:

- Docker toolbox runnerが存在する。
- dynamic run/reproduction evidenceが保存できる。
- scan profile/report/decision導線が存在する。

## Scope

Phase 11で実装するもの。

- DAST target model
- allowed target validation
- local dev server profile
- HTTP check runner
- browser automation runner
- DAST artifact/evidence保存
- rate limit / timeout
- DAST findings normalizer
- DAST UI panel

Phase 11で実装しないもの。

- external target unrestricted scan
- authenticated browser session recording
- active exploit payload generation
- destructive checks
- CI integration
- SaaS multi-tenant operation

## Target Boundary

許可するtarget:

```text
localhost
127.0.0.1
project-configured local dev origin
explicit allowlisted private network origin if enabled
```

禁止:

```text
arbitrary internet target
wildcard domain
credential stuffing
destructive payload
high rate scan
```

Target validationはDAST実行前に必ず行う。

## DAST Profile Model

Profile例:

```text
http-baseline:
  health check
  security headers
  common path probe
  rate limit: low

browser-smoke:
  load configured routes
  capture console errors
  capture network failures
  screenshot evidence

form-baseline:
  configured forms only
  non-destructive validation checks
```

Phase 11では、crawlerは最小限にする。routesはproject configで明示されたものを優先する。

## Data Model

追加table案:

```text
dast_runs
  id
  project_id
  scan_run_id
  target_origin
  profile
  status
  started_at
  completed_at
  metadata
  created_by_user_id
```

DAST findingsは既存 `findings` にsourceTool `dast` またはtool名で保存する。

Artifacts:

```text
http log
browser console log
network log
screenshot
raw result JSON
```

## Definition of Done

Phase 11は、次を満たしたら完了とする。

- allowlisted targetに対してDAST profileを実行できる。
- target validationが無許可originを拒否する。
- HTTP/browser resultがartifactとして保存される。
- DAST resultからfinding/evidenceが生成される。
- screenshot/log/network artifactを参照できる。
- rate limit/timeoutが効く。
- DAST失敗で既存scan/finding/review/decisionを壊さない。
- `bun run verify` が通る。

## CLI Contract

追加script:

```json
{
  "scan:dast": "bun run api/cli/scan-dast.ts"
}
```

Command shape:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target http://127.0.0.1:3000 \
  --profile http-baseline
```

Optional:

```text
--scan-run-id <scan-run-id>
--browser chromium
--timeout-sec <seconds>
```

Required behavior:

- target validationに失敗したら実行しない。
- stdoutはJSONだけにする。
- browser automation artifactを保存する。

## API Contract

追加API:

```text
GET  /api/projects/:id/dast-targets
POST /api/projects/:id/dast-runs
GET  /api/dast-runs/:id
```

Required behavior:

- project ownershipを確認する。
- target allowlistを確認する。
- DAST runとartifactを返す。

## Frontend Scope

- DAST panelを追加する。
- target origin/profileを選択する。
- run statusを表示する。
- generated DAST findingsをscan findingsに統合表示する。
- screenshot/log artifactを表示する。

## Implementation Steps

### P0: Baseline Inspection

- project configの保存方式を確認する。
- artifact storageでscreenshot/logを扱えるか確認する。
- browser dependencyをどう扱うか確認する。

Completion criteria:

- DAST target configとbrowser runner方式が決まっている。

### P1: Target Config and Validation

- target allowlist schemaを追加する。
- target validationを実装する。
- route/config APIを追加する。

Completion criteria:

- unauthorized targetが拒否される。

### P2: HTTP DAST Runner

- http-baseline profileを追加する。
- headers/common path checksを実装する。
- raw JSON/log artifactを保存する。

Completion criteria:

- local targetに対してHTTP checksを実行できる。

### P3: Browser Runner

- browser-smoke profileを追加する。
- console/network/screenshot artifactを保存する。
- timeoutを実装する。

Completion criteria:

- configured routeをbrowserで開き、artifactを保存できる。

### P4: Normalizer and UI

- DAST resultsをfinding/evidenceへ変換する。
- UIでDAST findings/artifactsを表示する。

Completion criteria:

- DAST findingが既存review/decision/report導線に乗る。

### P5: Verification

- target validation testsを追加する。
- HTTP runner testsを追加する。
- browser smokeを追加する。
- full verifyを実行する。

Completion criteria:

- `bun run verify` が通る。
- `git diff --check` が通る。

## Verification Commands

```bash
bun run test
bun run verify
git diff --check
```

個別確認:

```bash
bun run scan:dast -- --project-id <project-id> --target http://127.0.0.1:3000 --profile http-baseline
```

Expected results:

- unauthorized target is rejected.
- authorized local target produces artifacts.
- DAST findings are saved.

Failure handling:

- target validationが緩い場合はrunner実装を止めてvalidationを先に直す。
- browser dependency failureは環境確認としてfailedに閉じ込める。
- destructive checkが必要になる場合はPhase外として止める。

## Stop Conditions

- arbitrary external target scanを許可したくなる。
- high-rate crawlerを入れたくなる。
- destructive payloadを入れたくなる。
- auth session automationを同時に入れたくなる。

## Handoff to Phase 12

Phase 12では、すべての診断能力を統合し、evidence traceability、security boundary、UI、docs、verificationをhardeningする。
