# Phase 28: contextStill Scan Knowledge Candidate Registration Plan

## Purpose

この計画は、vulnWorkbench の scan 履歴から contextStill 向けの知識候補を自動生成し、ローカルで重複を抑制したうえで、新規候補だけを MCP `register_candidates` に送るための実装計画である。

中心に置く成果物は raw finding ではなく、プロジェクト依存をできるだけ除いた `ScanKnowledgeCandidate` とする。

完了時の到達条件:

- scan run / findings / evidence / scan review / improvement request から、再利用可能な security knowledge candidate を生成できる。
- 候補本文はプロジェクト固有 path や repo 名を主語にせず、applicability と evidence refs に限定して provenance を保持する。
- vulnWorkbench 側で deterministic / semantic fingerprint を保持し、重複候補は再登録せず `seen_count` と latest evidence を更新する。
- 新規候補だけを contextStill MCP `register_candidates` 互換 payload に整形して自動送信できる。
- Active 化、採否、蒸留、検索利用は contextStill 側の責務として残す。
- 登録成功、重複抑制、送信失敗、再試行状態を vulnWorkbench 側で監査できる。

## Product Boundary

役割分担:

```text
vulnWorkbench
  scan evidence ledger
  improvement request
  candidate normalization
  local dedupe / frequency tracking
  MCP register_candidates submission

contextStill
  candidate lifecycle
  active / rejected / deprecated judgment
  knowledge distillation
  compile / decision retrieval
```

この phase では MCP を使うが、Phase 27 の「scanner execution は CLI primary」という境界は変えない。

MCP を使う理由:

- 対象は scanner 実行ではなく、contextStill への candidate ingestion である。
- `register_candidates` は contextStill 側の既存候補登録 API であり、Active 化ではない。
- downstream mutation 成功を確認できるので、登録 outbox の状態管理と相性がよい。

MCP が持たない責務:

- vulnWorkbench scan の実行。
- contextStill active knowledge の直接作成。
- contextStill の DB 直書き。
- scan 履歴全体のミラーリング。

## Current Baseline

既存の関連 contract:

- `findings`
  - scanner 正規化結果を保持する。
  - `sourceTool`, `ruleId`, `severity`, `fingerprint`, `metadata`, `primaryLocation` を持つ。
- `finding_evidence`
  - finding の evidence refs と snippet / artifact / location を保持する。
- `scan_reviews`
  - `output.improvementRequest` を JSON として保持する。
- `scanImprovementRequestSchema`
  - `title`, `objective`, `priorityPlan`, `implementationTasks`, `acceptanceCriteria`, `verificationCommands`, `constraints`, `nonGoals`, `handoffPrompt` を定義済み。
- Phase 27
  - `agent-output` profile、handoff CLI、agent-actionability、rerun loop を NightWorkers 向け Security Feedback Loop として計画済み。

現状の不足:

- scan 履歴から contextStill 用 knowledge candidate を生成する domain model がない。
- 汎用化済み candidate と raw evidence の境界がない。
- 重複 candidate の local ledger がない。
- `register_candidates` へ送った履歴、成功結果、失敗再試行を追跡できない。
- frequency signal を contextStill に渡す前段の `seen_count` がない。

## Non-Goals

- raw scan logs を contextStill に保存しない。
- すべての finding を知識候補にしない。
- contextStill の active / rejected 判定を vulnWorkbench 側で実装しない。
- contextStill に新しい独立ストアや別エンジンを追加しない。
- vulnWorkbench から contextStill DB を直接読む、または書く実装はしない。
- LLM が repository を自由探索して知識候補を作る path は作らない。
- 初期実装で UI 承認フローは作らない。自動登録を前提にする。
- Phase 27 の `handoff:scan`, `rerun:scan`, `oracle:security` をこの phase の必須前提にしない。ただし実装済みなら入力信号として利用してよい。

## Target Workflow

通常 flow:

```text
scan completed
  -> findings / evidence / scan_reviews.output.improvementRequest
  -> generate scan knowledge candidates
  -> normalize project-specific details into applicability / evidence refs
  -> compute deterministic and semantic fingerprints
  -> upsert local candidate ledger
  -> send only new candidates to contextStill register_candidates
  -> store registration result
```

重複 flow:

```text
candidate generated
  -> fingerprint already exists
  -> do not call register_candidates
  -> increment seen_count
  -> update last_seen_at / latest_scan_run_id / latest_finding_ids / latest_evidence_refs
```

失敗 flow:

```text
candidate generated
  -> outbox send failed
  -> status = failed
  -> keep payload hash and error message
  -> retry only with same payload or explicitly regenerated payload
```

## Candidate Types

初期許可リスト:

```text
fix_pattern
false_positive_rule
project_security_convention
verification_recipe
scanner_tuning
agent_actionability_lesson
```

contextStill `register_candidates` へ渡す mapping:

| vulnWorkbench type | contextStill type | polarity | Notes |
| --- | --- | --- | --- |
| `fix_pattern` | `rule` or `procedure` | `positive` | 手順が 3 step 以上なら procedure |
| `false_positive_rule` | `rule` | `negative` or `positive` | 「本物扱いしない」知識は negative、fixture convention は positive |
| `project_security_convention` | `rule` | `positive` | できるだけ project name を本文から除外 |
| `verification_recipe` | `procedure` | `positive` | `Use when / Workflow / Verification / Avoid` 必須 |
| `scanner_tuning` | `rule` or `procedure` | `positive` | ignore / allowlist は applicability を強く限定 |
| `agent_actionability_lesson` | `rule` | `positive` | agent が直しやすい条件、検証明瞭性の判断 |

Candidate にしないもの:

- scanner stdout / stderr 全文。
- timeout や network failure だけの一時事象。
- stack trace だけで再利用可能な security 判断がないもの。
- secret 実値や token 断片を含むもの。
- path 名に依存しすぎる一回限りの事象。
- evidence がない LLM 推測。
- Active 化すべきかどうかの判断。

## Generalization Rules

Raw finding:

```text
/Users/example/project/src/auth/session.ts で cookie secure=false
```

Candidate body:

```text
Web アプリでセッション cookie を発行する場合、本番相当の設定では Secure, HttpOnly, SameSite を明示し、環境分岐がある場合も安全側のデフォルトにする。
```

保持する provenance:

```json
{
  "source": "vulnWorkbench.scan",
  "examplePath": "src/auth/session.ts",
  "sourceTool": "semgrep",
  "ruleId": "...",
  "scanRunId": "...",
  "findingIds": ["..."],
  "evidenceRefs": ["finding_evidence:..."]
}
```

本文から除くもの:

- absolute path。
- user home。
- repository name。
- generated temp path。
- raw secret。
- one-off branch name。

本文に残してよいもの:

- technology category。
- vulnerability pattern。
- scanner rule family。
- safe default。
- verification command pattern。
- applicability constraints。

## Data Model

### `scan_knowledge_candidates`

Purpose:

- 汎用化済み candidate の local ledger。
- 重複抑制と frequency signal の source truth。
- contextStill に送った後も local provenance を追跡する。

Columns:

```text
id text primary key
candidate_type text not null
contextstill_type text not null
polarity text not null
title text not null
body text not null
prefer text
avoid text
applicability_json text not null default '{}'
evidence_refs_json text not null default '[]'
source_summary_json text not null default '{}'
normalized_title text not null
normalized_body text not null
deterministic_fingerprint text not null
semantic_fingerprint text not null
project_specificity text not null
registration_status text not null default 'new'
contextstill_candidate_ids_json text not null default '[]'
first_scan_run_id text
latest_scan_run_id text
first_seen_at integer not null
last_seen_at integer not null
seen_count integer not null default 1
last_error text
metadata_json text not null default '{}'
created_at integer not null
updated_at integer not null
```

Indexes:

```text
unique deterministic_fingerprint
index semantic_fingerprint
index registration_status
index candidate_type
index last_seen_at
```

`project_specificity` enum:

```text
low
medium
high
```

Rules:

- `low` and `medium` candidates can be registered automatically.
- `high` candidates stay local unless the normalizer can rewrite them into medium or low.
- `seen_count` updates do not call `register_candidates` again.

### `contextstill_registration_outbox`

Purpose:

- MCP `register_candidates` call lifecycle。
- downstream mutation の成功確認。
- retry / error handling。

Columns:

```text
id text primary key
candidate_id text not null references scan_knowledge_candidates(id)
payload_json text not null
payload_hash text not null
status text not null
attempt_count integer not null default 0
last_attempt_at integer
registered_at integer
contextstill_result_json text not null default '{}'
error_message text
created_at integer not null
updated_at integer not null
```

`status` enum:

```text
pending
sending
registered
duplicate_skipped
failed
blocked
```

Rules:

- `registered` は MCP response を確認した場合のみ設定する。
- `duplicate_skipped` は local dedupe で送信対象外になった候補には使わない。outbox row を作った後に payload duplication が分かった場合だけ使う。
- `failed` は retry 可能。
- `blocked` は payload validation または redaction failure のように同じ payload で再送しても成功しない場合に使う。

## Candidate Payload Contract

Internal candidate:

```ts
type ScanKnowledgeCandidate = {
  version: "v1";
  candidateType:
    | "fix_pattern"
    | "false_positive_rule"
    | "project_security_convention"
    | "verification_recipe"
    | "scanner_tuning"
    | "agent_actionability_lesson";
  contextStill: {
    type: "rule" | "procedure";
    polarity: "positive" | "negative" | "neutral";
    title: string;
    body: string;
    prefer?: string;
    avoid?: string;
    applicability: Record<string, unknown>;
  };
  provenance: {
    source: "vulnWorkbench.scan";
    scanRunIds: string[];
    findingIds: string[];
    evidenceRefs: string[];
    sourceTools: string[];
    ruleIds: string[];
    exampleLocations: string[];
  };
  dedupe: {
    deterministicFingerprint: string;
    semanticFingerprint: string;
    normalizedTitle: string;
    normalizedBody: string;
  };
  quality: {
    projectSpecificity: "low" | "medium" | "high";
    evidenceQuality: "high" | "medium" | "low";
    redactionStatus: "clean" | "redacted" | "blocked";
  };
};
```

`register_candidates` payload item:

```json
{
  "type": "rule",
  "polarity": "positive",
  "title": "セッション cookie は安全属性を明示する",
  "body": "Web アプリでセッション cookie を発行する場合、本番相当の設定では Secure, HttpOnly, SameSite を明示する。",
  "prefer": "cookie 発行箇所で Secure, HttpOnly, SameSite を明示し、環境分岐のデフォルトを安全側に置く。",
  "avoid": "本番相当の経路で secure=false や SameSite 未指定の session cookie を発行しない。",
  "applicability": {
    "domains": ["web-security", "authentication"],
    "technologies": ["cookie", "session"],
    "source": "vulnWorkbench.scan",
    "evidenceRefs": ["scan:...", "finding:..."]
  }
}
```

Procedure body rule:

```text
Use when:
...

Workflow:
1. ...

Verification:
- ...

Avoid:
- ...
```

## Fingerprinting

Deterministic fingerprint input:

```text
candidate_type
contextstill_type
polarity
normalized_source_tool_family
normalized_rule_family
normalized_vulnerability_pattern
normalized_technology_tags
normalized_fix_or_verification_intent
```

Do not include:

- absolute path。
- scan run id。
- finding id。
- repository name。
- timestamp。
- raw snippet。

Semantic fingerprint input:

```text
normalized_title
normalized_body
prefer
avoid
applicability domains
applicability technologies
```

Collision behavior:

- deterministic fingerprint match:
  - update existing candidate `seen_count` and latest provenance.
  - do not create outbox row.
- deterministic mismatch but semantic match:
  - attach as related evidence to existing candidate if candidate type and polarity match.
  - if type or polarity differs, create candidate with `metadata.possibleDuplicateOf`.
- no match:
  - create candidate and outbox row.

## Redaction And Safety

Candidate generation must run redaction before persistence and before MCP payload creation.

Block registration when:

- raw secret-like value remains in `title`, `body`, `prefer`, `avoid`, or `applicability`.
- absolute home path remains in candidate text.
- evidence refs point to missing local rows.
- procedure body lacks required headings.
- body is only a restatement of scanner output and has no reusable rule.

Allowed:

- scanner rule id。
- CVE / GHSA / advisory id。
- package name。
- relative path as `exampleLocation` in provenance。
- redacted snippet marker.

## Implementation Phases

### Phase 0: Baseline Audit

Files:

- `api/db/schema.ts`
- `drizzle/`
- `shared/schemas/scan.schema.ts`
- `api/modules/scans/scan-review-bundle.ts`
- `api/modules/scans/scan-review-repository.ts`
- `api/modules/scans/scan-review-runner.ts`
- `api/modules/scans/report-builder.ts`
- `api/cli/review-scan.ts`
- `package.json`

Tasks:

- Confirm `scan_reviews.output.improvementRequest` is available and typed.
- Confirm finding/evidence rows expose enough provenance for candidate generation.
- Confirm current scan/review CLIs keep stdout machine-readable where applicable.
- Check whether Phase 27 helpers already added `handoff:scan`, agent scores, or rerun comparison.
- Record current DB counts for scan runs, findings, evidences, scan reviews.

Baseline commands:

```bash
rg -n "scanImprovementRequestSchema|scanReviewOutputSchema|scan_reviews|finding_evidence|findings|review:scan" shared api package.json
bun test api/modules/scans/scan-review-runner.test.ts api/modules/scans/report-builder.test.ts
bun run typecheck
```

Completion criteria:

- Candidate generation inputs are identified.
- Existing failure state is recorded before schema changes.

Stop conditions:

- If `scan_reviews.output.improvementRequest` is missing or unstable, finish the improvement request contract before this phase.
- If stdout contracts are dirty, do not add automation CLI until the command boundary is fixed.

### Phase 1: Schema And Migration

Files:

- `api/db/schema.ts`
- `drizzle/0012_scan_knowledge_candidates.sql`
- generated drizzle metadata files
- `shared/schemas/scan.schema.ts` or new `shared/schemas/scan-knowledge.schema.ts`

Tasks:

- Add `scanKnowledgeCandidates` table.
- Add `contextStillRegistrationOutbox` table.
- Add zod schemas for candidate type, contextStill payload, outbox status, quality fields.
- Add DB indexes for deterministic fingerprint, semantic fingerprint, status, candidate type.

Verification:

```bash
bun run db:generate
bun run db:migrate
bun run typecheck
```

Completion criteria:

- Migration creates both tables.
- Unique deterministic fingerprint prevents duplicate rows.
- TypeScript schema and Drizzle schema agree.

Stop conditions:

- If existing migrations are dirty or generated metadata conflicts with user changes, stop and inspect before editing.

### Phase 2: Candidate Builder

Files:

- `api/modules/scans/knowledge-candidates/candidate-builder.ts`
- `api/modules/scans/knowledge-candidates/candidate-builder.test.ts`
- `api/modules/scans/knowledge-candidates/generalizer.ts`
- `api/modules/scans/knowledge-candidates/redaction.ts`
- `api/modules/scans/knowledge-candidates/fingerprint.ts`
- `api/modules/scans/knowledge-candidates/types.ts`

Tasks:

- Build candidates from:
  - findings and evidence.
  - latest completed `scan_reviews.output.improvementRequest`.
  - verification commands / acceptance criteria.
  - finding decisions if available, especially false positive decisions.
- Generate only allowed candidate types.
- Convert project-specific facts into applicability / provenance.
- Run redaction before returning candidates.
- Produce blocked candidates with reason when safe payload cannot be generated.

Initial heuristics:

- Finding with concrete fix text and verification command -> `fix_pattern` or `verification_recipe`.
- False positive decision or review hotspot with evidence -> `false_positive_rule`.
- Repeated scanner allowlist / fixture convention -> `scanner_tuning` or `project_security_convention`.
- Improvement request with clear task/evidence/verification -> `agent_actionability_lesson`.

Verification:

```bash
bun test api/modules/scans/knowledge-candidates/candidate-builder.test.ts
bun run typecheck
```

Completion criteria:

- Fixture scan with secret finding produces a redacted candidate or blocked result.
- Cookie/session finding produces a project-agnostic rule candidate.
- Procedure candidates contain `Use when / Workflow / Verification / Avoid`.
- No absolute path or raw secret appears in candidate text.

Stop conditions:

- If candidate quality depends on LLM free-form repository claims outside saved scan context, remove that input before proceeding.

### Phase 3: Local Ledger And Dedupe

Files:

- `api/modules/scans/knowledge-candidates/repository.ts`
- `api/modules/scans/knowledge-candidates/repository.test.ts`
- `api/modules/scans/knowledge-candidates/dedupe.ts`
- `api/modules/scans/knowledge-candidates/dedupe.test.ts`

Tasks:

- Upsert generated candidates by deterministic fingerprint.
- On duplicate:
  - increment `seen_count`.
  - update `last_seen_at`.
  - merge latest scan/finding/evidence refs into provenance.
  - do not create outbox row.
- On semantic possible duplicate:
  - create candidate with `metadata.possibleDuplicateOf` or attach evidence if safe.
- Store blocked candidates only if useful for debugging, with no MCP outbox row.

Verification:

```bash
bun test api/modules/scans/knowledge-candidates/repository.test.ts api/modules/scans/knowledge-candidates/dedupe.test.ts
bun run typecheck
```

Completion criteria:

- Same scan replay does not create duplicate registered candidates.
- Same pattern from another project increments local frequency without re-registering if generalized fingerprint matches.
- New vulnerability pattern creates a new candidate and pending outbox row.

Stop conditions:

- If deterministic fingerprint includes project path or scan id, fix fingerprinting before MCP registration.

### Phase 4: CLI Candidate Generation

New command:

```bash
bun run scan:knowledge-candidates -- \
  --scan-run-id <scan-run-id> \
  --format json
```

Files:

- `api/cli/scan-knowledge-candidates.ts`
- `package.json`
- `api/modules/scans/knowledge-candidates/generate-runner.ts`
- `api/modules/scans/knowledge-candidates/generate-runner.test.ts`

Tasks:

- Load scan run context.
- Generate candidates.
- Upsert local ledger.
- Return JSON with:
  - generated count.
  - new count.
  - duplicate count.
  - blocked count.
  - pending registration count.
  - candidate ids.
- Keep stdout as one JSON object.
- Put progress and diagnostics on stderr.

Verification:

```bash
bun test api/modules/scans/knowledge-candidates/generate-runner.test.ts
bun run scan:knowledge-candidates -- --scan-run-id <scan-run-id> --format json
bun run typecheck
```

Completion criteria:

- CLI can be run repeatedly with stable dedupe behavior.
- blocked candidates are reported without sending to contextStill.
- stdout remains machine-readable JSON.

Stop conditions:

- If CLI cannot distinguish new / duplicate / blocked, do not add MCP registration yet.

### Phase 5: MCP Payload Formatter

Files:

- `api/modules/scans/knowledge-candidates/contextstill-payload.ts`
- `api/modules/scans/knowledge-candidates/contextstill-payload.test.ts`

Tasks:

- Convert local candidate rows into `register_candidates` item objects.
- Validate contextStill rule/procedure requirements.
- Ensure Japanese natural-language fields for `title`, `body`, `prefer`, `avoid`.
- Preserve identifiers, scanner names, CVE/GHSA ids, commands, and API names as original text.
- Add applicability fields:
  - `source: "vulnWorkbench.scan"`.
  - `domains`.
  - `technologies`.
  - `candidateType`.
  - `evidenceRefs`.
  - `sourceTools`.
  - `ruleIds`.
  - `frequency.seenCount`.

Verification:

```bash
bun test api/modules/scans/knowledge-candidates/contextstill-payload.test.ts
bun run typecheck
```

Completion criteria:

- Rule payload passes local schema validation.
- Procedure payload includes required headings in order.
- Payload contains evidence refs but no raw secret / absolute path.

Stop conditions:

- If payload must rely on contextStill DB lookup to be valid, revise payload to be self-contained.

### Phase 6: Automatic MCP Registration

New command:

```bash
bun run contextstill:register-scan-candidates -- \
  --scan-run-id <scan-run-id> \
  --format json
```

Files:

- `api/cli/contextstill-register-scan-candidates.ts`
- `package.json`
- `api/modules/scans/knowledge-candidates/contextstill-client.ts`
- `api/modules/scans/knowledge-candidates/registration-runner.ts`
- `api/modules/scans/knowledge-candidates/registration-runner.test.ts`

Tasks:

- Select pending outbox rows for a scan or candidate ids.
- Call contextStill MCP `register_candidates`.
- Mark `sending` before call.
- Mark `registered` only after successful MCP response.
- Store `contextstill_result_json`.
- Mark `failed` or `blocked` with error message on failure.
- Support `--dry-run true` to print payload without MCP mutation.
- Support `--limit <n>` for bounded registration batches.

Design note:

- The implementation should use the host-supported MCP call path available to the runtime.
- Do not shell out to edit contextStill memory files.
- Do not write directly to contextStill SQLite.

Verification:

```bash
bun test api/modules/scans/knowledge-candidates/registration-runner.test.ts
bun run contextstill:register-scan-candidates -- --scan-run-id <scan-run-id> --dry-run true --format json
bun run contextstill:register-scan-candidates -- --scan-run-id <scan-run-id> --format json
bun run typecheck
```

Completion criteria:

- Dry run returns exactly the payload that would be sent.
- Real run sends only pending new candidates.
- Re-running after success sends zero candidates unless new candidates exist.
- Failed MCP calls do not mark candidates registered.

Stop conditions:

- If MCP call success cannot be confirmed, keep outbox status failed/sending and do not claim registration completed.

### Phase 7: Pipeline Integration

Options:

1. Manual CLI sequence:

```bash
bun run scan:profile -- --profile agent-output --json
bun run review:scan -- --scan-run-id <scan-run-id> --json
bun run scan:knowledge-candidates -- --scan-run-id <scan-run-id> --format json
bun run contextstill:register-scan-candidates -- --scan-run-id <scan-run-id> --format json
```

2. Security oracle integration after Phase 27:

```bash
bun run oracle:security -- \
  --project-path <repo> \
  --profile agent-output \
  --register-contextstill-candidates true \
  --json
```

Files:

- `api/cli/scan-profile.ts` only if automatic post-scan hook is needed.
- `api/cli/review-scan.ts` only if post-review hook is needed.
- Phase 27 `api/cli/oracle-security.ts` if present.
- README / README.jp.

Initial recommendation:

- Do not hook registration directly into raw scan completion.
- Hook after scan review or oracle flow, because improvement request gives better candidate quality.
- Keep standalone commands for debuggability.

Verification:

```bash
bun run scan:knowledge-candidates -- --scan-run-id <scan-run-id> --format json
bun run contextstill:register-scan-candidates -- --scan-run-id <scan-run-id> --dry-run true --format json
```

Completion criteria:

- Candidate generation can run independently.
- Registration can run independently.
- Oracle integration, if added, is a thin composition of those commands.

Stop conditions:

- If oracle integration hides candidate counts or registration failure, keep the standalone commands as the only supported path.

### Phase 8: Minimal UI / Report Surface

Files:

- `web/src/domains/scans/`
- optional route under `api/routes/scans.route.ts`
- `api/modules/scans/report-builder.ts`

Tasks:

- Show per-scan candidate counts:
  - new.
  - duplicate.
  - blocked.
  - pending.
  - registered.
  - failed.
- Show latest registration status in scan detail.
- Add deterministic report section summarizing candidate generation and registration status.
- Do not add an approval UI in this phase.

Verification:

```bash
bunx vitest run web/src/domains/scans
bun test api/modules/scans/report-builder.test.ts
bun run build:web
```

Completion criteria:

- User can tell whether candidates were generated and registered.
- UI does not imply candidates are active contextStill knowledge.

Stop conditions:

- If UI work expands beyond status visibility, defer it.

## End-To-End Acceptance

From a repo with completed scan review:

```bash
bun run scan:knowledge-candidates -- --scan-run-id <scan-run-id> --format json
```

Expected:

- stdout is one JSON object.
- `generated`, `new`, `duplicates`, `blocked`, and `pendingRegistration` counts are present.
- local DB contains `scan_knowledge_candidates`.
- duplicate rerun updates `seen_count` and creates no additional pending outbox rows.

Dry run registration:

```bash
bun run contextstill:register-scan-candidates -- \
  --scan-run-id <scan-run-id> \
  --dry-run true \
  --format json
```

Expected:

- payload is `register_candidates` compatible.
- procedure candidates have required headings.
- payload has no raw secret or absolute path.
- no outbox status changes to `registered`.

Real registration:

```bash
bun run contextstill:register-scan-candidates -- \
  --scan-run-id <scan-run-id> \
  --format json
```

Expected:

- only pending new candidates are sent.
- successful MCP response marks outbox `registered`.
- candidate rows store contextStill result ids if returned.
- second run sends zero candidates unless new candidates were generated.

## Final Verification Gate

```bash
git diff --check
bun run typecheck
bun run verify
```

If global `bun run verify` fails because of unrelated existing failures, record:

- command.
- failure summary.
- narrower passing gates.
- why the failure is unrelated.

## Rollout Order

Recommended order:

1. Baseline audit.
2. DB schema and migration.
3. candidate builder / redaction / fingerprint.
4. local ledger and dedupe.
5. `scan:knowledge-candidates` CLI.
6. contextStill payload formatter.
7. automatic MCP registration and outbox.
8. optional oracle integration.
9. minimal UI/report status.

The first valuable milestone is step 5. At that point vulnWorkbench can already show which scan-derived lessons are reusable and which are duplicates, without mutating contextStill.

The second valuable milestone is step 7. At that point registration is fully automatic while Active 化 remains contextStill-owned.
