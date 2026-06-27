# Phase 22: Report Readiness and Export Quality Plan

## Purpose

この計画は、Report readiness preview と実際に生成される Markdown report の内容を一致させ、`ready / partial / blocked` の意味をユーザーが理解できる状態にするためのもの。

到達点は、ユーザーが report を生成する前に次を判断できる状態である。

- この report は提出用か、内部レビュー用か、未完成か。
- `blocked` または `partial` でも生成してよい理由は何か。
- preview で ready と表示された section が、実際の Markdown に十分な内容として出るか。
- LLM handoff、evidence quality、remediation、comparison、zero-finding coverage が report にどう入るか。

## Source Baseline

現在の状態:

- `report-quality.ts` が report readiness を導出している。
- `ReportDetailPanel` が readiness preview を表示する。
- `ScanReportControls` は readiness label をボタン名に含めるが、blocked/partial の説明は弱い。
- `report-builder.ts` は decision-grade sections と improvement request を Markdown に含める。
- UI の `reportTitle` / include options は state として存在するが、生成時の接続は限定的。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select status, count(*) from scan_reports group by status;"
```

## Scope

Phase 22 で実装するもの。

- Report readiness の提出レベル表示
- blocked/partial でも生成する時の明示
- preview section と Markdown section の同期
- report generation options UI の接続確認
- generated report の section completeness test
- LLM handoff section の report 表示品質向上

Phase 22 で実装しないもの。

- PDF export
- report builder の全面書き換え
- scan review prompt の大幅変更
- external sharing
- report artifact storage の再設計
- approval workflow

## Target Files

Primary files:

- `web/src/domains/scans/report-quality.ts`
- `web/src/domains/scans/report-quality.test.ts`
- `web/src/domains/scans/components/report-detail-panel.tsx`
- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/domains/scans/use-scans-controller.ts`
- `api/modules/scans/report-builder.ts`
- `api/modules/scans/report-builder.test.ts`
- `shared/schemas/scan.schema.ts`
- `web/src/api.ts`
- `web/src/styles-scans.css`

Optional files:

- `web/src/domains/scans/report-readiness-copy.ts`
- `web/src/domains/scans/report-readiness-copy.test.ts`

## File Responsibilities

- `web/src/domains/scans/report-quality.ts`
  - Own readiness, submission level, generation warning, and expected section states.
- `web/src/domains/scans/report-readiness-copy.ts`
  - Own user-facing labels for `ready / partial / blocked`.
- `web/src/domains/scans/components/scans-sidebar.tsx`
  - Render generation controls and warning copy.
- `web/src/domains/scans/components/report-detail-panel.tsx`
  - Render readiness preview and generated report preview.
- `web/src/domains/scans/use-scans-controller.ts`
  - Pass report options from UI state to `generateScanReport`.
- `api/modules/scans/report-builder.ts`
  - Render Markdown sections that correspond to readiness preview sections.
- `api/modules/scans/report-builder.test.ts`
  - Assert generated Markdown has required headings and state explanations.
- `shared/schemas/scan.schema.ts`
  - Change only if report options need schema-level validation.

## Implementation Gates

1. **Gate A: Frontend readiness model**
   - Submission level and warnings are derived and tested.
2. **Gate B: Report controls**
   - Button labels and warnings reflect readiness.
   - Report option state is passed to API.
3. **Gate C: Markdown section contract**
   - Builder headings match preview sections.
   - Partial/blocked sections include explanation text.
4. **Gate D: Zero-finding contract**
   - Generated reports remain conservative with and without diagnostics.
5. **Gate E: End-to-end report check**
   - Generate, download, preview, and compare headings with preview.

## Implementation Tasks

### Slice 1: Submission Level Model

1. Extend `ReportQualityPreview` with:

```ts
type ReportSubmissionLevel = "submission_ready" | "internal_review" | "incomplete";
```

2. Map:
   - `ready` -> `submission_ready`
   - `partial` -> `internal_review`
   - `blocked` -> `incomplete`
3. Add `generationWarning`:
   - null for ready
   - explanation for partial
   - explicit missing blockers for blocked
4. Add `primaryActionLabel` and `secondaryStatusLabel` or derive them in `report-readiness-copy.ts`.
5. Add tests for all mappings.
6. Required copy:
   - `submission_ready`: "提出用レポートを生成"
   - `internal_review`: "内部レビュー用ドラフトを生成"
   - `incomplete`: "未完成ドラフトを生成"

Acceptance:

- Readiness is understandable without reading each section.
- Missing inputs are listed in the warning for `incomplete`.

### Slice 2: Generation Button UX

1. Update `ScanReportControls` labels:
   - `Generate submission report`
   - `Generate internal review draft`
   - `Generate incomplete draft`
2. Add tooltip or inline compact warning for partial/blocked.
3. Keep generation allowed unless user enables strict mode.
4. Do not introduce modal confirmation unless the inline warning is insufficient.
5. If readiness is `blocked`, render warning text near the button:
   - missing decisions
   - missing remediation plan
   - missing zero-finding coverage
   - weak/missing evidence
6. If readiness is `partial`, render a compact note that the report is suitable for internal review, not final submission.

Acceptance:

- User understands what kind of report will be generated.
- Button labels are not the only place where readiness is communicated.

### Slice 3: Report Options Connection

1. Ensure `reportTitle`, `includeFalsePositives`, `includeDeferred`, `includeUndecided`, and `summaryMode` are passed to `generateScanReport`.
2. Add UI controls only where they already belong in report controls; do not create a large settings page.
3. Preserve defaults.
4. Add typecheck coverage through existing API types.
5. Concrete API payload:

```ts
generateScanReport(scanRunId, {
  format: "markdown",
  title: reportTitle.trim() || reportQualityPreview.recommendedReportTitle,
  includeFalsePositives,
  includeDeferred,
  includeUndecided,
  summaryMode,
});
```

6. UI controls:
   - title text input
   - three include checkboxes
   - deterministic vs deterministic_with_llm_summary action buttons
7. Do not add persistent user settings in this phase.

Acceptance:

- Changing report options affects generated Markdown.
- Existing default button behavior remains equivalent when user does not change options.

### Slice 4: Preview-to-Markdown Section Sync

1. Define a shared list of expected report sections.
2. Ensure each `ReportQualityPreview.sections` item maps to a report builder section:
   - Executive summary
   - Risk ranking
   - Evidence quality
   - Finding decisions or LLM handoff
   - Remediation plan
   - Verification status
   - Scan comparison
   - Zero-finding coverage
   - Appendix
3. Add report builder tests that assert headings exist.
4. If a section is partial, Markdown must say why.
5. Use stable section IDs:

```ts
type ReportSectionId =
  | "executive-summary"
  | "risk-ranking"
  | "evidence-quality"
  | "finding-decisions"
  | "remediation-plan"
  | "verification-status"
  | "scan-comparison"
  | "zero-finding-coverage"
  | "appendix";
```

6. Map IDs to Markdown headings:
   - `executive-summary` -> `## Decision-grade Executive Summary`
   - `risk-ranking` -> `## Risk Ranking`
   - `evidence-quality` -> `## Evidence Quality Summary`
   - `finding-decisions` -> `## Finding Decisions` or `## LLM Implementation Handoff`
   - `remediation-plan` -> `## Remediation Plan`
   - `verification-status` -> `## Verification Status`
   - `scan-comparison` -> `## Scan Comparison Delta`
   - `zero-finding-coverage` -> `## Zero-Finding Coverage Explanation`
   - `appendix` -> `## Appendix`

Acceptance:

- No preview section is falsely marked ready while Markdown omits it.
- Tests fail if a section ID has no Markdown heading mapping.

### Slice 5: LLM Handoff Report Quality

1. Render improvementRequest in a structured report section:
   - title
   - objective
   - priority plan
   - implementation tasks
   - acceptance criteria
   - verification commands
   - constraints
   - non-goals
   - handoff prompt
2. Ensure long handoff prompt is fenced or formatted safely.
3. Do not exceed existing schema limits.
4. Use a code fence for the final handoff prompt.
5. Escape table cells in priority plan and implementation tasks.
6. If no handoff exists, explicitly say "LLM handoff は生成されていません" only when preview marks that section partial/missing.

Acceptance:

- Generated Markdown can serve as both report and implementation handoff package.
- Handoff prompt remains copyable from Markdown.

### Slice 6: Zero-Finding Report Contract

1. When findings are empty, report must include:
   - scan scope
   - tool execution summary
   - coverage limitations
   - diagnostic report status
   - residual risk statement
2. If diagnostic data is missing, report must not imply safety.
3. Add tests for zero-finding with and without diagnostic report.
4. Required wording:
   - finding 0 is not a proof of safety
   - unexecuted checks and missing diagnostics remain residual risk
   - report describes what was checked and what was not checked

Acceptance:

- Zero-finding report remains conservative.
- The report never states that the project is safe solely because findings are 0.

## Verification

Run:

```bash
bunx vitest run web/src/domains/scans/report-quality.test.ts
bun test api/modules/scans/report-builder.test.ts
bun run typecheck
bun run verify
```

Additional focused tests after Slice 4:

```bash
bun test api/modules/scans/report-builder.test.ts
bunx vitest run web/src/domains/scans/report-quality.test.ts web/src/domains/scans/report-readiness-copy.test.ts
```

Expected:

- report quality tests cover `submission_ready`, `internal_review`, `incomplete`
- report builder tests assert all required headings
- report option changes alter generated Markdown sections as expected

Manual verification:

- Generate report in ready state.
- Generate report in partial state.
- Generate report in blocked state.
- Confirm button copy differs by state.
- Download Markdown and compare headings with readiness preview.
- Confirm LLM handoff appears in report when scan review output has improvementRequest.

## Definition of Done

Phase 22 is complete only when:

- readiness preview and generated Markdown section list are aligned
- report generation buttons explain ready/partial/blocked states
- report options are wired into generation payload
- zero-finding report wording is conservative
- report builder and frontend report quality tests pass
- `bun run verify` passes

## Stop Conditions

Stop and update this plan if:

- report options require a schema change not compatible with existing reports.
- preview and report builder cannot share section semantics without large refactor.
- blocked report generation must become a product policy decision.
- PDF/export beyond Markdown becomes necessary.
