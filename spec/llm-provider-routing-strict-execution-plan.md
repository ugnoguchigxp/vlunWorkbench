# LLM Provider Routing Strict Execution Plan

## Purpose

この計画は、vulnWorkbench の LLM Provider / Task Routing 設定を、実際の LLM 実行経路へ厳密に反映させるための hardening plan である。

現状は Settings UI と runtime の責務がずれている。UI では Codex provider と task routing を扱っているが、実行時には `finding_review` が DB 上の `llm_task_routes` に従って Azure OpenAI へ向かっており、さらに Codex provider は設定上存在するだけで `LlmProvider` adapter として実行できない。

この計画の最優先方針:

- LLM task は必ず `llm_task_routes` の設定に従う。
- env provider、legacy provider、既定 provider への暗黙 fallback は禁止する。
- fallback はユーザーが task route 上で明示的に有効化した場合だけ使う。
- Codex を provider として選べるなら、実行 adapter まで実装する。
- adapter がない provider は UI 上で実行可能 provider として扱わない。
- Generate Report の deterministic report と `report_summary` LLM task の責務を分離する。

## Current Failure

2026-06-26 のローカル DB では次の状態だった。

```text
llm_provider_endpoints
  codex-default      kind=codex enabled=true
  azure-env-default  kind=azure enabled=true
  local-template     kind=local enabled=false

llm_task_routes
  finding_review  -> azure-env-default / gpt-4o-mini
  scan_review     -> azure-env-default / gpt-4o-mini
  report_summary  -> azure-env-default / gpt-4o-mini
  evidence_context -> azure-env-default / gpt-4o-mini
  agentic_search  -> azure-env-default / gpt-4o-mini
```

`Run LLM Review` は `finding_review` route に従い Azure OpenAI を呼んだ。その結果、Azure 側に該当 deployment がなく、次の failed review が作られた。

```text
provider = azure:azure-env-default
model = gpt-4o-mini
status = failed
error = DeploymentNotFound
```

これは UI の表示だけの問題ではない。設定 seed と runtime adapter の両方に設計上の不整合がある。

## Source Baseline

実装前に確認する。

```bash
git status --short
sqlite3 data/vuln-workbench.sqlite '.schema llm_provider_endpoints'
sqlite3 data/vuln-workbench.sqlite '.schema llm_task_routes'
bun -e 'import { Database } from "bun:sqlite"; const db=new Database("data/vuln-workbench.sqlite",{readonly:true}); console.log(db.query("select * from llm_provider_endpoints").all()); console.log(db.query("select * from llm_task_routes").all());'
rg -n 'LlmRouter|createLlmProviderForEndpoint|llm_task_routes|fallbackTargets|codex|report_summary|buildMarkdownReport|FindingReviewRunner' api shared web/src spec
bun run typecheck
bunx biome lint api/providers api/modules/llm-settings api/modules/reviews api/routes/findings.route.ts web/src/settings-panel.tsx
```

Stop conditions:

- If current worktree has unrelated user changes in the same files, inspect and preserve them.
- If `bun run verify` already fails for unrelated lint issues, record the failure and use focused verification for changed files.
- If Codex CLI cannot run non-interactively in this environment, stop before wiring it as an enabled provider.
- If task routes reference an endpoint whose adapter is not implemented, the runtime must fail clearly; do not route to another provider.

## Target Behavior

### Task Routing Is Authoritative

For every LLM task:

```text
task -> llm_task_routes.primaryTarget -> provider endpoint -> adapter -> model
```

If any part is missing or invalid, the task fails with a persisted structured error.

Required failure cases:

- route missing
- primary target missing
- endpoint missing
- endpoint disabled
- provider kind not allowed for the task
- model not listed on endpoint
- provider adapter unavailable
- provider credential missing
- provider execution failed
- structured output validation failed

Forbidden behavior:

- Using `env.azureOpenAiDeployment` when route resolution fails.
- Falling back to `llmProvider` injected into Hono runtime when `llmRouter` is configured.
- Selecting the first enabled provider automatically.
- Re-seeding task routes from env after user settings exist.
- Swallowing routing errors and showing an empty review panel.

### Fallback Policy

Fallback must not be automatic.

Initial implementation should use only `primaryTarget`.

If fallback support remains in the schema, it must be gated by explicit policy:

```ts
policy: {
  fallbackMode?: "disabled" | "explicit";
}
```

Rules:

- default is `disabled`
- `fallbackTargets` are ignored unless `fallbackMode === "explicit"`
- fallback execution is attempted only after route-visible primary failure
- UI must show the exact fallback order before execution
- persisted review/report metadata must record which target was used

If this extra policy is considered too much for this phase, remove fallback execution entirely and keep `fallbackTargets` as unused future schema.

### Codex Provider Must Be Real Or Disabled

If `codex-default` is enabled and routeable, `createLlmProviderForEndpoint()` must return a working provider.

If no Codex adapter is implemented, then:

- `codex` must not be selectable as an execution target, or
- route validation must fail with `llm_provider_adapter_unavailable`

Do not let `codex` pass validation and then fall through to Azure/OpenAI/local.

## Implementation Phases

### Phase 1: Route Resolver Strictness

Files:

- `api/providers/llmRouter.ts`
- `api/providers/llmTaskTypes.ts`
- `api/modules/llm-settings/llm-settings.schema.ts`
- tests under `api/providers/llmRouter.test.ts`

Tasks:

- Make `LlmRouter.resolve(task)` require an explicit route and primary target.
- Return typed failure for route missing instead of silently trying other providers.
- Remove provider selection based on "first valid endpoint".
- Do not catch adapter creation errors without preserving the reason.
- Add failure kind values:
  - `llm_route_missing`
  - `llm_route_target_missing`
  - `llm_provider_missing`
  - `llm_provider_disabled`
  - `llm_provider_kind_not_allowed`
  - `llm_model_not_configured`
  - `llm_provider_adapter_unavailable`
  - `llm_provider_credentials_missing`
  - `llm_provider_execution_failed`
- Treat fallback as disabled unless `policy.fallbackMode === "explicit"`.

Completion criteria:

- Unit tests prove no env provider is used when route is missing.
- Unit tests prove Azure is not used when Codex route is invalid.
- Unit tests prove adapter creation error is returned as a failed resolution with message.

### Phase 2: Seed and Migration Hardening

Files:

- `api/modules/llm-settings/llm-settings.repository.ts`
- `api/modules/llm-settings/llm-settings.repository.test.ts`
- optional migration under `drizzle/`
- optional CLI under `api/cli/`

Tasks:

- Stop choosing default route from `enabled && kind !== "codex"`.
- Seed provider endpoints from env only as available endpoints, not as automatic task routes.
- Seed task routes only when a route target is explicitly safe:
  - Codex authenticated and Codex adapter available, or
  - user explicitly saved a route.
- Add a migration or repair command that can rewrite existing env-seeded routes.
- Add a route repair command:

```bash
bun run api/cli/llm-route-repair.ts --provider codex-default --model <model> --tasks finding_review,scan_review,report_summary
```

The repair command must:

- print the current routes before changing them
- refuse if provider/model is not configured
- update only requested tasks
- not delete providers unless explicitly asked

Completion criteria:

- Fresh DB with Azure env no longer auto-routes all tasks to Azure.
- Existing DB can be repaired to Codex routes with one explicit command.
- Tests cover masked secret preservation after route changes.

### Phase 3: Codex Execution Adapter

Files:

- `api/providers/CodexCliProvider.ts`
- `api/providers/llmProviderFactory.ts`
- `api/providers/CodexCliProvider.test.ts`
- `api/modules/llm-settings/codex-status.ts`

Preferred adapter shape:

```ts
class CodexCliProvider implements LlmProvider {
  chatCompletion(messages, options): Promise<LlmResponse>
}
```

Execution strategy:

- Use `codex exec`.
- Pass `--model <model>`.
- Pass `--sandbox read-only`.
- Pass `--cd <project repo path or app cwd>`.
- Use `--output-last-message <temp file>` to capture final content.
- Use `--output-schema <schema file>` for structured tasks if practical.
- Use `--json` only for event logging/debug, not as the primary content parser unless stable.
- Use bounded timeout.
- Use sanitized environment.
- Never pass approval-bypass flags.
- Never allow file edits, command execution with write permissions, or arbitrary browser/network search from this adapter.

Structured JSON tasks:

- `finding_review`, `scan_review`, and future `report_summary` structured mode must validate output with the existing Zod schemas.
- Prompt must tell Codex to output only the requested JSON object.
- Parser must reject missing JSON, invalid JSON, and schema mismatch as task failure.

Failure mapping:

- CLI not found -> `llm_provider_adapter_unavailable`
- Codex auth missing -> `llm_provider_credentials_missing`
- non-zero exit -> `llm_provider_execution_failed`
- timeout -> `llm_provider_execution_failed`
- invalid output -> structured validation failure in runner

Completion criteria:

- `createLlmProviderForEndpoint({ kind: "codex" })` returns `CodexCliProvider`.
- Tests mock `child_process`/spawn and prove argv has read-only sandbox.
- Tests prove non-zero Codex exit does not fall back to Azure.
- Tests prove final content is parsed and returned through `LlmResponse`.

### Phase 4: Finding Review Runtime Wiring

Files:

- `api/modules/reviews/finding-review-runner.ts`
- `api/routes/findings.route.ts`
- `web/src/domains/scans/components/review-section.tsx`
- `web/src/domains/scans/use-scans-controller.ts`

Tasks:

- Remove legacy default provider/model assumptions from `FindingReviewRunner`.
- Do not default provider name to `azure-openai`.
- Require `LlmRouter` for API review execution.
- Persist route failure as `finding_reviews.status = failed`.
- Persist provider/model only after route resolution; if resolution fails, use:

```text
provider = route:<failureKind>
model = requested task/model or "unresolved"
```

- UI must display the route target before execution:

```text
Route: finding_review -> Codex SDK / gpt-5.4-mini
```

- UI must display failed review rows and route errors in the Review section.

Completion criteria:

- Clicking `Run LLM Review` creates either completed or failed review row.
- Empty panel after click is impossible.
- If `finding_review` points to Azure, UI says Azure before execution.
- If `finding_review` points to Codex, UI says Codex before execution.

### Phase 5: Report Generation and `report_summary`

Current behavior:

- `Generate Report` calls deterministic `buildMarkdownReport()`.
- It does not call an LLM provider.
- It uses saved scan/finding/evidence/review/decision/reproduction/dynamic/DAST data.

Target behavior:

- Keep deterministic report generation as the default and name it clearly.
- Do not pretend deterministic report uses `report_summary`.
- Add optional LLM summary only as an explicit feature.

Recommended UI/API model:

```text
Generate Report
  mode = deterministic

Generate Report with LLM Summary
  mode = deterministic_with_llm_summary
  task route = report_summary
```

Rules:

- `mode=deterministic` never calls LLM.
- `mode=deterministic_with_llm_summary` must resolve `report_summary`.
- If `report_summary` route is missing, fail that mode clearly.
- Do not fallback to deterministic mode silently after LLM route failure.
- Store report options with `summaryMode`.
- Persist the used provider/model in report metadata when LLM summary is used.

Files:

- `api/modules/scans/report-builder.ts`
- `api/routes/scans.route.ts`
- `api/routes/scan-reports.route.ts`
- `api/modules/scans/report-repository.ts`
- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/domains/scans/components/report-detail-panel.tsx`

Completion criteria:

- Existing deterministic report tests still pass.
- New tests prove deterministic mode does not call `LlmRouter`.
- New tests prove LLM summary mode fails when route is missing.
- New tests prove LLM summary mode uses only `report_summary`.

### Phase 6: Settings UI Contract

Files:

- `web/src/settings-panel.tsx`
- `web/src/api.ts`
- `api/routes/settings.route.ts`

Tasks:

- Show actual DB routes, not inferred display state.
- Display whether each provider kind has an execution adapter.
- Disable route save for provider kinds with no adapter.
- Display `Codex authenticated` and `Codex executable adapter available` separately.
- Show per-task route preview:

```text
finding_review -> codex-default / gpt-5.4-mini
report_summary -> unconfigured
```

- Add "repair routes to Codex" action only if Codex adapter is available.
- Do not auto-add Azure route because env exists.

Completion criteria:

- UI cannot make a route to an unavailable adapter without a visible error.
- UI route preview matches DB rows.
- Saving settings preserves disabled providers but does not auto-select them.

### Phase 7: Local DB Repair

For the current local DB, after adapter and route validation are in place:

```bash
bun run api/cli/llm-route-repair.ts \
  --provider codex-default \
  --model <selected-codex-model> \
  --tasks finding_review,scan_review,report_summary
```

Then verify:

```bash
bun -e 'import { Database } from "bun:sqlite"; const db=new Database("data/vuln-workbench.sqlite",{readonly:true}); console.log(db.query("select * from llm_task_routes").all());'
```

Expected:

```text
finding_review -> codex-default / <selected-codex-model>
scan_review -> codex-default / <selected-codex-model>
report_summary -> codex-default / <selected-codex-model>
```

Do not delete `azure-env-default` unless the user explicitly chooses to remove that endpoint.

## Verification Matrix

Focused commands:

```bash
bun run typecheck
bunx biome lint api/providers api/modules/llm-settings api/modules/reviews api/routes/findings.route.ts api/routes/scan-reports.route.ts web/src/settings-panel.tsx web/src/domains/scans
bun test api/providers/llmRouter.test.ts api/providers/CodexCliProvider.test.ts api/modules/llm-settings/llm-settings.repository.test.ts api/modules/reviews/finding-review-runner.test.ts api/modules/scans/report-builder.test.ts api/routes/scan-reports.route.test.ts
bun run build:web
```

Repo gate:

```bash
bun run verify
```

If repo-wide verify is failing from pre-existing lint outside this scope, record the exact failures and run focused verification for changed files.

Manual runtime checks:

```bash
bun run db:migrate
bun run dev -- --host 127.0.0.1
```

Manual UI checks:

- Settings shows actual route targets.
- `finding_review` route preview matches DB.
- `Run LLM Review` shows provider/model before execution.
- Failed provider execution creates visible failed review.
- Deterministic report generation works without any LLM route.
- LLM summary report mode fails clearly when `report_summary` is unset.

## Non-Goals

- Do not make LLM scan source code by itself.
- Do not let Codex provider edit files.
- Do not let Codex provider run write-capable shell commands.
- Do not make env Azure/OpenAI silently override DB task routes.
- Do not silently fallback from Codex to Azure, OpenAI, local, or deterministic mode.
- Do not repair the user's DB without an explicit command/action.
- Do not delete provider endpoints as part of route repair unless explicitly requested.
- Do not make Report generation depend on live LLM availability by default.

## Open Questions

- Should `fallbackTargets` be removed from the active UI until explicit fallback policy is implemented?
- Should Codex adapter use `codex exec --output-schema` for all structured tasks, or should schema enforcement remain only in the app runner?
- Which Codex model should be the local default for `finding_review`?
- Should `report_summary` produce a separate report section, or replace only the executive summary section while the rest remains deterministic?

## Recommended First Implementation Slice

Implement only this slice first:

1. Make `LlmRouter` strict and remove implicit provider fallback.
2. Add adapter availability checks so `codex` cannot resolve without a real adapter.
3. Change env seeding so Azure env does not auto-own every task route.
4. Add route target preview to `Run LLM Review`.
5. Add local route repair CLI.

Do not implement LLM report summary in the first slice. Keep Generate Report deterministic until provider routing is correct for finding review.
