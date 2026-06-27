# Phase 25: Unified Scan Profile DAST Plan

## Purpose

この計画は、vulnWorkbench の scan 起動 UX を `ScanProfile` 中心に統一し、DAST を個別タブ・個別 profile・手動 target 操作ではなく、統一 scan profile の step として扱うための実装計画である。

目標は次の 2 つ。

1. ユーザーが通常導線で選ぶ概念を `Project` と `ScanProfile` に絞る。
2. Static tools と DAST を同じ scan run の診断 evidence として扱い、より実用的な Web app 診断 profile を作る。

この変更では、DAST の内部モデルを消さない。`dast_target_configs`, `dast_profile_configs`, `dast_runs`, `dast_artifacts`, `dast_evidence` は、対象解決、実行制約、証跡管理、report 統合のために維持する。ただし、`SavedTarget`, `Manual Target Origin`, `DAST Profile` は通常のユーザー操作の主語にしない。

## Core Principle

UI の主語と実行モデルの主語を分ける。

```text
User-facing model:
  Project
    -> ScanProfile
      -> Run
      -> Findings / Evidence / Report

Internal execution model:
  ScanProfile
    -> static step(s)
    -> dast step(s)
      -> auto target resolver
      -> ephemeral or persisted DAST target config
      -> DAST profile preset
      -> DAST run / artifacts / evidence
```

ユーザーには「何を診断するか」を profile として選ばせる。内部では、DAST が必要とする target validation、request budget、origin normalization、artifact/evidence 保存を既存モデルで維持する。

## Current Baseline

現状の主導線:

```text
Static scan:
  Project
    -> StaticTools tab
    -> ScanProfile
    -> scan:profile

DAST:
  Project
    -> DAST tab
    -> Auto DAST or Manual Target Origin / SavedTarget
    -> DAST Profile
    -> scan:dast
```

既存の責務:

- `api/modules/scans/profiles.ts`
  - Static tools の scan profile を定義する。
  - `semgrep`, `gitleaks`, `osv`, `trivy` を profile step として持つ。
- `api/modules/scans/profile-runner.ts`
  - scan run を作成し、profile tools を順に実行する。
  - 現状は static tool id のみを扱う。
- `api/modules/dast/target-preparer.ts`
  - project `package.json` scripts から起動計画、port、origin、readiness check を推定する。
- `api/modules/dast/dast-runner.ts`
  - DAST target/profile validation、DAST run、finding/evidence/artifact 保存を担う。
  - 既存 scan run に attach できるが、現在は親 scan run status も更新する。
- `drizzle/0008_dast.sql`
  - DAST run/artifact/evidence は `scan_run_id` を持ち、scan report に統合できる。
- `web/src/domains/scans/`
  - StaticTools と DAST の起動 UI が分離している。
  - DAST は target/profile 操作をユーザーに見せている。

実装前に採取する baseline:

```bash
git status --short
git diff --check
bun run scan:profile -- --profile baseline --dry-run true
bun run scan:profile -- --profile detailed-security --dry-run true
bun run scan:dast -- --project-id <project-id> --profile http-baseline --auto-target true --dry-run true
```

可能なら、実プロジェクトで次も採取する。

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --final-report true

bun run scan:dast -- \
  --project-id <project-id> \
  --profile http-baseline \
  --auto-target true
```

確認すること:

- Static scan の profile metadata、tool order、report が記録される。
- Auto DAST が project-derived origin を使う。
- DAST run が `scan_run_id` に紐づき、report の DAST summary に現れる。
- DAST target cleanup が機能し、一時起動 process が残らない。

## Target UX

通常導線:

```text
1. Project を選ぶ
2. Scan Profile を選ぶ
3. Run Scan を押す
4. Results / Findings / Evidence / Report を見る
```

通常導線から外すもの:

- `SavedTarget` selection
- `Manual Target Origin`
- `DAST Profile` selection
- DAST 専用起動タブ

通常導線に出してよいもの:

- 選択 profile が DAST を含むかどうか
- auto target の推定結果
- 起動 script 名
- resolved origin
- readiness status
- request budget
- DAST が失敗した場合の理由

通常導線には出さず、Advanced / Troubleshooting に退避するもの:

- manual origin override
- saved target inspection
- persisted DAST target config editing
- route path / form selector configuration
- runner override
- max request / timeout override

## Target Profile Catalog

初期 profile は、ユーザーに診断意図が伝わる単位に整理する。

### Source Baseline

目的: 速い静的基本診断。

Steps:

- `semgrep`
- `gitleaks`
- `osv`

### Web App Baseline

目的: 通常の Web app に対して、static と HTTP runtime evidence を一度で取る。

Steps:

- `semgrep`
- `gitleaks`
- `osv`
- `dast:http-baseline` with `auto-project-start`

DAST failure policy:

- 初期は `warn_and_continue`
- auto target が解決できない場合は scan 全体を失敗にしない。
- report には runtime coverage gap として明示する。

### Full Security Scan

目的: 広めの静的診断と bounded DAST を合わせた網羅寄り診断。

Steps:

- `semgrep`
- `gitleaks`
- `osv`
- `trivy`
- `dast:http-baseline` with `auto-project-start`

DAST failure policy:

- `warn_and_continue`
- static critical failure は既存 policy に従う。

### Runtime HTTP Check

目的: 起動可能な Web app に対して HTTP baseline evidence だけを素早く取る。

Steps:

- `dast:http-baseline` with `auto-project-start`

DAST failure policy:

- `fail_profile`
- runtime check 単独 profile なので、target 起動不能は profile 失敗にする。

### Secrets, Dependencies, Runtime Exposure

目的: 漏洩、依存関係、公開面の組み合わせ診断。

Steps:

- `gitleaks`
- `osv`
- `trivy`
- `dast:http-baseline` with `auto-project-start`

DAST failure policy:

- `warn_and_continue`

## Data Contract

`ScanProfile` は static tool だけでなく、異なる種類の step を持てるようにする。

初期案:

```ts
type ScanProfileStep =
  | {
      kind: "static_tool";
      toolId: "semgrep" | "gitleaks" | "osv" | "trivy";
      displayName: string;
      required: boolean;
      timeoutSec?: number;
      failurePolicy: "fail_profile" | "warn_and_continue";
      options?: Record<string, unknown>;
    }
  | {
      kind: "dast";
      profileId: "http-baseline";
      displayName: string;
      required: boolean;
      timeoutSec?: number;
      failurePolicy: "fail_profile" | "warn_and_continue";
      target: {
        mode: "auto_project_start";
      };
      options?: {
        maxRequests?: number;
        readinessTimeoutMs?: number;
      };
    };
```

互換方針:

- 既存 `tools` 配列は、移行中は static step として読み替え可能にする。
- API response では `steps` を返す。
- UI 側の古い `tools` 参照は段階的に `steps` へ寄せる。
- DB の `scan_runs.profile` は profile id のまま維持する。
- `scan_runs.metadata.toolResults` は互換のため維持し、追加で `stepResults` を保存する。

`stepResults` 初期案:

```ts
type ScanProfileStepResult =
  | {
      kind: "static_tool";
      toolId: string;
      status: "completed" | "failed" | "skipped";
      findingCount: number;
      toolRunId: string | null;
      exitCode: number | null;
      error: string | null;
    }
  | {
      kind: "dast";
      profileId: string;
      status: "completed" | "failed" | "skipped";
      outcome: string | null;
      findingCount: number;
      dastRunId: string | null;
      targetOrigin: string | null;
      error: string | null;
      autoTarget?: {
        scriptName: string;
        command: string[];
        port: number;
        origin: string;
        warnings: string[];
      };
    };
```

## Execution Design

`profile-runner` を orchestration owner にする。

```text
runProfileScan
  -> create scan_run(running)
  -> for each step
       static_tool -> runToolIntoExistingScan
       dast        -> runDastStepIntoExistingScan
  -> compute profileOutcome from all step results
  -> update scan_run once with final status / metadata
  -> generate final report
```

DAST step adapter:

```text
runDastStepIntoExistingScan
  -> resolve project repo path
  -> prepareDastTargetWorkspace(repoPath)
  -> create ephemeral DAST target config
  -> run DastRunner with existing scanRunId
  -> do not let DastRunner finalize parent scan_run
  -> disable ephemeral target config after execution
  -> stop prepared process in finally
  -> return DAST step result
```

Required DAST runner change:

- Add attach mode, for example `manageScanRunStatus?: boolean`.
- Default behavior remains current behavior for standalone `scan:dast`.
- Unified scan profile path passes `manageScanRunStatus: false`.
- In attach mode, `DastRunner` may create/update `dast_runs`, findings, evidence, artifacts.
- In attach mode, `DastRunner` must not mark the parent scan run completed or failed.

Failure behavior:

- Static tool failure follows existing `required` / `failurePolicy` semantics.
- DAST step failure follows its step `failurePolicy`.
- DAST auto target failure should produce a structured `stepResult` with failure kind where possible.
- If a DAST step is `warn_and_continue`, final scan status may be `completed` with `profileOutcome: "completed_with_warnings"`.
- If a DAST step is `fail_profile`, final scan status becomes `failed`.

## UI Design

Primary scan form:

- One profile picker.
- Profile cards or compact list show:
  - profile name
  - diagnostic intent
  - included checks
  - estimated intensity label such as `Fast`, `Balanced`, `Deep`
  - whether runtime DAST evidence is included
- One `Run Scan` button.

When selected profile includes DAST:

- Show a compact preflight panel.
- Text should focus on resolved facts, not configuration knobs.

Example content:

```text
Runtime target: auto-detected from project scripts
Start command: pending until run
Scope: local loopback, bounded HTTP baseline
Budget: 20 requests
```

During or after run:

```text
Runtime target: bun run dev
Origin: http://127.0.0.1:29831
Readiness: passed
DAST evidence: completed / findings / inconclusive / failed
```

Remove from normal scan creation panel:

- DAST tab as a peer of StaticTools
- saved target dropdown
- manual target origin input
- DAST profile dropdown
- separate Auto DAST button

Keep in Advanced / Troubleshooting:

- saved target list
- manual origin run
- DAST profile config editor
- route/form configuration

Results UI:

- Keep DAST evidence in scan result details.
- DAST run rows should appear as part of the selected scan run, not as a separate launch history.
- If DAST was skipped or failed, show it as coverage gap, not as an invisible omission.

## Report and Review Design

Report should treat DAST as part of the selected scan profile.

Required report changes:

- Profile summary lists static and DAST steps.
- DAST summary indicates target origin, profile id, status, outcome, and request budget.
- Zero-finding / diagnostic sections mention whether runtime HTTP evidence was collected.
- If DAST was expected but failed/skipped, report should include a coverage gap.

Review bundle should preserve DAST context:

- Include `stepResults`.
- Include DAST run summaries by `scanRunId`.
- Include auto target origin and script metadata when available.
- Do not imply runtime coverage when DAST failed before readiness.

## Migration Strategy

Phase 25 should be implemented in reversible slices.

### Slice 1: Profile schema and API response

Tasks:

- Add `ScanProfileStep` union to shared schema.
- Convert existing static profiles to expose `steps`.
- Preserve `tools` compatibility for current runner and tests.
- Update `/api/scan-profiles` sanitized response to include `steps`.
- Add tests for profiles that include DAST step metadata without exposing unsafe raw options.

Verification:

```bash
bunx vitest run api/routes/scan-profiles.route.test.ts
bun run scan:profile -- --profile baseline --dry-run true
```

Stop conditions:

- Existing static profile dry-run changes order unexpectedly.
- API leaks command strings or sensitive DAST options.

### Slice 2: DAST attach mode

Tasks:

- Add `manageScanRunStatus` or equivalent option to `DastRunner`.
- Keep standalone `scan:dast` behavior unchanged.
- Add test proving attach mode writes DAST run/evidence but does not finalize parent scan run.
- Add test proving standalone mode still creates or finalizes its own scan run.

Verification:

```bash
bunx vitest run api/modules/dast/dast-runner.test.ts
bunx vitest run api/routes/dast.route.test.ts
```

Stop conditions:

- Standalone DAST CLI stops updating scan run status.
- Attach mode loses DAST findings, artifacts, or evidence.

### Slice 3: Profile runner DAST step adapter

Tasks:

- Add `runDastStepIntoExistingScan`.
- Call `prepareDastTargetWorkspace` for `auto_project_start`.
- Create ephemeral DAST target config internally.
- Disable ephemeral target after execution.
- Stop prepared process in `finally`.
- Return structured DAST step result.
- Add `Web App Baseline` and `Runtime HTTP Check` profiles behind normal profile list.

Verification:

```bash
bunx vitest run api/modules/scans/profile-runner.test.ts
bunx vitest run api/modules/dast/target-preparer.test.ts
bun run scan:profile -- --profile web-app-baseline --dry-run true
```

If a local fixture project is available:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile web-app-baseline \
  --final-report true
```

Stop conditions:

- DAST process remains alive after profile scan.
- DAST step failure overwrites final scan metadata incorrectly.
- `completed_with_warnings` cannot distinguish static failure from DAST coverage gap.

### Slice 4: Report and review integration

Tasks:

- Update scan summary/report builders to read `stepResults`.
- Show DAST as profile step, not unrelated add-on.
- Add coverage gap text when DAST was expected but skipped/failed.
- Ensure existing DAST summary by `scanRunId` still works.
- Update scan review bundle to include DAST step metadata.

Verification:

```bash
bunx vitest run api/modules/scans/report-builder.test.ts
bunx vitest run api/modules/scans/scan-review-bundle.test.ts
bunx vitest run api/modules/scans/summary-builder.test.ts
```

Stop conditions:

- Report says runtime evidence exists when DAST did not run.
- Existing reports for static-only scans regress.

### Slice 5: Scan creation UI

Tasks:

- Replace StaticTools / DAST launch mode with a single scan profile picker.
- Show DAST-included profile metadata in profile description.
- Remove saved target dropdown, manual origin input, DAST profile dropdown, and Auto DAST button from normal creation panel.
- Move low-level DAST controls into Advanced / Troubleshooting or keep route/API-only if no UI is needed yet.
- Keep scan run history and findings/report tabs intact.

Verification:

```bash
bunx vitest run web/src/domains/scans
bun run build:web
```

Manual UI checks:

- Static-only profile can be selected and started.
- DAST-included profile can be selected and started.
- User does not need to type origin or choose saved target.
- DAST failure appears as actionable coverage gap.
- Latest run selection still chooses the newest run.

Stop conditions:

- User can no longer run static-only scan.
- DAST controls disappear without replacement for troubleshooting.
- Run history or selected findings regress.

### Slice 6: Cleanup and documentation

Tasks:

- Update README scan examples.
- Document profile catalog and DAST auto-target behavior.
- Mark old DAST launch UI as Advanced or remove if unused.
- Remove dead controller state only after UI tests and build pass.

Verification:

```bash
git diff --check
bun run verify
```

Stop conditions:

- Repo-wide verify fails due to touched files.
- Documentation claims unsupported browser/form DAST support.

## Non-Goals

- Do not remove DAST DB tables.
- Do not merge DAST runner into static tool runner.
- Do not enable `browser-smoke` until a real browser adapter exists.
- Do not enable `form-baseline` in the unified scan profile path.
- Do not add crawler behavior or arbitrary external URL scanning.
- Do not make DAST target manual entry part of the normal scan creation path.
- Do not require DAST for every scan profile.
- Do not make LLM perform live scanning or repository exploration.
- Do not introduce durable background queue in this phase.
- Do not refactor unrelated scan review, decision, report, or diagnostics workflows unless required by the profile step contract.

## Definition of Done

Phase 25 is complete when:

- Users can start scans from a single profile-centered creation flow.
- Static-only scan profiles continue to work.
- At least one DAST-included profile works through `scan:profile`.
- DAST-included profile requires no manual origin or saved target selection in the normal path.
- DAST auto target origin, command, readiness, and request budget are recorded in scan metadata or DAST metadata.
- DAST evidence and DAST findings attach to the same scan run as static findings.
- DAST failure is represented as a step result and coverage gap, not hidden.
- Standalone `scan:dast` remains functional for advanced/troubleshooting use.
- Markdown report identifies whether runtime HTTP evidence was collected.
- UI no longer presents StaticTools and DAST as peer launch tabs in the primary scan creation path.
- Tests for profile schema, profile runner, DAST attach mode, report integration, and scan UI pass.
- `git diff --check` and `bun run verify` pass, or any unrelated existing verifier failure is documented with a narrower passing gate for touched surfaces.

## Rollout Notes

Recommended rollout order:

1. Land schema/API compatibility first.
2. Land DAST attach mode with no UI changes.
3. Land profile-runner DAST step support.
4. Add the first DAST-included profiles.
5. Update report/review summary.
6. Simplify UI once backend behavior is proven.

This order keeps the existing DAST tab usable while the unified profile path is being built. Remove or hide the normal DAST launch UI only after `web-app-baseline` works end to end through `scan:profile`.

