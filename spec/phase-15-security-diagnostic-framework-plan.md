# Phase 15: Security Diagnostic Framework Core Plan

## Purpose

この計画は、vulnWorkbench を「CLI scan 結果を保存するワークベンチ」から、より実践的なセキュリティ診断フレームワークへ拡張するためのもの。

現状の `detailed-security` は、Semgrep / Gitleaks / OSV / Trivy を `full_deep` scope で実行する広域 scan である。これは有用だが、finding が 0 件だった場合に、次の問いへ十分に答えられない。

- どの攻撃面を確認したのか。
- どのセキュリティ境界を確認したのか。
- どの観点は未確認なのか。
- finding が 0 件だったことを、どこまで低リスクの根拠として扱えるのか。
- 次に手動確認または追加検査すべき箇所はどこか。

Phase 15 の目的は、finding の有無だけに依存しない診断価値を作ること。具体的には、次の 3 要素を実装する。

1. Attack Surface Inventory
2. Security Check Framework
3. Zero Finding Diagnostic Report

このフェーズでは、運用安定性、長時間ジョブ管理、CI 統合、チーム運用 UI は主目的にしない。まず、コンセプトとして十分な価値を持つ診断モデルを成立させる。

## Core Principle

Phase 15 でも、vulnWorkbench の基本境界は維持する。

```text
CLI tools = evidence generation
Deterministic analyzers = inventory and check result generation
LLM = explanation, prioritization, residual-risk summary
Human = final decision
```

重要なのは、脆弱性 finding 以外の診断成果物を一級のデータとして扱うこと。

```text
finding:
  問題またはリスク候補

attack surface item:
  診断対象となる入口、境界、実行点、データ操作点

security check result:
  pass / fail / warn / not_applicable / manual_review / not_checked

coverage gap:
  今回の診断では確認できなかった観点

diagnostic report:
  finding、check result、coverage gap を統合した説明可能な結論
```

finding が 0 件でも、attack surface / check result / coverage gap が残れば、診断として価値が出る。

## Source Baseline

Phase 15 実装前に確認する現状。

- `api/modules/scans/profiles.ts` に `detailed-security` がある。
- `detailed-security` は `full_deep` scope で `semgrep`, `gitleaks`, `osv`, `trivy` を実行する。
- `scan_runs`, `tool_runs`, `scan_artifacts`, `findings`, `finding_evidences`, `finding_reviews`, `finding_decisions`, `scan_reports` が既に存在する。
- reproduction / dynamic / DAST は dedicated run / artifact / evidence モデルを持つ。
- Markdown report は finding / evidence / review / decision / reproduction / dynamic / DAST を統合できる。
- 現状の scan report は finding が 0 件の場合、診断範囲、確認済み境界、未確認項目の説明力が弱い。

実装前に採取する baseline:

```bash
git status --short
git diff --check
bun run verify
bun run scan:profile -- --profile detailed-security --dry-run true
```

可能なら、既存のローカル project に対して次も保存する。

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile detailed-security \
  --output-summary /tmp/vuln-workbench-detailed-security-baseline.json \
  --report-output /tmp/vuln-workbench-detailed-security-baseline.md
```

確認すること:

- `detailed-security` の tool order と tool options が記録されている。
- finding 0 件の report がどの程度の説明を返すか確認する。
- Phase 15 後に、同じ scan 結果から追加の診断価値が出ることを比較できるようにする。

## Scope

Phase 15 で実装するもの。

- Attack Surface Inventory data model
- Attack Surface Inventory extractor
- `inventory:attack-surface` CLI
- Attack surface API
- Security Check Framework data model
- Security check registry
- Initial deterministic checks
- `check:security` CLI
- Security check API
- Zero Finding Diagnostic Report builder
- Zero finding report integration in `report:scan`
- Diagnostic summary API
- Minimal scan UI integration
- Tests, fixtures, verification docs

Phase 15 で実装しないもの。

- 新しい大規模外部 scanner の追加
- LLM による repo 全体の自由探索
- LLM tool としての任意 file read
- exploit 生成
- patch 生成または patch 自動適用
- CI integration
- durable background queue
- multi-tenant SaaS features
- long-running fuzz campaign
- authenticated browser automation の拡張
- production-grade scheduling / retry / notification
- legacy knowledge / chat / search の全面再設計

## Definition of Done

Phase 15 は次を満たしたら完了とする。

- Attack Surface Inventory を scan run または project に対して生成できる。
- Inventory は route、auth boundary、admin boundary、artifact access、CLI execution、external call、database write、file/path boundary の初期カテゴリを表現できる。
- Security Check Framework が Inventory と保存済み scan/tool/evidence metadata を入力として check result を生成できる。
- Check result は `pass`, `fail`, `warn`, `not_applicable`, `manual_review`, `not_checked` を区別する。
- finding が 0 件でも、Zero Finding Diagnostic Report が確認済み観点、未確認観点、残余リスク、次の確認候補を出力できる。
- Report は保存済み evidence / inventory / check result に基づき、未確認の推測を事実として書かない。
- LLM は任意 path を読まず、保存済み summary / references / bounded snippets だけを入力にする。
- 既存の `scan:profile`, `review:finding`, `decision:finding`, `report:scan`, reproduction, dynamic, DAST の動作を壊さない。
- `bun run verify` と `git diff --check` が通る。

## Data Model

Phase 15 では、finding とは別に診断成果物を保存する。

Recommended tables:

```text
attack_surface_items
  id
  project_id
  scan_run_id
  category
  name
  kind
  location_json
  boundary_json
  evidence_refs_json
  confidence
  metadata
  created_at
  updated_at

security_checks
  id
  check_id
  title
  category
  severity_hint
  description
  input_kinds_json
  enabled
  metadata
  created_at
  updated_at

security_check_results
  id
  project_id
  scan_run_id
  check_id
  attack_surface_item_id
  status
  outcome
  title
  summary
  evidence_refs_json
  remediation_hint
  coverage_gap
  metadata
  created_at
  updated_at

diagnostic_reports
  id
  project_id
  scan_run_id
  report_kind
  status
  summary
  checked_categories_json
  coverage_gaps_json
  residual_risks_json
  recommended_next_actions_json
  artifact_id
  metadata
  error_message
  created_at
  updated_at
```

Rules:

- `attack_surface_items` are not findings.
- `security_check_results.status = fail` may optionally create or link a finding in a later phase, but Phase 15 does not require automatic finding creation.
- `not_checked` and `manual_review` are first-class outcomes, not errors.
- `coverage_gap` is a valid diagnostic result when the framework cannot make a claim from available evidence.
- `diagnostic_reports` may link to `scan_reports`, but should not replace existing Markdown report records.

## Status Vocabulary

Security check result statuses:

```text
pass:
  The check was performed and no issue was observed.

fail:
  The check found a concrete problem or policy violation.

warn:
  The check found a weak signal, risky configuration, or incomplete hardening.

not_applicable:
  The check does not apply to this project, scan, or attack surface item.

manual_review:
  The available evidence is insufficient for deterministic judgment, but the item deserves human review.

not_checked:
  The framework knows this category exists but did not inspect it in this run.
```

Do not collapse `manual_review` and `not_checked` into `warn`. They answer different questions.

## Attack Surface Inventory

### Purpose

Attack Surface Inventory enumerates what should be examined before judging whether a scan result is meaningful.

The inventory should answer:

- What are the externally reachable or user-triggered entry points?
- Which routes require auth?
- Which routes require admin?
- Where are artifacts or local files read?
- Where are files written?
- Where are subprocesses or Docker runs created?
- Which code paths use external network calls?
- Which code paths write to the database?
- Which environment variables affect security boundaries?

### Initial Categories

Implement these categories first:

```text
api_route
  Hono route method/path, handler file, auth/admin boundary if detectable

auth_boundary
  requireAuth, requireAdmin, login, refresh, logout, token/cookie handling

artifact_access
  download/read artifact endpoints, path validation, content disposition

file_path_boundary
  repo path, artifact path, scoped workspace, path traversal guard

execution_boundary
  Bun.spawn, Docker runner, tool process runner, dynamic/reproduction execution

external_call
  HTTP client, LLM provider, web search provider, DAST target request

database_write
  create/update/delete repository methods and route-triggered writes

configuration_boundary
  JWT, CORS, cookie secure/sameSite, security headers, provider API keys
```

### Extractor Design

Add deterministic extractors under:

```text
api/modules/diagnostics/attack-surface/
```

Recommended files:

```text
api/modules/diagnostics/attack-surface/types.ts
api/modules/diagnostics/attack-surface/route-inventory.ts
api/modules/diagnostics/attack-surface/auth-boundary-inventory.ts
api/modules/diagnostics/attack-surface/file-boundary-inventory.ts
api/modules/diagnostics/attack-surface/execution-boundary-inventory.ts
api/modules/diagnostics/attack-surface/config-boundary-inventory.ts
api/modules/diagnostics/attack-surface/inventory-runner.ts
api/modules/diagnostics/attack-surface/repository.ts
```

Implementation should start with TypeScript AST parsing when practical. If AST parsing is too large for Phase 15, use conservative regex-based extraction only for stable local patterns and mark low-confidence items explicitly.

Do not let LLM discover inventory items.

### CLI Contract

Add package script:

```json
{
  "inventory:attack-surface": "bun run api/cli/inventory-attack-surface.ts"
}
```

Command:

```bash
bun run inventory:attack-surface -- \
  --project-id <project-id> \
  --scan-run-id <scan-run-id>
```

Options:

```text
--project-id <project-id>
--scan-run-id <scan-run-id>
--output-summary <path>
--fixture-root <path>
--dry-run true|false
```

Success JSON:

```json
{
  "ok": true,
  "projectId": "...",
  "scanRunId": "...",
  "inventoryCount": 42,
  "categories": {
    "api_route": 18,
    "execution_boundary": 4
  }
}
```

Failure JSON:

```json
{
  "ok": false,
  "projectId": "...",
  "scanRunId": "...",
  "message": "Project not found"
}
```

stdout must be JSON only. Progress logs go to stderr.

## Security Check Framework

### Purpose

Security Check Framework turns attack surface and saved scan metadata into structured diagnostic judgments.

This framework is not another scanner adapter. It is a deterministic diagnostic layer that asks whether important security properties were checked, passed, failed, or still need manual review.

### Initial Checks

Start with checks that are valuable for local web/API apps and for vulnWorkbench itself.

```text
auth.required_for_project_routes
  Category: auth_boundary
  Goal: project/scan/finding/report endpoints should require auth.
  Inputs: api_route inventory, auth middleware inventory.

auth.admin_routes_require_admin
  Category: auth_boundary
  Goal: admin endpoints should require admin guard.
  Inputs: api_route inventory, auth boundary inventory.

artifact.download_scoped_to_owner
  Category: artifact_access
  Goal: artifact download endpoints must verify project ownership before reading stored paths.
  Inputs: artifact_access inventory, route handler references.

path.repo_access_uses_scope_guard
  Category: file_path_boundary
  Goal: repo/artifact path reads should use path normalization or stored artifact references.
  Inputs: file_path_boundary inventory.

execution.no_shell_string_for_tool_runs
  Category: execution_boundary
  Goal: tool execution should use structured args, not shell command strings.
  Inputs: execution_boundary inventory.

execution.runner_scrubs_sensitive_env
  Category: execution_boundary
  Goal: scanner/Docker runner should not inherit LLM/API key secrets.
  Inputs: execution_boundary inventory, config boundary inventory.

execution.docker_no_socket_mount
  Category: execution_boundary
  Goal: Docker-based runners should not mount Docker socket.
  Inputs: execution boundary inventory.

config.production_jwt_secret_required
  Category: configuration_boundary
  Goal: production must reject default or weak JWT secret.
  Inputs: env parser/config inventory.

config.cookie_security_reviewed
  Category: configuration_boundary
  Goal: auth cookies should set httpOnly, sameSite, and secure according to environment.
  Inputs: auth boundary inventory, config inventory.

scan.zero_finding_has_coverage_context
  Category: diagnostic_coverage
  Goal: zero finding scan should still produce checked/unchecked category summary.
  Inputs: scan run, tool runs, inventory, check results.
```

### Check Registry

Add:

```text
api/modules/diagnostics/checks/check-registry.ts
api/modules/diagnostics/checks/types.ts
api/modules/diagnostics/checks/repository.ts
api/modules/diagnostics/checks/check-runner.ts
```

Recommended type:

```ts
type SecurityCheckStatus =
  | "pass"
  | "fail"
  | "warn"
  | "not_applicable"
  | "manual_review"
  | "not_checked";

type SecurityCheckResult = {
  checkId: string;
  status: SecurityCheckStatus;
  title: string;
  summary: string;
  attackSurfaceItemId?: string | null;
  evidenceRefs: Array<{
    kind: "file" | "route" | "scan_artifact" | "tool_run" | "finding" | "diagnostic";
    id?: string;
    path?: string;
    line?: number;
    label?: string;
  }>;
  remediationHint?: string;
  coverageGap?: string;
  metadata?: Record<string, unknown>;
};
```

Rules:

- A check must not invent evidence.
- A check may return `manual_review` when deterministic evidence is insufficient.
- A check may return `not_checked` when the framework does not have an extractor for the needed category yet.
- Checks should be individually testable with fixture inventory records.
- A failing check does not automatically mutate finding decision state.

### CLI Contract

Add package script:

```json
{
  "check:security": "bun run api/cli/check-security.ts"
}
```

Command:

```bash
bun run check:security -- \
  --project-id <project-id> \
  --scan-run-id <scan-run-id>
```

Options:

```text
--project-id <project-id>
--scan-run-id <scan-run-id>
--category <category>
--check-id <check-id>
--output-summary <path>
--dry-run true|false
```

Success JSON:

```json
{
  "ok": true,
  "projectId": "...",
  "scanRunId": "...",
  "resultCount": 24,
  "statusCounts": {
    "pass": 12,
    "warn": 3,
    "manual_review": 7,
    "not_checked": 2
  }
}
```

stdout must be JSON only. Progress logs go to stderr.

## Zero Finding Diagnostic Report

### Purpose

Zero Finding Diagnostic Report explains what a no-finding result means and does not mean.

It should be generated when a scan has 0 findings, but it should also be useful when findings exist and the user wants diagnostic coverage context.

The report must distinguish:

- Confirmed checks
- Weak signals
- Manual review items
- Not applicable checks
- Not checked categories
- Residual risks
- Recommended next actions

### Report Sections

Minimum Markdown sections:

```text
# Zero Finding Diagnostic Summary

## Result
No normalized vulnerability findings were produced by this scan.

## Checked Categories
Table of categories and status counts.

## Attack Surface Inventory
Summary by category with representative items.

## Passed Checks
Security properties that were deterministically confirmed.

## Warnings and Manual Review
Items that deserve human attention even without findings.

## Coverage Gaps
Categories or checks not covered by this scan.

## Residual Risk
What cannot be concluded from this scan.

## Recommended Next Actions
Concrete follow-up checks or profiles.
```

The report must not say "the project is safe." It should say what was checked and what remains unknown.

### Builder

Add:

```text
api/modules/diagnostics/reports/zero-finding-report-builder.ts
api/modules/diagnostics/reports/diagnostic-report-repository.ts
```

Inputs:

```text
projectId
scanRunId
scan run metadata
tool run summaries
finding count
attack surface inventory
security check results
existing scan report references
```

Output:

```text
diagnostic report record
markdown artifact
summary JSON
```

Rules:

- The builder must work without LLM provider.
- LLM summary may be added later as optional `report_summary`, but deterministic report must exist first.
- The builder must not create findings.
- The builder must not change decisions or reviews.
- If inventory or check results are missing, the report should list them as coverage gaps rather than failing.

### Integration

Phase 15 should support both explicit and automatic generation.

Explicit CLI:

```json
{
  "report:diagnostic": "bun run api/cli/report-diagnostic.ts"
}
```

Command:

```bash
bun run report:diagnostic -- \
  --project-id <project-id> \
  --scan-run-id <scan-run-id> \
  --kind zero-finding \
  --output-path /tmp/zero-finding-diagnostic.md
```

Optional integration:

- `scan:profile --final-report true` may include a diagnostic summary section if diagnostic data already exists.
- Do not make `scan:profile` fail if diagnostic report generation fails.
- Do not require diagnostic generation for normal static scan completion in Phase 15.

## API

Add minimal protected endpoints.

```text
GET  /api/scans/:scanRunId/attack-surface
POST /api/scans/:scanRunId/attack-surface/run

GET  /api/scans/:scanRunId/security-checks
POST /api/scans/:scanRunId/security-checks/run

GET  /api/scans/:scanRunId/diagnostic-reports
POST /api/scans/:scanRunId/diagnostic-reports
GET  /api/diagnostic-reports/:reportId
GET  /api/diagnostic-reports/:reportId/download
```

Rules:

- All endpoints require auth.
- Project ownership must be checked through the scan run's project.
- Download endpoints must not expose raw filesystem paths.
- Failed diagnostic reports are visible as records but not downloadable as completed artifacts.

## UI

Add minimal UI under the existing scans domain.

Do not create a new product area in Phase 15.

Required UI additions:

- Scan detail shows "Diagnostic coverage" summary.
- Finding list empty state links to zero finding diagnostic report when available.
- Attack surface panel groups inventory by category.
- Security checks panel shows status counts and manual-review items.
- Report panel includes diagnostic report history and download.

The UI should not imply that no findings means safe. Use wording such as:

```text
No normalized findings were produced. Review diagnostic coverage before treating this as low risk.
```

## LLM Use

LLM use in Phase 15 is optional and advisory.

Allowed:

- Summarize attack surface categories.
- Summarize check result patterns.
- Explain residual risk from saved check results.
- Suggest next diagnostic profiles from known profiles.

Not allowed:

- Read arbitrary files.
- Invent attack surface items not produced by deterministic inventory.
- Create findings without tool/check evidence.
- Mark a finding accepted or false positive.
- Generate exploit steps.
- Recommend unbounded scan or patch automation as a default.

If LLM output is added, use schema validation and persist failure as diagnostic report failure or optional summary failure. Do not block deterministic report generation.

## Implementation Order

### Step 1: Baseline and Schema

Tasks:

- Record current `detailed-security` dry run output.
- Add migrations for `attack_surface_items`, `security_checks`, `security_check_results`, and `diagnostic_reports`.
- Add Drizzle schema entries.
- Add shared Zod schemas for diagnostic records and API responses.

Verification:

```bash
bun run db:migrate
bun run typecheck
bun test ./api/db/*.test.ts
```

If no DB schema tests exist for migrations, verify with a fresh temporary SQLite database through the migration CLI.

### Step 2: Attack Surface Inventory

Tasks:

- Add inventory extractor types.
- Implement route inventory for Hono routes.
- Implement auth/admin boundary inventory for `requireAuth` and `requireAdmin`.
- Implement artifact/file path boundary inventory for artifact read/download and path guard helpers.
- Implement execution boundary inventory for `Bun.spawn`, Docker runners, and tool process runner.
- Persist inventory rows.
- Add `inventory:attack-surface` CLI.

Verification:

```bash
bun test ./api/modules/diagnostics/attack-surface/**/*.test.ts
bun run inventory:attack-surface -- --project-id <project-id> --scan-run-id <scan-run-id> --output-summary /tmp/attack-surface.json
```

Expected result:

- JSON output contains nonzero inventory count for this repo.
- API routes and execution boundaries are represented.
- Low-confidence extraction is explicitly marked and not treated as confirmed.

### Step 3: Security Check Framework

Tasks:

- Add check registry.
- Add check runner.
- Implement initial checks listed in this plan.
- Persist check results.
- Add `check:security` CLI.

Verification:

```bash
bun test ./api/modules/diagnostics/checks/**/*.test.ts
bun run check:security -- --project-id <project-id> --scan-run-id <scan-run-id> --output-summary /tmp/security-checks.json
```

Expected result:

- Status counts include `pass`, `manual_review`, or `not_checked`.
- Checks can run even when findings are 0.
- Missing inventory categories become `not_checked` or `manual_review`, not silent success.

### Step 4: Zero Finding Diagnostic Report

Tasks:

- Add diagnostic report repository.
- Add zero finding report builder.
- Save Markdown report as artifact.
- Add `report:diagnostic` CLI.
- Add optional integration into existing scan report builder.

Verification:

```bash
bun test ./api/modules/diagnostics/reports/**/*.test.ts
bun run report:diagnostic -- --project-id <project-id> --scan-run-id <scan-run-id> --kind zero-finding --output-path /tmp/zero-finding-diagnostic.md
```

Expected result:

- Report is generated even when `findings` is empty.
- Report contains checked categories, manual review items, coverage gaps, residual risk, and next actions.
- Report does not claim the project is safe.

### Step 5: API and UI

Tasks:

- Add protected diagnostic routes.
- Add ownership checks.
- Add scan detail diagnostic coverage panel.
- Add zero-finding empty state that links to diagnostic report.
- Add diagnostic report download.

Verification:

```bash
bun test ./api/routes/diagnostics.route.test.ts
bun run typecheck
bun run build
```

Expected result:

- Unauthorized users cannot access diagnostic records.
- Project owners can view inventory, check results, and diagnostic reports.
- UI shows diagnostic context for zero-finding scans.

### Step 6: Full Verification

Run:

```bash
git diff --check
bun run verify
```

Then run an end-to-end local diagnostic sequence:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile detailed-security \
  --output-summary /tmp/vuln-workbench-phase15-scan.json \
  --report-output /tmp/vuln-workbench-phase15-scan.md

bun run inventory:attack-surface -- \
  --project-id <project-id> \
  --scan-run-id <scan-run-id> \
  --output-summary /tmp/vuln-workbench-phase15-inventory.json

bun run check:security -- \
  --project-id <project-id> \
  --scan-run-id <scan-run-id> \
  --output-summary /tmp/vuln-workbench-phase15-checks.json

bun run report:diagnostic -- \
  --project-id <project-id> \
  --scan-run-id <scan-run-id> \
  --kind zero-finding \
  --output-path /tmp/vuln-workbench-phase15-zero-finding.md
```

Completion criteria:

- All commands produce machine-readable JSON or expected Markdown output.
- Diagnostic report references real inventory and check result records.
- Existing scan and report commands still work without running diagnostics.
- Zero-finding scan produces a useful coverage explanation.

## Initial Fixtures

Add small fixture projects under tests or generated temp directories.

Recommended fixtures:

```text
fixture-secure-minimal-api
  Has protected route, admin route, no findings expected.

fixture-missing-auth-route
  Has an unprotected sensitive route.

fixture-artifact-download-boundary
  Has artifact read path with ownership check.

fixture-execution-boundary
  Has structured Bun.spawn and a shell-string anti-example.

fixture-zero-finding-report
  Has no normalized findings but has inventory/check results.
```

Fixtures should avoid real secrets. Use clearly fake values that do not trigger GitHub push protection.

## Report Quality Rules

The zero finding report must follow these rules.

- Say "no normalized findings were produced", not "no vulnerabilities exist".
- Every passed claim must be backed by check result references.
- Every unknown must appear as coverage gap, manual review, or not checked.
- Recommended next actions must be concrete and bounded.
- Do not recommend exploit generation.
- Do not recommend arbitrary repo-wide LLM exploration.
- Prefer existing profile names and commands when suggesting follow-up.

Example wording:

```text
No normalized findings were produced by this scan. The diagnostic checks confirmed the listed route and execution boundaries, but DAST target validation and authenticated browser coverage were not performed in this run.
```

## Risks

### Inventory false confidence

If inventory extraction misses routes or boundaries, the report may understate risk.

Mitigation:

- Include extraction confidence.
- Add coverage gaps for unsupported frameworks and patterns.
- Avoid absolute safety language.

### Check framework becomes a second SAST

The framework may drift into ad hoc vulnerability scanning.

Mitigation:

- Keep checks tied to known inventory categories.
- Use deterministic evidence.
- Add new scanner adapters separately when needed.

### Too many manual-review results

Early versions may produce many `manual_review` or `not_checked` entries.

Mitigation:

- Treat this as acceptable for Phase 15.
- Use the report to show where framework coverage should improve next.

### LLM overreach

LLM summary may imply certainty beyond evidence.

Mitigation:

- Make deterministic report mandatory.
- Keep LLM summary optional.
- Schema-validate output.
- Prompt the model to separate checked facts from residual risk.

## Hand-Off to Later Phases

After Phase 15, later phases can add:

- framework-specific inventory extractors
- language-specific taint/dataflow checks
- dependency reachability analysis
- SBOM generation
- richer DAST profile recommendations
- CI integration
- scheduled local diagnostics
- LLM-assisted report summary
- optional conversion of failed security checks into findings

Do not add these in Phase 15 unless they are necessary to complete the three core deliverables.
