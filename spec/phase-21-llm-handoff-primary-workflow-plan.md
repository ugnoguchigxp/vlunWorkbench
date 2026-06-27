# Phase 21: LLM Handoff Primary Workflow Plan

## Purpose

この計画は、vulnWorkbench の scan review を「人間が Decision を手入力する補助」ではなく、「次の LLM または実装者へ渡せる改善依頼書を生成する主成果物」へ寄せるためのもの。

到達点は、scan review 実行後にユーザーが次の問いへ答えられる状態である。

- この scan run から何を次の LLM に依頼すべきか。
- handoff prompt はそのまま渡せる品質か。
- 対象 finding、実装タスク、受け入れ条件、検証、非ゴールは揃っているか。
- finding 0 件でも、追加確認依頼として何を渡せるか。
- 人力 Decision は必須作業ではなく、監査用の任意記録として理解できるか。

## Source Baseline

現在の状態:

- `ScanReviewRunner` は `improvementRequest` を structured output として保存する。
- `ReviewSection` と `ScanResultOverview` は improvement request / handoff prompt を表示できる。
- `workflow-completion.ts` と `report-quality.ts` は scan-level handoff を Decision 未入力の代替信号として扱える。
- `DecisionSection` はまだ finding drawer 内で強い主導線として表示される。
- zero-finding scan では coverage UX はあるが、LLM handoff としての追加確認依頼は弱い。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from scan_reviews; select count(*) from scan_reviews where json_extract(output, '$.improvementRequest.handoffPrompt') is not null;"
```

可能なら UI で次を確認する。

- Run Scan Review 後に handoff prompt が overview に出るか。
- finding を選ばなくても scan-level handoff が見えるか。
- Decision 未入力時に workflow/report がどう表示されるか。

## Scope

Phase 21 で実装するもの。

- LLM改善依頼書の実データ確認導線
- Decision入力の主導線からの格下げ
- Handoff prompt quality preview
- Scan review failure reason UX
- Remediation plan を LLM handoff の構成要素として再定義
- Handoff prompt の Markdown export
- 改善依頼書履歴の表示
- 対象 finding filter 付き scan review / handoff
- Zero-finding scan 用の追加確認 handoff

Phase 21 で実装しないもの。

- 新しい scanner / runner の追加
- report builder の大幅刷新
- PDF export
- multi-user approval
- external issue tracker integration
- LLM provider routing の再設計
- Decision schema の語彙変更
- arbitrary repository file read by LLM

## Target Files

Primary files to change:

- `shared/schemas/scan.schema.ts`
- `api/modules/scans/scan-review-prompt.ts`
- `api/modules/scans/scan-review-runner.ts`
- `api/modules/scans/scan-review-runner.test.ts`
- `api/modules/scans/scan-review-bundle.ts`
- `api/routes/scans.route.ts`
- `web/src/api.ts`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/components/review-section.tsx`
- `web/src/domains/scans/components/decision-section.tsx`
- `web/src/domains/scans/components/remediation-plan-section.tsx`
- `web/src/styles-scans.css`

Optional files to add:

- `web/src/domains/scans/scan-improvement-request.ts`
- `web/src/domains/scans/scan-improvement-request.test.ts`
- `web/src/domains/scans/components/scan-improvement-request-panel.tsx`

## File Responsibilities

- `shared/schemas/scan.schema.ts`
  - Add request/filter schemas only if scan review filtering requires API validation.
  - Keep existing `scanImprovementRequestSchema` compatible.
- `api/modules/scans/scan-review-bundle.ts`
  - Apply finding filters before building the bundle.
  - Preserve existing bundle shape for unfiltered scan review.
- `api/modules/scans/scan-review-prompt.ts`
  - Strengthen instructions for zero-finding handoff and filtered handoff.
  - Do not add repository-file access instructions.
- `api/modules/scans/scan-review-runner.ts`
  - Pass filter options to bundle generation.
  - Preserve structured output validation and Japanese text validation.
- `api/routes/scans.route.ts`
  - Accept optional filter payload for scan review route.
  - Reject invalid filters with 400.
- `web/src/domains/scans/scan-improvement-request.ts`
  - Own all parsing and view-model logic for improvement requests.
- `web/src/domains/scans/components/scan-improvement-request-panel.tsx`
  - Render quality checks, copy, Markdown export, and history summary.
- `web/src/domains/scans/components/decision-section.tsx`
  - Reposition Decision as audit metadata, not the primary workflow.
- `web/src/domains/scans/components/remediation-plan-section.tsx`
  - Show LLM handoff tasks even when Decision metadata is absent.
- `web/src/domains/scans/use-scans-controller.ts`
  - Hold selected filter state and call scan review route with filter options.

## Implementation Gates

Complete each gate before moving to the next.

1. **Gate A: Pure frontend model**
   - Add `scan-improvement-request.ts` and tests.
   - No API or UI behavior changes yet.
2. **Gate B: Scan overview handoff UI**
   - Add reusable panel and remove duplicate parsing from components.
   - Copy/export works with existing saved scan review output.
3. **Gate C: Decision/remediation UX repositioning**
   - Decision form becomes audit-oriented.
   - Remediation can display handoff tasks without saved Decision.
4. **Gate D: Failure UX**
   - Structured failure categories are visible in scan review UI.
5. **Gate E: Filtered and zero-finding backend support**
   - Route, bundle, prompt, runner, and tests support filter options and zero-finding handoff.
6. **Gate F: End-to-end manual check**
   - Run scan review, view/copy/export handoff, and verify workflow/report state.

## Implementation Tasks

### Slice 1: Improvement Request View Model

1. Add `scan-improvement-request.ts`.
2. Export a pure helper:

```ts
type ScanImprovementRequestView = {
  available: boolean;
  sourceReviewId: string | null;
  title: string;
  objective: string;
  handoffPrompt: string;
  qualityChecks: Array<{
    id: "objective" | "scope" | "findings" | "tasks" | "acceptance" | "verification" | "non_goals" | "context_limit";
    label: string;
    status: "ready" | "missing" | "partial";
    reason: string;
  }>;
  readiness: "ready" | "partial" | "missing";
};
```

3. Read only `scanReview.output.improvementRequest`; do not infer missing text.
4. Quality check rules:
   - `objective` ready when objective is non-empty.
   - `scope` ready when at least one scope item exists.
   - `findings` ready when any priority/task item references finding IDs, partial when zero-finding handoff explicitly states coverage scope, missing otherwise.
   - `tasks` ready when at least one implementation task exists.
   - `acceptance` ready when acceptance criteria exist.
   - `verification` ready when verification commands exist.
   - `non_goals` ready when nonGoals exist.
   - `context_limit` ready when constraints or handoffPrompt mention saved context / bundle / stored evidence limitation.
5. Add tests:
   - no scan review returns missing
   - full improvementRequest returns ready
   - missing verificationCommands returns partial
   - missing handoffPrompt returns missing
   - malformed `output.improvementRequest` returns missing
   - zero-finding handoff without finding IDs can be partial but not missing when objective/scope/tasks exist

Acceptance:

- UI does not parse `improvementRequest` ad hoc in multiple components.
- Quality checks are deterministic and tested.
- Helper is framework-independent and has no React imports.

### Slice 2: Scan-Level Handoff Panel

1. Move duplicated improvement request rendering into `ScanImprovementRequestPanel`.
2. Show it in scan overview, not only finding drawer.
3. Include:
   - title
   - objective
   - quality checks
   - top implementation tasks
   - copy handoff button
   - export Markdown button
4. Export Markdown as a client-side download.
5. Keep the panel hidden when no completed scan review has improvementRequest.
6. Markdown export format:

````md
# <title>

## Objective
<objective>

## Scope
- ...

## Priority Plan
- <priority>: <rationale> (<finding ids>)

## Implementation Tasks
### <task title>
<task body>

## Acceptance Criteria
- ...

## Verification Commands
```bash
...
```

## Constraints
- ...

## Non-Goals
- ...

## Handoff Prompt
<handoffPrompt>
````

Acceptance:

- User can use handoff without selecting a finding.
- Handoff copy/export works from scan overview.
- Exported Markdown contains all available sections and does not invent missing sections.

### Slice 3: Decision UI Repositioning

1. Rename the section from primary "レビュアー判断" to compatibility-record wording.
2. Move Decision form below LLM handoff / evidence / remediation guidance inside drawer.
3. Add short text that Decision is optional legacy metadata and the primary output is scan-level implementation handoff.
4. Keep existing save behavior and history.
5. Do not remove Decision support.
6. Exact UI policy:
   - If scan handoff exists, show Decision form collapsed or visually secondary by default.
   - If no scan handoff exists, keep Decision visible as before.
   - Decision history remains visible when records exist.
   - The default decision value remains `needs_fix`.

Acceptance:

- Human Decision no longer reads as triage work or mandatory main workflow when handoff exists.
- Existing decision tests and report behavior remain valid.

### Slice 4: Failure Reason UX

1. Normalize scan review failure reasons into UI categories:
   - provider failure
   - JSON/schema validation failure
   - Japanese language validation failure
   - bundle reference violation
   - unknown
2. Show category, raw error, and next action in scan review UI.
3. Do not change backend error semantics unless needed for parsing.
4. Add frontend helper tests.
5. Suggested parsing:
   - error contains `llm_provider_execution_failed` -> provider failure
   - error contains `llm_structured_output_validation_failed` and `Japanese review text is required` -> Japanese language validation failure
   - error contains `referenced findings not in bundle` -> bundle reference violation
   - error contains `JSON` or `schema` or `validation` -> JSON/schema validation failure
   - fallback -> unknown
6. Suggested next actions:
   - provider failure: check provider route/API key and retry
   - language failure: retry scan review
   - bundle reference violation: retry with current scan bundle
   - JSON/schema failure: retry or inspect prompt/schema mismatch
   - unknown: inspect raw error

Acceptance:

- Users can understand why scan review failed and whether retry is useful.

### Slice 5: Handoff-Oriented Remediation

1. In `RemediationPlanSection`, distinguish:
   - saved remediation metadata
   - LLM handoff recommended task
   - audit-only decision metadata
2. If no Decision exists but handoff exists, show remediation guidance from improvementRequest tasks.
3. Disable persistence-only controls less prominently when they require Decision.
4. Do not create a new remediation table.

Acceptance:

- Remediation is usable as instruction context even without human Decision.

### Slice 6: Target Finding Filters

1. Add filter inputs for scan review/handoff generation:
   - all findings
   - high/critical only
   - weak/missing evidence only
   - new/regressed only
2. Pass filter options to `buildScanReviewBundle` through existing route/runner options.
3. Add bundle tests showing only intended findings are included.
4. Ensure invalid filters fail schema validation.
5. Filter contract:

```ts
type ScanReviewFindingFilter =
  | "all"
  | "high_or_critical"
  | "weak_or_missing_evidence"
  | "new_or_regressed";
```

6. `new_or_regressed` depends on existing comparison data. If baseline comparison is unavailable, route should return 400 or UI should disable the option with an explanation.
7. Backend bundle filtering must be deterministic and tested without relying on UI state.

Acceptance:

- Handoff can be generated for focused implementation scopes.
- Existing unfiltered scan review route behavior remains unchanged.

### Slice 7: Zero-Finding Handoff

1. Extend scan review prompt to produce improvementRequest for zero-finding scans.
2. For zero findings, request should focus on:
   - coverage confirmation
   - missing diagnostics
   - manual review tasks
   - non-goal: claiming safety
3. Add tests with zero-finding scan bundle.
4. Zero-finding handoff must not include fake finding IDs.
5. `priorityPlan.findingIds` and task `findingIds` may be empty only for zero-finding handoff.
6. Handoff prompt must explicitly say that finding 0 does not prove safety.

Acceptance:

- Zero-finding scan can produce a useful follow-up handoff.
- Schema/tests allow empty finding ID arrays for zero-finding handoff but still reject unknown IDs when findings exist.

## Verification

Run after slices:

```bash
bunx vitest run web/src/domains/scans/scan-improvement-request.test.ts
bun test api/modules/scans/scan-review-runner.test.ts
bun run typecheck
bun run verify
```

Run after Gate E:

```bash
bun test api/modules/scans/scan-review-runner.test.ts api/modules/scans/scan-review-bundle.test.ts
```

Expected:

- all frontend helper tests pass
- API scan review tests pass under `bun test`
- `bun run verify` passes
- unfiltered scan review still accepts the old request shape

Manual verification:

- Run scan review on a scan with findings.
- Confirm handoff panel appears in scan overview.
- Copy and export Markdown handoff.
- Confirm Decision form is available but no longer the primary path.
- Run scan review on zero-finding scan and confirm follow-up handoff appears.
- Trigger or fixture a structured validation failure and confirm failure reason UX.

## Definition of Done

Phase 21 is complete only when:

- A scan-level handoff can be produced, viewed, copied, and exported without selecting a finding.
- Decision entry is still available but no longer visually presented as the required primary workflow when handoff exists.
- Handoff quality checks are visible and deterministic.
- Scan review failures are categorized.
- Filtered handoff and zero-finding handoff are covered by tests.
- `bun run verify` passes.

## Stop Conditions

Stop and update this plan before continuing if:

- scan review route cannot accept filtering without changing unrelated API contracts.
- handoff export requires server-side artifact persistence.
- Decision schema changes become necessary.
- zero-finding scan bundle lacks enough context to create a truthful handoff.
- `bun run verify` fails from unrelated changes that cannot be isolated.
