# Phase 19: Coverage Gap and Zero Finding UX Plan

## Purpose

この計画は、vulnWorkbench で finding が 0 件だった scan run でも、診断価値を明確に提示できる UI/UX を作るためのもの。

到達点は、ユーザーが zero finding の結果を見たときに、次の問いへ答えられる状態である。

- どの scan profile と tool が実行されたのか。
- どの attack surface や security boundary が確認されたのか。
- どの check は pass / warn / manual_review / not_checked なのか。
- finding 0件をどこまで低リスクの根拠として扱えるのか。
- 次に追加確認すべき coverage gap は何か。

Phase 19 は Phase 15 の診断フレームワークを UI 上の価値へ変換する。新しい scanner を増やすフェーズではない。

## Source Baseline

現在の diagnostic framework:

- `attack_surface_items`, `security_checks`, `security_check_results`, `diagnostic_reports` tables が存在する。
- `inventory:attack-surface` CLI がある。
- `check:security` CLI がある。
- `report:diagnostic` CLI がある。
- API client には `fetchScanAttackSurface`, `fetchScanSecurityChecks`, `fetchScanDiagnosticReports`, `runScanAttackSurfaceInventory`, `runScanSecurityChecks`, `generateDiagnosticReport` がある。
- `FindingDetailPanel` は finding 0件時に簡単な empty state を表示する。
- Dashboard や action queue がない状態では、zero finding scan の診断価値が見えにくい。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from attack_surface_items; select status, count(*) from security_check_results group by status; select status, count(*) from diagnostic_reports group by status;"
```

可能なら zero finding scan run を選んで次を確認する。

```bash
bun run scan:profile -- --profile detailed-security --dry-run true
```

確認すること:

- zero finding scan で、現在の UI が何を表示するか。
- attack surface / security checks / diagnostic report が UI から読めるか。
- coverage gap が report 以外にも visible か。

## Scope

Phase 19 で実装するもの。

- Zero finding result panel
- Coverage gap summary
- Attack surface coverage view
- Security check result table
- Diagnostic report preview integration
- Run missing diagnostics actions
- Status-specific empty states
- tests for coverage summary derivation

Phase 19 で実装しないもの。

- 新しい scanner の追加
- 新しい attack surface extractor の大幅拡張
- new security check categories beyond existing framework
- LLM による任意 file read
- exploit generation
- patch generation
- CI integration
- team workflow
- report builder の全面刷新
- scan profile scope の再設計

## Target Files

Primary files to change:

- `web/src/domains/scans/coverage-summary.ts`
- `web/src/domains/scans/coverage-summary.test.ts`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/components/zero-finding-diagnostic-panel.tsx`
- `web/src/domains/scans/components/finding-detail-panel.tsx`
- `web/src/styles-scans.css`

Files to read before implementation:

- `web/src/api.ts`
- `api/routes/diagnostics.route.ts`
- `api/modules/diagnostics/repository.ts`
- `api/modules/diagnostics/attack-surface/inventory-runner.ts`
- `api/modules/diagnostics/checks/check-runner.ts`
- `api/cli/report-diagnostic.ts`

Do not add new security check categories or new scanner behavior in this phase. Use existing diagnostic data and existing run/generate actions.

## UX Principle

Zero finding is not the same as safe.

The UI must distinguish:

```text
No findings:
  The configured scanners did not produce normalized findings.

Checked:
  A specific category or boundary was examined by a tool or deterministic check.

Not checked:
  A known category exists but this run did not inspect it.

Manual review:
  The framework found a relevant boundary but cannot make a deterministic claim.

Coverage gap:
  A meaningful diagnostic question remains unanswered.
```

The UI should be confident about what was checked and conservative about what was not checked.

### Concrete Coverage Model

Implement `buildCoverageSummary(input)` in `web/src/domains/scans/coverage-summary.ts`.

```ts
type CoverageSummary = {
  scanRunId: string;
  hasFindings: boolean;
  toolCoverage: Array<{
    toolName: string;
    status: string;
    findingCount: number;
  }>;
  attackSurfaceCounts: Record<string, number>;
  checkStatusCounts: Record<string, number>;
  coverageGaps: Array<{
    id: string;
    status: "warn" | "manual_review" | "not_checked" | "fail";
    title: string;
    summary: string;
    category?: string;
    attackSurfaceItemId?: string | null;
  }>;
  latestDiagnosticReport: DiagnosticReport | null;
  missingActions: Array<"run_inventory" | "run_security_checks" | "generate_diagnostic_report">;
};
```

Rules:

- `hasFindings` is true when selected scan run findings length is greater than 0.
- `toolCoverage` should use scan summary/tool run data if available. If tool run data is not available in current frontend state, show scan profile/status and leave tool list empty rather than making up tool names.
- `attackSurfaceCounts` groups `attackSurfaceItems` by category.
- `checkStatusCounts` groups `securityCheckResults` by status.
- `coverageGaps` includes check results with `warn`, `manual_review`, `not_checked`, or `fail`.
- `latestDiagnosticReport` is the newest completed diagnostic report for the selected scan run.
- `missingActions`:
  - include `run_inventory` when attack surface count is 0
  - include `run_security_checks` when security check result count is 0
  - include `generate_diagnostic_report` when there is no completed diagnostic report

## Zero Finding Panel

When selected scan run has zero findings, the finding table empty state should be replaced with a diagnostic panel.

Recommended sections:

```text
Scan outcome
  profile, tools, status, completed time

What was checked
  completed tools
  pass check count
  attack surface categories observed

What needs review
  manual_review checks
  warn checks
  not_checked categories

Coverage gaps
  gap label
  affected attack surface
  recommended next action

Diagnostic report
  latest report status
  preview
  generate / regenerate action
```

This panel should also work when findings exist, but the first priority is zero-finding scan runs.

## Implementation Tasks

Implement in these slices. Complete and verify each slice before moving to the next.

### Slice 1: Pure Coverage Summary Helper

1. Create `web/src/domains/scans/coverage-summary.ts`.
2. Export:
   - `type CoverageSummary`
   - `buildCoverageSummary(input)`
   - `getCoverageGapItems(summary)`
3. Keep helper pure.
4. Add `web/src/domains/scans/coverage-summary.test.ts`.
5. Test cases:
   - zero findings with no diagnostics returns all missing actions
   - attack surface items remove `run_inventory`
   - security check results remove `run_security_checks`
   - completed diagnostic report removes `generate_diagnostic_report`
   - warn/manual_review/not_checked/fail become coverage gaps
   - pass checks are counted but not listed as gaps

Acceptance for Slice 1:

- Helper tests pass.
- No UI behavior changes yet.

### Slice 2: Controller Wiring

1. Import `buildCoverageSummary` into `use-scans-controller.ts`.
2. Derive `selectedCoverageSummary` for the selected scan run.
3. Add handlers if not already exposed:
   - `handleRunAttackSurfaceInventory`
   - `handleRunSecurityChecks`
   - `handleGenerateDiagnosticReport`
4. Reuse existing API client functions:
   - `runScanAttackSurfaceInventory`
   - `runScanSecurityChecks`
   - `generateDiagnosticReport`
5. After each action completes, refresh:
   - attack surface items
   - security check results
   - diagnostic reports
6. Expose `selectedCoverageSummary` and handlers through `scans-context.tsx`.

Acceptance for Slice 2:

- Typecheck passes.
- Existing diagnostic buttons, if any, still work.
- No duplicate API client functions are introduced.

### Slice 3: Zero Finding Panel Component

1. Create `web/src/domains/scans/components/zero-finding-diagnostic-panel.tsx`.
2. Render sections:
   - Scan outcome
   - What was checked
   - What needs review
   - Coverage gaps
   - Diagnostic report
3. Add action buttons:
   - Run inventory
   - Run security checks
   - Generate diagnostic report
4. Disable buttons when:
   - no selected scan run
   - diagnostic action already loading
   - selected scan run is not completed
5. Show conservative text for no data:
   - "No diagnostic inventory has been generated for this scan."
   - "No security checks have been generated for this scan."
   - "No diagnostic report has been generated for this scan."

Acceptance for Slice 3:

- Component renders with empty summary.
- Component renders with populated attack surface/check/report data.
- Buttons call existing controller handlers.

### Slice 4: Replace Zero-Finding Empty State

1. In `finding-detail-panel.tsx`, update the empty finding path.
2. If `displayedFindings.length === 0` and selected scan run exists, render `ZeroFindingDiagnosticPanel`.
3. If no scan run is selected, keep the existing empty state.
4. If grouped view has no matching findings but scan has findings, keep the existing group-empty message.
5. Do not show zero-finding panel for filtered-out grouped results.

Acceptance for Slice 4:

- True zero-finding scan shows diagnostic panel.
- Group filter with no matches does not incorrectly show zero-finding diagnostics.
- Scan with findings keeps the normal table.

### Slice 5: CSS and Regression Check

1. Add panel styles to `web/src/styles-scans.css`.
2. Use compact tables for security checks and coverage gaps.
3. Ensure long check titles wrap.
4. Run final verification.

## Definition of Done

Phase 19 is complete when:

- A scan run with zero findings shows a useful diagnostic result instead of a bare empty state.
- The UI distinguishes no findings, checked areas, manual review items, and not checked areas.
- Coverage gaps are visible without opening a Markdown report.
- Users can run missing inventory, security checks, or diagnostic report actions from the zero finding panel.
- Diagnostic report preview is available when a report exists.
- The UI does not claim that zero findings means the project is safe.
- Existing finding list behavior still works for scan runs with findings.

## Verification

Run:

```bash
git diff --check
bun run verify
```

Manual UI verification:

1. Select a zero-finding scan run.
2. Confirm the zero finding diagnostic panel appears.
3. Confirm tool completion and profile are visible.
4. Confirm attack surface and security check summaries appear when data exists.
5. Confirm missing diagnostic actions are visible when data does not exist.
6. Generate a diagnostic report and confirm the panel updates.
7. Select a scan run with findings and confirm the normal finding table still appears.

Expected command result:

- `git diff --check` exits 0.
- `bun run verify` exits 0.
- If full verify is blocked by an unrelated existing issue, run coverage summary tests and `bun run build:web`, then document the unrelated failure.

## Stop Conditions

Stop and reassess before implementation continues if:

- Existing diagnostic APIs do not expose enough data to explain coverage gaps.
- The UI would need to invent coverage claims not backed by saved security check results.
- The implementation begins adding new scanner behavior instead of presenting existing diagnostic data.
