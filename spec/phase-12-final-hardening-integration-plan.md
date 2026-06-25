# Phase 12: Final Hardening and Full Diagnostic Integration Plan

## Purpose

この計画は、vulnWorkbench の Phase 12 として、Phase 1 から Phase 11 までで追加した診断能力を統合し、十分な脆弱性診断ワークベンチとして破綻しにくい状態へ仕上げるためのもの。

Phase 12 は新しい大きな診断カテゴリを追加する Phase ではない。既存の CLI scan、multi-tool adapters、LLM review、human decision、report、Docker toolbox、sandbox reproduction、dynamic verification、DAST / browser automation を、実運用で説明可能な一つの workflow として hardening する。

重要な責務境界:

- heavy diagnostic work は引き続き CLI に委譲する。
- LLM は診断の探索主体ではなく、保存済み finding / evidence / artifact のレビュー主体である。
- Phase 12 は traceability、security boundary、failure mode、UI integration、docs、verification を閉じる。
- Phase 12 で exploit generation、patch automation、new major scanner、unbounded fuzzing、destructive DAST を追加しない。
- CI は必須化しない。ただし local verification は再現可能な形にする。

## Source Baseline

Phase 12 は Phase 1 から Phase 11 が完了した状態を前提にする。

前提機能:

```text
Phase 1: CLI scan foundation
Phase 2: Semgrep adapter
Phase 3: LLM finding review
Phase 4: reviewer decision workflow
Phase 5: Markdown report export
Phase 6: Gitleaks / OSV / Trivy adapters
Phase 7: scan profile orchestration
Phase 8: Docker toolbox runner
Phase 9: sandbox reproduction
Phase 10: test / sanitizer / lightweight fuzzing
Phase 11: DAST / browser automation
```

前提 CLI:

```text
scan:import
scan:semgrep
scan:gitleaks
scan:osv
scan:trivy
scan:profile
review:finding
decision:finding
report:scan
repro:finding
dynamic:run
scan:dast
```

実装前に確認する baseline:

```bash
git status --short
git diff --check
bun run verify
rg -n 'scan:profile|review:finding|decision:finding|report:scan|repro:finding|dynamic:run|scan:dast' package.json api spec
rg -n 'TODO|FIXME|RAG|hono-standard|template|placeholder|stub' README.md spec api shared web/src
```

確認すること:

- Phase 11 が未実装または `scan:dast` が存在しない場合、Phase 12 実装へ進まず Phase 11 完了へ戻す。
- `bun run verify` が既に失敗している場合、Phase 12 の最初の作業として原因を分類し、Phase 12 で扱うべき failure か前 Phase の未完了かを分ける。
- Phase 12 の変更は既存の未コミット実装差分と混ぜて壊さない。
- 通常 verify は Docker daemon、browser image、live target、LLM provider を必須にしない。

## Scope

Phase 12 で実装するもの。

- Phase inventory audit
- end-to-end traceability audit
- artifact access hardening
- secret redaction boundary audit
- container / runner environment audit
- target / path / command boundary audit
- failure kind catalog and normalization
- API response consistency pass
- UI workflow integration pass
- report integration pass
- README / docs / troubleshooting update
- local fixture workflow
- final verification matrix

Phase 12 で実装しないもの。

- new major scan tool
- public internet DAST support
- authenticated browser session recording
- exploit generation
- patch auto-apply
- destructive DAST
- unbounded fuzz campaign
- long-running scheduler
- SaaS multi-tenant isolation
- CI required gate
- cloud artifact storage migration
- LLM-driven free source exploration

## Completion Boundary

Phase 12 完了時点で、CI がなくても次が成立している状態を目標にする。

```text
local project registration
  -> scan profile selection
  -> CLI / Docker tool execution
  -> raw artifact persistence
  -> deterministic finding / evidence normalization
  -> LLM review
  -> human decision
  -> sandbox reproduction
  -> dynamic verification
  -> scoped DAST / browser checks
  -> Markdown report export
  -> artifact-backed audit trail
```

完了の意味:

- finding から一次証拠へ辿れる。
- 一次証拠から関連 finding へ辿れる。
- LLM review と human decision が一次証拠と混ざらず表示される。
- reproduction / dynamic / DAST evidence が既存 finding workflow と矛盾しない。
- 失敗が tool / parser / LLM / sandbox / DAST / artifact / validation のどれか分かる。
- secret / token / cookie / LLM key の境界がテストで確認されている。
- README と実装が一致している。
- `bun run verify` と `git diff --check` が通る。

## Traceability Contract

すべての表示・判断・report section は、保存済み record または raw artifact へ遡れる必要がある。

必須 trace:

```text
project
  -> scan_runs
  -> tool_runs
  -> scan_artifacts
  -> findings
  -> finding_evidence
  -> finding_reviews
  -> finding_decisions
  -> scan_reports

finding
  -> reproduction_runs
  -> reproduction_artifacts
  -> reproduction_evidence

project / scan / finding
  -> dynamic_runs
  -> dynamic_artifacts
  -> dynamic_evidence

project / scan
  -> dast_runs
  -> dast_artifacts
  -> dast_evidence
  -> optional DAST findings
```

Rules:

- `finding_evidence.artifact_id` should be populated whenever evidence comes from a scan artifact.
- `finding_reviews.input_bundle` must include stable finding / evidence / artifact references.
- `finding_decisions.linked_review_id` must remain optional, but if present it must reference the same finding.
- `scan_reports.artifact_id` must point to the generated Markdown artifact when report generation succeeds.
- reproduction / dynamic / DAST evidence must not be treated as primary static scan evidence unless explicitly linked.
- UI must distinguish primary evidence, LLM review, human decision, reproduction, dynamic verification, and DAST evidence.

If a trace cannot be represented by existing columns, prefer adding stable IDs in `metadata` before broad schema changes. Add schema columns only when metadata cannot support query or API requirements.

## Security Boundary Contract

Phase 12 must verify these boundaries across tests and documentation.

Path and artifact:

- Repository path traversal is rejected.
- Symlink escape from registered repo is rejected or explicitly documented as blocked by canonical path validation.
- Artifact suggested filename traversal is rejected.
- Artifact read routes verify ownership and artifact membership.
- Screenshot / binary artifact routes set correct content type and do not inline unsafe HTML.

Secret and LLM:

- Secret-like values are redacted in scan artifacts where tool output is persisted.
- Secret-like snippets are redacted before LLM review input.
- LLM API keys remain host-side only.
- Container / dynamic / reproduction / DAST runners do not receive LLM API keys.
- Screenshot bytes are not sent to LLM by default.

Runner and Docker:

- Docker socket is never mounted into toolbox, dynamic, reproduction, or DAST containers.
- Privileged container mode is not used.
- Host repo is mounted read-only unless a phase explicitly uses ephemeral workdir copy.
- Network defaults are restrictive and phase-specific.
- Host runner remains explicit. Docker runner must not silently fall back to host.

Target and command:

- DAST target validation rejects unauthorized public targets.
- Dynamic command profiles reject shell strings and unapproved binaries.
- Reproduction profiles remain finding-scoped and bounded.
- API bridges construct argv arrays and never shell-concatenate request bodies.

## Failure Kind Catalog

Phase 12 should standardize failure naming in CLI JSON, API responses, UI display, and docs.

Core failure kinds:

```text
tool_missing
tool_timeout
tool_exit_nonzero
tool_output_missing
tool_output_invalid
normalizer_failed
artifact_write_failed
artifact_read_failed
path_validation_failed
ownership_check_failed
llm_provider_unconfigured
llm_provider_failed
llm_output_invalid
decision_validation_failed
report_generation_failed
docker_unavailable
docker_image_missing
sandbox_profile_rejected
sandbox_timeout
dynamic_profile_rejected
dynamic_timeout
dast_target_rejected
dast_target_unreachable
dast_redirect_out_of_scope
browser_unavailable
browser_timeout
unknown_error
```

Rules:

- CLI commands output JSON on stdout for machine-readable results.
- API routes must not require parsing stderr for expected failures.
- UI should show failure kind and human message separately.
- Do not collapse provider failures into scan failures.
- Do not collapse target validation failures into browser failures.
- Do not collapse artifact persistence failure into normalizer failure.

## UI Integration Contract

The UI must support a full diagnostic pass without requiring the user to infer state from logs.

Required workflow:

```text
Projects
  -> project detail
  -> scan profile selection
  -> scan run status
  -> findings list
  -> finding detail
  -> evidence / artifact inspection
  -> LLM review
  -> human decision
  -> reproduction
  -> dynamic verification
  -> DAST
  -> report export
```

UI rules:

- Static scan evidence, reproduction evidence, dynamic evidence, DAST evidence, LLM review, and human decision are visually separate.
- Every action that runs a CLI-backed task shows profile, target, runner, and boundary summary before execution.
- Failure states show actionable but bounded messages.
- Empty states explain what is missing without implying LLM will scan source.
- No free-form command input is introduced.
- No free-form DAST target execution box is introduced.
- RAG or old template copy must not describe the product as a generic knowledge RAG app.

## Report Integration Contract

Markdown report export must reflect the full workflow without treating LLM output as primary evidence.

Required report sections:

```text
scan summary
tool summary
finding groups
finding details
primary evidence
LLM review summary
human decision
reproduction summary
dynamic verification summary
DAST summary
artifact references
verification metadata
```

Rules:

- Reports must include artifact references for primary evidence.
- Reports must identify source tool names.
- Reports must mark LLM review as review, not primary evidence.
- Reports must include human decision when available.
- Reports may summarize reproduction / dynamic / DAST outcomes but must link to run IDs or artifact IDs.
- Reports must not include unredacted secrets.

## Implementation Steps

### P0: Baseline Audit

Run:

```bash
git status --short
git diff --check
bun run verify
rg -n 'scan:profile|review:finding|decision:finding|report:scan|repro:finding|dynamic:run|scan:dast' package.json api spec
rg -n 'TODO|FIXME|RAG|hono-standard|template|placeholder|stub' README.md spec api shared web/src
```

Expected:

- Worktree state is understood.
- Current verify result is recorded.
- CLI command inventory is known.
- Stale copy / placeholders are listed.

Failure handling:

- If `scan:dast` is absent, stop Phase 12 implementation and complete Phase 11 first.
- If verify fails, classify whether the failure belongs to an earlier incomplete phase or Phase 12 hardening.
- If stale RAG copy is found in user-facing docs/UI, add it to P8.

Completion criteria:

- A concrete hardening task list exists.
- No Phase 12 implementation begins with unknown baseline failures.

### P1: Phase Inventory Audit

Implement a small read-only audit helper if needed:

```text
scripts/audit-phase12-inventory.ts
```

The helper should inspect package scripts, route files, shared schemas, and key modules. It should output JSON only.

Minimum JSON:

```json
{
  "ok": true,
  "commands": {
    "scan:profile": true,
    "review:finding": true,
    "decision:finding": true,
    "report:scan": true,
    "repro:finding": true,
    "dynamic:run": true,
    "scan:dast": true
  },
  "routes": {},
  "schemas": {},
  "missing": []
}
```

Verification:

```bash
bun run scripts/audit-phase12-inventory.ts
```

Expected:

- All Phase 1-11 command contracts are present.
- Missing items are explicit JSON entries, not console prose.

Failure handling:

- Missing Phase 11 items stop Phase 12.
- Missing optional docs become P8 tasks.

Completion criteria:

- Phase inventory is machine-readable and reviewed.

### P2: Traceability Audit

Implement read-only traceability checks:

```text
scripts/audit-phase12-traceability.ts
```

Checks:

- `findings` have at least one `finding_evidence` when produced by scan runs.
- `finding_evidence.artifact_id` references existing `scan_artifacts` when present.
- `finding_reviews.finding_id` references existing finding.
- `finding_reviews.input_bundle` contains finding and evidence references.
- `finding_decisions.linked_review_id`, when present, belongs to the same finding.
- `scan_reports.artifact_id`, when present, references an existing artifact.
- reproduction / dynamic / DAST run artifacts reference their owning run.
- DAST findings, if present, have `sourceTool` names documented by Phase 11.

Verification:

```bash
bun run scripts/audit-phase12-traceability.ts -- --database-url <database-url>
```

Expected:

- Exits 0 with `ok: true` for a seeded fixture DB.
- Returns typed failures for missing evidence, orphan artifact references, and mismatched linked reviews.

Failure handling:

- If missing references are caused by old fixture data, repair fixtures.
- If missing references are caused by implementation, fix repository / normalizer / report code before UI polish.

Completion criteria:

- Traceability failures are either fixed or explicitly impossible in current implementation.

### P3: Artifact Access Hardening

Review and harden:

```text
api/modules/scans/artifact-storage.ts
api/modules/reproductions/reproduction-artifact-storage.ts
api/modules/dynamic/dynamic-artifact-storage.ts
api/modules/dast/dast-artifact-storage.ts
api/routes/scans.route.ts
api/routes/reproductions.route.ts
api/routes/dynamic.route.ts
api/routes/dast.route.ts
api/routes/scan-reports.route.ts
```

Tests:

- suggested filename traversal is rejected.
- artifact path traversal is rejected.
- artifact read checks ownership.
- artifact read checks run / scan membership.
- JSON artifacts return JSON.
- text artifacts return text.
- screenshots return image content type.

Verification:

```bash
bun test ./api/modules/scans/artifact-storage.test.ts
bun test ./api/modules/reproductions/*.test.ts
bun test ./api/modules/dynamic/*.test.ts
bun test ./api/modules/dast/*.test.ts
bun test ./api/routes/scans.route.test.ts ./api/routes/reproductions.route.test.ts ./api/routes/dynamic.route.test.ts ./api/routes/dast.route.test.ts
```

Expected:

- Normal tests do not require Docker, browser, live target, or LLM provider.
- Path traversal attempts fail deterministically.

Failure handling:

- Any artifact traversal failure blocks Phase 12 completion.
- If a route cannot prove ownership, add repository lookup before reading files.

Completion criteria:

- Artifact access is tested across scan, reproduction, dynamic, DAST, and report artifacts.

### P4: Redaction and LLM Input Hardening

Review and harden:

```text
api/modules/scans/normalizers/redaction.ts
api/modules/reviews/finding-review-bundle.ts
api/modules/reviews/finding-review-prompt.ts
api/modules/scans/report-builder.ts
api/modules/dynamic/dynamic-artifact-storage.ts
api/modules/reproductions/reproduction-artifact-storage.ts
api/modules/dast/dast-artifact-storage.ts
```

Required tests:

- GitHub tokens are redacted.
- Slack tokens are redacted.
- AWS access key IDs are redacted.
- assignment-style API keys / passwords are redacted.
- cookies and auth headers from DAST artifacts are redacted.
- redaction runs before LLM review input.
- screenshot bytes are not included in LLM input by default.
- Markdown report does not include raw secret values.

Verification:

```bash
bun test ./api/modules/scans/normalizers/*.test.ts
bun test ./api/modules/reviews/*.test.ts
bun test ./api/modules/scans/report-builder.test.ts
```

Expected:

- Redaction tests cover scan artifacts, review bundle, and report output.

Failure handling:

- Redaction failure is release-blocking.
- Prefer central redaction helper reuse over one-off regex copies.

Completion criteria:

- Secret boundary is covered by unit tests and documented.

### P5: Runner Environment Audit

Implement or extend environment filtering tests for:

```text
api/modules/scans/tools/tool-process-runner.ts
api/modules/reproductions/reproduction-runner.ts
api/modules/dynamic/dynamic-runner.ts
api/modules/dast/*
```

Checks:

- LLM provider env vars are not passed to tool containers.
- Docker socket is not mounted.
- privileged mode is not used.
- host repo write is not allowed unless using explicit ephemeral workdir copy.
- Docker runner does not silently fall back to host runner.
- network default is phase-appropriate.

Verification:

```bash
bun test ./api/modules/scans/tools/tool-process-runner.test.ts
bun test ./api/modules/reproductions/reproduction-runner.test.ts
bun test ./api/modules/dynamic/dynamic-runner.test.ts
bun test ./api/modules/dast/*.test.ts
```

Expected:

- Environment and Docker argv are testable without Docker daemon.
- Unsafe env / mount / network configuration is rejected or absent.

Failure handling:

- If live Docker is required for these tests, replace with process adapter / argv builder tests.
- If LLM keys can enter a runner environment, fix before continuing.

Completion criteria:

- Runner boundaries are mechanically tested.

### P6: Failure Mode Normalization

Implement a shared failure kind mapping if current modules duplicate or blur failures.

Candidate location:

```text
shared/schemas/failure.schema.ts
api/modules/common/failure.ts
```

Use only if it reduces duplication. If existing local types are clearer, document a catalog and map UI labels without broad refactor.

Required pass:

- CLI JSON failure shapes are consistent enough for UI.
- API errors preserve failure kind where expected.
- UI surfaces failure kind and user-facing message separately.
- Logs may contain diagnostics, but normal clients do not parse stderr.

Verification:

```bash
bun test ./api/modules/scans/*.test.ts
bun test ./api/modules/reviews/*.test.ts
bun test ./api/modules/decisions/*.test.ts
bun test ./api/modules/reproductions/*.test.ts
bun test ./api/modules/dynamic/*.test.ts
bun test ./api/modules/dast/*.test.ts
bun test ./api/routes/*.test.ts
```

Expected:

- Known failure cases have stable failure kinds.
- Distinct causes are not collapsed into generic errors.

Failure handling:

- Do not perform a large cross-cutting exception refactor unless tests require it.
- Prefer adapter functions at module boundaries.

Completion criteria:

- Failure kind catalog is reflected in tests, UI messages, and troubleshooting docs.

### P7: End-to-End Fixture Workflow

Create a local fixture workflow that exercises the full product without external services.

Recommended fixture:

```text
tests/fixtures/vuln-project/
```

The fixture should include deterministic cases for:

- Semgrep static finding.
- Gitleaks redacted secret.
- OSV / dependency finding if lockfile fixture is stable.
- Trivy filesystem / config finding if fixture is stable.
- reproduction-applicable finding.
- dynamic profile that can run without network.
- DAST target only when local test server is explicitly started or mocked.

Recommended helper:

```text
scripts/phase12-fixture-workflow.ts
```

Flow:

```text
create temp DB
run migrations
create project for fixture repo
run scan:profile baseline
assert artifacts / findings / evidence
run review:finding with fixture output or mock provider
run decision:finding
run report:scan
optionally run repro:finding dry-run
optionally run dynamic:run dry-run
optionally run scan:dast dry-run
run traceability audit
```

Verification:

```bash
bun run scripts/phase12-fixture-workflow.ts
```

Expected:

- Exits 0 without network, Docker, browser, or LLM provider.
- Produces a machine-readable summary with scanRunId, findingIds, reviewIds, decisionIds, reportId, and artifactIds.

Failure handling:

- If a real tool binary is absent, either use existing fixture import path or mark the check as skipped with explicit reason.
- Do not require external network for normal fixture workflow.

Completion criteria:

- Full local workflow can be demonstrated from a fresh DB.

### P8: API and UI Integration Pass

Review and update:

```text
web/src/api.ts
web/src/domains/scans/scans-domain.tsx
web/src/styles.css
api/routes/projects.route.ts
api/routes/scans.route.ts
api/routes/findings.route.ts
api/routes/finding-reviews.route.ts
api/routes/finding-decisions.route.ts
api/routes/scan-reports.route.ts
api/routes/reproductions.route.ts
api/routes/dynamic.route.ts
api/routes/dast.route.ts
```

Required behavior:

- Project -> scan -> finding -> review -> decision -> reproduction -> dynamic -> DAST -> report can be understood from UI.
- Artifact links are visible where evidence references artifacts.
- DAST / dynamic / reproduction panels do not obscure primary evidence.
- Stale RAG / template copy is removed from user-facing README and scan workflow UI.
- Buttons that launch bounded tasks show profile / runner / target context.
- Errors map to failure kinds where available.

Verification:

```bash
bun run typecheck
bun run build:web
```

Optional visual smoke:

```bash
bun run dev
```

Expected:

- Typecheck and build pass.
- UI does not require live LLM provider to view scan/finding/report surfaces.

Failure handling:

- If frontend types diverge from API, update shared schemas or API client before visual tweaks.
- Avoid broad UI redesign; Phase 12 is integration hardening.

Completion criteria:

- MVP workflow is navigable and uses current vulnWorkbench terminology.

### P9: Report Hardening

Review and update:

```text
api/modules/scans/report-builder.ts
api/modules/scans/report-builder.test.ts
api/modules/scans/report-repository.ts
api/cli/report-scan.ts
api/routes/scan-reports.route.ts
```

Required behavior:

- Report includes scan summary and tool summary.
- Report includes primary evidence references.
- Report includes LLM review only as review.
- Report includes latest or selected human decision.
- Report includes reproduction / dynamic / DAST summaries when available.
- Report includes artifact references and verification metadata.
- Report redacts secrets.

Verification:

```bash
bun test ./api/modules/scans/report-builder.test.ts
bun run report:scan -- --scan-run-id <scan-run-id> --format markdown
```

Expected:

- Report generation works for fixture scan.
- Report artifact is persisted.
- Report text does not contain raw secrets.

Failure handling:

- If reproduction / dynamic / DAST summaries are not available through current repositories, add minimal repository read methods instead of embedding ad hoc SQL in the builder.

Completion criteria:

- Report is a credible audit artifact for the full workflow.

### P10: Documentation Update

Update:

```text
README.md
.env.example
spec/vuln-workbench-concept.md
spec/phase-12-final-hardening-integration-plan.md
```

README must include:

- Product purpose.
- CLI-first diagnostic model.
- Supported scan tools.
- LLM role boundary.
- Docker toolbox usage.
- Reproduction / dynamic / DAST boundaries.
- Local setup.
- Core commands.
- Verification commands.
- Troubleshooting.
- Security boundary notes.

Docs must not claim:

- LLM freely scans source for vulnerabilities.
- Public internet DAST is supported.
- CI is required.
- Patch automation exists.
- Long-running fuzz campaigns are in scope.

Verification:

```bash
rg -n 'RAG|hono-standard|template|placeholder|public internet DAST|patch automation|free source exploration' README.md spec web/src
git diff --check README.md .env.example spec
```

Expected:

- Stale product copy is gone or clearly marked legacy/internal.
- README matches implemented commands.

Failure handling:

- If docs mention an unimplemented command, either implement it in the relevant phase or remove the claim.

Completion criteria:

- A new contributor can run local verification from README without guessing.

### P11: Final Verification

Run normal verification:

```bash
git diff --check
bun run test
bun run typecheck
bun run build:web
bun run verify
```

Run fresh DB verification:

```bash
rm -f /tmp/vuln-workbench-phase12-fresh.sqlite
DATABASE_URL=file:/tmp/vuln-workbench-phase12-fresh.sqlite bun run db:migrate
```

Run phase audits:

```bash
bun run scripts/audit-phase12-inventory.ts
bun run scripts/phase12-fixture-workflow.ts
bun run scripts/audit-phase12-traceability.ts -- --database-url file:/tmp/vuln-workbench-phase12-fresh.sqlite
```

Optional smoke checks:

```bash
bun run docker:toolbox:build
bun run docker:dynamic:build
bun run docker:dast:build
```

Expected:

- Normal verification passes without Docker daemon, browser image, live target, network, or LLM provider.
- Fresh DB migration passes.
- Fixture workflow passes or explicitly skips optional external-tool checks.
- Optional Docker/image checks are not required for normal completion.

Failure handling:

- Migration failure takes priority over UI/docs.
- Traceability failure takes priority over display polish.
- Redaction failure blocks completion.
- Verify failure must be classified and fixed before commit.

Completion criteria:

- All normal verification commands pass.
- Optional smoke failures are documented as environmental only when normal contract is unaffected.

## Verification Matrix

Normal required:

```bash
git diff --check
bun run test
bun run typecheck
bun run build:web
bun run verify
```

Fresh database:

```bash
rm -f /tmp/vuln-workbench-phase12-fresh.sqlite
DATABASE_URL=file:/tmp/vuln-workbench-phase12-fresh.sqlite bun run db:migrate
```

Traceability:

```bash
bun run scripts/audit-phase12-inventory.ts
bun run scripts/phase12-fixture-workflow.ts
bun run scripts/audit-phase12-traceability.ts -- --database-url file:/tmp/vuln-workbench-phase12-fresh.sqlite
```

CLI smoke:

```bash
bun run scan:profile -- --project-id <project-id> --profile baseline
bun run review:finding -- --finding-id <finding-id> --fixture-output tests/fixtures/reviews/finding-review.json
bun run decision:finding -- --finding-id <finding-id> --decision needs_fix --reason confirmed_by_evidence --comment "Confirmed from evidence."
bun run report:scan -- --scan-run-id <scan-run-id> --format markdown
bun run repro:finding -- --finding-id <finding-id> --profile <profile-id> --runner docker --dry-run true
bun run dynamic:run -- --project-id <project-id> --profile-id <profile-id> --dry-run true
bun run scan:dast -- --project-id <project-id> --target-config-id <target-config-id> --profile http-baseline --dry-run true
```

Expected:

- Static scan creates artifacts, findings, and evidence.
- Review can run with fixture output or configured provider.
- Decision attaches to finding.
- Report persists Markdown artifact.
- Reproduction / dynamic / DAST dry-runs validate boundaries without heavy execution.

## Stop Conditions

Stop Phase 12 implementation and revise the plan if any of these becomes necessary:

- A new scanner must be added.
- Public internet DAST support is required.
- Authenticated browser recording is required.
- Unbounded fuzzing is required.
- Patch automation is required.
- CI must become mandatory.
- LLM free source exploration is required.
- Evidence traceability is skipped to finish UI polish.
- `findings.scan_run_id` needs to become nullable.
- Normal `bun run verify` would require Docker daemon, browser download, live target, network, or LLM provider.

## Phase 12 Done

Phase 12 is done only when:

- Baseline failures are resolved or explicitly outside Phase 12.
- Traceability audit passes.
- Security boundary tests pass.
- Artifact access hardening tests pass.
- Redaction tests pass.
- UI and API types align.
- Report export represents the full workflow.
- README and docs match current implementation.
- Fresh DB migration passes.
- `git diff --check` passes.
- `bun run verify` passes.

At that point, vulnWorkbench should support a local, evidence-backed vulnerability diagnostic workflow covering static analysis, secret detection, dependency vulnerability detection, filesystem / IaC scan, Docker-isolated tool execution, bounded reproduction, test / sanitizer / light fuzz verification, scoped DAST / browser checks, LLM review, human decision, and Markdown reporting.

## Post-Phase Candidates

These are deliberately outside Phase 12:

- CI integration
- patch workflow
- team approval workflow
- additional scanners
- long-running fuzz campaigns
- advanced DAST profiles
- authenticated DAST
- cloud artifact storage
- multi-tenant SaaS hardening
