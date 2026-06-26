# LLM Provider Settings and Task Routing Plan

## Purpose

この計画は、vulnWorkbench に LLM provider 設定画面と task routing を追加するための独立計画である。Phase 1-13 の本線とは別に扱う。

Implementation status:

- Started: LLM settings persistence/API, provider factory, task router, finding review CLI/API integration.
- Not yet complete: Agentic Search routing, dedicated Settings UI, optional Codex SDK execution adapter, documentation hardening.

目的は、現在の env 固定の単一 LLM 構成を、UI から管理できる複数 provider 構成へ置き換え、vulnWorkbench 内の LLM 利用タスクごとに担当 LLM を選べる状態にすること。

参照実装は `../nightWorkers` の LLM settings / provider endpoint / role routing / Codex SDK status 実装とする。ただし、NightWorkers は実装エージェント実行基盤を含むため、vulnWorkbench では脆弱性診断ワークフローに必要な範囲だけを取り込む。

重要な責務境界:

- LLM は診断結果の reviewer / summarizer / context assistant であり、scanner ではない。
- LLM に repo 全体や任意 path を自由探索させない。
- 重い scan / DAST / reproduction / sandbox 実行は引き続き CLI / tool runner が担当する。
- LLM provider 設定は scan runner / Docker toolbox / browser automation に秘密情報を漏らさない。
- `bun run verify` は live provider、network、Codex login、local-llm daemon を要求しない。
- Codex SDK を provider として使う場合も、vulnWorkbench では read-only review 用 adapter として扱い、file edit / command execution / network browsing を許可しない。

## Investigation Summary

調査コマンド:

```bash
git status --short --branch
rg -n 'LLM|provider|model|OpenAI|Azure|local-llm|codex|settings|routing|route|task' api shared web/src README.md spec package.json
rg --files ../nightWorkers | sort
sed -n '1,260p' ../nightWorkers/api/services/structured-llm/settings.ts
sed -n '1,260p' ../nightWorkers/api/services/structured-llm/providers.ts
sed -n '1,240p' ../nightWorkers/api/services/structured-llm/role-routing.ts
sed -n '1,260p' ../nightWorkers/api/services/structured-llm/provider-health.ts
sed -n '1,260p' ../nightWorkers/api/services/codex-global-config/status.ts
sed -n '1,260p' ../nightWorkers/api/routes/settings-runtime.ts
sed -n '1,260p' ../nightWorkers/api/routes/settings.ts
sed -n '1,260p' ../nightWorkers/src/modules/nightworkers/types/provider-settings.ts
sed -n '1,760p' ../nightWorkers/src/modules/nightworkers/components/SettingsLlmPanel.tsx
rg -n '@openai/codex-sdk|codex-sdk|codex' package.json api web/src spec ../nightWorkers/package.json ../nightWorkers/api ../nightWorkers/src/modules/nightworkers -g '!node_modules'
rg -n 'class Unconfigured|UnconfiguredProvider|unconfigured' api/providers api/app api/modules
rg -n 'userSettings|findingReviews|scanReviews|llm|provider|review' api/db/schema.ts shared api/modules/reviews api/cli package.json
```

Current vulnWorkbench baseline:

- Settings API is currently limited to `GET/PUT /api/settings/system-context`.
- `api/modules/settings/settings.repository.ts` stores only system context in `user_settings`.
- `web/src/App.tsx` contains a minimal settings UI surface with API health, Knowledge Git, and Agentic Search prompt.
- `api/app/hono.ts` creates one Azure OpenAI provider from env via `createAzureOpenAiProviderFromAppEnv`.
- When Azure env is missing, runtime falls back to `UnconfiguredProvider`; scan/finding foundations still work.
- `api/providers/types.ts` has simple `LlmProvider`, `EmbeddingProvider`, and `StreamingLlmProvider` interfaces.
- `api/modules/reviews/finding-review-runner.ts` receives one injected `LlmProvider` and defaults provider name to `azure-openai`.
- `api/cli/review-finding.ts` rejects every provider except `azure-openai`.
- Agentic Search separately builds `OpenAiResponsesAdapter` from `OPENAI_API_KEY` / `AZURE_OPENAI_API_KEY` / `OPENAI_BASE_URL`.
- `package.json` does not currently depend on `@openai/codex-sdk`.

NightWorkers reference baseline:

- `StructuredLlmProviderEndpoint` supports `azure`, `openai`, `openai-compatible`, `bedrock`, `codex`, and `local`.
- Settings include `providerEndpoints`, per-role `roleRoutes`, primary/fallback targets, model capabilities, enabled flags, and thinking depth.
- Runtime settings are schema validated and secret values are masked on reads.
- Masked secrets are merged server-side on save, so a UI save does not erase stored tokens.
- Provider health checks are separate from actual task execution and use bounded timeout/cache behavior.
- Codex SDK status reads configured token, env token, or `~/.codex/auth.json`, and reads model options from Codex model cache when available.
- Codex SDK calls in NightWorkers are configured with constrained runtime options such as read-only sandbox, no approval, disabled network search, and sanitized environment.
- Role routing resolves primary + fallbacks and fails clearly for missing endpoint, disabled endpoint, or missing model.

## Scope

Implement in this plan:

- DB-backed LLM provider endpoint settings.
- Masked secret read / merge-on-write behavior.
- Provider health API.
- Codex SDK status API.
- OpenAI-compatible provider implementation for OpenAI public API, local-llm, and custom API endpoint.
- Azure provider construction from stored endpoint settings as well as env fallback.
- Optional Codex SDK provider adapter for bounded review tasks.
- LLM task routing model with primary and fallback targets.
- Dedicated Settings UI for provider endpoints and task routing.
- Runtime resolver that routes each LLM task to the configured provider/model.
- Migration path from existing env-only Azure/OpenAI settings.
- Tests and verification gates that do not require live providers.

Do not implement in this plan:

- Autonomous patch generation.
- LLM-controlled scanner execution.
- LLM arbitrary file read.
- LLM browser automation.
- Authenticated DAST credential management.
- Embedding provider routing.
- Bedrock support, unless it is added as a low-cost compatible extension after the core endpoint model is stable.
- Remote team settings sync.
- OS keychain integration.

## Source Baseline Before Implementation

Before implementation starts, confirm:

```bash
git status --short
git diff --check
bun run verify
rg -n 'review:finding|agentic-search|OpenAiResponsesAdapter|createAzureOpenAiProviderFromAppEnv|SettingsRepository|user_settings|finding_reviews' api shared web/src package.json
```

Stop conditions:

- If `bun run verify` is already failing on `main`, record the failure and do not mix unrelated fixes into this work.
- If another active branch already added LLM settings or task routing, switch this plan to hardening/review mode instead of duplicating it.
- If `@openai/codex-sdk` cannot be installed or bundled cleanly, keep Codex endpoint config/status in scope but defer Codex execution adapter behind a disabled feature flag.

## Target Task Model

Use vulnWorkbench task names, not NightWorkers role names. Recommended first set:

```text
finding_review
scan_review
evidence_context
agentic_search
report_summary
```

Task meanings:

- `finding_review`: Phase 3 finding-level review. Uses bounded finding/evidence/source snippet bundle.
- `scan_review`: Phase 13 scan-level review, if present. Uses saved scan/finding/evidence summaries only.
- `evidence_context`: evidence/context synthesis over saved project/scan/finding context.
- `agentic_search`: current agentic-search flow. Must remain bounded by configured tools and max call limits.
- `report_summary`: report explanation, summary, or executive narrative generation from saved report/finding data.

Routing rules:

- Each task has one primary model target and zero or more fallbacks.
- A model target is `{ providerEndpointId, model, thinkingDepth? }`.
- A disabled endpoint is never selected.
- A target whose model is not listed on the endpoint is invalid unless the endpoint explicitly allows custom model names.
- `codex` targets are allowed only for tasks whose policy explicitly permits Codex SDK.
- `finding_review`, `scan_review`, and `report_summary` should default to API/local providers, with Codex as opt-in fallback only.
- `agentic_search` can use OpenAI-compatible endpoints but must not silently use Codex SDK.
- If no valid route exists, the task must fail with `llm_provider_unconfigured` without affecting scan/finding persistence.

Suggested task policy:

```text
finding_review:
  allowProviderKinds: azure, openai, openai-compatible, local, codex
  defaultAllowCodex: false
  requiresStructuredJson: true

scan_review:
  allowProviderKinds: azure, openai, openai-compatible, local, codex
  defaultAllowCodex: false
  requiresStructuredJson: true

evidence_context:
  allowProviderKinds: azure, openai, openai-compatible, local
  defaultAllowCodex: false
  requiresStructuredJson: false

agentic_search:
  allowProviderKinds: openai, openai-compatible, local, azure
  defaultAllowCodex: false
  requiresStructuredJson: false

report_summary:
  allowProviderKinds: azure, openai, openai-compatible, local, codex
  defaultAllowCodex: false
  requiresStructuredJson: true
```

## Data Model

Do not overload `user_settings`. Add dedicated project-level LLM settings tables.

Recommended tables:

```text
llm_provider_endpoints
  id
  name
  kind
  enabled
  base_url
  azure_endpoint
  azure_api_version
  api_key
  auth_source
  models
  model_display_names
  allow_custom_models
  capabilities
  metadata
  created_at
  updated_at

llm_task_routes
  task
  primary_provider_endpoint_id
  primary_model
  primary_thinking_depth
  fallback_targets
  policy
  created_at
  updated_at

llm_provider_health_checks
  id
  provider_endpoint_id
  ok
  reachable
  status
  url
  message
  duration_ms
  checked_at
```

Storage notes:

- This is a local-first SQLite app, so MVP may store provider secrets in SQLite.
- API responses must never return raw `api_key`; return `********` or empty string.
- PUT/PATCH must preserve existing secret when the request sends `********`.
- Reports, artifacts, scan logs, prompt bundles, and workflow JSON must never include raw provider secrets.
- Add `auth_source` to distinguish `stored`, `environment`, `codex-auth-json`, and `none`.
- Future OS keychain integration should be left as a documented extension, not part of this plan.

Endpoint kinds:

```text
azure
openai
openai-compatible
local
codex
```

Field requirements:

- `azure`: `azure_endpoint`, `azure_api_version`, `api_key`, at least one deployment model.
- `openai`: optional `base_url`, `api_key`, model list.
- `openai-compatible`: required `base_url`, optional `api_key`, model list.
- `local`: required `base_url`, optional `api_key`, model list, health may probe `/health` and `/v1/models`.
- `codex`: optional access token, model list from settings/env/`~/.codex/models_cache.json`, no HTTP health URL.

Default seed behavior:

- If Azure env vars exist, create an enabled `azure-env-default` endpoint using env-derived settings with `auth_source=environment`.
- If `OPENAI_API_KEY` exists, create an enabled `openai-env-default` endpoint with `auth_source=environment`.
- Always allow creating a disabled local endpoint template with `base_url=http://127.0.0.1:11434/v1` and model `qwen3-coder`.
- Do not create enabled Codex endpoint unless Codex auth is detected or user enables it explicitly.

## API Contract

Add to existing settings route namespace:

```text
GET  /api/settings/llm
PUT  /api/settings/llm
GET  /api/settings/llm/codex/status
POST /api/settings/llm/provider-endpoints/:id/health
POST /api/settings/llm/smoke
GET  /api/settings/llm/model-options
```

`GET /api/settings/llm` returns:

```json
{
  "providerEndpoints": [],
  "taskRoutes": [],
  "updatedAt": "2026-06-26T00:00:00.000Z"
}
```

Rules:

- GET masks secrets.
- PUT validates the whole settings document strictly.
- PUT merges masked secrets with stored secrets.
- PUT rejects unknown task names and unknown provider kinds.
- PUT rejects duplicate endpoint IDs.
- PUT rejects routes pointing to missing endpoints.
- PUT rejects Codex routes where task policy disallows Codex.
- Health and smoke endpoints must not persist raw request/response bodies.
- Smoke test must be opt-in and bounded; health test should be cheap and safe.

Provider health behavior:

- `azure`: POST a minimal chat completion against the selected deployment with short timeout.
- `openai`: GET `/models` or equivalent with Authorization header.
- `openai-compatible`: prefer GET `/models`; fallback to GET `/health` if configured as local-like.
- `local`: GET `/health` first, then optional GET `/v1/models`.
- `codex`: use status API, not HTTP health.

## Runtime Architecture

Add provider settings and routing modules:

```text
api/modules/llm-settings/
  llm-settings.repository.ts
  llm-settings.schema.ts
  llm-settings-service.ts
  secret-mask.ts
  provider-health.ts
  codex-status.ts

api/providers/
  openAiCompatibleProvider.ts
  codexSdkReviewProvider.ts
  llmProviderFactory.ts
  llmRouter.ts
  llmTaskTypes.ts
```

Core interfaces:

```ts
type LlmTask =
  | "finding_review"
  | "scan_review"
  | "evidence_context"
  | "agentic_search"
  | "report_summary";

type LlmModelTarget = {
  providerEndpointId: string;
  model: string;
  thinkingDepth?: "minimal" | "low" | "medium" | "high";
};

type LlmRouteResolution =
  | { ok: true; task: LlmTask; target: LlmModelTarget; provider: LlmProvider; providerName: string; model: string }
  | { ok: false; task: LlmTask; failureKind: "llm_provider_unconfigured"; message: string };
```

Runtime flow:

```text
task request
  -> LlmRouter.resolve(task)
  -> route policy validation
  -> provider endpoint lookup
  -> provider factory creates adapter
  -> task runner calls provider.chatCompletion(...)
  -> result persists providerEndpointId/providerKind/model
```

Integration points:

- `FindingReviewRunner` should accept `LlmRouter` or a resolved provider target, not a single global provider only.
- `review:finding` CLI should accept `--task finding_review`, `--provider-endpoint-id`, and `--model` override, while defaulting to configured route.
- `api/routes/finding-reviews.route.ts` should resolve task route server-side.
- Agentic Search should read `agentic_search` route, replacing direct env-only `OpenAiResponsesAdapter` construction.
- Embedding provider should remain existing Azure/env path for this plan; do not mix embedding routing into the MVP.
- Existing env-only provider behavior should continue as fallback when no DB LLM settings exist.

Codex SDK adapter requirements:

- Add `@openai/codex-sdk` only when the adapter is implemented.
- Use a narrow adapter that returns text for bounded review prompts.
- Configure Codex SDK with read-only sandbox, approval never, web search disabled, no file writes, and sanitized env.
- Do not expose Codex SDK to scan execution, reproduction, DAST, or sandbox tasks.
- Tests must mock the Codex SDK; no live Codex session in normal verify.

## Frontend UX

Add a dedicated Settings screen rather than expanding the current inline settings block indefinitely.

Recommended structure:

```text
Settings
  System Context
  LLM Providers
  Task Routing
  Provider Health
```

LLM Providers UI:

- Add/edit/remove provider endpoints.
- Provider kind selector: Azure OpenAI, OpenAI, OpenAI-compatible API, Local LLM, Codex SDK.
- Enabled toggle.
- Name field.
- Base URL or Azure endpoint field.
- API version field for Azure.
- API key/token field with masked value and explicit replacement behavior.
- Models editor with add/remove model names.
- Allow custom model names toggle for OpenAI-compatible/local endpoints.
- Health check button per endpoint.
- Health result badge with last checked time.
- Codex SDK status panel showing auth source, Codex home, model source, and detected models.

Task Routing UI:

- Row per task: finding review, scan review, evidence context, agentic search, report summary.
- Primary model select populated from enabled endpoints and model lists.
- Fallback model selector with ordered fallback list.
- Thinking depth selector only where provider kind supports it.
- Inline validation for disabled endpoints, missing models, and disallowed Codex routes.
- Save button disabled while schema errors exist.

UX constraints:

- Do not display provider secrets after save.
- Do not run smoke prompts automatically on page load.
- Do not make live network calls from the browser directly; all provider checks go through API.
- Preserve existing System Context setting and move it into the new settings layout without changing behavior.

## CLI Contract

Update `review:finding`:

```bash
bun run review:finding -- \
  --finding-id <finding-id>
```

Optional overrides:

```text
--task finding_review
--provider-endpoint-id <id>
--provider <legacy-provider-name>
--model <model>
--fixture-output <path>
--max-snippet-lines <number>
```

Rules:

- Default path resolves the configured `finding_review` route.
- `--provider-endpoint-id` and `--model` override routing for one run.
- `--provider azure-openai` remains a compatibility alias during migration.
- Unsupported provider should become a typed route resolution error, not a hardcoded Azure-only branch.
- stdout remains JSON only.
- Fixture output bypasses live provider exactly as current tests expect.

If `review:scan` exists when this plan is implemented, apply the same routing shape to it.

## Migration Strategy

Implementation order should avoid breaking existing review behavior.

1. Add schema/types/tests for provider endpoints, masked secrets, and task routes.
2. Add DB tables and repository.
3. Seed settings from env when DB settings are empty.
4. Add read/write settings API with masked secret merge.
5. Add provider factory for Azure and OpenAI-compatible endpoints.
6. Add router resolution without changing existing callers.
7. Wire `review:finding` through router, preserving Azure env fallback.
8. Wire API finding review route through router.
9. Wire Agentic Search through router, preserving env fallback.
10. Add Codex SDK status UI/API.
11. Add Codex SDK adapter only after status/config path is tested.
12. Add Settings UI panels.
13. Update README and specs.

Compatibility requirements:

- Existing `.env` Azure setup must still allow `review:finding` to work before the user opens settings.
- Existing system context settings must not be migrated or lost.
- Existing `finding_reviews.provider` and `finding_reviews.model` should remain valid. New runs may store endpoint id in `output`/metadata or add nullable columns in a separate migration.
- Tests that rely on fixture provider should not need live API keys.

## Verification Plan

Focused tests:

```bash
bun test ./api/modules/llm-settings/**/*.test.ts
bun test ./api/providers/**/*.test.ts
bun test ./api/routes/settings.route.test.ts
bun test ./api/modules/reviews/*.test.ts ./api/modules/reviews/**/*.test.ts
bunx vitest run web/src
```

Repo gate:

```bash
git diff --check
bun run verify
```

Test coverage targets:

- Secret masking and masked-secret merge.
- Strict schema rejection for unknown provider kinds/tasks.
- Route resolution primary/fallback behavior.
- Disabled endpoint rejection.
- Missing model rejection.
- Codex disallowed task rejection.
- Env seed behavior for Azure/OpenAI.
- OpenAI-compatible request construction.
- Local endpoint health URL construction.
- Codex status from missing auth, env token, and auth.json fixtures.
- `review:finding` fixture output still succeeds without live provider.
- `review:finding` no configured provider returns `llm_provider_unconfigured`.
- Settings UI can add endpoint, mask secret, save route, and display validation errors.

Manual optional checks, not required for normal verify:

```bash
# local-llm, if daemon is running
curl http://127.0.0.1:11434/health
curl http://127.0.0.1:11434/v1/models

# configured provider smoke from UI or API
POST /api/settings/llm/smoke
```

## Implementation Milestones

### Milestone 1: Settings Schema and Persistence

Deliver:

- Shared/server schemas for endpoint settings and task routes.
- DB migration for LLM settings tables.
- Repository with masked read and merge-on-write.
- Env seed logic.
- Unit tests.

Done when:

- Invalid settings fail strictly.
- GET never returns raw secret values.
- `********` preserves stored secret on PUT.
- Existing system context tests still pass.

### Milestone 2: Provider Factory and Health Checks

Deliver:

- OpenAI-compatible provider.
- Azure provider factory from endpoint settings.
- Local endpoint health checks.
- Provider health cache with short timeout.
- Codex status reader.

Done when:

- Health checks are mock-tested with no live network.
- OpenAI-compatible/local URL normalization is deterministic.
- Codex status works without requiring `@openai/codex-sdk`.

### Milestone 3: Task Router

Deliver:

- `LlmRouter`.
- Task policy map.
- Primary/fallback resolution.
- Typed unconfigured failure.

Done when:

- Router unit tests cover missing/disabled endpoint, missing model, fallback selection, and Codex policy.
- Existing Azure env fallback still resolves for `finding_review`.

### Milestone 4: Review Runner Integration

Deliver:

- `FindingReviewRunner` route-aware provider resolution.
- CLI compatibility update.
- Finding review API update.
- Stored review records include provider endpoint/model metadata.

Done when:

- Fixture review tests pass.
- Azure-only hardcoded CLI rejection is removed.
- Provider absence fails only review command/API.

### Milestone 5: Agentic Search Integration

Deliver:

- Agentic Search resolves `agentic_search` route.
- Existing env-based behavior preserved as fallback.
- OpenAI-compatible/local route can be used for agentic prompt calls when configured.

Done when:

- Agentic Search tests do not require live provider.
- Route misconfiguration returns a clear API error.
- Existing max tool/fetch/context limits remain enforced.

### Milestone 6: Settings UI

Deliver:

- Dedicated settings layout.
- LLM Providers panel.
- Task Routing panel.
- Codex status panel.
- Health check interactions.

Done when:

- UI preserves masked secrets.
- UI cannot save invalid routes.
- UI does not issue live provider calls except explicit health/smoke actions.
- System Context remains editable.

### Milestone 7: Codex SDK Adapter

Deliver:

- Optional `@openai/codex-sdk` dependency.
- Review-only Codex adapter.
- Mocked tests.
- Runtime guardrails for read-only/no approval/no web search/sanitized env.

Done when:

- Normal verify does not need Codex login.
- Codex route can be configured but is selected only for allowed tasks.
- Codex adapter cannot be used by scanner/sandbox/DAST runners.

### Milestone 8: Documentation and Final Hardening

Deliver:

- README update for provider settings, env fallback, local-llm, Codex SDK, and task routing.
- Spec update if Phase 13 scan review is present.
- Failure-kind documentation.
- Final verification.

Done when:

- `git diff --check` passes.
- `bun run verify` passes.
- README explains that live provider checks are optional manual steps.

## Risks and Controls

Secret leakage:

- Control with masked GET responses, merge-on-write, prompt bundle redaction, and tests that inspect serialized artifacts/logs.

Provider misrouting:

- Control with strict task policy, route validation, and explicit fallback resolution tests.

Codex SDK overreach:

- Control with route allowlist, read-only SDK options, no automatic task eligibility, and no integration with scan execution.

Local endpoint drift:

- Control by treating local-llm as OpenAI-compatible plus optional `/health` probe. Do not assume a daemon is running in verify.

Regression of existing Azure env behavior:

- Control with env seed/fallback tests and compatibility aliases in CLI.

Settings UI complexity:

- Control by splitting System Context, Providers, Routing, and Health into separate panels and keeping validation server-authoritative.

## Open Decisions for Implementation Start

Resolve these at implementation kickoff:

- Whether to store raw provider secrets in SQLite for MVP or add a local file/keychain-backed secret store immediately.
- Whether `scan_review` is present in the current branch; if not, route definition can exist disabled until Phase 13 implementation lands.
- Whether Codex SDK execution should be included in the first implementation batch or limited to status/configuration until the provider/router path is stable.
- Whether local-llm default base URL should be `http://127.0.0.1:11434/v1` or another project-specific default from the local daemon currently in use.
