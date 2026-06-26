# Phase 13: Concept Closure and Evidence Context Integration Plan

## Purpose

この計画は、vulnWorkbench の Phase 13 として、`spec/vuln-workbench-concept.md` に残る未達要素を閉じるための任意フェーズである。

Phase 13 は、Phase 12 の final hardening が終わった後に実施する想定であり、今すぐ実装しない。目的は、新しい診断カテゴリを追加することではなく、コンセプト文書上の次の曖昧さを実装可能な形で整理・解消すること。

- finding 単位に偏っている LLM review を、必要最小限の scan 単位 review へ拡張する。
- legacy knowledge / search / agentic-search と、脆弱性診断用 evidence context の境界を明確にする。
- `static / reviewed / accepted / false_positive` というコンセプト上の confidence model を、既存の review / decision record と矛盾しない effective state として表示・出力する。

重要な責務境界:

- LLM は引き続き診断主体ではない。
- LLM に repo 全体を自由探索させない。
- Scan-level review は保存済み scan / tool run / finding / evidence / artifact metadata の要約レビューに限定する。
- Evidence context search は project / scan / finding 境界に閉じる。
- Legacy knowledge RAG を脆弱性診断の証拠ストアへ混ぜない。
- Patch automation、CI integration、new scanner、authenticated DAST、long-running fuzzing は扱わない。

## Source Baseline

Phase 13 は Phase 12 完了後の状態を前提にする。

前提実装:

- Phase 1-12 の通常 verify が通っている。
- `scan:profile` が保存済み artifact / finding / evidence を生成できる。
- `review:finding` が finding 単位の LLM review を保存できる。
- `decision:finding` が human decision を保存できる。
- `report:scan` が Markdown report を保存できる。
- reproduction / dynamic / DAST evidence が Phase 12 で traceability hardening されている。
- legacy knowledge / search / agentic-search は残っていてよいが、vulnWorkbench の主 workflow と混同しない状態になっている。

実装前に確認する baseline:

```bash
git status --short
git diff --check
bun run verify
rg -n 'review:finding|review:scan|scan review|scan-level|finding_reviews|scan_reviews|agentic-search|knowledge|search_evidence|RAG' package.json api shared web/src spec README.md
```

確認すること:

- Phase 12 が未完了なら Phase 13 を開始しない。
- `review:scan` が既に存在する場合は、その実装を前提に hardening へ切り替える。
- legacy knowledge/search が残っている場合、削除ではなく境界整理を第一候補にする。
- 通常 `bun run verify` は LLM provider、network、Docker、browser、live target を要求しない。

## Scope

Phase 13 で実装するもの。

- scan-level review data model
- `review:scan` CLI
- scan review input bundle builder
- scan review prompt and structured output schema
- scan review API
- scan summary UI integration
- project / scan / finding scoped evidence context service
- legacy knowledge/search boundary documentation
- effective finding state calculation
- report integration for scan review and effective state
- verification tests and docs

Phase 13 で実装しないもの。

- LLMによる自由探索型の脆弱性発見
- LLM toolとしての任意 file read
- scan実行中の自動 mandatory LLM review
- patch生成、patch適用、修正PR作成
- CI統合
- new major scanner
- public internet DAST
- authenticated browser automation
- long-running fuzz campaign
- legacy knowledge RAG の全面削除
- chat/search product の再設計

## Definition of Done

Phase 13 は次を満たしたら完了とする。

- `review:scan` CLI で scan run ID を指定して scan-level review を作成できる。
- Scan-level review は保存済み scan / tool runs / findings / evidence / artifact references だけを入力にする。
- Scan-level review は finding を新規作成しない。
- Scan-level review failure は scan / finding / finding review / decision / report を壊さない。
- Project / scan / finding scoped evidence context API が legacy knowledge RAG と混ざらず動く。
- Evidence context は任意 path を受け取らず、保存済み evidence / artifact / location から deterministic に構築される。
- UI は finding review と scan review を区別して表示する。
- UI / API / report が effective finding state を表示できる。
- `static / reviewed / accepted / false_positive` の概念が、既存 DB の review / decision record と矛盾しない形で説明される。
- README / spec が Phase 13 後の境界を説明している。
- `bun run verify` と `git diff --check` が通る。

## Scan-Level Review Model

Phase 3 の `finding_reviews` は finding 単位の review として維持する。Phase 13 では dedicated `scan_reviews` を追加する。

Recommended table:

```text
scan_reviews
  id
  scan_run_id
  project_id
  provider
  model
  status
  summary
  risk_overview
  priority_notes
  coverage_notes
  false_positive_hotspots
  recommended_next_actions
  input_bundle
  output
  error_message
  created_by_user_id
  started_at
  completed_at
  created_at
  updated_at
```

Status:

```text
running
completed
failed
```

Rules:

- `scan_reviews.scan_run_id` is non-null.
- `scan_reviews.project_id` is non-null and must match the scan run project.
- `input_bundle` must contain stable references, not raw full artifacts.
- `output` must be schema-validated structured data.
- Scan review is advisory. It must not change finding status, decision, confidence, reproduction, dynamic, or DAST records.
- Scan review should be useful even if some findings do not have finding-level reviews.

## Scan Review Input Bundle

Add deterministic builder:

```text
api/modules/reviews/scan-review-bundle.ts
```

Input:

```text
scanRunId
maxFindings
maxEvidencePerFinding
maxSnippetBytes
includeDecisionSummary
includeDynamicSummary
includeDastSummary
```

Allowed bundle contents:

- scan run metadata
- scan profile
- tool run summaries
- artifact references
- finding IDs, source tools, rule IDs, severity, confidence, status
- primary locations
- bounded evidence snippets
- latest finding review summaries if already saved
- latest human decision per finding if already saved
- reproduction / dynamic / DAST outcome summaries by run ID
- report references if already saved

Not allowed:

- full raw artifact text
- arbitrary repo file tree
- LLM-selected path reads
- unredacted secrets
- screenshots as bytes
- browser network logs in full
- external web search by default

## Scan Review Output Schema

Add shared schema:

```text
shared/schemas/scan-review.schema.ts
```

Minimum output:

```text
summary
riskOverview
priorityNotes[]
coverageNotes[]
falsePositiveHotspots[]
recommendedNextActions[]
findingTriageHints[]
confidenceNotes[]
```

Rules:

- `findingTriageHints` may reference existing finding IDs only.
- Output must not introduce new finding IDs.
- Output must not mark a finding accepted or false positive.
- Output must not recommend running unbounded scan, exploit generation, or patch automation.
- Invalid LLM output creates `scan_reviews.status=failed`.

## CLI Contract

Add package script:

```json
{
  "review:scan": "bun run api/cli/review-scan.ts"
}
```

Command:

```bash
bun run review:scan -- \
  --scan-run-id <scan-run-id>
```

Options:

```text
--provider <provider>
--model <model>
--fixture-output <path>
--max-findings <number>
--max-evidence-per-finding <number>
--max-snippet-bytes <number>
--created-by-user-id <user-id>
```

Required behavior:

- stdout is JSON only.
- LLM provider absence fails only the scan review command, not scan/finding/report workflows.
- `--fixture-output` supports normal tests without a live provider.
- Review creation should persist a running row first, then update to completed or failed.
- If bundle building fails because the scan is missing, return typed failure without creating unrelated records.

Success JSON:

```json
{
  "ok": true,
  "scanReviewId": "uuid",
  "scanRunId": "uuid",
  "status": "completed"
}
```

Failure JSON:

```json
{
  "ok": false,
  "scanReviewId": "uuid-or-null",
  "scanRunId": "uuid",
  "status": "failed",
  "failureKind": "llm_provider_unconfigured",
  "message": "LLM provider is not configured"
}
```

## API Contract

Add route or extend review route:

```text
GET  /api/scans/:scanRunId/reviews
POST /api/scans/:scanRunId/reviews
GET  /api/scan-reviews/:scanReviewId
```

Required behavior:

- Every route checks project ownership through scan run.
- POST route invokes `review:scan` CLI through argv array.
- POST route does not call LLM directly.
- POST route returns persisted failed review as 200 if a `scanReviewId` exists.
- GET route includes scan review records and stable references, not full raw artifacts.

Do not add:

- request-time arbitrary prompt
- request-time arbitrary context paths
- request-time web search toggle
- automatic scan review during scan execution

## Evidence Context Integration

コンセプトの RAG position を実装境界として閉じる。ここでの目的は generic knowledge RAG の強化ではなく、scan/finding review に使う bounded context を明確にすること。

Add service:

```text
api/modules/evidence-context/evidence-context-builder.ts
```

Supported scopes:

```text
project
scan
finding
```

Input:

```text
scope
projectId
scanRunId?
findingId?
maxItems
maxSnippetBytes
includeRelatedFindings
```

Allowed sources:

- `finding_evidence`
- `scan_artifacts` metadata
- bounded source snippets already tied to finding locations
- `finding_reviews` summaries
- `finding_decisions`
- reproduction / dynamic / DAST summaries

Not allowed:

- arbitrary source path read from request
- whole repo indexing as a prerequisite
- legacy wiki page body as diagnostic evidence
- chat artifacts as primary evidence
- web search by default

Legacy knowledge/search boundary:

- Existing knowledge / search / agentic-search may remain as a separate workspace feature.
- It must not be described as vulnerability evidence search unless project/finding boundaries are added.
- If reused, it must require explicit kind/project/scan/finding metadata.
- Do not mix Markdown knowledge sources, chat artifacts, scan artifacts, and findings without a `kind` and boundary filter.

## Effective Finding State

Do not rewrite the persisted confidence model broadly. Instead, compute an effective state for UI/API/report.

Input records:

```text
finding.confidence
finding.status
latest completed finding review
latest human decision
reproduction outcomes
dynamic outcomes
DAST evidence
```

Effective state:

```text
static
reviewed
accepted
false_positive
deferred
needs_fix
runtime_supported
dast_supported
inconclusive
```

Rules:

- `static` means no completed review and no decision.
- `reviewed` means at least one completed finding review and no human decision.
- `accepted`, `false_positive`, `deferred`, `needs_fix` come from latest human decision.
- `runtime_supported` may be added as a secondary badge when reproduction / dynamic evidence supports the finding.
- `dast_supported` may be added as a secondary badge when scoped DAST evidence supports the finding.
- Do not mutate `finding.confidence` simply because a review or decision exists.
- Reports and UI should display persisted records and effective state together.

Candidate helper:

```text
api/modules/scans/effective-finding-state.ts
```

## Frontend Scope

Add scan-level review and concept-closure surfaces without broad UI redesign.

Scan detail:

- Scan Review panel.
- Trigger scan review.
- Show latest scan review.
- Show scan review history.
- Show input bundle references count.

Finding list/detail:

- Display effective finding state.
- Keep latest human decision visible.
- Keep finding-level LLM review separate from scan-level LLM review.
- Show evidence context references when available.

Knowledge/search UI:

- Keep legacy knowledge/search visually separate from vulnerability scans.
- Remove wording that implies generic RAG is the vulnerability evidence system.
- If evidence context search has UI, label it as scan/finding scoped evidence context.

## Report Integration

Update report builder to optionally include:

- latest scan review summary
- scan review priority notes
- scan review coverage notes
- effective finding state
- evidence context reference counts

Rules:

- Scan review is not primary evidence.
- Report must still include raw artifact references.
- Human decision remains the final decision.
- Scan review must not replace finding-level review.

## Implementation Steps

### P0: Baseline Audit

Run:

```bash
git status --short
git diff --check
bun run verify
rg -n 'review:scan|scan_reviews|scan review|agentic-search|knowledge|RAG|effective finding' package.json api shared web/src spec README.md
```

Completion criteria:

- Phase 12 is confirmed complete.
- Existing review/search/effective-state gaps are listed.
- No implementation starts from unknown verify failure.

### P1: Scan Review Schema and Repository

Implement:

- DB table / migration for `scan_reviews`.
- `shared/schemas/scan-review.schema.ts`.
- `api/modules/reviews/scan-review-repository.ts`.
- Repository tests.

Verification:

```bash
bun test ./api/modules/reviews/scan-review-repository.test.ts
bun run typecheck
```

### P2: Scan Review Bundle Builder

Implement:

- `api/modules/reviews/scan-review-bundle.ts`.
- Redaction.
- Bounded finding / evidence selection.
- Stable reference output.
- Tests for no arbitrary path read.

Verification:

```bash
bun test ./api/modules/reviews/scan-review-bundle.test.ts
```

### P3: Scan Review Runner and CLI

Implement:

- `api/modules/reviews/scan-review-runner.ts`.
- `api/cli/review-scan.ts`.
- package script `review:scan`.
- fixture-output test path.

Verification:

```bash
bun test ./api/modules/reviews/scan-review-runner.test.ts
bun run review:scan -- --scan-run-id <scan-run-id> --fixture-output tests/fixtures/reviews/scan-review.json
```

### P4: API Routes

Implement:

- `GET /api/scans/:scanRunId/reviews`.
- `POST /api/scans/:scanRunId/reviews`.
- `GET /api/scan-reviews/:scanReviewId`.
- Route tests with mocked CLI bridge.

Verification:

```bash
bun test ./api/routes/scan-reviews.route.test.ts
```

### P5: Evidence Context Builder

Implement:

- `api/modules/evidence-context/evidence-context-builder.ts`.
- Scope validation.
- Project / scan / finding context tests.
- Legacy knowledge boundary tests if reused.

Verification:

```bash
bun test ./api/modules/evidence-context/*.test.ts
```

### P6: Effective Finding State

Implement:

- `api/modules/scans/effective-finding-state.ts`.
- API response integration where findings are listed or detailed.
- UI type updates.
- Report integration tests.

Verification:

```bash
bun test ./api/modules/scans/effective-finding-state.test.ts
bun test ./api/routes/findings.route.test.ts ./api/routes/scans.route.test.ts
```

### P7: Frontend Integration

Implement:

- scan review API client functions.
- scan review panel.
- effective state badges.
- evidence context reference display.
- terminology cleanup around legacy knowledge/search.

Verification:

```bash
bun run typecheck
bun run build:web
```

### P8: Report and Documentation

Implement:

- Report builder scan review section.
- README update.
- Concept doc addendum or Phase 13 completion note.
- Troubleshooting for scan review provider failures.

Verification:

```bash
bun test ./api/modules/scans/report-builder.test.ts
rg -n 'free source exploration|LLM scans the repo|generic RAG vulnerability evidence' README.md spec web/src
git diff --check README.md spec
```

### P9: Final Verification

Run:

```bash
git diff --check
bun run test
bun run typecheck
bun run build:web
bun run verify
```

Completion criteria:

- Normal verification passes without live LLM provider.
- Scan review fixture path passes.
- Evidence context does not require whole-repo indexing.
- Legacy knowledge/search remains separate or clearly scoped.

## Verification Matrix

Required:

```bash
git diff --check
bun run test
bun run typecheck
bun run build:web
bun run verify
```

Scan review fixture:

```bash
bun run review:scan -- --scan-run-id <scan-run-id> --fixture-output tests/fixtures/reviews/scan-review.json
```

Evidence context:

```bash
bun test ./api/modules/evidence-context/*.test.ts
```

Effective state:

```bash
bun test ./api/modules/scans/effective-finding-state.test.ts
```

Expected:

- Scan-level review can be created from saved evidence.
- Finding-level review remains unchanged.
- Human decision remains final.
- Effective state is computed, not persisted as destructive migration.
- Legacy knowledge/search does not become vulnerability evidence by accident.

## Stop Conditions

Stop Phase 13 implementation and revise the plan if any of these becomes necessary:

- LLM needs arbitrary repo file access.
- LLM needs to create findings from scan-level review.
- Scan review needs external web search by default.
- Evidence context needs whole-repo indexing before it can work.
- Legacy knowledge RAG must be merged with scan evidence without kind/project boundaries.
- Effective state requires overwriting `finding.confidence` or decision history.
- Normal verify would require live LLM provider, network, Docker, browser, or live target.
- Patch automation, CI, new scanner, authenticated DAST, or long-running fuzzing becomes required.

## Handoff After Phase 13

After Phase 13, the concept should be considered closed for local MVP-plus scope:

- CLI remains evidence generation.
- Normalizers remain deterministic.
- LLM reviews saved evidence at finding and scan level.
- Humans make final decisions.
- Evidence context is bounded by project / scan / finding.
- Legacy knowledge/search is separate from vulnerability evidence.
- Reports can include scan review and effective state without treating LLM output as primary evidence.

Post-Phase candidates remain separate:

- CI integration
- patch workflow
- team approval workflow
- additional scanners
- authenticated DAST
- long-running fuzz campaigns
