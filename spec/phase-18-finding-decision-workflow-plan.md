# Phase 18: Finding Decision Workflow Plan

## Purpose

この計画は、vulnWorkbench の finding detail を「情報を見る画面」から「人間が診断判断を完了する画面」へ変えるためのもの。

到達点は、finding ごとに一次証拠、LLM review、検証結果、人間判断、report 反映状態が一つの判断フローとしてつながる状態である。

現状では `finding_decisions` のデータモデルと `DecisionSection` は存在するが、プロダクト価値の中心としてはまだ弱い。Phase 18 では、human decision を診断完了の中核にする。

## Source Baseline

現在の decision workflow:

- `web/src/domains/scans/components/decision-section.tsx` が finding decision の入力を担当している。
- `createFindingDecision` API client がある。
- `finding_decisions` table が存在する。
- `FindingDetailDrawer` は review / verification tab を持つ。
- `FindingsTable` は latest decision を badge 表示する。
- `buildMarkdownReport` は finding decision を report bucket に反映する。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from findings; select count(*) from finding_decisions;"
```

確認すること:

- decision がない finding を UI から見つけやすいか。
- decision 入力時に、どの evidence を根拠にしたか分かるか。
- decision 済み finding が report にどう反映されるか追えるか。

## Scope

Phase 18 で実装するもの。

- Decision-first finding detail layout
- Evidence checklist for decision
- Decision reason guidance
- Link review to decision by default when applicable
- Decision completeness indicator
- Report impact preview
- Latest decision summary in drawer header
- Decision history display
- tests for decision-derived display logic

Phase 18 で実装しないもの。

- 新しい authorization model
- multi-reviewer approval
- team assignment
- risk acceptance expiration
- notification / reminder
- auto patch generation
- exploit generation
- new reproduction or dynamic runner behavior
- LLM による任意 path 探索
- report format の全面刷新

## Target Files

Primary files to change:

- `web/src/domains/scans/decision-workflow.ts`
- `web/src/domains/scans/decision-workflow.test.ts`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/components/finding-detail-panel.tsx`
- `web/src/domains/scans/components/decision-section.tsx`
- `web/src/domains/scans/components/review-section.tsx`
- `web/src/domains/scans/components/verification-sections.tsx`
- `web/src/styles-scans.css`

Files to read before implementation:

- `api/modules/scans/report-builder.ts`
- `api/routes/finding-decisions.route.ts`
- `api/modules/decisions/finding-decision-repository.ts`
- `web/src/api.ts`

Do not change the persisted decision vocabulary in this phase unless current values make the UI impossible to implement. If schema changes are required, stop and split that into a separate backend phase.

## Decision Model

The UI should make the following distinction obvious:

```text
evidence:
  CLI output, source location, scan log, DAST evidence, reproduction evidence.

review:
  LLM interpretation of existing evidence.

decision:
  Human-owned status and rationale.

report impact:
  How the human decision affects final output.
```

Decision options should remain aligned with existing domain values:

```text
needs_fix
accepted
deferred
false_positive
```

If current API values differ, Phase 18 should map UI labels onto the existing schema instead of changing persistence casually.

### Concrete Derived Model

Implement `buildDecisionWorkflow(input)` in `web/src/domains/scans/decision-workflow.ts`.

```ts
type DecisionWorkflowView = {
  findingId: string;
  latestDecision: FindingDecision | null;
  latestReview: FindingReview | null;
  decisionState: "missing" | "complete" | "needs_context";
  evidenceChecklist: Array<{
    id: string;
    label: string;
    kind: "source" | "tool_output" | "scan_log" | "review" | "reproduction" | "dynamic" | "dast";
    available: boolean;
    reference?: string;
  }>;
  reportImpact: {
    bucket: "needs_fix" | "accepted" | "deferred" | "false_positive" | "undecided";
    label: string;
    includedByDefault: boolean;
  };
  recommendedReason: FindingDecision["reason"] | null;
  missingInputs: string[];
};
```

Rules:

- `decisionState = "missing"` when there is no latest decision.
- `decisionState = "needs_context"` when there is no source location and no evidence item.
- `decisionState = "complete"` when latest decision exists.
- `evidenceChecklist` must include source evidence when `source-location` evidence or metadata snippet exists.
- Include `review` evidence when `latestReview` exists.
- Include reproduction / dynamic / DAST items only from already loaded verification data.
- `reportImpact.bucket` maps directly from latest decision; no decision maps to `undecided`.
- `includedByDefault` follows current report options:
  - `needs_fix`: true
  - `accepted`: true
  - `deferred`: true when include deferred is true
  - `false_positive`: true when include false positives is true
  - `undecided`: true when include undecided is true

## UX Requirements

The finding drawer should answer these questions without requiring the user to switch context repeatedly:

- What was detected?
- Which tool detected it?
- What primary evidence exists?
- What did the LLM review conclude?
- Has this been reproduced or dynamically checked?
- What human decision is currently recorded?
- What rationale was used?
- How will this appear in the report?
- What is still missing before this finding is considered triaged?

Recommended drawer structure:

```text
Header
  severity / work state / latest decision / report bucket

Decision Panel
  recommended next action
  decision selector
  reason selector
  comment
  evidence checklist
  submit action

Evidence Panel
  primary source location
  tool artifact references
  redacted snippets

Review Panel
  latest LLM review
  review history

Verification Panel
  reproduction / dynamic / DAST results

Report Impact
  how this finding will be grouped in Markdown report
```

## Implementation Tasks

Implement in these slices. Complete and verify each slice before moving to the next.

### Slice 1: Pure Decision Workflow Helper

1. Create `web/src/domains/scans/decision-workflow.ts`.
2. Export:
   - `type DecisionWorkflowView`
   - `buildDecisionWorkflow(input)`
   - `mapDecisionToReportBucket(decision, reportOptions)`
   - `buildEvidenceChecklist(input)`
3. Keep helper pure.
4. Add `web/src/domains/scans/decision-workflow.test.ts`.
5. Test cases:
   - no decision maps to `undecided`
   - `false_positive` maps to false positive bucket
   - missing source/evidence yields `needs_context`
   - latest review adds review checklist item
   - source-location evidence adds source checklist item
   - include/exclude report options change `includedByDefault`

Acceptance for Slice 1:

- Helper tests pass.
- No UI behavior changes yet.

### Slice 2: Controller Defaults and Data Exposure

1. Import `buildDecisionWorkflow` into `use-scans-controller.ts`.
2. Derive `selectedDecisionWorkflow` for the selected finding.
3. When selected finding changes and `latestReview` exists, default `linkReviewInput` to true.
4. Do not override user-edited `linkReviewInput` while the same finding remains selected.
5. Expose `selectedDecisionWorkflow` through `scans-context.tsx`.

Acceptance for Slice 2:

- Selecting a finding with review defaults link-review on.
- Selecting a finding without review leaves link-review off.
- Existing decision submit still works.

### Slice 3: Decision-First Drawer Layout

1. In `FindingDetailDrawer`, keep existing tabs but make the first drawer content start with decision status.
2. In `FindingBody`, render sections in this order:
   - Decision summary and controls
   - Evidence checklist
   - LLM review summary
   - Source/evidence detail
   - Report impact
3. Keep `VerificationSections` on the verification tab.
4. Do not remove existing `ReviewSection` or `DecisionSection`; restructure composition around them.

Acceptance for Slice 3:

- Decision controls are visible without scrolling deeply on a typical laptop viewport.
- Review and source details remain accessible.
- Drawer close and keyboard interactions still work.

### Slice 4: Decision Section Enhancements

1. Update `decision-section.tsx` to accept or read `selectedDecisionWorkflow`.
2. Add:
   - current decision state badge
   - reason guidance based on selected decision
   - evidence checklist summary
   - decision history list
3. Keep existing form field names and submit handler.
4. Do not add required fields unless backend validation already requires them.

Acceptance for Slice 4:

- Existing decision submission payload shape is unchanged.
- Decision history is visible when `allDecisions` has entries.
- Missing evidence is shown as a warning, not a hard blocker.

### Slice 5: Report Impact Preview

1. Add report impact preview in `finding-detail-panel.tsx` or a small local component.
2. Show:
   - bucket label
   - whether it will be included with current report options
   - which decision drives the bucket
3. If no decision exists, show `undecided` and do not imply human approval.

Acceptance for Slice 5:

- Preview matches `buildMarkdownReport` bucket vocabulary.
- No decision is never displayed as accepted.

### Slice 6: CSS and Regression Check

1. Add decision workflow styles to `web/src/styles-scans.css`.
2. Keep density consistent with existing scan UI.
3. Run final verification.

## Definition of Done

Phase 18 is complete when:

- A user can record a human decision from the finding drawer without hunting through secondary UI.
- The drawer clearly separates evidence, LLM review, human decision, and report impact.
- Findings without decisions are visibly incomplete.
- Latest decision and decision history are visible.
- Decision submission can link to a completed review when one exists.
- Report impact is shown before report generation.
- Decision display does not invent a decision when no persisted decision exists.
- Existing report generation still respects saved decisions.

## Verification

Run:

```bash
git diff --check
bun run verify
```

Manual UI verification:

1. Select a finding with no decision.
2. Confirm decision controls are immediately visible.
3. Submit a decision and confirm the finding table badge updates.
4. Confirm the drawer shows latest decision and history.
5. Confirm report impact preview changes with the saved decision.
6. Generate a report and confirm the decision bucket matches the preview.
7. Select a finding with no review and confirm the UI does not claim review-backed confidence.

Expected command result:

- `git diff --check` exits 0.
- `bun run verify` exits 0.
- If full verify is blocked by an unrelated existing issue, run decision workflow tests and `bun run build:web`, then document the unrelated failure.

## Stop Conditions

Stop and reassess before implementation continues if:

- Current decision API does not expose enough data to render decision history safely.
- Report builder bucket semantics conflict with displayed decision labels.
- The UI starts treating LLM review as a human decision.
