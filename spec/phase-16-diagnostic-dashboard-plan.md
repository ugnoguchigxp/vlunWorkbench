# Phase 16: Diagnostic Dashboard Plan

## Purpose

この計画は、vulnWorkbench の scan 画面を「スキャンを実行する場所」から「診断状態を把握して次の作業へ進む場所」へ引き上げるためのもの。

到達点は、Project を選択した直後に、ユーザーが次の問いへ一画面で答えられる状態である。

- 最新の診断はいつ実行され、成功したのか。
- finding は何件あり、重大度はどう分布しているのか。
- 未判断 finding はどれだけ残っているのか。
- review / decision / report / diagnostic coverage はどこまで進んでいるのか。
- 次に実行すべき操作は何か。

Phase 16 では、診断価値の入口を作る。詳細な triage 操作や zero finding coverage の深い説明は後続フェーズで扱う。

## Source Baseline

現在の scan UI:

- `web/src/domains/scans/scans-domain.tsx` は toolbar、sidebar、detail panel の3領域で構成されている。
- `web/src/domains/scans/use-scans-controller.ts` が project、scan run、finding、review、report、diagnostic data を一括管理している。
- `ScansToolbar` は project 選択と scan / DAST 実行を主導している。
- `FindingDetailPanel` は選択中 scan run の結果、finding table、report tab を表示している。
- `ScanResultOverview` と `ScanSummaryPanel` は存在するが、Project 全体の診断状態を最初に判断する dashboard にはなっていない。
- API client には `fetchScanSummary`, `fetchScanFindings`, `fetchScanReviews`, `fetchScanReports`, `fetchScanDiagnosticReports`, `fetchScanSecurityChecks`, `fetchScanAttackSurface` がある。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from projects; select status, count(*) from scan_runs group by status;"
```

UI baseline で確認すること:

- Project 選択直後に何が最初に見えるか。
- 最新 scan run の状態と finding 数がすぐ判断できるか。
- report / diagnostic / decision の不足が分かるか。
- finding 0件の scan run で、何を確認済みか分かるか。

## Scope

Phase 16 で実装するもの。

- Project diagnostic dashboard component
- 最新 scan run の summary card
- severity distribution card
- decision progress card
- review / report / diagnostic readiness card
- next actions panel
- dashboard 用の derived view model
- loading / empty / error state
- desktop と mobile の responsive layout
- focused unit tests for derived summary logic
- UI smoke verification

Phase 16 で実装しないもの。

- 新しい scan engine
- 新しい DB table
- durable background queue
- CI integration
- report format の全面変更
- finding decision 入力フローの全面変更
- zero finding diagnostic report builder の新規実装
- team / audit trail
- LLM による自由探索

## Target Files

Primary files to change:

- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/scans-domain.tsx`
- `web/src/domains/scans/components/diagnostic-dashboard.tsx`
- `web/src/domains/scans/diagnostic-dashboard.ts`
- `web/src/domains/scans/diagnostic-dashboard.test.ts`
- `web/src/styles-scans.css`

Files to read before implementation:

- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/components/scan-summary-panel.tsx`
- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/api.ts`
- `api/routes/scans.route.ts`
- `api/routes/diagnostics.route.ts`

Do not edit backend route/schema files in Phase 16 unless existing frontend API payloads are proven insufficient after a small spike. If backend aggregation is required, stop and update this plan first.

## Product Principle

Dashboard は「説明ページ」ではなく、現在の診断状態を操作可能な形で見せる。

表示する情報は、保存済みデータから導出できるものに限定する。

```text
scan_runs
  -> latest run state

findings
  -> severity distribution and open work

finding_decisions
  -> triage progress

finding_reviews / scan_reviews
  -> review coverage

scan_reports / diagnostic_reports
  -> report readiness

security_check_results / attack_surface_items
  -> diagnostic coverage signal
```

推測を事実として表示しない。データがない場合は、未実行、未判断、未生成として扱う。

## Dashboard Model

Dashboard は次の derived model を持つ。

```ts
type ProjectDiagnosticDashboard = {
  projectId: string;
  latestScanRun: {
    id: string;
    profile: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    findingCount: number;
  } | null;
  severityCounts: Record<string, number>;
  decisionProgress: {
    totalFindings: number;
    decidedFindings: number;
    undecidedFindings: number;
    needsFix: number;
    falsePositive: number;
    accepted: number;
    deferred: number;
  };
  reviewCoverage: {
    findingReviews: number;
    scanReviews: number;
    reviewMissingFindings: number;
  };
  reportReadiness: {
    scanReports: number;
    diagnosticReports: number;
    ready: boolean;
    blockers: string[];
  };
  diagnosticCoverage: {
    attackSurfaceItems: number;
    securityChecks: number;
    coverageGaps: number;
  };
  nextActions: Array<{
    kind:
      | "run_scan"
      | "review_findings"
      | "record_decisions"
      | "run_diagnostics"
      | "generate_report"
      | "inspect_zero_findings";
    label: string;
    priority: "high" | "medium" | "low";
    targetId?: string;
  }>;
};
```

The model may initially be built in the frontend from existing API responses. Add a backend summary endpoint only if the current API call pattern becomes too noisy or duplicates business rules.

### Concrete Derivation Rules

Implement `buildProjectDiagnosticDashboard(input)` in `web/src/domains/scans/diagnostic-dashboard.ts`.

Input shape:

```ts
type BuildProjectDiagnosticDashboardInput = {
  projectId: string;
  scanRuns: ScanRun[];
  selectedScanRunId: string;
  findings: Finding[];
  reports: ScanReport[];
  scanReviews: ScanReview[];
  diagnosticReports: DiagnosticReport[];
  securityCheckResults: SecurityCheckResult[];
  attackSurfaceItems: AttackSurfaceItem[];
};
```

Rules:

- `latestScanRun` is `scanRuns[0]` because `fetchScans` already returns latest-first. If this assumption is false in implementation, sort by `createdAt` descending in the helper and add a test.
- `activeScanRun` is selected scan run when available; otherwise latest scan run.
- `severityCounts` are computed from `findings` for the active scan run only.
- `decidedFindings` counts findings with `latestDecision`.
- `undecidedFindings = totalFindings - decidedFindings`.
- `reviewMissingFindings` counts findings without `latestReview`.
- `reportReadiness.ready` is true when:
  - active scan run is `completed`
  - if findings exist, all findings have `latestDecision`
  - at least one report exists or report generation has no blockers
- `reportReadiness.blockers` must be explicit strings from known conditions:
  - `scan_not_completed`
  - `undecided_findings`
  - `missing_diagnostic_summary_for_zero_findings`
  - `no_scan_selected`
- `diagnosticCoverage.coverageGaps` counts `securityCheckResults` where status is `manual_review`, `not_checked`, `warn`, or `fail`.
- `nextActions` are sorted by priority then fixed order:
  1. `run_scan`
  2. `record_decisions`
  3. `inspect_zero_findings`
  4. `run_diagnostics`
  5. `generate_report`
  6. `review_findings`

## UI Layout

The scan screen should start with a compact dashboard band below the toolbar.

```text
Toolbar
  Project selector / scan launch controls

Diagnostic Dashboard
  Latest scan
  Severity
  Decision progress
  Report readiness
  Diagnostic coverage
  Next actions

Workspace
  Recent runs / findings
  Selected scan or finding detail
```

The dashboard must be dense and operational. Avoid marketing-style hero content, large decorative cards, or explanatory copy that does not drive action.

## Implementation Tasks

Implement in these slices. Complete and verify each slice before moving to the next.

### Slice 1: Pure Dashboard Helper

1. Create `web/src/domains/scans/diagnostic-dashboard.ts`.
2. Export:
   - `type DashboardActionKind`
   - `type DashboardAction`
   - `type ProjectDiagnosticDashboard`
   - `buildProjectDiagnosticDashboard(input)`
3. Keep the file pure. It must not import React, call APIs, or mutate inputs.
4. Add `web/src/domains/scans/diagnostic-dashboard.test.ts`.
5. Test cases:
   - no project / no scan returns `run_scan`
   - failed latest scan returns high-priority `run_scan`
   - completed scan with undecided findings returns `record_decisions`
   - zero-finding scan without diagnostic report returns `inspect_zero_findings`
   - scan with all decisions and no report returns `generate_report`
   - severity counts ignore unrelated scan data if provided

Acceptance for Slice 1:

- Helper tests pass.
- No UI files are changed in this slice except type imports if needed.

### Slice 2: Controller Wiring

1. Import `buildProjectDiagnosticDashboard` into `use-scans-controller.ts`.
2. Add derived `diagnosticDashboard` value after all required state is available.
3. Add `handleDashboardAction(action)` to the controller.
4. Action behavior:
   - `run_scan`: keep static launch mode selected and focus existing start controls if practical; otherwise no-op with dashboard state visible.
   - `record_decisions`: switch `scanListTab` to `findings` and select the first undecided finding.
   - `inspect_zero_findings`: select active scan run and keep result tab open.
   - `run_diagnostics`: call existing diagnostic action only if the action maps to an existing controller method; otherwise open result area.
   - `generate_report`: call or expose existing report generation flow without duplicating report controls.
   - `review_findings`: switch to findings and select first finding without review.
5. Expose `diagnosticDashboard` and `handleDashboardAction` from `scans-context.tsx`.

Acceptance for Slice 2:

- Typecheck passes.
- Existing scan selection behavior is unchanged.
- No new backend call is introduced.

### Slice 3: Dashboard Component

1. Create `web/src/domains/scans/components/diagnostic-dashboard.tsx`.
2. Render five compact groups:
   - Latest Scan
   - Findings
   - Decisions
   - Diagnostics
   - Next Actions
3. Use existing `Button` or existing scan UI button classes. Do not introduce a new design system.
4. Each card must have stable content for:
   - no scan
   - failed scan
   - zero findings
   - undecided findings
   - report ready
5. Use action buttons that call `handleDashboardAction`.

Acceptance for Slice 3:

- Dashboard renders when scan screen is active.
- Buttons do not throw when there is no project or no scan.
- Existing toolbar and workspace remain visible.

### Slice 4: Layout and Responsive CSS

1. Import and render `DiagnosticDashboard` in `scans-domain.tsx` between `ScansToolbar` and `.scans-workspace`.
2. Add CSS to `web/src/styles-scans.css`.
3. Use CSS grid with stable min widths:
   - desktop: compact multi-column dashboard
   - tablet/mobile: single-column or two-column without overflow
4. Ensure cards are not nested inside other cards.
5. Ensure text wraps without overlapping.

Acceptance for Slice 4:

- Dashboard does not shift toolbar controls.
- At 390px width, no text overlaps or horizontal page overflow is introduced.

### Slice 5: Final Regression Check

Run the full verification list in this plan. Fix only regressions introduced by Phase 16.

## Definition of Done

Phase 16 is complete when:

- Selecting a project immediately shows the latest diagnostic state.
- The user can see latest scan status, finding severity, decision progress, review coverage, report readiness, and diagnostic coverage without opening a finding.
- Empty states distinguish no scan, failed scan, zero finding scan, and undecided finding scan.
- Next actions are derived from saved data and take the user to the relevant existing UI surface.
- The dashboard does not claim coverage or safety that is not backed by saved data.
- Layout is usable at desktop and mobile widths without text overlap.
- Existing scan start, DAST start, finding detail, and report viewing flows still work.

## Verification

Run:

```bash
git diff --check
bun run verify
```

Manual UI verification:

1. Start the app and open the scan screen.
2. Select a project with scan runs.
3. Confirm the dashboard shows latest scan status and next actions.
4. Select a zero-finding scan run and confirm the dashboard does not imply full safety.
5. Select a scan run with findings and confirm undecided finding count appears.
6. Generate or view a report and confirm report readiness updates.
7. Resize to mobile width and confirm dashboard cards do not overlap.

Expected command result:

- `git diff --check` exits 0.
- `bun run verify` exits 0.
- If `bun run verify` fails because of an unrelated pre-existing error, capture the failing command, prove Phase 16 touched UI with `bun run build:web` and helper tests, and report the unrelated blocker explicitly.

## Stop Conditions

Stop and reassess before implementation continues if:

- The dashboard requires a large new backend aggregation surface before any UI value can be shown.
- Existing API data is inconsistent about finding counts, review counts, or report counts.
- The design starts duplicating the later action queue or decision workflow in a way that makes Phase 17 / Phase 18 unclear.
