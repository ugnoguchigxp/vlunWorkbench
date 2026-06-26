# Codex SDK Review and Report Implementation Plan

## Purpose

この計画は、vulnWorkbench の LLM Provider / Task Routing 設定で `codex` を選んだときに、実際に Codex SDK 経由で finding review、scan-level review、LLM付き scan report summary を実行できる状態へ到達するための実装計画である。

完了時の到達条件:

- `finding_review` route が `codex-default / <model>` を指している場合、`Run LLM Review` が Codex SDK adapter を通り、`finding_reviews.status = completed` または構造化された failed row を必ず作る。
- `scan_review` route が `codex-default / <model>` を指している場合、scan 全体の保存済み finding / evidence / review / decision / verification context だけを入力にした scan-level review を作れる。
- `report_summary` route が `codex-default / <model>` を指している場合、deterministic report に Codex 生成 summary を明示的に追加した report を作れる。
- UI は `Codex authenticated` と `Codex executable adapter available` を分けて表示し、実行できない provider を実行 route として保存できない。
- Azure deployment mismatch、route primary missing、Codex adapter missing、deterministic report が LLM を呼ばない問題を、すべて誤解なく表示・永続化・検証できる。

## Current Failure Baseline

2026-06-26 の調査で確認した失敗は一種類ではない。

1. 現在の `data/vuln-workbench.sqlite` では `llm_task_routes` の全 task が存在するが、`primary_provider_endpoint_id` と `primary_model` が空である。
   - Runtime result: `llm_route_target_missing`
   - Root code: `api/providers/llmRouter.ts`

2. `codex-default` endpoint は存在し、Codex auth / model status も UI に出せるが、`createLlmProviderForEndpoint()` に `codex` adapter がない。
   - Runtime result if routed to Codex: `llm_provider_adapter_unavailable`
   - Root code: `api/providers/llmProviderFactory.ts`
   - Existing test intentionally expects this failure in `api/providers/llmRouter.test.ts`.

3. 直近の failed finding review は Azure route で実行され、Azure 側に `gpt-4o-mini` deployment がなく `DeploymentNotFound` になっていた。
   - Root cause: `.env` に `AZURE_OPENAI_DEPLOYMENT` がなく、default `gpt-4o-mini` が env seed model として使われた。
   - This is separate from Codex adapter absence.

4. `Generate Report` は deterministic `buildMarkdownReport()` を呼ぶだけで、`report_summary` task route を見ない。
   - This is correct for deterministic report mode.
   - It is wrong only if UI/API implies that normal report generation uses LLM.

5. Settings UI は Codex provider を route target として選べるが、adapter availability を表示・検証していない。
   - `Codex authenticated` and `Codex executable` are currently conflated.

## Source Facts

- Official Codex SDK docs: `https://developers.openai.com/codex/sdk`
  - TypeScript SDK package: `@openai/codex-sdk`
  - Server-side use, Node.js 18 or later.
  - Basic flow: `new Codex()`, `startThread()`, `thread.run(prompt)`, `resumeThread(threadId)`.
- Codex manual sandbox guidance: `https://developers.openai.com/codex/concepts/sandboxing`
  - Prefer bounded sandboxing and least permission.
  - `read-only` means Codex can inspect files but not edit them.
- Existing repo plan:
  - `spec/llm-provider-routing-strict-execution-plan.md`
  - This new plan supersedes its Codex adapter phases only; it does not replace unrelated LLM routing hardening notes.

## Non-Goals

- Do not let Codex search the repository freely for vulnerabilities.
- Do not let Codex run scan tools, DAST, reproduction, dynamic verification, browser automation, Docker, shell commands, or file edits for these tasks.
- Do not silently fallback from Codex to Azure/OpenAI/local when a Codex route fails.
- Do not silently fallback from LLM summary mode to deterministic-only report when `report_summary` fails.
- Do not make normal deterministic report generation depend on live LLM, Codex login, network, or provider availability.
- Do not store Codex prompts/responses with raw provider secrets.
- Do not solve Bedrock or generic multi-agent execution in this work.

## Design Contract

### Provider Contract

Add a Codex adapter that implements the existing `LlmProvider` interface:

```ts
export class CodexSdkProvider implements LlmProvider {
  chatCompletion(
    messages: ChatMessage[],
    options?: LlmCompletionOptions,
  ): Promise<LlmResponse>;
}
```

The adapter will translate chat messages into one bounded Codex prompt and return only the final assistant text as `LlmResponse.content`.

Required adapter behavior:

- Use `@openai/codex-sdk` as the primary programmatic control surface.
- Set the selected route model on the Codex thread/run when the SDK supports it.
- Run in a read-only or no-repo-access mode.
- Use a temp empty working directory if the TypeScript SDK does not expose a sufficient sandbox/cwd contract.
- Never pass the project repo path as a writable workspace.
- Never pass scan runner environment variables wholesale.
- Preserve only safe env needed for Codex auth, such as `CODEX_HOME`, `CODEX_API_KEY`, or SDK-required process env.
- Time out long runs with a bounded timeout.
- Return provider execution failures as `llm_provider_execution_failed`, not `adapter_unavailable`.

### Runtime Compatibility Contract

The repo runtime is Bun, while the official TypeScript Codex SDK requires server-side Node.js 18 or later. Phase 1 must decide the runtime shape before feature wiring.

Allowed implementations:

1. Direct Bun import, only if `bun test` proves `@openai/codex-sdk` can be imported and used under Bun.
2. Node bridge process, if direct Bun import is unsupported or unstable:
   - `api/providers/codex-sdk-node-runner.mjs`
   - Spawned from Bun with `process.execPath` overridden to a Node binary found on `PATH`.
   - JSON request on stdin, JSON result on stdout, diagnostics on stderr.
   - The bridge still uses `@openai/codex-sdk`; it is not a CLI fallback.

Stop condition:

- If neither direct Bun import nor Node bridge can run a mocked SDK contract test, do not mark Codex executable. Keep Codex status/config visible but disabled for task routes.

### Routing Contract

`llm_task_routes` remains authoritative.

For `finding_review`, `scan_review`, and `report_summary`:

```text
task -> llm_task_routes.primaryTarget -> endpoint -> adapter -> model
```

Failure behavior:

- Missing route: persisted failed row with `route:llm_route_missing`.
- Missing primary target: persisted failed row with `route:llm_route_target_missing`.
- Missing endpoint: persisted failed row with `route:llm_provider_missing`.
- Disabled endpoint: persisted failed row with `route:llm_provider_disabled`.
- Unsupported provider kind for task: persisted failed row with `route:llm_provider_kind_not_allowed`.
- Model not configured on endpoint: persisted failed row with `route:llm_model_not_configured`.
- Adapter unavailable: persisted failed row with `route:llm_provider_adapter_unavailable`.
- Execution failed: persisted failed row with `route:llm_provider_execution_failed`.
- Structured JSON invalid: persisted failed row with `route:llm_structured_output_validation_failed`.

No automatic fallback unless `policy.fallbackMode === "explicit"`.

### Report Contract

Keep two report modes:

```text
deterministic
deterministic_with_llm_summary
```

Rules:

- `deterministic` calls only `buildMarkdownReport()`.
- `deterministic_with_llm_summary` first builds deterministic content, then resolves `report_summary`, calls Codex/provider, validates structured summary, and inserts an LLM summary section.
- If `report_summary` fails, the report row is `failed`; do not silently save deterministic-only output for that mode.
- Store `summaryMode`, `providerRouting`, `provider`, `model`, and `llmSummaryStatus` in report options/metadata.

## Implementation Phases

### Phase 0: Baseline Fixture and Failure Reproduction

Files:

- `api/providers/llmRouter.test.ts`
- `api/modules/reviews/finding-review-runner.test.ts`
- `api/routes/scans.route.test.ts`
- `api/routes/scan-reports.route.test.ts`

Tasks:

- Add or update tests that prove current route target missing returns `llm_route_target_missing`.
- Preserve tests proving Codex without adapter currently fails as `llm_provider_adapter_unavailable`.
- Add a fixture for Azure `DeploymentNotFound` style provider execution failure and ensure it is surfaced as provider execution failure, not routing failure.
- Add report tests proving default deterministic mode does not call `LlmRouter`.

Completion criteria:

- Current failure modes are locked before implementation.
- No live provider or Codex auth is required.

Verification:

```bash
bun test api/providers/llmRouter.test.ts api/modules/reviews/finding-review-runner.test.ts api/routes/scans.route.test.ts api/routes/scan-reports.route.test.ts
```

### Phase 1: Codex SDK Dependency and Contract Spike

Files:

- `package.json`
- `bun.lock`
- `api/providers/codexSdkProvider.ts`
- `api/providers/codexSdkProvider.test.ts`
- Optional: `api/providers/codex-sdk-node-runner.mjs`

Tasks:

- Add `@openai/codex-sdk`.
- Inspect installed TypeScript types and document the actual supported constructor/thread/run options in code comments or tests.
- Implement a mocked SDK contract test that proves:
  - prompt text is passed to Codex;
  - selected model is passed when supported;
  - result final text is extracted;
  - timeout maps to `llm_provider_execution_failed`;
  - malformed/empty result maps to provider execution failure.
- Decide direct Bun import vs Node bridge.
- Add `CodexSdkProvider.getDiagnostics()` with:
  - `sdkAvailable`
  - `runtimeMode: "bun-direct" | "node-bridge"`
  - `nodeVersion` if using bridge
  - `codexHome`
  - `authSource`

Completion criteria:

- `CodexSdkProvider` can be unit-tested without live Codex.
- Runtime mode is explicit.
- Adapter can be marked executable only after mocked contract passes.

Verification:

```bash
bun test api/providers/codexSdkProvider.test.ts
bun run typecheck
```

### Phase 2: Provider Factory and Health Integration

Files:

- `api/providers/llmProviderFactory.ts`
- `api/providers/llmTaskTypes.ts`
- `api/modules/llm-settings/provider-health.ts`
- `api/modules/llm-settings/codex-status.ts`
- `api/routes/settings.route.ts`
- `api/modules/llm-settings/llm-settings.repository.test.ts`
- `api/providers/llmRouter.test.ts`

Tasks:

- Wire `endpoint.kind === "codex"` to `new CodexSdkProvider(...)`.
- Extend failure kinds if needed:
  - keep `llm_provider_adapter_unavailable` for missing SDK/runtime;
  - use `llm_provider_credentials_missing` only when Codex auth is absent;
  - use `llm_provider_execution_failed` when SDK run starts but fails.
- Extend Codex status API to include `executableAdapterAvailable` and `adapterDiagnostics`.
- Update health check so Codex health is not a fake `ok: true` unless both auth and adapter availability are true.
- Keep `codex_status_required` only as an informational status if executable adapter is not checked by health.

Completion criteria:

- Router can resolve `codex-default / model` into a real `LlmProvider`.
- Settings API can tell UI whether Codex is authenticated and executable.
- Existing Azure/OpenAI/local behavior is unchanged.

Verification:

```bash
bun test api/providers/llmRouter.test.ts api/modules/llm-settings/llm-settings.repository.test.ts
bun test api/modules/llm-settings/**/*.test.ts
```

### Phase 3: Finding Review Through Codex

Files:

- `api/modules/reviews/finding-review-runner.ts`
- `api/modules/reviews/finding-review-prompt.ts`
- `api/modules/reviews/finding-review-runner.test.ts`
- `api/routes/findings.route.ts`
- `web/src/domains/scans/components/review-section.tsx`
- `web/src/domains/scans/use-scans-controller.ts`

Tasks:

- Keep the existing bounded `ReviewInputBundle`; do not give Codex arbitrary repo access.
- Route `finding_review` through `LlmRouter` only.
- Remove legacy `providerName = "azure-openai"` assumptions where they affect persisted rows.
- Persist route failure as a failed review row with:
  - `provider = route:<failureKind>`
  - `model = unresolved` or requested model
  - `errorMessage = <failureKind>: <message>`
- Persist successful Codex route metadata into review output:
  - task
  - providerEndpointId
  - model
  - runtimeMode
  - codexThreadId if available
- UI must display:
  - configured route before execution;
  - failed review rows;
  - adapter unavailable vs auth missing vs execution failed.

Completion criteria:

- Clicking `Run LLM Review` against a Codex route creates a completed review when mocked Codex returns valid JSON.
- If Codex returns non-JSON, the row is failed with `llm_structured_output_validation_failed`.
- Empty review panel after click is impossible.

Verification:

```bash
bun test api/modules/reviews/finding-review-runner.test.ts api/routes/findings.route.test.ts
bunx biome lint api/modules/reviews api/routes/findings.route.ts web/src/domains/scans
```

### Phase 4: Scan-Level Review

Files:

- `drizzle/<next>_scan_reviews.sql`
- `api/db/schema.ts`
- `shared/schemas/scan.schema.ts`
- `api/modules/scans/scan-review-bundle.ts`
- `api/modules/scans/scan-review-prompt.ts`
- `api/modules/scans/scan-review-runner.ts`
- `api/routes/scans.route.ts`
- `web/src/api.ts`
- `web/src/domains/scans/components/scan-summary-panel.tsx`
- `web/src/domains/scans/use-scans-controller.ts`

Tasks:

- Add `scan_reviews` table rather than overloading `scan_reports`.
- Input must be saved scan/finding/evidence/review/decision/reproduction/dynamic/DAST summaries only.
- Do not include raw artifacts by default.
- Add `POST /api/scans/:scanRunId/reviews` and `GET /api/scans/:scanRunId/reviews`.
- Use task route `scan_review`.
- Add a structured output schema for scan-level review:
  - `summary`
  - `riskPosture`
  - `topRisks`
  - `coverageGaps`
  - `recommendedNextActions`
  - `reviewerNotes`
  - `confidence`
- Persist provider/model/route metadata like finding reviews.

Completion criteria:

- Codex can create scan-level review from saved DB context.
- Route errors create failed scan review rows.
- UI shows latest scan-level review and failure reason.

Verification:

```bash
bun run db:migrate
bun test api/modules/scans/scan-review-runner.test.ts api/routes/scans.route.test.ts
bun run typecheck
```

### Phase 5: LLM Summary Report Mode

Files:

- `shared/schemas/scan.schema.ts`
- `api/modules/scans/report-builder.ts`
- `api/modules/scans/report-summary-prompt.ts`
- `api/modules/scans/report-summary-runner.ts`
- `api/modules/scans/report-repository.ts`
- `api/routes/scans.route.ts`
- `api/routes/scan-reports.route.ts`
- `api/cli/report-scan.ts`
- `web/src/api.ts`
- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/domains/scans/components/report-detail-panel.tsx`
- `web/src/domains/scans/use-scans-controller.ts`

Tasks:

- Extend `createScanReportSchema` with:

```ts
summaryMode: z.enum(["deterministic", "deterministic_with_llm_summary"]).default("deterministic")
```

- Extend `scanReportSchema.options` to include `summaryMode` and optional `providerRouting`.
- Add `buildMarkdownReportWithLlmSummary()` or `ReportSummaryRunner`.
- For LLM summary mode:
  - build deterministic report first;
  - create a compact prompt from deterministic markdown and DB summary;
  - resolve `report_summary`;
  - call Codex/provider;
  - validate JSON summary;
  - insert a clearly labeled `## LLM Summary` section near the top;
  - persist route metadata.
- UI:
  - Keep existing `Generate Report` button for deterministic mode.
  - Add distinct `Generate Report with Codex Summary` or mode selector.
  - Show the resolved `report_summary` route before execution.

Completion criteria:

- Existing deterministic report tests still pass.
- Deterministic mode never calls `LlmRouter`.
- LLM summary mode fails clearly when `report_summary` route is missing.
- LLM summary mode uses `report_summary`, not `finding_review` or `scan_review`.
- Download/regeneration preserves the selected summary mode semantics.

Verification:

```bash
bun test api/modules/scans/report-builder.test.ts api/modules/scans/report-summary-runner.test.ts
bun test api/routes/scans.route.test.ts api/routes/scan-reports.route.test.ts
```

### Phase 6: Settings UI and Local DB Repair

Files:

- `web/src/settings-panel.tsx`
- `web/src/api.ts`
- `api/cli/llm-route-repair.ts`
- `api/modules/llm-settings/llm-settings.schema.ts`
- `api/modules/llm-settings/llm-settings.repository.ts`

Tasks:

- Display provider execution adapter status:
  - `Configured`
  - `Authenticated`
  - `Executable adapter available`
  - `Last health`
- Disable route save for `codex` when adapter is unavailable.
- Allow saving Codex routes only when:
  - endpoint is enabled;
  - model is listed;
  - Codex auth exists;
  - adapter diagnostics say executable.
- Add route preview for each task:

```text
finding_review -> codex-default / gpt-5.4-mini
scan_review -> codex-default / gpt-5.4-mini
report_summary -> codex-default / gpt-5.4-mini
```

- Add CLI repair command support for setting primary targets:

```bash
bun run api/cli/llm-route-repair.ts \
  --provider codex-default \
  --model <selected-codex-model> \
  --tasks finding_review,scan_review,report_summary
```

Completion criteria:

- UI route preview matches SQLite rows.
- A route pointing to a non-executable provider cannot be saved without a visible error.
- Local DB can be repaired to point review/report tasks at Codex after adapter availability is true.

Verification:

```bash
bun test api/modules/llm-settings/**/*.test.ts
bun run api/cli/llm-route-repair.ts --help
bun run typecheck
bun run build:web
```

### Phase 7: Live Codex Smoke Gate

This phase is not part of default `bun run verify` because it requires local Codex auth and possibly network/model entitlement.

Prerequisites:

- `GET /api/settings/llm/codex/status` returns authenticated.
- `adapterDiagnostics.executableAdapterAvailable === true`.
- `llm_task_routes`:
  - `finding_review -> codex-default / <model>`
  - `scan_review -> codex-default / <model>`
  - `report_summary -> codex-default / <model>`
- At least one scan with findings exists.

Commands:

```bash
bun --eval 'import { readAppEnv } from "./api/app/env.ts"; import { createDbConnection } from "./api/db/index.ts"; import { LlmSettingsRepository } from "./api/modules/llm-settings/llm-settings.repository.ts"; import { LlmRouter } from "./api/providers/llmRouter.ts"; const env=readAppEnv(); const c=createDbConnection(env.databaseUrl); const repo=new LlmSettingsRepository(c.db, env); const router=new LlmRouter(repo, env); for (const task of ["finding_review","scan_review","report_summary"]) console.log(task, await router.resolve(task)); c.sqlite.close(false);'
```

Then run one finding review:

```bash
bun run review:finding -- --finding-id <finding-id> --task finding_review
```

Then run scan review:

```bash
bun run api/cli/review-scan.ts -- --scan-run-id <scan-run-id> --task scan_review
```

Then run report with LLM summary:

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --summary-mode deterministic_with_llm_summary \
  --output /tmp/vuln-workbench-codex-summary-report.md
```

Expected DB evidence:

```sql
select provider, model, status, error_message
from finding_reviews
order by created_at desc
limit 1;

select provider, model, status, error_message
from scan_reviews
order by created_at desc
limit 1;

select status, error_message, options
from scan_reports
order by created_at desc
limit 1;
```

Expected results:

- Finding review provider begins with `codex:`.
- Scan review provider begins with `codex:`.
- LLM summary report options include `summaryMode = deterministic_with_llm_summary`.
- Generated markdown contains `## LLM Summary`.
- No raw API keys or Codex tokens appear in artifacts, DB JSON, logs, or UI responses.

## Verification Matrix

Focused verification:

```bash
bun run typecheck
bunx biome lint api/providers api/modules/llm-settings api/modules/reviews api/modules/scans api/routes web/src/settings-panel.tsx web/src/domains/scans
bun test api/providers/llmRouter.test.ts api/providers/codexSdkProvider.test.ts
bun test api/modules/llm-settings/**/*.test.ts
bun test api/modules/reviews/finding-review-runner.test.ts
bun test api/modules/scans/report-builder.test.ts api/modules/scans/report-summary-runner.test.ts api/modules/scans/scan-review-runner.test.ts
bun test api/routes/findings.route.test.ts api/routes/scans.route.test.ts api/routes/scan-reports.route.test.ts
bun run build:web
```

Repo gate:

```bash
bun run verify
```

Live smoke gate:

```bash
bun run verify:codex-live
```

Add `verify:codex-live` only after the adapter and CLI commands exist. It must be opt-in and must skip with a clear message when Codex auth or route setup is absent.

## Rollback and Stop Conditions

Stop before merging implementation if:

- Codex SDK cannot be installed or imported in either direct Bun mode or Node bridge mode.
- The TypeScript SDK cannot be run without giving Codex write access or broad repo access.
- Structured output cannot be validated reliably.
- UI cannot distinguish authenticated from executable.
- Deterministic report behavior regresses.
- `bun run verify` fails from changed files.

Rollback strategy:

- Revert the Codex adapter wiring in `llmProviderFactory` first.
- Keep schema migrations only if already used by local data; otherwise revert migration and schema together.
- Leave deterministic report path intact throughout; it is the fallback user workflow, but not a silent fallback for LLM summary mode.

## Final Done Checklist

- `@openai/codex-sdk` dependency is present and covered by mocked tests.
- `CodexSdkProvider` implements `LlmProvider`.
- `llmProviderFactory` creates a Codex provider when endpoint kind is `codex`.
- Settings API reports Codex auth and executable adapter availability separately.
- Settings UI prevents non-executable Codex routes.
- `finding_review` through Codex persists completed review with structured JSON.
- `scan_review` through Codex persists completed scan review with structured JSON.
- `report_summary` through Codex creates deterministic report plus validated LLM summary.
- Route and provider failures are persisted and visible in UI.
- Default deterministic report remains live-provider-free.
- Focused tests, `bun run build:web`, and `bun run verify` pass.
- Optional live smoke proves local Codex can run all three target tasks.
