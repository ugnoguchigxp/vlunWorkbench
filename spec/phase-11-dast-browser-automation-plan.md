# Phase 11: DAST and Browser Automation Implementation Plan

## Purpose

この計画は、vulnWorkbench の Phase 11 として、Web application 向けの bounded DAST / browser automation 診断を追加するためのもの。

Phase 11 の目的は、静的 scan、sandbox reproduction、dynamic test / sanitizer / fuzzing では観測できない HTTP response / browser runtime / configured route の証拠を、CLI 実行と保存済み artifact / evidence として扱えるようにすること。

重要な責務境界:

- heavy DAST work は CLI に委譲する。
- API route は DAST runner や browser automation を直接実行しない。API は `scan:dast` CLI への argv bridge に限定する。
- LLM は DAST の探索主体ではない。LLM は保存済み DAST artifact / evidence を後段でレビューするだけで、target URL、crawler 範囲、payload を自由生成しない。
- target は project config で明示許可された origin / path に限定する。
- external target への無制限 scan は実装しない。
- destructive payload、credential stuffing、auth session recording は実装しない。
- DAST 実行環境へ LLM API key、host secret、Docker socket を渡さない。

## Source Baseline

前提実装:

- Phase 8 Docker toolbox runner が存在する。
- Phase 9 reproduction schema / repository / artifact / evidence の実装が存在する。
- Phase 10 dynamic verification schema / repository / artifact / evidence の実装が存在する。
- `findings.scan_run_id` は non-null で、finding は必ず scan run に紐づく。
- scan artifact / reproduction artifact / dynamic artifact の保存パターンが存在する。
- API は heavy work を CLI bridge 経由で実行する方針になっている。
- Finding detail UI に evidence / artifact / review / decision / reproduction / dynamic verification を表示する導線がある。

実装前に確認する baseline:

```bash
git status --short
git diff --check
bun run verify
rg -n "reproduction|dynamic|artifact|scan:profile|scan:dast" package.json api shared web/src spec
```

確認すること:

- Phase 9 / Phase 10 実装が未コミットの場合は、Phase 11 の変更と混ぜて壊さない。
- Phase 11 は `reproduction_runs` や `dynamic_runs` を拡張しない。DAST は dedicated `dast_*` model として実装する。
- DAST finding を既存 `findings` に保存する場合は、必ず `scan_runs` に紐づける。`findings.scan_run_id` を nullable にしない。
- 通常 `bun run verify` は Docker daemon、DAST image build、browser binary download、live dev server を要求しない。
- Browser / Docker smoke は opt-in verification として分離する。

## Scope

Phase 11 で実装するもの。

- DAST target config schema / migration
- DAST run DB schema / migration
- DAST artifact DB schema / migration
- DAST evidence DB schema / migration
- DAST target validator
- DAST profile registry / validator
- low-rate HTTP baseline runner
- configured-route browser smoke runner
- optional configured-form baseline runner
- DAST artifact storage helper
- DAST findings normalizer
- `scan:dast` CLI
- DAST API routes with CLI bridge
- project / scan / finding UI の DAST panel
- mocked HTTP / browser / Docker tests so normal verify does not require a live browser or Docker
- opt-in local DAST smoke documentation

Phase 11 で実装しないもの。

- arbitrary internet target scan
- wildcard domain scan
- recursive high-rate crawler
- authenticated session recording
- credential stuffing
- destructive payload
- active exploit generation
- SQL injection payload campaign
- XSS payload campaign
- long-running browser crawling
- external dependency install in target app
- Docker socket passthrough
- privileged container
- target repo modification
- CI 必須化
- SaaS multi-tenant operation

## Definition of Done

Phase 11 は、次を満たしたら完了とする。

- Project owner が明示許可した DAST target だけを実行できる。
- `scan:dast` CLI から project ID、target ID、profile ID を指定して bounded DAST run を実行できる。
- API は DAST runner を直接呼ばず、CLI bridge を通す。
- DAST run は `scan_runs` に紐づき、DAST finding は既存 `findings` / `finding_evidence` に保存できる。
- unauthorized origin、wildcard origin、public internet target、metadata service address、URL credentials が拒否される。
- HTTP baseline result が artifact / evidence として保存される。
- Browser smoke が configured route だけを開き、console / network / screenshot / raw result artifact を保存する。
- Optional crawler は disabled by default で、使う場合も same-origin / max depth / max requests / path allowlist で制限される。
- Rate limit / timeout / max requests が効く。
- DAST failure は既存 scan / finding / review / decision / reproduction / dynamic / report を壊さない。
- Screenshot artifact は保存できるが、LLM input にはデフォルトで含めない。
- 通常 `bun run verify` は Docker daemon / browser install / live target なしで通る。
- `git diff --check` が通る。

## DAST Run Model

Phase 11 は dedicated `dast_runs` を追加する。Phase 9 の `reproduction_runs` は finding-scoped bounded recheck、Phase 10 の `dynamic_runs` は test / sanitizer / fuzzing として残し、HTTP / browser automation へ無理に流用しない。

基本フロー:

```text
project
  -> allowed DAST target config
  -> DAST profile selection
  -> target validation
  -> scan_runs row for DAST execution
  -> scan:dast CLI
  -> HTTP / browser runner
  -> DAST artifacts
  -> DAST evidence
  -> optional DAST findings
  -> UI / human review / report
```

DAST kind:

```text
http
browser
form
```

Status:

```text
queued
running
completed
failed
timed_out
cancelled
```

Outcome:

```text
passed
findings
failed
timed_out
inconclusive
error
```

Rules:

- `status=completed` means the runner completed and artifacts were persisted.
- `outcome=findings` means the runner found one or more DAST findings.
- `outcome=passed` means no configured checks produced findings.
- `status=failed` and `outcome=error` means infrastructure, validation, artifact persistence, or runner setup failed.
- Timeout must be represented as `status=timed_out`, `outcome=timed_out`.
- A browser console error is not automatically infrastructure failure. It is DAST evidence and may become a finding depending on profile rules.

## Target Config Model

Use dedicated project DAST target config instead of request-time arbitrary URL submission.

Recommended table:

```text
dast_target_configs
  id
  project_id
  name
  origin
  normalized_origin
  enabled
  allow_loopback
  allow_private_network
  allowed_paths_json
  excluded_paths_json
  default_headers_json
  max_depth
  max_requests
  rate_limit_per_sec
  timeout_sec
  metadata
  created_by_user_id
  created_at
  updated_at
```

Rules:

- `origin` is user-provided display/config input.
- `normalized_origin` is generated by URL normalization and used for execution.
- Scheme must be `http` or `https`.
- URL must not contain username, password, query, or fragment.
- Host must not be wildcard.
- Default allowed target is loopback only: `localhost`, `127.0.0.1`, `[::1]`.
- Private network targets require explicit `allow_private_network=true`.
- Public internet targets are rejected in Phase 11.
- `allowed_paths_json` is an array of path prefixes, default `["/"]`.
- `excluded_paths_json` must include a safe default for destructive or noisy paths if project config has them.
- `default_headers_json` must not include `Authorization`, `Cookie`, or arbitrary secret-bearing headers in Phase 11.
- `max_depth` defaults to `0`.
- `max_requests` defaults to a low bound, for example `20`.
- `rate_limit_per_sec` defaults to a low bound, for example `2`.
- `timeout_sec` must be positive and bounded by a global max, for example `120`.

## Target Validation Contract

Target validation must run before any HTTP request or browser launch.

Validation input:

```text
project_id
target_config_id
optional requested_path
optional profile_id
```

Validation output:

```text
{
  ok: true,
  targetConfigId,
  normalizedOrigin,
  runnerOrigin,
  allowedPaths,
  excludedPaths,
  maxDepth,
  maxRequests,
  rateLimitPerSec,
  timeoutSec,
  resolvedAddresses,
  warnings
}
```

Rejection cases:

```text
unsupported_scheme
url_credentials_rejected
url_query_or_fragment_rejected
wildcard_host_rejected
public_internet_target_rejected
private_network_target_not_allowed
metadata_service_target_rejected
localhost_alias_not_allowed
path_out_of_scope
target_disabled
profile_disabled
```

Address rules:

- Resolve host before execution when host is not a literal loopback IP.
- Every resolved address must be in an allowed range.
- Reject metadata service and link-local targets, including `169.254.169.254`, `169.254.0.0/16`, IPv6 link-local, and IPv4-mapped variants.
- Reject redirects that leave `normalizedOrigin` or configured path scope.
- Store resolved address metadata in `dast_runs.metadata` for audit.

Docker runner origin rules:

- User-visible target origin and runner target origin may differ when browser runs in Docker.
- `http://127.0.0.1:<port>` and `http://localhost:<port>` may map to `http://host.docker.internal:<port>` only after loopback validation succeeds.
- This mapping must be explicit in code and recorded in run metadata.
- If the platform cannot reach `host.docker.internal`, fail with `dast_target_unreachable`, not by broadening scope.

## DAST Profile Model

Profiles are registry-defined. Requests may select an enabled profile but may not submit arbitrary checks or payloads.

Built-in profiles:

```text
http-baseline
  kind: http
  checks:
    - reachability
    - status code class
    - security headers
    - cookie flags from Set-Cookie
    - CORS wildcard on simple request
    - configured common path probes
  crawler: disabled

browser-smoke
  kind: browser
  checks:
    - load configured routes
    - console error capture
    - failed network request capture
    - screenshot capture
    - final URL scope validation
  crawler: disabled

form-baseline
  kind: form
  checks:
    - configured forms only
    - empty submit prevention observations
    - client-side validation observations
  crawler: disabled
  destructive payloads: disabled
```

Optional profile config table:

```text
dast_profile_configs
  id
  project_id
  profile_id
  display_name
  enabled
  target_config_id
  route_paths_json
  form_selectors_json
  check_options_json
  timeout_sec
  max_requests
  metadata
  created_by_user_id
  created_at
  updated_at
```

Rules:

- `http-baseline` can run with target config alone.
- `browser-smoke` must use configured route paths. It must not auto-discover broad routes by default.
- `form-baseline` must use configured form selectors and must remain non-destructive.
- Request-time route / selector override is rejected in Phase 11.
- Profile config may narrow target config scope but must not broaden it.

## HTTP Baseline Checks

Minimum HTTP runner behavior:

```text
1. Validate target config.
2. Request normalized origin and configured route paths.
3. Follow redirects only inside allowed origin and path scope.
4. Apply rate limit and max requests.
5. Record response metadata, selected headers, status code, redirect chain, and timing.
6. Save raw result JSON, HTTP log, stdout, stderr, and summary artifacts.
7. Normalize deterministic findings.
```

Minimum findings:

```text
missing-security-header
weak-cookie-flags
cors-wildcard
unexpected-server-error
sensitive-common-path-exposed
redirect-out-of-scope-blocked
```

Header handling:

- Store selected response headers needed for evidence.
- Redact `Set-Cookie` values but keep cookie names and security attributes.
- Redact header values that look like secrets.
- Do not store request `Authorization` or `Cookie` headers in Phase 11.

Common path probes:

- Must be low-rate and bounded.
- Must be same-origin.
- Must be from a fixed registry, not LLM-generated.
- Must be disabled or limited by project config if too noisy.
- Examples may include `/.env`, `/openapi.json`, `/swagger.json`, `/debug`, but the implementation must treat them as bounded probes with clear evidence titles.

## Browser Automation Runner

Browser automation must be CLI-runner owned and bounded by target config.

Recommended execution:

```text
scan:dast CLI
  -> target validation
  -> browser runner adapter
  -> Playwright-compatible browser execution
  -> route artifacts
  -> summary artifacts
```

Browser dependency policy:

- Prefer a dedicated DAST browser image for browser smoke execution.
- Add `docker/dast/Dockerfile` and `scripts/build-dast-image.ts` only if the implementation uses Docker for browser execution.
- Add package script:

```json
{
  "docker:dast:build": "bun run scripts/build-dast-image.ts"
}
```

- Default browser image name should be `vuln-workbench-dast:local`.
- Normal `bun run verify` must not build the image or download browsers.
- Browser smoke tests in normal verify must mock browser execution.
- Opt-in live browser smoke must be documented separately.

Browser run rules:

- Open only configured route paths.
- Block navigation outside allowed origin.
- Block or record out-of-scope subresource requests according to profile rules.
- Capture console errors, page errors, failed requests, final URL, response status, timing, and screenshot.
- Use deterministic route order.
- Apply timeout per route and total timeout.
- Do not record user credentials or interactive login in Phase 11.
- Do not execute generated exploit payloads.

Screenshot rules:

- Save screenshot artifact for configured routes.
- Treat screenshots as sensitive local artifacts.
- Do not include screenshot bytes in LLM review input by default.
- UI may display screenshots only from the artifact endpoint after ownership checks.

## Data Model

Add dedicated DAST tables. Do not overload `dynamic_*` tables.

Recommended tables:

```text
dast_target_configs
  id
  project_id
  name
  origin
  normalized_origin
  enabled
  allow_loopback
  allow_private_network
  allowed_paths_json
  excluded_paths_json
  default_headers_json
  max_depth
  max_requests
  rate_limit_per_sec
  timeout_sec
  metadata
  created_by_user_id
  created_at
  updated_at

dast_profile_configs
  id
  project_id
  target_config_id
  profile_id
  display_name
  enabled
  route_paths_json
  form_selectors_json
  check_options_json
  timeout_sec
  max_requests
  metadata
  created_by_user_id
  created_at
  updated_at

dast_runs
  id
  project_id
  scan_run_id
  target_config_id
  profile_config_id
  profile_id
  dast_kind
  target_origin
  runner_origin
  status
  outcome
  started_at
  completed_at
  summary
  error_message
  metadata
  created_by_user_id
  created_at
  updated_at

dast_artifacts
  id
  dast_run_id
  project_id
  scan_run_id
  kind
  format
  path
  sha256
  size_bytes
  metadata
  created_at

dast_evidence
  id
  dast_run_id
  project_id
  scan_run_id
  finding_id
  kind
  title
  artifact_id
  location
  snippet
  metadata
  created_at
```

Schema rules:

- `dast_runs.scan_run_id` should be non-null.
- `dast_artifacts.scan_run_id` should be non-null.
- `dast_evidence.scan_run_id` should be non-null.
- `dast_evidence.finding_id` may be null for run-level evidence.
- DAST findings use existing `findings` with `sourceTool` values such as `dast-http` or `dast-browser`.
- DAST findings must use existing severity / confidence / status model.
- DAST evidence that supports a finding should be duplicated or linked through `finding_evidence` as needed for existing review / decision / report flows.

Migration:

```text
drizzle/0008_dast.sql
```

If the next migration number differs because Phase 10 changes have moved, use the next generated Drizzle migration number. Do not hand-edit older migrations.

## Shared Schema Contract

Add shared schemas:

```text
shared/schemas/dast.schema.ts
```

Minimum exports:

```text
dastKindSchema
dastRunStatusSchema
dastOutcomeSchema
dastTargetConfigSchema
dastProfileConfigSchema
dastRunSchema
dastArtifactKindSchema
dastArtifactSchema
dastEvidenceKindSchema
saveDastTargetRequestSchema
saveDastProfileRequestSchema
runDastRequestSchema
```

Request rules:

- `saveDastTargetRequestSchema` accepts display config only. It must validate shape but final SSRF / network validation remains server-side.
- `runDastRequestSchema` accepts `targetConfigId`, `profileId`, optional `profileConfigId`, optional `scanRunId`, and bounded resource overrides.
- Request body must not accept arbitrary URL when launching a run.
- Request body must not accept arbitrary route paths when launching a run.

## Artifact Storage Contract

Add DAST artifact storage helper:

```text
api/modules/dast/dast-artifact-storage.ts
```

Default root:

```text
artifacts/dast/<dastRunId>/
```

Artifact kinds:

```text
raw_result
http_log
browser_console
browser_network
screenshot
stdout
stderr
summary
```

Formats:

```text
json
text
png
markdown
```

Rules:

- All writes must validate that the final path remains inside the DAST run directory.
- Text artifacts must be redacted before persistence when possible.
- Binary screenshot artifacts may be persisted but are not sent to LLM by default.
- Artifact rows must include sha256 and size bytes.
- Artifact read routes must confirm project ownership before returning content.
- JSON artifacts may be returned as JSON; screenshots should return correct `Content-Type`.

## Findings Normalizer

Add deterministic normalizer:

```text
api/modules/dast/dast-normalizer.ts
```

Normalizer input:

```text
dastRun
targetConfig
profile
rawResultJson
artifactIds
```

Normalizer output:

```text
findings[]
findingEvidence[]
dastEvidence[]
summary
```

Rules:

- LLM must not participate in normalization.
- Findings require stable fingerprint generation.
- Fingerprint should include project ID, normalized origin, profile ID, check ID, route path, and stable evidence key.
- DAST findings should be low confidence by default unless evidence is strong and deterministic.
- Missing security headers should not be over-severitized. Use `info` or `low` unless profile rules justify higher severity.
- Browser console errors should be evidence first; only deterministic security-relevant patterns become findings.
- Out-of-scope redirect blocking should be evidence and run warning, not necessarily a vulnerability finding.

## CLI Contract

Add package script:

```json
{
  "scan:dast": "bun run api/cli/scan-dast.ts"
}
```

Command shape:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile http-baseline
```

Optional:

```text
--profile-config-id <profile-config-id>
--scan-run-id <scan-run-id>
--runner docker
--docker-image vuln-workbench-dast:local
--timeout-sec <seconds>
--max-requests <count>
--dry-run true
```

Required behavior:

- stdout is JSON only.
- stderr is for diagnostics only and must not be required for normal parsing.
- If `--scan-run-id` is not supplied, CLI creates a `scan_runs` row with profile `dast:<profileId>`.
- If target validation fails, do not start HTTP/browser execution.
- If `--dry-run true`, validate target/profile and print planned execution without making network requests or creating findings.
- Persist DAST run even when HTTP/browser execution fails after validation.
- Persist artifacts before creating findings when possible.
- Return 0 when the run completed and persisted, even if findings exist.
- Return non-zero when validation, setup, or persistence failed before a usable run result exists.

Success JSON:

```json
{
  "ok": true,
  "dastRunId": "uuid",
  "scanRunId": "uuid",
  "status": "completed",
  "outcome": "findings",
  "targetConfigId": "uuid",
  "profileId": "http-baseline",
  "artifactIds": ["uuid"],
  "findingIds": ["uuid"],
  "evidenceIds": ["uuid"],
  "summary": "DAST run completed with 2 findings."
}
```

Failure JSON:

```json
{
  "ok": false,
  "dastRunId": "uuid-or-null",
  "scanRunId": "uuid-or-null",
  "status": "failed",
  "outcome": "error",
  "failureKind": "target_validation_failed",
  "message": "public internet target is not allowed in Phase 11"
}
```

## API Contract

Add route module:

```text
api/routes/dast.route.ts
```

Register it in:

```text
api/app/hono.ts
```

Routes:

```text
GET    /api/projects/:projectId/dast-targets
POST   /api/projects/:projectId/dast-targets
PATCH  /api/projects/:projectId/dast-targets/:targetConfigId

GET    /api/projects/:projectId/dast-profiles
POST   /api/projects/:projectId/dast-profiles
PATCH  /api/projects/:projectId/dast-profiles/:profileConfigId

GET    /api/projects/:projectId/dast-runs
POST   /api/projects/:projectId/dast-runs
GET    /api/dast-runs/:dastRunId
GET    /api/dast-runs/:dastRunId/artifacts
GET    /api/dast-runs/:dastRunId/artifacts/:artifactId
```

Required behavior:

- Every route checks project ownership.
- Target/profile writes validate request schemas.
- Run route validates target/profile before launching CLI.
- Run route constructs argv array itself and does not pass request body through as shell string.
- Run route uses `Bun.spawn(["bun", "run", "api/cli/scan-dast.ts", "--", ...])` or equivalent argv array.
- Run route parses stdout JSON only.
- If CLI creates a failed persisted run, API returns 200 with run result.
- If CLI fails before creating a run, API returns a typed 400 or 500.
- Artifact endpoint checks run ownership and artifact membership before reading a file.

Do not add:

- A route that accepts arbitrary URL at run time.
- A route that accepts arbitrary browser script.
- A route that streams browser interaction to the user.
- A route that records credentials.

## Frontend Scope

Add DAST surfaces without merging DAST evidence into LLM review text by default.

Project detail:

- DAST Targets section.
- Add/edit local target origin.
- Show validation status and scope.
- Show explicit warning for private network targets.
- Disable public internet targets.

Scan/finding detail:

- DAST Runs panel.
- Run profile selector.
- Target selector.
- Run status / outcome.
- Artifact list for HTTP log, browser console, network log, screenshot, raw result.
- DAST findings integrated into existing findings list through `sourceTool=dast-http|dast-browser`.

UI rules:

- Display target scope before run.
- Browser screenshot artifacts are viewed through artifact endpoint only.
- Do not send screenshot content to LLM review automatically.
- Do not show a free-form URL run box.
- Do not show browser script editor.
- Keep DAST evidence visually separate from static evidence, reproduction evidence, dynamic evidence, LLM review, and human decision.

## Implementation Steps

### P0: Baseline Inspection

Run:

```bash
git status --short
git diff --check
bun run verify
rg -n "dynamicRuns|reproductionRuns|scanArtifacts|findingEvidences|scan:profile|repro:finding|dynamic:run" api shared web/src package.json
```

Review:

- Current migration number.
- Existing artifact storage path validation helpers.
- Existing route ownership checks.
- Existing CLI stdout JSON pattern.
- Existing finding normalizer and report behavior.

Completion criteria:

- DAST model is confirmed to be separate from reproduction / dynamic model.
- Next migration number is known.
- Normal verify baseline is recorded.

### P1: Shared Schema and DB Migration

Implement:

- `shared/schemas/dast.schema.ts`
- `dast_target_configs`
- `dast_profile_configs`
- `dast_runs`
- `dast_artifacts`
- `dast_evidence`
- Drizzle migration

Completion criteria:

- Schema exports compile.
- Migration applies locally.
- Repository tests can insert/list target configs, profile configs, runs, artifacts, and evidence.

Verification:

```bash
bun run typecheck
bun test ./api/modules/dast/*.test.ts
```

### P2: Target Validator

Implement:

- `api/modules/dast/target-validator.ts`
- URL normalization.
- loopback / private / metadata service validation.
- path scope validation.
- redirect scope helper.
- Docker runner origin mapping helper.

Completion criteria:

- Unauthorized origin is rejected before any network request.
- Loopback target is accepted.
- Public internet target is rejected.
- Private network target is rejected unless explicitly enabled.
- URL credentials are rejected.
- Metadata service IPs are rejected.
- Out-of-scope path is rejected.

Verification:

```bash
bun test ./api/modules/dast/target-validator.test.ts
```

### P3: DAST Repository and Artifact Storage

Implement:

- `api/modules/dast/dast-repository.ts`
- `api/modules/dast/dast-artifact-storage.ts`
- path traversal tests
- redaction helper reuse where applicable

Completion criteria:

- DAST run lifecycle can be persisted.
- Text, JSON, and PNG artifact metadata can be stored.
- Artifact read prevents path traversal.
- Evidence can be attached to run-level and finding-level records.

Verification:

```bash
bun test ./api/modules/dast/dast-repository.test.ts ./api/modules/dast/dast-artifact-storage.test.ts
```

### P4: Profile Registry

Implement:

- `api/modules/dast/profiles.ts`
- profile definitions for `http-baseline`, `browser-smoke`, `form-baseline`
- profile config validation
- route path narrowing
- form selector validation

Completion criteria:

- Built-in profiles list deterministically.
- Disabled profile cannot run.
- Profile config cannot broaden target config scope.
- `form-baseline` cannot run without configured forms.

Verification:

```bash
bun test ./api/modules/dast/profiles.test.ts
```

### P5: HTTP Baseline Runner

Implement:

- `api/modules/dast/http-runner.ts`
- bounded fetch adapter
- response metadata capture
- redirect blocking
- rate limiting
- timeout
- raw result artifact generation

Completion criteria:

- Mock HTTP server test produces raw result / http log / summary artifacts.
- Redirect out of scope is blocked and recorded.
- Rate limit and max requests are enforced.
- Security header and cookie findings are deterministic.

Verification:

```bash
bun test ./api/modules/dast/http-runner.test.ts
```

### P6: Browser Smoke Runner

Implement:

- `api/modules/dast/browser-runner.ts`
- browser adapter interface
- mocked browser adapter for normal tests
- optional Playwright/Docker adapter behind runtime boundary
- screenshot artifact persistence
- console and network artifact persistence

Completion criteria:

- Normal tests use mocked browser adapter.
- Configured route list is the only navigation source.
- Out-of-scope navigation is blocked or marked failed.
- Screenshot artifact row is created for each successful configured route.
- Browser setup failure becomes `status=failed`, `outcome=error`, `failureKind=browser_unavailable`.

Verification:

```bash
bun test ./api/modules/dast/browser-runner.test.ts
```

Opt-in smoke, only when target and browser image are available:

```bash
bun run docker:dast:build
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile browser-smoke \
  --runner docker \
  --docker-image vuln-workbench-dast:local
```

### P7: DAST Normalizer

Implement:

- `api/modules/dast/dast-normalizer.ts`
- deterministic DAST finding creation
- finding evidence creation
- DAST evidence creation
- stable fingerprint generation

Completion criteria:

- HTTP baseline findings are saved to existing `findings`.
- Browser evidence is saved without over-producing findings.
- Existing finding review / decision / report flows can see DAST findings through existing APIs.
- Normalizer does not call LLM.

Verification:

```bash
bun test ./api/modules/dast/dast-normalizer.test.ts
```

### P8: CLI

Implement:

- `api/cli/scan-dast.ts`
- package script `scan:dast`
- dry-run behavior
- stdout JSON-only behavior
- scan run creation when `--scan-run-id` is absent

Completion criteria:

- Dry-run validates target/profile without network execution.
- Unauthorized target returns JSON failure.
- Authorized local target can run `http-baseline`.
- Failed browser setup is persisted as run failure when validation already succeeded.

Verification:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile http-baseline \
  --dry-run true
```

### P9: API Routes

Implement:

- `api/routes/dast.route.ts`
- route registration
- route tests
- CLI bridge tests with mocked `Bun.spawn`

Completion criteria:

- Project ownership is enforced.
- Target/profile CRUD works through schema validation.
- Run route launches CLI through argv array.
- Run route never accepts arbitrary URL or script body.
- Artifact route enforces run ownership and artifact membership.

Verification:

```bash
bun test ./api/routes/dast.route.test.ts
```

### P10: Frontend

Implement:

- API client additions in `web/src/api.ts`.
- DAST target/profile/run types.
- DAST Targets panel.
- DAST Runs panel.
- Artifact list / screenshot rendering.
- Clear status / outcome / failure messages.

Completion criteria:

- User can configure a local target.
- User can run `http-baseline` from UI.
- User can inspect DAST artifacts.
- DAST findings appear in existing finding list/detail.
- UI does not expose free-form target execution.

Verification:

```bash
bun run typecheck
bun run build:web
```

### P11: Full Verification

Run:

```bash
git diff --check
bun run test
bun run typecheck
bun run build:web
bun run verify
```

Optional local smoke:

```bash
# terminal 1
bun run dev

# terminal 2
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile http-baseline
```

Completion criteria:

- Normal verification passes without Docker/browser/live target.
- Opt-in smoke either passes or fails with a scoped, typed environmental failure.
- Worktree contains no unrelated formatting churn.

## Verification Matrix

Target validation:

```bash
bun test ./api/modules/dast/target-validator.test.ts
```

Expected:

- Loopback accepted.
- Public internet target rejected.
- Metadata service rejected.
- URL credentials rejected.
- Path out of scope rejected.

Repository/storage:

```bash
bun test ./api/modules/dast/dast-repository.test.ts ./api/modules/dast/dast-artifact-storage.test.ts
```

Expected:

- Runs, artifacts, evidence persist.
- Path traversal fails.
- Artifact metadata includes sha256 and size.

Runner:

```bash
bun test ./api/modules/dast/http-runner.test.ts ./api/modules/dast/browser-runner.test.ts
```

Expected:

- HTTP artifacts are produced from mock server.
- Browser artifacts are produced from mock adapter.
- Timeout / redirect / max request failures are represented as DAST results.

API:

```bash
bun test ./api/routes/dast.route.test.ts
```

Expected:

- Ownership checks pass/fail correctly.
- CLI bridge uses argv array.
- Persisted failed run returns a run result.
- Pre-run validation failure returns typed error.

Full:

```bash
git diff --check
bun run verify
```

Expected:

- Verification passes without requiring Docker daemon, DAST image, browser install, or live target.

## Failure Handling

Use distinct failure kinds. Do not collapse them into generic DAST failure.

```text
target_validation_failed
target_unreachable
target_redirect_out_of_scope
profile_not_found
profile_disabled
browser_unavailable
browser_timeout
http_timeout
max_requests_exceeded
artifact_write_failed
normalizer_failed
cli_bridge_parse_failed
docker_unavailable
runner_failed
```

Rules:

- Validation failure before run creation may return no run ID.
- Failure after run creation must update `dast_runs` with status / outcome / error message.
- Artifact write failure after partial execution must fail the run with `outcome=error`.
- Browser unavailable must not fail normal verify.
- DAST failure must not change existing scan / review / decision / reproduction / dynamic records except through explicit linked DAST records.

## Security Requirements

- No free-form target execution.
- No wildcard domain.
- No public internet target in Phase 11.
- No credential capture.
- No auth session recording.
- No generated attack payload.
- No Docker socket mount.
- No privileged browser container.
- No LLM API key in runner environment.
- No host secret in runner environment.
- No screenshot content in LLM input by default.
- Redact cookies, tokens, auth headers, and secret-like values in text artifacts.
- Store target validation result and resolved address metadata for audit.

## Stop Conditions

Stop implementation and revise the plan if any of these becomes necessary:

- Public internet DAST target support is required.
- Authenticated browser session recording is required.
- Destructive payloads are required.
- High-rate recursive crawling is required.
- Arbitrary browser script execution is required.
- User-provided run-time URL must bypass saved target config.
- DAST findings require making `findings.scan_run_id` nullable.
- Normal `bun run verify` would require Docker daemon, browser download, or live target.

## Handoff to Phase 12

Phase 12 will integrate all diagnostic capabilities into a hardened workflow. Phase 11 must hand off:

- DAST target configs.
- DAST profile configs.
- DAST runs / artifacts / evidence.
- DAST finding source tool names.
- DAST failure kinds.
- Security boundary tests.
- Documentation for opt-in local DAST smoke.

Phase 12 should not need to invent DAST data contracts. It should focus on traceability, UI integration, docs, final hardening, and full verification across Phase 1 through Phase 11.
