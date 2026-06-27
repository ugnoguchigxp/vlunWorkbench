# Phase 20: Decision-Grade Security Workflow Plan

## Purpose

この計画は、vulnWorkbench を「スキャン結果を見る画面」から「診断判断、修正計画、差分確認、提出用レポートまで完了できる security workflow」へ引き上げるためのもの。

到達点は、ユーザーが scan run を開いた時に、次の問いへ画面内で答えられる状態である。

- この scan run の主要リスクは何か。
- どの finding は証跡が強く、どの finding は判断保留にすべきか。
- triage 完了まで何が残っているか。
- 修正対象、受容リスク、誤検知、保留をどう扱うか。
- 前回 scan から何が増え、何が解消され、何が悪化したか。
- そのまま共有できる report として何が出力されるか。

Phase 20 は Phase 16-19 で作った dashboard / action queue / decision workflow / coverage UX を統合し、プロダクト価値を 90 点台へ上げるための decision-grade layer を作る。新しい scanner や exploit runner を増やすフェーズではない。

## Source Baseline

現在の scan workflow:

- `work-states.ts` が finding / scan の作業状態を導出している。
- `diagnostic-dashboard.ts` と `coverage-summary.ts` が scan diagnostics と zero-finding coverage を扱っている。
- `decision-workflow.ts` が finding decision の表示モデルを持つ。
- `ActionQueuePanel` が次アクションを提示している。
- `FindingDetailPanel` が findings table, drawer, decision, review, verification, zero finding panel を束ねている。
- `ScanResultOverview`, `ScanSummaryPanel`, `ReportDetailPanel` が scan summary と report 周辺 UI を担っている。
- `buildMarkdownReport` が scan report の本文を生成している。
- `finding_decisions`, `finding_reviews`, `scan_reports`, `diagnostic_reports`, `reproduction_runs`, `dynamic_runs`, `dast_runs` の既存データがある。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from scan_runs; select count(*) from findings; select count(*) from finding_reviews; select count(*) from finding_decisions; select count(*) from scan_reports; select count(*) from diagnostic_reports; select count(*) from reproduction_runs; select count(*) from dynamic_runs; select count(*) from dast_runs;"
```

可能なら、finding がある scan run と zero-finding scan run をそれぞれ UI で開き、次を確認する。

- scan run を見ただけで主要リスクを説明できるか。
- finding ごとの証跡品質が分かるか。
- triage 完了までの残作業が分かるか。
- report に含まれる内容を生成前に予測できるか。
- 前回 scan との差分が分かるか。

## Scope

Phase 20 で実装するもの。

- Evidence Quality Meter
- Executive Risk Summary
- Workflow Completion State
- Remediation Plan Builder
- Scan Comparison View
- Report Quality Upgrade
- tests for derived workflow/risk/comparison/report models

Phase 20 で実装しないもの。

- 新しい scanner の追加
- 新しい exploit / reproduction / dynamic runner の追加
- auto patch generation
- GitHub / Jira / Slack 連携
- multi-user approval workflow
- authorization model の再設計
- notification / reminder
- PDF renderer の新規導入
- LLM による任意 file read
- scan profile scope の全面再設計
- report UI の全面作り直し
- persisted decision vocabulary の変更

## Target Files

Primary files to add:

- `web/src/domains/scans/evidence-quality.ts`
- `web/src/domains/scans/evidence-quality.test.ts`
- `web/src/domains/scans/risk-summary.ts`
- `web/src/domains/scans/risk-summary.test.ts`
- `web/src/domains/scans/workflow-completion.ts`
- `web/src/domains/scans/workflow-completion.test.ts`
- `web/src/domains/scans/remediation-plan.ts`
- `web/src/domains/scans/remediation-plan.test.ts`
- `web/src/domains/scans/scan-comparison.ts`
- `web/src/domains/scans/scan-comparison.test.ts`
- `web/src/domains/scans/report-quality.ts`
- `web/src/domains/scans/report-quality.test.ts`
- `web/src/domains/scans/components/executive-risk-summary.tsx`
- `web/src/domains/scans/components/workflow-completion-panel.tsx`
- `web/src/domains/scans/components/remediation-plan-section.tsx`
- `web/src/domains/scans/components/scan-comparison-panel.tsx`

Primary files to change:

- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/components/action-queue-panel.tsx`
- `web/src/domains/scans/components/finding-detail-panel.tsx`
- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/components/scan-summary-panel.tsx`
- `web/src/domains/scans/components/report-detail-panel.tsx`
- `web/src/domains/scans/components/decision-section.tsx`
- `web/src/domains/scans/work-states.ts`
- `web/src/styles-scans.css`
- `api/modules/scans/report-builder.ts`
- `api/modules/scans/report-builder.test.ts`
- `web/src/api.ts`

Files to read before implementation:

- `web/src/domains/scans/coverage-summary.ts`
- `web/src/domains/scans/decision-workflow.ts`
- `web/src/domains/scans/diagnostic-dashboard.ts`
- `web/src/domains/scans/work-states.ts`
- `api/modules/scans/report-repository.ts`
- `api/modules/scans/summary-builder.ts`
- `api/modules/decisions/finding-decision-repository.ts`
- `api/modules/reviews/finding-review-repository.ts`
- `api/modules/reproductions/reproduction-repository.ts`
- `api/modules/dynamic/dynamic-repository.ts`
- `api/modules/dast/dast-repository.ts`
- `shared/schemas/scan.schema.ts`

Do not add a new table unless Slice 4 proves that remediation state cannot be represented safely from existing decision metadata and report options. If schema changes become necessary, stop at Slice 4 and split a backend migration sub-plan inside this same Phase 20 document before coding it.

## UX Principle

The UI should answer decision questions before showing raw details.

```text
scan result:
  What happened?

decision-grade result:
  What should we do, why, by when, and what evidence supports it?
```

The user should not need to inspect every tab to understand the scan's current risk posture. Detail views remain available, but the primary scan page should surface:

- risk summary
- evidence confidence
- work remaining
- remediation ownership
- scan delta
- report readiness

## Gate Structure

This is one phase and one plan, but implementation must pass six gates in order.

```text
Gate 1: Evidence Quality Meter
Gate 2: Executive Risk Summary
Gate 3: Workflow Completion State
Gate 4: Remediation Plan Builder
Gate 5: Scan Comparison View
Gate 6: Report Quality Upgrade
```

Do not mark Phase 20 complete until all gates pass `bun run verify` and each gate's acceptance criteria.

## Gate 1: Evidence Quality Meter

### Goal

Finding ごとの証跡品質を、ユーザーが一目で判断できる状態にする。

### Concrete Model

Implement `buildEvidenceQuality(input)` in `web/src/domains/scans/evidence-quality.ts`.

```ts
type EvidenceQualityLevel = "strong" | "moderate" | "weak" | "missing";

type EvidenceSignal = {
  id: string;
  label: string;
  kind:
    | "source_location"
    | "tool_output"
    | "llm_review"
    | "reproduction"
    | "dynamic"
    | "dast"
    | "diagnostic"
    | "decision";
  present: boolean;
  strength: "high" | "medium" | "low";
  reference?: string;
};

type EvidenceQualityView = {
  findingId: string;
  level: EvidenceQualityLevel;
  score: number;
  label: string;
  reasons: string[];
  missingSignals: EvidenceSignal[];
  presentSignals: EvidenceSignal[];
  recommendedNextAction:
    | "run_review"
    | "run_reproduction"
    | "run_dynamic"
    | "record_decision"
    | "ready_for_report";
};
```

Rules:

- `strong` requires usable source/tool evidence and at least one of completed review, completed reproduction, completed dynamic run, completed DAST evidence, or human decision.
- `moderate` requires usable source/tool evidence and either review or decision.
- `weak` means some evidence exists but confidence is not enough for a final decision.
- `missing` means no usable location, snippet, artifact, or verification signal exists.
- completed reproduction with `reproduced` or `not_reproduced` counts as high-strength evidence.
- completed dynamic run with `passed` or `failed` counts as high-strength evidence.
- completed review with weak evidence strength does not upgrade beyond `weak`.
- false positive or accepted decisions still count as human decision signal, but do not hide missing technical evidence.

### UI Tasks

1. Add evidence quality badge to findings table.
2. Add evidence quality meter to finding drawer header.
3. Add evidence signal checklist near the existing decision/review sections.
4. Feed evidence quality into `deriveFindingWorkState` and `buildActionQueue` only when it improves existing state precision.
5. Keep badge labels short:
   - Strong
   - Moderate
   - Weak
   - Missing

### Tests

Add `evidence-quality.test.ts` cases:

- source location only returns `weak`
- source + completed review returns `moderate`
- source + completed reproduction returns `strong`
- missing location/evidence returns `missing`
- weak LLM evidence does not become `moderate`
- accepted decision with no technical evidence stays `missing` or `weak`, not `strong`

### Acceptance

- Evidence quality appears in table and drawer.
- Missing or weak evidence produces a visible next action.
- No persisted schema change is introduced.
- Targeted tests pass.

## Gate 2: Executive Risk Summary

### Goal

Scan run の上位判断を、finding list を読まなくても理解できる summary として表示する。

### Concrete Model

Implement `buildExecutiveRiskSummary(input)` in `web/src/domains/scans/risk-summary.ts`.

```ts
type RiskBand = "critical" | "high" | "medium" | "low" | "informational";

type ExecutiveRiskSummary = {
  scanRunId: string;
  riskBand: RiskBand;
  score: number;
  headline: string;
  keyDrivers: Array<{
    id: string;
    label: string;
    severity?: string;
    findingId?: string;
    evidenceLevel?: EvidenceQualityLevel;
  }>;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    strongEvidence: number;
    weakOrMissingEvidence: number;
    reproduced: number;
    acceptedRisk: number;
    falsePositive: number;
    needsFix: number;
    undecided: number;
  };
  recommendedFocus: Array<{
    findingId: string;
    title: string;
    reason: string;
  }>;
};
```

Rules:

- severity is the base risk input.
- evidence quality changes confidence, not raw severity.
- `critical/high + strong evidence + needs_fix/no decision` should be top priority.
- false positives should not drive risk band.
- accepted risk should appear as accepted exposure, not disappear.
- zero finding scans should delegate risk explanation to coverage summary and diagnostics.

### UI Tasks

1. Add `ExecutiveRiskSummary` component above or inside `ScanResultOverview`.
2. Show:
   - risk band
   - score
   - top 3 drivers
   - evidence confidence counts
   - recommended focus findings
3. Add click action from recommended focus to select the finding.
4. Keep the component dense and operational, not marketing-style.

### Tests

Add `risk-summary.test.ts` cases:

- critical strong-evidence finding produces critical risk band
- false positive does not drive risk band
- accepted risk remains visible in counts
- weak evidence reduces confidence but does not remove finding
- zero findings produce low/informational band with coverage note

### Acceptance

- Scan page has a top-level risk summary.
- User can identify top findings without reading the entire table.
- Summary remains deterministic and does not require LLM calls.

## Gate 3: Workflow Completion State

### Goal

Scan run completion を「どこまで終わったか」「何が残っているか」で見える化する。

### Concrete Model

Implement `buildWorkflowCompletion(input)` in `web/src/domains/scans/workflow-completion.ts`.

```ts
type WorkflowCompletion = {
  scanRunId: string;
  stage:
    | "scan_running"
    | "needs_review"
    | "needs_decision"
    | "needs_verification"
    | "needs_remediation_plan"
    | "report_ready"
    | "report_generated";
  percent: number;
  checklist: Array<{
    id: string;
    label: string;
    status: "complete" | "incomplete" | "blocked" | "not_applicable";
    count?: string;
    blockingReason?: string;
  }>;
  nextBestAction: {
    label: string;
    action:
      | "review_findings"
      | "record_decisions"
      | "run_verification"
      | "create_remediation_plan"
      | "generate_report"
      | "inspect_coverage";
    targetId?: string;
  } | null;
};
```

Rules:

- Review completion uses latest completed finding review.
- Decision completion uses latest finding decision.
- Verification completion uses completed reproduction/dynamic/DAST where available.
- Remediation completion uses Slice 4 model after Slice 4 exists; before Slice 4, mark as `not_applicable`.
- Report readiness is true only when blocking triage states are resolved.
- Zero finding scan uses diagnostic coverage completion instead of finding triage completion.

### UI Tasks

1. Add `WorkflowCompletionPanel` near Action Queue.
2. Show progress, checklist, and next best action.
3. Add action handlers that route to existing tabs/actions where possible.
4. Update Action Queue labels to align with completion state.

### Tests

Add `workflow-completion.test.ts` cases:

- no reviews returns `needs_review`
- completed reviews but no decisions returns `needs_decision`
- weak evidence returns `needs_verification`
- decisions and verification complete returns `report_ready`
- completed report returns `report_generated`
- zero finding with missing diagnostics returns `inspect_coverage`

### Acceptance

- User can tell what remains before report readiness.
- Action Queue and completion panel do not contradict each other.
- Completion state is pure-derived from existing frontend/API data.

## Gate 4: Remediation Plan Builder

### Goal

Finding decision の後に、修正計画を画面内で管理できるようにする。

### Data Strategy

Start with a frontend-derived remediation model backed by existing finding decision metadata where possible.

If existing `finding_decisions.metadata` or API payload cannot safely store remediation fields, stop and add a migration plan before implementation. Do not silently overload unrelated fields.

### Slice 4 Backend Migration Sub-Plan

Repository inspection shows `finding_decisions` does not yet have a `metadata` column, but remediation state can be represented safely as decision metadata without introducing a dedicated table.

Implementation scope for Slice 4 persistence:

- Add a nullable-compatible JSON `metadata` column to `finding_decisions` with `{}` default.
- Extend the Drizzle schema, shared decision schema, repository create path, and API client type to preserve `metadata.remediation`.
- Keep existing decisions readable with empty metadata.
- Persist remediation by writing a new latest decision row with the same decision semantics and updated `metadata.remediation`.
- Do not add `finding_remediations` unless the metadata path fails verification.

### Concrete Model

Implement `buildRemediationPlanView(input)` in `web/src/domains/scans/remediation-plan.ts`.

```ts
type RemediationStatus =
  | "not_started"
  | "planned"
  | "in_progress"
  | "fixed"
  | "accepted"
  | "false_positive"
  | "deferred";

type RemediationPlanView = {
  findingId: string;
  status: RemediationStatus;
  owner: string | null;
  priority: "p0" | "p1" | "p2" | "p3";
  dueDate: string | null;
  recommendedFix: string | null;
  verificationRequired: boolean;
  verificationStatus: "not_run" | "running" | "passed" | "failed" | "inconclusive";
  blockingReasons: string[];
};
```

Minimal persisted fields if schema/API extension is required:

```ts
type RemediationInput = {
  owner?: string | null;
  priority?: "p0" | "p1" | "p2" | "p3";
  dueDate?: string | null;
  status?: RemediationStatus;
  recommendedFix?: string | null;
};
```

Allowed persistence options, in order:

1. Use `finding_decisions.metadata.remediation` if the repository already preserves metadata.
2. Extend finding decision create/update schema to accept `metadata.remediation`.
3. Add a dedicated `finding_remediations` table only if existing decision metadata is not viable.

### UI Tasks

1. Add `RemediationPlanSection` to finding drawer after decision section.
2. Show status, priority, owner, due date, recommended fix, verification status.
3. Default status from latest decision:
   - `needs_fix` -> `not_started`
   - `accepted` -> `accepted`
   - `false_positive` -> `false_positive`
   - `deferred` -> `deferred`
4. Add Save action only if persistence path is implemented.
5. Reflect remediation readiness in workflow completion.

### Tests

Add `remediation-plan.test.ts` cases:

- no decision returns `not_started` with blocking decision reason
- needs_fix decision maps to remediation required
- accepted maps to accepted and does not require fix
- false_positive maps to false_positive
- completed verification updates verification status
- missing owner/dueDate blocks remediation completion for high/critical findings

### Acceptance

- A finding can show a clear remediation plan state.
- High/critical `needs_fix` findings require owner or explicit accepted/deferred decision to be considered workflow-complete.
- If persistence is added, route/repository tests cover it.

## Gate 5: Scan Comparison View

### Goal

Scan run を単発結果ではなく、継続的な改善/悪化の差分として理解できるようにする。

### Concrete Model

Implement `buildScanComparison(input)` in `web/src/domains/scans/scan-comparison.ts`.

```ts
type FindingDeltaKind = "new" | "resolved" | "unchanged" | "regressed";

type ScanComparisonView = {
  currentScanRunId: string;
  baselineScanRunId: string | null;
  status: "available" | "missing_baseline" | "insufficient_data";
  counts: {
    new: number;
    resolved: number;
    unchanged: number;
    regressed: number;
  };
  severityTrend: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  deltas: Array<{
    id: string;
    kind: FindingDeltaKind;
    title: string;
    severity: string;
    currentFindingId?: string;
    baselineFindingId?: string;
    reason: string;
  }>;
};
```

Matching rules:

- Prefer stable normalized identifiers if present in finding metadata.
- Fallback match key should combine rule id, tool name, title, and primary location path when available.
- Do not match on title only.
- If baseline data is missing, return `missing_baseline` instead of fabricating improvement.
- `regressed` means a previously lower severity or accepted/resolved finding now appears with higher severity or active needs_fix state.

### Data Loading Tasks

1. Identify previous scan run for the same project/profile.
2. Load previous scan findings.
3. Keep comparison optional if previous scan cannot be loaded.
4. Avoid N+1 detail requests for all historical findings unless required by the API.

### UI Tasks

1. Add `ScanComparisonPanel` in scan overview area.
2. Show new/resolved/unchanged/regressed counts.
3. Show top deltas with click-through when current finding exists.
4. Add baseline scan label and timestamp.

### Tests

Add `scan-comparison.test.ts` cases:

- missing baseline returns `missing_baseline`
- matching rule/location returns unchanged
- current-only returns new
- baseline-only returns resolved
- severity increase returns regressed
- title-only similarity does not match

### Acceptance

- User can see whether the security posture improved or worsened.
- Comparison view is absent or clearly unavailable when there is no baseline.
- No false improvement is shown.

## Gate 6: Report Quality Upgrade

### Goal

Report を、画面内判断の集約ではなく、提出・共有に耐える成果物へ上げる。

### Concrete Model

Implement `buildReportQualityPreview(input)` in `web/src/domains/scans/report-quality.ts`.

```ts
type ReportQualityPreview = {
  scanRunId: string;
  sections: Array<{
    id: string;
    label: string;
    status: "ready" | "missing" | "partial";
    reason?: string;
  }>;
  readiness: "ready" | "partial" | "blocked";
  missingInputs: string[];
  recommendedReportTitle: string;
};
```

Required report sections:

- Executive summary
- Risk ranking
- Evidence quality summary
- Finding decisions
- Remediation plan
- Verification status
- Scan comparison delta
- Zero-finding coverage explanation when findings are empty
- Appendix with evidence references

### API/Report Builder Tasks

1. Extend `buildMarkdownReport` with optional decision-grade sections.
2. Keep existing report options compatible.
3. Add executive summary from deterministic risk summary.
4. Add evidence quality and remediation sections.
5. Add comparison section only when baseline is available.
6. Add coverage explanation for zero-finding scans.
7. Do not introduce PDF generation in this phase.

### UI Tasks

1. Add report readiness preview to `ReportDetailPanel` or scan overview.
2. Show missing inputs before report generation.
3. Make report generation button state reflect blocked/partial/ready.
4. Include generated report preview after creation.

### Tests

Add `report-quality.test.ts` cases:

- all required inputs returns `ready`
- missing decisions returns `blocked` or `partial`
- missing remediation for high finding blocks readiness
- missing baseline comparison only marks comparison section partial
- zero-finding report requires coverage explanation

Extend `report-builder.test.ts` cases:

- executive summary section is included
- evidence quality section is included
- remediation section is included
- comparison section is included when provided
- zero-finding coverage section is included when applicable

### Acceptance

- Report preview makes missing inputs visible before generation.
- Generated Markdown includes decision-grade sections.
- Existing report generation behavior remains backward compatible.

## Implementation Order

Complete in this order. Do not start a later gate until the previous gate passes targeted tests.

1. Read current models and baseline.
2. Gate 1 pure helper + tests.
3. Gate 1 UI integration.
4. Gate 2 pure helper + tests.
5. Gate 2 UI integration.
6. Gate 3 pure helper + tests.
7. Gate 3 UI integration.
8. Gate 4 derived remediation helper + tests.
9. Gate 4 persistence decision:
   - if existing decision metadata is enough, implement metadata save/load.
   - if not enough, stop and add schema migration tasks before continuing.
10. Gate 4 UI integration.
11. Gate 5 comparison helper + tests.
12. Gate 5 data loading + UI integration.
13. Gate 6 report quality helper + tests.
14. Gate 6 report-builder integration.
15. Final verification and rescoring.

## Cross-Gate Integration Rules

- Pure derived helpers must stay framework-independent.
- React components should receive already-derived view models where possible.
- Do not put scoring logic directly inside JSX.
- Keep UI labels short and action-oriented.
- Do not hide uncertainty. Use `partial`, `missing`, `weak`, or `insufficient_data` states explicitly.
- Do not use LLM calls for deterministic risk/completion/comparison scores.
- Do not block existing report generation unless the user explicitly selects strict readiness mode.

## Verification

Run after each gate:

```bash
bunx vitest run web/src/domains/scans/evidence-quality.test.ts
bunx vitest run web/src/domains/scans/risk-summary.test.ts
bunx vitest run web/src/domains/scans/workflow-completion.test.ts
bunx vitest run web/src/domains/scans/remediation-plan.test.ts
bunx vitest run web/src/domains/scans/scan-comparison.test.ts
bunx vitest run web/src/domains/scans/report-quality.test.ts
```

Run after UI integration slices:

```bash
bun run typecheck
bun run format:check
```

Run before marking Phase 20 complete:

```bash
bun run verify
```

Manual UI verification:

- Select a scan run with findings.
- Confirm executive risk summary appears.
- Confirm evidence quality appears in table and drawer.
- Confirm workflow completion next action matches Action Queue.
- Confirm high/critical needs_fix finding shows remediation requirement.
- Confirm previous scan comparison is shown or clearly unavailable.
- Generate report and confirm new sections are present.
- Select a zero-finding scan run and confirm coverage explanation remains conservative.

Database verification if remediation persistence is implemented:

```bash
sqlite3 data/vuln-workbench.sqlite "select count(*) from finding_decisions where json_extract(metadata, '$.remediation') is not null;"
```

Expected result:

- count increases after saving remediation metadata.
- existing finding decisions without remediation metadata still load.

## Stop Conditions

Stop implementation and update this plan before continuing if any of these are true:

- Remediation persistence requires a new table.
- Existing API cannot load previous scan findings without excessive N+1 requests.
- Report builder needs incompatible schema changes.
- Derived risk summary contradicts existing decision/report semantics.
- `bun run verify` fails for reasons unrelated to Phase 20 and the failure cannot be isolated.
- UI cannot present all six gates without overcrowding the current scan layout.

## Rollback Plan

If a gate introduces regressions:

1. Revert that gate's UI integration first.
2. Keep pure helper/tests only if they remain unused and verified.
3. Do not revert earlier completed gates unless they are the direct cause.
4. Re-run targeted tests and `bun run verify`.

If remediation persistence is added and must be rolled back:

1. Keep read compatibility for existing metadata.
2. Remove write UI.
3. Keep report builder tolerant of missing remediation fields.

## Success Metrics

Phase 20 is complete when:

- UI/UX rescoring reaches 90 or higher.
- Product value rescoring reaches 90 or higher.
- The scan page answers risk, evidence, workflow, remediation, delta, and report-readiness questions without requiring raw DB inspection.
- `bun run verify` passes.
- New derived models have focused tests.
- Report output includes decision-grade sections.
- Zero-finding scans still communicate coverage uncertainty instead of implying safety.

Expected post-implementation score:

| Area | Expected Score |
| --- | ---: |
| UI/UX | 92-94 |
| Product value | 92-95 |
| Technical quality | 86-90 |
| Operational value | 80-86 |
| Overall | 90-93 |
