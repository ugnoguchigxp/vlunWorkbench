# Phase 24: Maintainability and Operational Readiness Plan

## Purpose

この計画は、Phase 20〜23 の機能を継続的に保守・運用しやすくするため、controller 肥大化、型ガード重複、artifact 差分、API test 実行手順、DB migration 確認を整理するためのもの。

到達点は、開発者が次の問いへ迷わず答えられる状態である。

- decision-grade view model はどこで作られているか。
- `improvementRequest` の型安全な取り出しはどこで行うか。
- generated artifacts は Git に入れるべきか。
- API tests は `bunx vitest` ではなくどのコマンドで走らせるか。
- `finding_decisions.metadata` migration は適用済みか確認できるか。

## Source Baseline

現在の状態:

- `use-scans-controller.ts` は scan/finding/report/diagnostic/decision-grade state を多く抱えている。
- `improvementRequest` の型ガードは UI 側に散らばり始めている。
- `/artifacts` は `.gitignore` に追加されたが、過去に追加された artifact 追跡解除が staged で残っている。
- API tests は `bun:sqlite` を使うため、`bunx vitest` では失敗し、`bun test` 経由が必要。
- `drizzle/0012_finding_decision_metadata.sql` が追加されている。

実装前に採取する baseline:

```bash
git status --short
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from pragma_table_info('finding_decisions') where name='metadata';"
git diff --cached --name-only -- artifacts | wc -l
```

## Scope

Phase 24 で実装するもの。

- Decision-grade view model aggregation
- scan review improvement request type guard common helper
- artifact tracking cleanup policy
- API test command documentation
- migration application verification helper/documentation

Phase 24 で実装しないもの。

- UI/UX の新機能
- report content の変更
- LLM prompt の変更
- DB schema redesign
- test runner replacement
- large controller rewrite unrelated to decision-grade data
- Git history rewrite

## Target Files

Primary files:

- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/scan-improvement-request.ts`
- `web/src/domains/scans/scan-improvement-request.test.ts`
- `web/src/domains/scans/decision-grade-view.ts`
- `web/src/domains/scans/decision-grade-view.test.ts`
- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/components/review-section.tsx`
- `.gitignore`
- `README.md`
- `spec/phase-24-maintainability-and-operational-readiness-plan.md`
- `scripts/verify.ts`

Optional files:

- `scripts/check-migrations.ts`
- `scripts/check-artifact-tracking.ts`

## Implementation Tasks

### Slice 1: Common Improvement Request Helper

1. Add or reuse `scan-improvement-request.ts`.
2. Export:

```ts
function getScanImprovementRequest(review: ScanReview | null | undefined): ScanImprovementRequest | null;
function hasScanImprovementRequest(review: ScanReview | null | undefined): boolean;
```

3. Replace ad hoc parsing in components/controller.
4. Add tests for malformed output.

Acceptance:

- `improvementRequest` parsing exists in one place.

### Slice 2: Decision-Grade View Aggregation

1. Add `decision-grade-view.ts`.
2. Move only pure aggregation out of `use-scans-controller.ts`:
   - selected coverage summary
   - executive risk summary
   - workflow completion
   - scan comparison
   - report quality preview
3. Do not move event handlers in this phase.
4. Keep React state ownership in controller.

Acceptance:

- Controller has less derived-model assembly.
- Behavior remains identical.

### Slice 3: Artifact Tracking Policy

1. Confirm `.gitignore` includes `/artifacts`.
2. Decide whether staged artifact removals are part of the current commit.
3. Document:
   - generated artifacts should not be tracked
   - reports needed as fixtures must live under explicit fixture paths
   - runtime scan outputs remain local artifacts
4. Add a lightweight check script only if needed:

```bash
git ls-files artifacts
```

Acceptance:

- Generated artifact policy is explicit before commit.

### Slice 4: API Test Command Documentation

1. Document that API tests using `bun:sqlite` must run through `bun test`.
2. Add examples:

```bash
bun test api/modules/scans/scan-review-runner.test.ts
bun test api/modules/scans/report-builder.test.ts
bun run verify
```

3. If `scripts/verify.ts` already handles this, reference it.
4. Do not attempt to make `bunx vitest` run `bun:sqlite` tests in this phase.

Acceptance:

- Future reviewers do not misdiagnose `bun:sqlite` failures as implementation failures.

### Slice 5: Migration Verification

1. Document the check:

```bash
sqlite3 data/vuln-workbench.sqlite "select count(*) from pragma_table_info('finding_decisions') where name='metadata';"
```

2. Optionally add `scripts/check-migrations.ts` if the repo already has similar scripts.
3. Ensure `db:migrate` remains the official migration path.
4. Do not mutate production/local DB automatically from verify unless already established.

Acceptance:

- Developer can confirm `finding_decisions.metadata` exists before testing remediation metadata.

### Slice 6: Final Maintenance Verification

1. Run focused tests for moved helpers.
2. Run full verify.
3. Inspect diff for accidental UI behavior changes.

Acceptance:

- Refactor reduces duplication without product behavior changes.

## Verification

Run:

```bash
bunx vitest run web/src/domains/scans/scan-improvement-request.test.ts
bunx vitest run web/src/domains/scans/decision-grade-view.test.ts
bun run typecheck
bun run verify
sqlite3 data/vuln-workbench.sqlite "select count(*) from pragma_table_info('finding_decisions') where name='metadata';"
git ls-files artifacts | wc -l
```

Expected:

- tests pass
- verify passes
- metadata column check returns `1`
- tracked artifact count is either intentionally reduced or explicitly documented

## Stop Conditions

Stop and update this plan if:

- moving derived models changes UI behavior.
- helper extraction requires broad component rewrites.
- artifact cleanup conflicts with user-owned tracked fixtures.
- migration check would mutate local DB.
- test command documentation conflicts with `scripts/verify.ts`.

