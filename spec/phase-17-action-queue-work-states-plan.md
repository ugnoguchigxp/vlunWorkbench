# Phase 17: Action Queue and Work States Plan

## Purpose

この計画は、vulnWorkbench の scan results を単なる一覧から、診断を完了するための作業キューへ変えるためのもの。

到達点は、ユーザーが scan run や finding を見たときに、次に何をすべきかを迷わない状態である。

現在の UI は、runs、findings、reports、reviews を表示できる。しかし、診断作業としては「未判断」「証拠不足」「レビュー待ち」「再現推奨」「レポート可能」といった作業状態が前面に出ていない。Phase 17 では、保存済みデータから work state を導出し、UI の主導線にする。

## Source Baseline

現在の scan UI:

- `scanListTab` は `runs` / `findings` を切り替える。
- `FindingsTable` は severity、finding、tool/rule、location、decision、updated を表示する。
- finding の decision は `finding.latestDecision?.decision ?? "open"` として表示される。
- review、decision、verification は finding drawer の中に分かれている。
- DB には `finding_decisions`, `finding_reviews`, `reproduction_runs`, `dynamic_runs`, `dast_runs`, `scan_reports`, `diagnostic_reports` がある。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select status, count(*) from findings group by status; select count(*) from finding_decisions;"
```

確認すること:

- finding が未判断でも、現在の一覧で次行動が十分に分かるか。
- review がない finding と decision がない finding を区別できるか。
- report 生成前に何が blocker なのか分かるか。

## Scope

Phase 17 で実装するもの。

- Work state taxonomy
- Finding work state derivation
- Scan run work state derivation
- Action queue component
- Queue filters
- Queue counters
- Table badges and sorting updates
- Next action click behavior
- focused tests for work state derivation

Phase 17 で実装しないもの。

- 新しい decision schema
- risk acceptance lifecycle
- team assignment
- notification / reminder
- durable job queue
- reproduction / dynamic / DAST の新規 runner
- report builder の大幅変更
- dashboard の再設計
- LLM による自由探索

## Target Files

Primary files to change:

- `web/src/domains/scans/work-states.ts`
- `web/src/domains/scans/work-states.test.ts`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/components/action-queue-panel.tsx`
- `web/src/domains/scans/components/finding-detail-panel.tsx`
- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/styles-scans.css`

Files to read before implementation:

- `web/src/domains/scans/components/run-card-list.tsx`
- `web/src/domains/scans/components/review-section.tsx`
- `web/src/domains/scans/components/decision-section.tsx`
- `web/src/domains/scans/components/verification-sections.tsx`
- `web/src/api.ts`

Do not change persisted DB state names in this phase. Work states are derived UI state.

## Work State Taxonomy

Work state は DB の保存済み状態から導出する。新しい永続 state を作るのは、既存データから安定して導出できない場合だけにする。

Finding work states:

```text
needs_review:
  finding exists but no completed LLM review is available.

needs_decision:
  finding has evidence or review, but no human decision is recorded.

needs_verification:
  finding has a decision or review signal indicating reproduction / dynamic / DAST would improve confidence.

blocked_by_evidence:
  finding lacks usable location, evidence, or artifact references.

ready_for_report:
  finding has enough saved evidence and a human decision.

false_positive_recorded:
  finding has a false_positive decision.

accepted_risk_recorded:
  finding has an accepted decision.
```

Scan run work states:

```text
scan_failed:
  scan run failed or required tool failed.

triage_open:
  one or more findings need review or decision.

diagnostics_open:
  diagnostic checks or coverage gap report are missing.

report_ready:
  triage is sufficient and report can be generated.

report_generated:
  report exists for the scan run.

zero_finding_needs_coverage:
  scan completed with zero findings but no diagnostic coverage summary exists.
```

### Concrete Priority Rules

Implement `buildActionQueue(input)` in `web/src/domains/scans/work-states.ts`.

Queue item type:

```ts
type ActionQueueItem = {
  id: string;
  targetType: "scan" | "finding" | "report" | "diagnostic";
  targetId: string;
  state:
    | "scan_failed"
    | "needs_review"
    | "needs_decision"
    | "needs_verification"
    | "blocked_by_evidence"
    | "ready_for_report"
    | "report_generated"
    | "zero_finding_needs_coverage";
  priority: "high" | "medium" | "low";
  label: string;
  reason: string;
  updatedAt: string | null;
};
```

Priority rules:

- `scan_failed` is high.
- `blocked_by_evidence` is high.
- `needs_decision` is high when severity is `critical` or `high`; otherwise medium.
- `needs_review` is medium.
- `needs_verification` is medium.
- `zero_finding_needs_coverage` is medium.
- `ready_for_report` is low.
- `report_generated` is low and hidden by default unless the user selects the `All` filter.

Sorting:

1. priority rank: high, medium, low
2. severity rank: critical, high, medium, low, info, unknown
3. updatedAt descending
4. label ascending

## Action Queue

The action queue should list actionable items, not every saved record.

Recommended grouping:

```text
High priority:
  failed scan
  critical/high finding without decision
  evidence blocker

Medium priority:
  finding without LLM review
  finding needing verification
  zero-finding scan without coverage summary

Low priority:
  report generation
  completed report review
  accepted / false positive audit checks
```

Each queue row should include:

- action label
- target type
- severity or priority
- reason
- created / updated time
- primary button

Examples:

```text
Review missing: semgrep rule no-sanitized-html at web/src/...
Record decision: 7 DAST findings have no human decision.
Generate report: scan completed and all findings have a decision.
Add coverage summary: detailed-security found 0 findings but no diagnostic report exists.
```

## Implementation Tasks

Implement in these slices. Complete and verify each slice before moving to the next.

### Slice 1: Pure Work-State Helper

1. Create `web/src/domains/scans/work-states.ts`.
2. Export:
   - `type FindingWorkState`
   - `type ScanWorkState`
   - `type ActionQueueItem`
   - `deriveFindingWorkState(input)`
   - `deriveScanWorkState(input)`
   - `buildActionQueue(input)`
   - `sortActionQueue(items)`
3. Inputs should use existing API types from `web/src/api.ts`.
4. The helper must not import React or call controller setters.
5. Add `web/src/domains/scans/work-states.test.ts`.
6. Test cases:
   - failed scan produces high-priority scan item
   - finding without evidence location produces `blocked_by_evidence`
   - finding without review produces `needs_review`
   - finding with review but no decision produces `needs_decision`
   - high severity undecided finding sorts before low severity undecided finding
   - zero-finding scan without diagnostic report produces `zero_finding_needs_coverage`
   - report-generated items are low priority

Acceptance for Slice 1:

- Helper tests pass.
- No UI behavior changes yet.

### Slice 2: Controller State and Handlers

1. Import `buildActionQueue` into `use-scans-controller.ts`.
2. Add state:
   - `actionQueueFilter`
   - `setActionQueueFilter`
3. Add derived values:
   - `actionQueueItems`
   - `filteredActionQueueItems`
   - `findingWorkStatesById`
4. Add `handleActionQueueItem(item)`.
5. Handler behavior:
   - target `finding`: select finding, set `scanListTab` to `findings`, set `scanDetailTab` to `review` or `verification` depending on state.
   - target `scan`: select scan run, set `scanListTab` to `runs`.
   - target `report`: set `scanDetailTab` to `report`.
   - target `diagnostic`: keep selected scan run and show scan result area.
6. Expose the new values through `scans-context.tsx`.

Acceptance for Slice 2:

- Typecheck passes.
- Existing finding selection still opens the drawer.
- Existing report tab behavior remains unchanged.

### Slice 3: Action Queue UI

1. Create `web/src/domains/scans/components/action-queue-panel.tsx`.
2. Render queue filters:
   - All
   - Needs review
   - Needs decision
   - Needs verification
   - Ready for report
   - Blocked
3. Render at most 8 items by default, with a compact "show all" control if more exist.
4. Each item must show:
   - priority badge
   - state label
   - reason
   - target summary
   - action button
5. Add the panel to `ScansSidebar` above or near Recent Runs so it is visible before long finding lists.

Acceptance for Slice 3:

- Queue appears for selected project/scan.
- Empty queue shows a concise completed state.
- Clicking a queue item navigates to the relevant existing surface.

### Slice 4: Finding Table Integration

1. In `FindingDetailPanel`, update `FindingsTable` rows to show the derived work state badge next to or near the decision badge.
2. Sort displayed findings using work-state priority unless the grouped view is active.
3. Preserve keyboard selection behavior.
4. Do not remove severity, tool/rule, location, decision, or updated columns.

Acceptance for Slice 4:

- Undecided and blocked findings are visually distinct.
- Existing grouped view still works.
- `List` and `Grouped` counters remain correct.

### Slice 5: CSS and Regression Check

1. Add queue and badge styles to `web/src/styles-scans.css`.
2. Use fixed badge min-widths or wrapping so labels do not resize table columns aggressively.
3. Run final verification.

## Definition of Done

Phase 17 is complete when:

- The scan screen shows a clear action queue for the selected project or scan run.
- Findings are grouped or sortable by work state.
- A user can identify all undecided findings without manually opening each finding.
- A zero-finding scan without diagnostic coverage is treated as incomplete, not silently done.
- Queue actions navigate to existing UI surfaces instead of creating a second workflow.
- Work states are derived from saved data and are covered by unit tests.
- Existing run list, finding list, drawer, review, decision, verification, and report flows still work.

## Verification

Run:

```bash
git diff --check
bun run verify
```

Manual UI verification:

1. Open a project with multiple scan runs.
2. Confirm the action queue shows missing decisions or missing reviews.
3. Click a queue item and confirm the relevant finding or scan run is selected.
4. Confirm false positive / accepted findings are not mixed with undecided work.
5. Confirm a zero-finding scan is represented as needing coverage when no diagnostic report exists.
6. Confirm queue counters match the visible finding table.

Expected command result:

- `git diff --check` exits 0.
- `bun run verify` exits 0.
- If full verify is blocked by an unrelated existing issue, run the work-state tests and `bun run build:web`, then document the unrelated failure.

## Stop Conditions

Stop and reassess before implementation continues if:

- Work states cannot be derived consistently from current API payloads.
- Work state labels start replacing persisted decision semantics.
- The queue becomes a separate workflow that conflicts with finding drawer actions.
