# Phase 43: vulnWorkbench NightWorkers Support Readiness Plan

## Implementation Status

2026-07-15 に vulnWorkbench repository 内だけで実装を完了した。

- scanner execution policy を一元化し、development/test の host 互換と production の Docker default / host explicit opt-in を実装した。
- Web scan を queued admission + owned child supervisor + atomic claim + polling + cancel + shutdown/stale recovery へ移行した。
- Security Oracle は usable scan 後に `scan_review` を実行し、persisted handoff prompt を stable JSON に返す。review route 不在・失敗は `inconclusive` とする。
- Project/Scan UI に persisted external-agent readiness、実行中 status、latest event、cancel を表示し、主要 navigation と lazy loading を整理した。
- NightWorkers、contextStill、外部 queue/task/ontology への mutation は追加していない。Static Intelligence MCP は read-only のままである。

完了時 evidence:

- `bun run verify`: pass
- `bun run test`: 225 pass / 0 fail
- Static Intelligence MCP focused tests: 22 pass / 0 fail
- `bun run fixture:static-intelligence-source`: 17 checks passed
- production main entry: 約 1.645 MB / gzip 約 474 KB（baseline 約 1.84 MB / gzip 約 516 KB）

## Purpose

この計画は、vulnWorkbench を NightWorkers から利用しやすい Security Oracle / Static Intelligence producer に改善するための実装計画である。

対象は vulnWorkbench repository 内の変更だけに限定する。NightWorkers は引き続き ontology、task compilation、queue admission、implementation、verification orchestration を所有し、vulnWorkbench は scanner-backed evidence、implementation handoff、read-only agent context を生成する。

到達点は次の通り。

1. 外部 orchestrator が `--project-path` だけで Security Oracle を呼び、scan result と scan-level implementation handoff を同じ stable JSON response から取得できる。
2. Web UI から起動する長時間 scan が HTTP request を占有せず、queued / running / terminal state、失敗理由、キャンセル結果を追跡できる。
3. scanner の host / Docker execution policy が vulnWorkbench 側の設定として一元化され、実際に使われた runner と安全条件が結果に記録される。
4. Project Intelligence と Scan workspace で、外部 agent に渡せる handoff、generation、freshness、readiness、取得 command を確認できる。
5. 既存の NightWorkers CLI contract、read-only MCP boundary、scanner evidence provenance を壊さない。

## Executive Decision

Phase 43 は次の順序で実施する。

```text
baseline / contract freeze
  -> scanner execution policy
  -> asynchronous web scan lifecycle
  -> Security Oracle scan-review-handoff workflow
  -> external-agent handoff UI
  -> frontend loading cleanup
  -> full verification and evidence
```

非同期化と Oracle handoff を同じ実装へ混在させない。Web UI の scan launch は asynchronous lifecycle を使い、`oracle:security` は command completion 時に stable JSON を一件返す synchronous CLI contract を維持する。両方が共有するのは profile runner、scan state transition、execution policy、review / handoff extraction である。

## Current Baseline

2026-07-15 時点の確認結果。

- `bun run typecheck`: pass
- `bun run lint`: exit 0、46 warnings
- `bun run test`: 218 pass、0 fail
- `bun run build`: pass
- production build の main entry: 約 1.84 MB、gzip 約 516 KB
- `oracle:security`:
  - external input は `--project-path` のみ
  - `agent-output` profile を host runner で実行する
  - final report は生成する
  - scan review は実行せず `review.status = "not_requested"` を返す
- Web scan route:
  - child CLI の `proc.exited` を HTTP handler 内で待つ
  - scan 完了まで response を返さない
- Static Intelligence:
  - exact `scanRunId` / `generationId` read を持つ
  - source discovery、manifest、evidence、verification candidate、code structure、exploration catalog を read-only MCP で提供する
  - Catalog MCP producer component は GO evidence を持つ
  - NightWorkers consumer rollout と価値計測は未実施であり、本 phase の完了条件に含めない
- UI:
  - scan-level handoff、report readiness、Ontology Handoff、pull command を表示できる
  - primary navigation に legacy Knowledge / Chat / Search と developer Showcase が並ぶ

実装開始時に baseline を再取得する。

```bash
git status --short
bun run typecheck
bun run lint
bun run test
bun run build
bun test api/modules/scans/security-oracle-cli.test.ts
bun test api/modules/scans/profile-runner.test.ts api/routes/projects.route.test.ts
```

記録する値。

- test pass / fail count
- lint warning count
- main entry raw / gzip size
- Web scan POST の response timing と response shape
- Oracle の status / exit code / review shape
- scan failure 時に残る scan run / event / finding / report record

## Scope Boundary

### In Scope

- vulnWorkbench-owned scanner execution policy
- scanner runner provenance と安全条件の永続化
- existing `scan_runs` state machine を使う asynchronous Web scan launch
- queued scan の claim、terminal transition、cancel、shutdown、stale-run recovery
- Security Oracle 内部での scan review 実行
- existing `review.reviewId` / `review.improvementRequest` contract の充足
- provider 未設定 / review 失敗時の degraded result
- zero-finding scan の follow-up handoff
- Project Intelligence / Scan workspace の external-agent handoff readiness UI
- production navigation から developer Showcase を分離すること
- frontend route / domain lazy loading
- focused tests、fixture、README、運用 evidence

### Non-Goals

- NightWorkers repository のコード変更
- NightWorkers の feature settings、DB、MCP settings、task、run、queue、prompt の変更
- NightWorkers task の作成、送信、承認、実行、完了更新
- contextStill knowledge の登録または変更
- vulnWorkbench から NightWorkers / contextStill DB を読むこと
- 「Send to NightWorkers」のような外部 mutation button
- MCP から scanner、generation build、verification command、task creation を実行すること
- patch の生成または自動適用
- verification candidate の自動実行
- scanner finding や module candidate から canonical Ontology を生成すること
- NightWorkers rollout の GO / NO-GO 判定
- NightWorkers での tool-call / token reduction の計測
- multi-node queue、distributed worker、remote executor
- SQLite から別 DB への移行
- scanner や LLM provider を呼び出し元から自由指定させること

## Contract Invariants

Phase 43 の変更後も次を維持する。

### Security Oracle

- primary command は `bun run oracle:security -- --project-path <repo>` のままにする。
- external input に project ID、profile、review policy、provider、model、timeout、runner、DB URL、report path を追加しない。
- stdout は schema validation 済み JSON object 一件だけにする。
- progress、warning、stack trace は stderr または persisted event / artifact に出す。
- repository location は project-relative path だけを返す。
- scan が usable で review が失敗しても scan result を捨てない。
- exit code 3 は security action required であり process transport failure と扱わない。

### Static Intelligence / MCP

- MCP は read-only のままにする。
- exact generation pinning を維持する。
- raw source body、raw artifact body、evidence snippet、absolute project root、secret を agent-facing payload に追加しない。
- module / file / verification result は candidate-only を維持する。
- generation missing を暗黙の build や refresh で補わない。

### Scan Completion

- required downstream persistence が一件でも未確認なら scan を completed にしない。
- child process の exit code 0 だけで completed にしない。
- terminal state は profile runner が tool / artifact / finding / event / final report の必要処理を完了してから保存する。
- cancel / timeout / server shutdown を completed に変換しない。

## Target Architecture

### Web Scan

```text
POST /api/projects/:projectId/scans
  -> validate ownership and profile input
  -> create scan_run(status=queued)
  -> start supervised child CLI with exact scanRunId
  -> return HTTP 202 with scanRunId

child CLI
  -> atomically claim queued scan
  -> transition running
  -> execute profile into the existing scan
  -> persist tools / artifacts / findings / events / report
  -> transition completed / failed / cancelled

UI
  -> poll selected run while queued/running
  -> show events and current step
  -> stop polling at terminal state
```

### Security Oracle

```text
--project-path
  -> resolve/create project
  -> execute agent-output profile with vulnWorkbench-owned policy
  -> keep usable scan result even when partially degraded
  -> run scan_review through configured task route
  -> extract improvementRequest.handoffPrompt
  -> return one stable SecurityOracleResult JSON
```

### Agent Handoff UI

```text
selected project / scan
  -> scan outcome and coverage
  -> latest completed scan review
  -> handoff quality and copy action
  -> persisted generation readiness / freshness
  -> read-only CLI / MCP pull command
```

UI は外部 consumer の接続状態や採用状態を推測しない。表示するのは vulnWorkbench 自身が確認できる persisted state だけにする。

## Target Files

Primary candidates:

- `api/app/env.ts`
- `api/config/appDefaults.ts`
- `api/app/hono.ts`
- `api/app/server.ts`
- `api/cli/oracle-security.ts`
- `api/cli/scan-profile.ts`
- `api/modules/scans/profile-runner.ts`
- `api/modules/scans/project-resolver.ts`
- `api/modules/scans/repositories.ts`
- `api/modules/scans/security-oracle-runner.ts`
- `api/modules/scans/scan-execution-policy.ts`
- `api/modules/scans/scan-process-supervisor.ts`
- `api/modules/scans/scan-review-runner.ts`
- `api/routes/projects.route.ts`
- `api/routes/scans.route.ts`
- `shared/schemas/security-oracle.schema.ts`
- `shared/schemas/scan.schema.ts`
- `web/src/App.tsx`
- `web/src/router.tsx`
- `web/src/app-header.tsx`
- `web/src/api.ts`
- `web/src/domains/projects/projects-domain.tsx`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/components/scan-improvement-request-panel.tsx`
- `scripts/bootstrap-check.ts`
- `scripts/verify.ts`
- `README.md`
- `README.jp.md`

New filenames are candidates, not a requirement to create parallel abstractions when an existing module already owns the responsibility.

## Implementation Gates

1. **Gate A: Baseline and contract freeze**
   - Existing CLI, status, exit code, MCP, and scan-state contracts are captured by tests.
2. **Gate B: Execution policy and provenance**
   - Every scanner launch resolves one central policy and records the effective runner.
3. **Gate C: Asynchronous Web scan lifecycle**
   - HTTP request returns after queue admission and does not wait for scan completion.
4. **Gate D: Oracle review and handoff**
   - A usable scan attempts scan review and returns the existing handoff field when completed.
5. **Gate E: Agent handoff UI**
   - Users can inspect and copy truthful persisted handoff / generation data.
6. **Gate F: Loading and navigation cleanup**
   - Core scan pages do not eagerly load legacy and showcase domains.
7. **Gate G: Repository verification**
   - Focused tests, fixture checks, build comparison, and `bun run verify` pass.

## Implementation Tasks

### Slice 0: Baseline Fixtures and Contract Tests

1. Extend `security-oracle-cli.test.ts` before changing Oracle behavior.
2. Capture cases for:
   - missing `--project-path`
   - unknown external option rejection
   - project auto-create
   - existing project reuse
   - relative finding location
   - finding truncation and blocking fingerprint stability
   - exit codes 0 / 1 / 2 / 3 / 4
   - stdout JSON-only behavior
3. Add or extend route tests that prove the current Web route waits for the child. This test becomes the before/after comparison and is changed to expect 202 after Slice 2.
4. Add state-transition repository tests for queued / running / terminal states.
5. Keep test tools deterministic; do not require network scanners or live LLM providers.

Acceptance:

- Public contracts have executable tests before refactoring.
- Tests fail for accidental external Oracle options and absolute location leakage.
- Baseline output size and test results are recorded in implementation evidence.

### Slice 1: Central Scanner Execution Policy

1. Add a pure policy resolver, conceptually:

```ts
type ScanExecutionSurface = "web" | "cli" | "security_oracle";

type ResolvedScanExecutionPolicy = {
  runner: "host" | "docker";
  networkMode: "none" | "default";
  dockerImage: string | null;
  source: "default" | "environment" | "request";
  hostExecutionExplicitlyAllowed: boolean;
};
```

2. Add vulnWorkbench-owned environment settings. Recommended shape:

```text
SCAN_EXECUTION_MODE=host|docker
ALLOW_HOST_SCANNER_EXECUTION=true|false
SCAN_DOCKER_IMAGE=<image>
```

3. Defaults:
   - development / test: preserve host compatibility unless explicitly configured
   - production: Docker is required unless host execution is explicitly allowed
   - Security Oracle: caller cannot override the resolved policy
4. Do not automatically fall back from Docker to host when Docker is unavailable.
5. Static `agent-output` execution uses network `none` unless a profile step explicitly requires a bounded runtime target.
6. Persist effective policy in:
   - `scan_runs.metadata`
   - lifecycle event data
   - Security Oracle scan result metadata if the public schema already has a compatible location
7. Add preflight checks for configured Docker binary / image and actionable error codes.
8. Ensure API request fields cannot broaden a production-level policy.

Acceptance:

- Oracle input remains `--project-path` only.
- Effective runner is deterministic and visible in persisted provenance.
- Production does not silently use host execution.
- Docker failure never causes an implicit host retry.
- Existing development setup remains documented and testable.

Focused verification:

```bash
bun test api/app/env.test.ts
bun test api/modules/scans/tools/tool-process-runner.test.ts
bun test api/modules/scans/security-oracle-cli.test.ts
bun test api/routes/projects.route.test.ts
```

### Slice 2: Asynchronous Web Scan Lifecycle

#### Runner Refactor

1. Split current profile execution into two compatible operations:
   - create-and-run for existing CLI callers
   - execute-into-existing-scan for queued Web jobs
2. Preserve `runProfileScan` as a compatibility wrapper.
3. Add an internal CLI option such as `--scan-run-id` for a pre-created queued scan.
4. The internal option must:
   - verify scan/project/profile identity
   - atomically claim `queued -> running`
   - reject already running or terminal rows
   - never create a second scan run
5. Keep `oracle:security` on the create-and-run path.

#### Supervisor

1. Add one process supervisor owned by the Hono app runtime.
2. The supervisor tracks only Web-launched scan children in memory for cancellation and graceful shutdown.
3. Persist a random launch token and launch source in `scan_runs.metadata`; do not trust PID alone.
4. Web route flow:
   - create queued scan
   - start child with argv array
   - return HTTP 202 `{ scan: { id, status: "queued", profile } }`
5. Background monitor rules:
   - spawn failure before claim -> failed scan + event
   - unexpected child exit while scan is non-terminal -> failed scan + event
   - child exit 0 while DB state is non-terminal -> failed contract violation, not completed
   - terminal DB state is authoritative
6. Add `POST /api/scans/:scanRunId/cancel`.
7. Cancel only when:
   - requester owns the project
   - scan is queued/running
   - in-memory child launch token matches persisted metadata
8. If no matching process is owned by the current runtime, do not signal a PID. Record a safe cancellation failure or stale-run recovery reason.
9. Graceful shutdown:
   - send TERM to owned children
   - wait a bounded interval
   - send KILL only to still-owned children
   - persist cancelled / failed state with shutdown reason
10. Startup recovery marks stale Web-owned queued/running rows failed only when their recorded runtime instance is no longer active. It must not rewrite independently launched CLI scans.

#### UI Polling

1. After HTTP 202, immediately select the queued scan.
2. Poll scan detail and events while status is queued/running.
3. Use one bounded polling interval and stop at terminal state or unmount.
4. Show current status, latest event, start time, elapsed time, and cancel action.
5. Refresh findings, summary, reviews, reports, diagnostics, and Static Intelligence readiness once the run becomes terminal.
6. Do not create a second scan when a response or poll is retried.

Acceptance:

- POST response does not await child completion.
- Exactly one scan row exists per accepted request.
- A scan cannot move from terminal back to running.
- No scan is completed from process exit alone.
- Cancel never kills an unrelated or unowned process.
- UI converges to the persisted terminal state without manual refresh.

Focused verification:

```bash
bun test api/modules/scans/profile-runner.test.ts
bun test api/modules/scans/repositories.test.ts
bun test api/routes/projects.route.test.ts api/routes/scans.route.test.ts
bunx vitest run web/src/domains/scans
```

### Slice 3: Security Oracle Scan Review and Handoff

#### Service Extraction

1. Move workflow logic from `api/cli/oracle-security.ts` into a testable `SecurityOracleRunner` service.
2. Keep the CLI responsible only for:
   - strict argument parsing
   - opening/closing runtime dependencies
   - writing one validated JSON object
   - mapping result status to process exit code
3. `SecurityOracleRunner` owns:
   - project path resolution
   - agent-output profile execution
   - finding summary
   - scan review attempt
   - handoff extraction
   - final status / nextAction calculation

#### Review Policy

1. After every usable terminal scan, attempt task-routed `scan_review` using vulnWorkbench settings.
2. The external caller cannot select provider, model, task, filter, or prompt.
3. Use the full persisted scan bundle; do not let the LLM freely browse the repository.
4. On completed review:
   - set `review.status = "completed"`
   - return `review.reviewId`
   - copy `output.improvementRequest.handoffPrompt` into the existing `review.improvementRequest` string
5. Do not add a new required Oracle response field in this phase.
6. Do not serialize the full review bundle, source snippets, or raw artifacts into stdout.
7. Zero-finding scans must still produce a truthful follow-up handoff covering scanner scope and remaining coverage gaps.

#### Degraded Results

1. Missing route / provider:
   - keep scan result
   - set review to `skipped` with a bounded error
   - use `nextAction = "configure_provider"` when handoff readiness matters
2. Provider execution or schema validation failure:
   - keep persisted failed review row
   - keep scan result
   - set review to `failed`
3. Do not invent a deterministic object and label it as an LLM review.
4. High / critical findings remain `security_action_required` even if review fails.
5. Hard scan failure without usable result remains `runtime_error`.

Result matrix:

| Scan | Review | Oracle status | Exit | nextAction |
| --- | --- | --- | ---: | --- |
| completed, no blocking finding | completed | completed | 0 | none |
| high / critical finding | completed | security_action_required | 3 | apply_security_fix |
| high / critical finding | skipped / failed | security_action_required | 3 | apply_security_fix |
| usable scan with coverage warning | completed | inconclusive | 4 | inspect_diagnostic_failure |
| completed scan | route/provider missing | inconclusive | 4 | configure_provider |
| completed scan | review execution failed | inconclusive | 4 | run_scan_review |
| no usable scan result | skipped | runtime_error | 1 | inspect_diagnostic_failure |

Acceptance:

- One Oracle command can return a completed scan review handoff.
- Existing `SecurityOracleResult` consumers can parse the result without a required-field migration.
- Review failure never deletes or hides findings.
- Finding severity controls security action status independently of LLM success.
- Zero-finding does not become a safety claim.
- stdout remains one JSON object.

Focused verification:

```bash
bun test api/modules/scans/security-oracle-cli.test.ts
bun test api/modules/scans/scan-review-runner.test.ts
bun test api/modules/scans/scan-review-bundle.test.ts
bun test api/modules/scans/scan-review-prompt.test.ts
```

If `scan-review-prompt.test.ts` does not exist, add focused cases to the existing scan review test files instead of creating a test file only to match this plan.

### Slice 4: External-Agent Handoff Readiness UI

1. Add one shared pure view model for external-agent readiness.
2. Inputs:
   - selected scan status
   - latest completed scan review
   - improvement request quality
   - report readiness
   - persisted generation readiness
   - source revision / generated time
   - degraded reasons
3. Output states:

```ts
type ExternalAgentHandoffReadiness =
  | "ready"
  | "scan_required"
  | "review_required"
  | "generation_required"
  | "stale"
  | "degraded";
```

4. Project Intelligence panel shows:
   - selected scan ID / profile / completion time
   - generation ID / source revision / freshness
   - module and evidence readiness
   - copyable read-only manifest / catalog command templates
   - explicit consumer boundary
5. Scan overview shows:
   - handoff objective and scope
   - top implementation tasks
   - acceptance criteria
   - verification candidates
   - non-goals
   - copy handoff action
   - missing-quality checklist
6. Copy actions operate only on persisted content. Do not construct missing handoff text in components.
7. Add visible wording that command candidates require consumer-side policy validation before execution.
8. Do not display "NightWorkers connected", "sent", "accepted", or "task created" because vulnWorkbench cannot verify those states.
9. Navigation cleanup:
   - Projects and Scans are the first production navigation items
   - Showcase is visible only in development or through its direct route
   - Knowledge / Chat / Search remain available as secondary utilities; do not delete them in this phase
10. Normalize core Project / Scan operational copy to Japanese where adjacent labels are mixed without adding a full i18n framework.

Acceptance:

- A user can distinguish scan-ready, handoff-ready, generation-ready, stale, and degraded states.
- A user can copy handoff and read-only pull commands without selecting an individual finding.
- UI does not claim any NightWorkers-side mutation or adoption.
- Raw review parsing remains centralized in `scan-improvement-request.ts`.

Focused verification:

```bash
bunx vitest run web/src/domains/scans/scan-improvement-request.test.ts
bunx vitest run web/src/domains/scans/decision-grade-view.test.ts
bunx vitest run web/src/domains/projects/project-intelligence-readiness.test.ts
bunx vitest run web/src/domains/projects/project-intelligence-view-model.test.ts
```

### Slice 5: Static Intelligence Handoff Contract Regression

1. Keep Phase 42 Catalog MCP contract unchanged unless a bug is found.
2. Add regression assertions that Phase 43 UI / Oracle changes do not:
   - trigger generation build through MCP
   - add write-capable MCP tools
   - expose project root or secrets
   - return source body or artifact body
   - resolve latest generation during a pinned read
3. Ensure Oracle scan review does not automatically build Static Intelligence generation. Generation remains an explicit vulnWorkbench operation.
4. Keep Project Intelligence Refresh Analysis limited to derived generation refresh.

Acceptance:

- Existing expected MCP tool list is unchanged.
- CLI / MCP catalog parity remains deterministic.
- Oracle and Web scan changes do not broaden MCP authority.

Focused verification:

```bash
bun test api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun test api/modules/static-intelligence/exploration-catalog.test.ts
bun run fixture:static-intelligence-source
```

### Slice 6: Frontend Loading and Bundle Cleanup

1. Record the build manifest before changes.
2. Lazy-load domain screens that are not required by Projects / Scans:
   - Knowledge
   - Chat
   - Search
   - Showcase
3. Avoid importing Showcase and heavy editor / diagram dependencies into the core scan route entry.
4. Keep auth/session handling shared and eager.
5. Preserve direct navigation and refresh for every existing route.
6. Do not change scan or review behavior as part of code splitting.

Acceptance:

- Main entry raw and gzip size decrease by at least 30% from the recorded baseline, or the implementation evidence explains why dependency boundaries prevent that target.
- Projects / Scans first render does not download Showcase code.
- Direct `/chat`, `/knowledge`, `/search`, and `/showcase` navigation still works.
- Build produces no new circular dependency or route registration error.

Verification:

```bash
bun run build
bun run typecheck
```

Record before/after chunk names and raw / gzip sizes in Phase 43 evidence.

### Slice 7: Documentation and Operational Closeout

1. Update README in Japanese and English.
2. Document:
   - Oracle now attempts scan review and returns handoff when configured
   - degraded behavior when provider is unavailable
   - asynchronous Web scan status / cancel semantics
   - scanner execution policy and production Docker requirement
   - no automatic Docker-to-host fallback
   - external-agent UI boundary
3. Update `.env.example` with safe comments and no real credentials.
4. Extend `bootstrap:check` to report scanner execution readiness without executing a scan.
5. Add `spec/evidence/phase-43-vulnworkbench-support-readiness.md` during implementation closeout with:
   - baseline / final verification results
   - Oracle fixture matrix
   - async route evidence
   - cancellation / shutdown evidence
   - bundle before/after
   - known limitations
6. Do not claim NightWorkers rollout success in this evidence.

Acceptance:

- Fresh-clone and production policy differences are understandable from README / `.env.example`.
- Operators can diagnose missing Docker, missing scanner, missing LLM route, and stale scan state.
- Evidence separates producer readiness from consumer rollout value.

## Verification Matrix

| Command | Purpose | Expected | Failure Action |
| --- | --- | --- | --- |
| `bun run typecheck` | shared/API/UI contract consistency | exit 0 | fix type or contract drift before proceeding |
| `bun run lint` | unsafe patterns and style regression | exit 0; warning count not increased | resolve new warnings; record existing baseline warnings |
| `bun run format:check` | formatting | exit 0 | format touched files only |
| `bun test api/modules/scans/security-oracle-cli.test.ts` | Oracle args/result/exit/handoff | all pass | stop Oracle rollout slice |
| `bun test api/modules/scans/profile-runner.test.ts` | profile state and persistence | all pass | stop async rollout slice |
| `bun test api/routes/projects.route.test.ts api/routes/scans.route.test.ts` | queue admission, polling, cancel, ownership | all pass | stop Web scan rollout slice |
| `bunx vitest run web/src/domains/scans` | scan view models and polling state | all pass | fix UI derivation before build |
| `bunx vitest run web/src/domains/projects` | handoff readiness UI model | all pass | do not ship readiness UI |
| `bun test api/modules/static-intelligence/mcp-tools.test.ts` | read-only MCP regression | all pass | reject authority broadening |
| `bun run fixture:static-intelligence-source` | consumer-facing source fixture | `ok: true` JSON | fix leak/parity/hash regression |
| `bun run build` | production route and chunk build | exit 0; size comparison recorded | fix loading regression |
| `bun run verify` | repository closeout gate | exit 0 | do not complete Phase 43 |

## Manual / Integration Scenarios

Use a disposable repository fixture and isolated database.

1. Web static scan accepted:
   - POST returns 202 and scanRunId before scanner completes.
   - scan transitions queued -> running -> completed.
2. Required scanner missing:
   - scan transitions failed.
   - event and error identify tool/policy failure.
   - UI does not show completed.
3. Cancel running scan:
   - only owned child receives signal.
   - scan becomes cancelled.
   - no final report is presented as completed.
4. Server graceful shutdown:
   - owned children are terminated within bound.
   - scan records shutdown reason.
5. Oracle with configured scan review route:
   - one JSON object includes scan, completed reviewId, improvementRequest.
6. Oracle with missing provider:
   - scan remains present.
   - review is skipped/degraded.
   - status/exit code follow the matrix.
7. Oracle with high finding and failed review:
   - status remains security_action_required and exit code 3.
8. Zero-finding Oracle scan:
   - completed review describes coverage and follow-up work.
   - output does not claim the repository is safe.
9. Project Intelligence stale generation:
   - UI shows stale/degraded state.
   - copy command retains exact generation.
10. Production execution policy:
   - Docker missing fails preflight.
   - host is not selected unless explicitly allowed.

## Release Slices

### Release 43A: Reliability Foundation

- Slice 0 baseline
- Slice 1 execution policy
- Slice 2 asynchronous Web scan

Ship criteria:

- no false completion
- safe cancellation
- production runner policy enforced
- existing CLI compatibility preserved

### Release 43B: Oracle Handoff

- Slice 3 Security Oracle review / handoff
- Slice 5 Static Intelligence regression

Ship criteria:

- one-command handoff with configured provider
- degraded result preserves scan
- exit matrix verified
- MCP remains read-only

### Release 43C: Operator Experience

- Slice 4 handoff readiness UI
- Slice 6 loading cleanup
- Slice 7 documentation / evidence

Ship criteria:

- truthful readiness UI
- production navigation prioritizes Projects / Scans
- bundle comparison recorded
- full verify passes

## Commit Strategy

Recommended implementation commits:

1. `test: freeze scan and oracle contracts`
2. `feat: centralize scan execution policy`
3. `feat: add asynchronous web scan lifecycle`
4. `feat: return oracle scan review handoff`
5. `feat: add external agent handoff readiness ui`
6. `perf: lazy load non-core frontend domains`
7. `docs: close phase 43 support readiness`

Each commit must pass its focused tests. Do not combine async lifecycle, Oracle behavior, and UI into one unreviewable commit.

## Stop Conditions

Stop and revise this plan if any of the following becomes necessary.

- NightWorkers code, settings, DB, task, or runtime must be changed for a vulnWorkbench slice to work.
- contextStill mutation is required.
- Oracle needs external profile/provider/model/runner/DB parameters.
- Web scan cannot return early without treating an unconfirmed child launch as completed.
- cancellation requires signalling a PID that cannot be tied to the current launch token.
- a scanner needs arbitrary shell command input from the request.
- Docker failure must silently fall back to host execution.
- MCP must gain a write path.
- source bodies, raw artifacts, absolute roots, or secrets must be exposed to make the UI or handoff useful.
- a DB migration becomes necessary only to store transient process details that belong in runtime supervision.
- full repository verification cannot pass without suppressing relevant failures.

## Definition of Done

Phase 43 is complete when all of the following are true.

- Web scan launch is asynchronous and has verified terminal-state semantics.
- scanner execution policy is centralized, persisted, and production-safe.
- `oracle:security --project-path` attempts scan review without new external tuning inputs.
- completed scan review returns `reviewId` and `improvementRequest` through the existing contract.
- review/provider failure preserves usable scan results and returns a truthful degraded state.
- high / critical findings remain blocking independently of LLM success.
- Project / Scan UI displays persisted handoff and Static Intelligence readiness without claiming NightWorkers-side state.
- MCP remains read-only, bounded, redacted, and generation-pinned.
- frontend core loading is measurably improved or the limitation is documented with evidence.
- focused tests, fixture checks, build, and `bun run verify` pass.
- completion evidence explicitly states that NightWorkers consumer rollout and value measurement remain outside vulnWorkbench scope.
