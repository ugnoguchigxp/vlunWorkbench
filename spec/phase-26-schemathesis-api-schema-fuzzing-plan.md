# Phase 26: Schemathesis API Schema Fuzzing Plan

## Purpose

この計画は、vulnWorkbench に Schemathesis ベースの API schema fuzzing を追加するための実装計画である。

目的は、既存の Semgrep / Gitleaks / OSV / Trivy / HTTP DAST と重なりにくい API 契約面の検査を追加し、LLM handoff に「API schema と実装の不整合」「schema から生成した境界値で再現する 5xx / contract violation」を渡せるようにすること。

この phase では Terraform / IaC scanner は扱わない。ZAP full scan も扱わない。

## Product Positioning

Schemathesis は、既存 DAST の置き換えではない。

既存 DAST:

- target 起動、reachability、HTTP header、cookie、CORS、common path を低負荷に確認する。
- schema がなくても Web app の公開面を観測できる。
- 日常的に回す runtime smoke として使う。

Schemathesis:

- OpenAPI / GraphQL schema を入力に、operation / parameter / body の組み合わせを生成して API を叩く。
- schema と実装の不整合、5xx、unexpected response、境界値バグを finding 化する。
- schema がない場合は実行できないため、coverage gap として明示する。

ユーザーに見せる scan 種別は次のように分ける。

```text
Source / dependency / secret:
  static_tool steps

Runtime HTTP exposure:
  dast:http-baseline

API contract fuzzing:
  api_schema_fuzz:schemathesis

Comprehensive:
  static_tool + dast + api_schema_fuzz
```

## External Tool Facts

- Schemathesis は OpenAPI / GraphQL schema から property-based tests を生成する。
- CLI は `st run <schema>` を使う。CI や bounded scan では継続実行の `st fuzz` ではなく `st run` を使う。
- CLI は `--report junit`、`--report ndjson`、`--report-dir`、`--report-junit-path`、`--report-ndjson-path` を持つ。
- 公式 Docker image は `ghcr.io/schemathesis/schemathesis:stable`。
- Schemathesis 本体は MIT license。

References:

- https://schemathesis.readthedocs.io/
- https://schemathesis.readthedocs.io/en/stable/reference/cli/
- https://schemathesis.readthedocs.io/en/stable/guides/docker/
- https://github.com/schemathesis/schemathesis

## Non-Goals

- Terraform / IaC scanner の追加。
- ZAP full scan / active DAST の追加。
- LLM が schema や source を自由探索して finding を作ること。
- 認証付き API fuzzing の完全対応。
- destructive operation の安全性を完全自動判定すること。
- stateful long-running fuzzing。
- CI integration。

## Target UX

通常導線は `Project -> ScanProfile -> Run Scan -> Findings / Evidence / Report` のままにする。

新しく見せる profile:

1. `api-schema-fuzz`
   - 表示名: `APIスキーマファズ診断`
   - 目的: OpenAPI / GraphQL schema がある project に対して Schemathesis を単独実行する。
   - schema が見つからない場合は profile failed。

2. `api-web-security`
   - 表示名: `API Web総合診断`
   - 目的: Web API project 向けに static baseline、HTTP DAST、Schemathesis をまとめる。
   - Schemathesis は schema がない場合 `warn_and_continue`。

既存 profile への組み込み:

- `full-security-scan`
  - Schemathesis step を `required: false`, `failurePolicy: "warn_and_continue"` で追加する。
  - schema がない project でも総合診断全体は失敗にしない。
- `web-app-baseline`
  - 初期実装では追加しない。
  - 理由: baseline は速く低負荷であるべきで、schema fuzzing は schema discovery / request generation / target execution を必要とするため。
- `runtime-http-check`
  - 追加しない。
  - 理由: runtime HTTP check は schema 非依存の HTTP smoke として維持する。

## Data Model Strategy

初期実装では DB table を追加しない。

既存 table を次のように使う。

| Data | Storage |
| --- | --- |
| Schemathesis execution | `tool_runs` |
| raw NDJSON / JUnit / stdout / stderr | `scan_artifacts` |
| failed operation / contract bug | `findings` |
| operation path / method / failure message | `finding_evidence` |
| schema source, target origin, seed, checks, request limits | `tool_runs.metadata` |
| profile step status | `scan_runs.metadata.stepResults` |

`toolName` は `schemathesis` とする。

`sourceTool` は `schemathesis` とする。

`confidence` は `dynamic` を使う。

`primaryLocation` は source file location ではなく API operation location にする。

```json
{
  "kind": "api_operation",
  "method": "GET",
  "path": "/api/items/{id}",
  "schemaSource": "openapi.json",
  "baseUrl": "http://127.0.0.1:29831"
}
```

## Shared Schema Changes

File: `shared/schemas/scan-profile.schema.ts`

Add a new profile step:

```ts
export const apiSchemaFuzzProfileStepSchema = z.object({
  kind: z.literal("api_schema_fuzz"),
  engine: z.literal("schemathesis"),
  displayName: z.string(),
  required: z.boolean(),
  timeoutSec: z.number().int().positive().optional(),
  failurePolicy: profileToolFailurePolicySchema,
  target: z.object({
    mode: z.enum(["auto_project_start", "explicit_base_url"]),
    baseUrl: z.string().url().optional(),
  }),
  schema: z.object({
    mode: z.enum(["auto_discover", "file", "url"]),
    path: z.string().optional(),
    url: z.string().url().optional(),
    kind: z.enum(["openapi", "graphql", "auto"]).default("auto"),
  }),
  options: z.object({
    maxExamples: z.number().int().positive().optional(),
    checks: z.array(z.string()).optional(),
    phases: z.array(z.string()).optional(),
    seed: z.number().int().optional(),
    workers: z.union([z.number().int().positive(), z.literal("auto")]).optional(),
    readinessTimeoutMs: z.number().int().positive().optional(),
    maxResponseBodyBytes: z.number().int().positive().optional()
  }).optional()
});
```

Extend `scanProfileStepSchema`:

```ts
export const scanProfileStepSchema = z.discriminatedUnion("kind", [
  staticToolProfileStepSchema,
  dastProfileStepSchema,
  apiSchemaFuzzProfileStepSchema,
]);
```

Add exported type:

```ts
export type ApiSchemaFuzzProfileStep = z.infer<typeof apiSchemaFuzzProfileStepSchema>;
```

## New Module Layout

Add:

```text
api/modules/api-schema-fuzz/
  schema-discovery.ts
  schema-discovery.test.ts
  schemathesis-runner.ts
  schemathesis-runner.test.ts
  schemathesis-normalizer.ts
  schemathesis-normalizer.test.ts
  schemathesis-step.ts
  schemathesis-step.test.ts
  types.ts
```

Responsibilities:

- `schema-discovery.ts`
  - Find local schema files.
  - Probe common schema URLs after auto target startup.
  - Return a deterministic `SchemaSource`.
- `schemathesis-runner.ts`
  - Check `st --version`.
  - Build bounded `st run` args.
  - Save JUnit, NDJSON, stdout, stderr artifacts.
- `schemathesis-normalizer.ts`
  - Convert JUnit/NDJSON failures into normalized findings.
  - Deduplicate by method + path + check/failure kind + stable message hash.
- `schemathesis-step.ts`
  - Reuse `prepareDastTargetWorkspace` for auto project start.
  - Create `tool_runs` row.
  - Execute runner.
  - Register artifacts.
  - Create findings/evidence.
  - Return profile step result.

## Schema Discovery

File candidates, in priority order:

```text
openapi.json
openapi.yaml
openapi.yml
swagger.json
swagger.yaml
swagger.yml
docs/openapi.json
docs/openapi.yaml
api/openapi.json
api/openapi.yaml
schema/openapi.json
schema/openapi.yaml
schemas/openapi.json
schemas/openapi.yaml
graphql/schema.graphql
schema.graphql
```

URL candidates, only after auto target is ready:

```text
/openapi.json
/openapi.yaml
/swagger.json
/swagger.yaml
/api-docs
/v3/api-docs
/docs/openapi.json
/graphql/schema.graphql
```

Discovery result:

```ts
export type SchemaSource =
  | {
      mode: "file";
      kind: "openapi" | "graphql";
      path: string;
      displayName: string;
    }
  | {
      mode: "url";
      kind: "openapi" | "graphql";
      url: string;
      displayName: string;
    };
```

Rules:

- Explicit `schema.path` wins over auto discovery.
- Explicit `schema.url` wins over local discovery.
- Auto discovery checks local files first, then target URLs.
- Do not recursively scan the whole repository.
- Do not read large files over 5 MB.
- Redact headers and query params before storing schema URL metadata.
- If no schema is found:
  - `api-schema-fuzz` profile fails.
  - comprehensive profiles record a warning step failure and continue.

## Target Resolution

For `target.mode: "auto_project_start"`:

- Reuse `prepareDastTargetWorkspace`.
- Use the resolved `origin` as Schemathesis `--url` when schema source is a local file.
- For schema URL candidates, use the discovered URL directly.
- Always stop the started process in `finally`.

For `target.mode: "explicit_base_url"`:

- Require `target.baseUrl`.
- Do not auto start project.
- Validate URL with the same safety posture as DAST target validation:
  - loopback/private allowed only when explicitly intended by project-local execution.
  - no credentials in URL.
  - no redirect out of scope.

Initial CLI profile should expose auto mode first. Explicit base URL can be wired for advanced/API route later if needed.

## Runner Command

Use `st run`, not `st fuzz`.

Host runner command shape:

```bash
st run <schema> \
  --url <base-url> \
  --report junit,ndjson \
  --report-dir <tmp-report-dir> \
  --report-junit-path <tmp-report-dir>/schemathesis-junit.xml \
  --report-ndjson-path <tmp-report-dir>/schemathesis-events.ndjson \
  --output-sanitize true
```

Add bounded options when configured:

```bash
--max-examples <n>
--seed <n>
--workers <n|auto>
--checks <comma-separated-checks>
--phases <comma-separated-phases>
```

Initial defaults:

```ts
{
  timeoutSec: 300,
  maxExamples: 25,
  workers: 1,
  outputSanitize: true
}
```

Do not pass auth headers in phase 26.

## Docker Runner Design

Update `docker/toolbox/Dockerfile`:

- Add `ARG SCHEMATHESIS_VERSION`.
- Install Schemathesis through pip.
- Ensure `st --version` works.

Update `api/modules/scans/tools/tool-process-runner.ts`:

- Add allowlist entry:

```ts
st: new Set(["--version", "run"])
```

Docker constraints:

- `api_schema_fuzz` requires network access.
- If profile execution uses Docker with `network: "none"`, fail the step with a clear message.
- For auto-started loopback targets, either:
  - run Schemathesis on host, or
  - rewrite `http://127.0.0.1:<port>` to `http://host.docker.internal:<port>` and add Docker host-gateway support.

Recommended phase 26 implementation:

- Host runner is the default and fully supported.
- Docker runner supports explicit remote schema/base URLs with `network: "default"`.
- Auto-start + Docker is rejected with:

```text
Schemathesis auto target currently requires host runner; use --runner host or provide an explicit reachable base URL.
```

This avoids a brittle cross-platform Docker networking implementation in the first pass.

## Normalization

Normalizer input:

- JUnit XML artifact, if present.
- NDJSON artifact, if present.
- stdout/stderr fallback.

Finding strategy:

- Create one finding per failed API operation/check when operation data is available.
- If operation-level data cannot be extracted, create one aggregate Schemathesis finding for the failed run.
- Do not create findings for passed operations.
- Treat execution failure before test execution as tool failure, not finding.

Severity mapping:

| Schemathesis signal | Severity |
| --- | --- |
| 5xx server error from generated valid/invalid request | high |
| response schema mismatch | medium |
| unexpected status code / negative data rejection issue | medium |
| flaky / timeout / network error during operation | low |
| aggregate parse fallback | medium |

Confidence:

- `dynamic` for operation-level failures.
- `medium` only for aggregate fallback if evidence is incomplete.

Fingerprint:

```text
sha256("schemathesis" + schemaSource + method + path + checkName + normalizedMessage)
```

Evidence kinds:

- `tool-output` for JUnit/NDJSON failure snippet.
- `scan-log` for stderr/stdout fallback.

Evidence metadata:

```json
{
  "method": "GET",
  "path": "/api/items/{id}",
  "checkName": "not_a_server_error",
  "statusCode": 500,
  "schemaSource": "openapi.json",
  "baseUrl": "http://127.0.0.1:29831"
}
```

Redaction:

- Reuse existing `redactSecrets` / `redactJsonSecrets`.
- Store sanitized reports only.
- Truncate evidence snippets to a bounded length.

## Profile Integration

File: `api/modules/scans/profiles.ts`

Add step constant:

```ts
const AUTO_API_SCHEMA_FUZZ_STEP: ApiSchemaFuzzProfileStep = {
  kind: "api_schema_fuzz",
  engine: "schemathesis",
  displayName: "Schemathesis API Schema Fuzzing",
  required: false,
  failurePolicy: "warn_and_continue",
  target: { mode: "auto_project_start" },
  schema: { mode: "auto_discover", kind: "auto" },
  options: {
    maxExamples: 25,
    workers: 1,
    readinessTimeoutMs: 30_000
  }
};
```

Add required variant:

```ts
const REQUIRED_AUTO_API_SCHEMA_FUZZ_STEP: ApiSchemaFuzzProfileStep = {
  ...AUTO_API_SCHEMA_FUZZ_STEP,
  required: true,
  failurePolicy: "fail_profile"
};
```

Add focused profile:

```ts
{
  id: "api-schema-fuzz",
  name: "APIスキーマファズ診断",
  description: "OpenAPI / GraphQL schema から生成したリクエストで API contract と境界値の実行時不整合を確認します。",
  category: "focused",
  enabled: true,
  defaultTimeoutSec: 300,
  tools: [],
  steps: [REQUIRED_AUTO_API_SCHEMA_FUZZ_STEP]
}
```

Add API comprehensive profile:

```ts
{
  id: "api-web-security",
  name: "API Web総合診断",
  description: "静的診断、HTTP公開面、API schema fuzzing をまとめて実行し、API実装改善向けの証跡を収集します。",
  category: "detailed",
  enabled: true,
  defaultTimeoutSec: 1200,
  scope: SOURCE_BASELINE_SCOPE,
  tools: [...],
  steps: [
    semgrep,
    gitleaks,
    osv,
    AUTO_HTTP_DAST_STEP,
    AUTO_API_SCHEMA_FUZZ_STEP
  ]
}
```

Update `full-security-scan`:

- Append `AUTO_API_SCHEMA_FUZZ_STEP` after `AUTO_HTTP_DAST_STEP`.
- Keep `warn_and_continue`.

Do not add it to `baseline`, `source-baseline`, `basic-security`, `dependency-manifest`, `artifact`, or `runtime-http-check`.

## Profile Runner Changes

File: `api/modules/scans/profile-runner.ts`

Add result type:

```ts
export type ApiSchemaFuzzStepResult = {
  kind: "api_schema_fuzz";
  engine: "schemathesis";
  required: boolean;
  status: "completed" | "failed" | "skipped";
  outcome: "passed" | "failed" | "error" | "schema_not_found" | null;
  findingCount: number;
  toolRunId: string | null;
  schemaSource: string | null;
  targetOrigin: string | null;
  error: string | null;
  autoTarget?: {
    scriptName: string;
    command: string[];
    port: number;
    origin: string;
    warnings: string[];
  };
};
```

Extend union:

```ts
export type ScanProfileStepResult =
  | (ToolResult & { kind: "static_tool" })
  | DastStepResult
  | ApiSchemaFuzzStepResult;
```

Add step handler:

```ts
if (step.kind === "api_schema_fuzz") {
  const result = await runApiSchemaFuzzStepIntoExistingScan(...);
  stepResults.push(result);
  findingCount = result.findingCount;
  status = result.status;
  error = result.error;
  update failure flags using failureFailsProfile;
  continue;
}
```

Update `stepOrder` formatting:

```ts
step.kind === "api_schema_fuzz"
  ? "api_schema_fuzz:schemathesis"
```

Update skip behavior to create an `api_schema_fuzz` skipped result.

## CLI Changes

Add script to `package.json`:

```json
"scan:schemathesis": "bun run api/cli/scan-schemathesis.ts"
```

Add file: `api/cli/scan-schemathesis.ts`

Arguments:

```text
--project-id <id>              required unless --dry-run true
--profile api-schema-fuzz      default
--schema <path-or-url>         optional explicit schema
--schema-kind openapi|graphql|auto
--base-url <url>               optional explicit base URL
--auto-target true|false       default true
--timeout-sec <n>
--max-examples <n>
--workers <n|auto>
--seed <n>
--runner host|docker           default host
--network none|default         default default for docker
--dry-run true|false
--final-report true|false      default true
--report-output <path>
```

Behavior:

- Implement as a thin wrapper around `runProfileScan` with profile `api-schema-fuzz`.
- Explicit schema/base-url override should be passed through step options only for this invocation.
- JSON stdout only.
- Non-zero exit when profile outcome is failed.

Dry-run output:

```json
{
  "dryRun": true,
  "profileId": "api-schema-fuzz",
  "stepOrder": ["api_schema_fuzz:schemathesis"],
  "schema": {"mode": "auto_discover", "kind": "auto"},
  "target": {"mode": "auto_project_start"},
  "runner": "host"
}
```

## API / UI Changes

No dedicated API route is required in phase 26 if `POST /api/projects/:projectId/scans` already runs arbitrary enabled profiles.

Required UI updates:

- Profile selector should show:
  - `APIスキーマファズ診断`
  - `API Web総合診断`
  - updated `総合セキュリティ診断` description indicating API schema fuzzing is included when schema is available.
- Recent run / step result display should render `api_schema_fuzz` as:
  - `Schemathesis`
  - schema source
  - target origin
  - outcome
  - finding count
  - schema-not-found warning when optional.
- Do not add a manual schema form in the normal UI in phase 26.

Advanced manual schema input can be added later after the core evidence path is stable.

## Report Changes

File: `api/modules/scans/report-builder.ts`

Update expected step analysis:

- Include `api_schema_fuzz` in expected runtime coverage.
- If expected optional Schemathesis step fails with `schema_not_found`, report it as an API contract coverage gap, not as a tool crash.
- Add a summary section:

```md
## API Schema Fuzzing サマリ
```

When runs exist:

```md
| Tool Run | Schema | Target | Status | Outcome | Findings |
```

When profile expected it but it did not complete:

```md
API contract coverage gap: この ScanProfile は API schema fuzzing を含みますが、OpenAPI / GraphQL schema が見つからなかったため実行されていません。
```

Finding detail section should show:

- method/path
- check name
- status code if present
- schema source
- target origin
- artifact references

Update LLM handoff / report readiness text so LLM receives this as implementation risk:

```text
API schema fuzzing found runtime contract failures. Prioritize implementation fixes that align handlers, validation, and response schemas.
```

## Security Boundaries

- Do not pass LLM credentials or provider env vars to Schemathesis.
- Keep `getCleanEnv` behavior.
- Default to host runner for auto-started local targets.
- Do not send auth headers in phase 26.
- Do not allow arbitrary shell commands.
- Do not use `st fuzz` for normal scan profiles.
- Bound timeout and examples.
- Sanitize output.
- Store artifacts under existing scan artifact root.
- Stop auto-started target in `finally`.
- Reject URLs with credentials.
- Reject non-HTTP(S) schema URLs.

## Implementation Tasks

### Task 1: Extend Shared Profile Schema

Files:

- `shared/schemas/scan-profile.schema.ts`

Steps:

1. Add `apiSchemaFuzzProfileStepSchema`.
2. Add exported `ApiSchemaFuzzProfileStep`.
3. Extend `scanProfileStepSchema`.
4. Update any exhaustive type handling errors.

Tests:

```bash
bun run typecheck
```

### Task 2: Add Schema Discovery

Files:

- `api/modules/api-schema-fuzz/schema-discovery.ts`
- `api/modules/api-schema-fuzz/schema-discovery.test.ts`

Steps:

1. Implement local file candidate lookup.
2. Implement URL probe lookup with bounded timeout.
3. Add file size guard.
4. Add explicit path/url override.
5. Add schema kind inference from extension and lightweight content markers.

Tests:

- Local `openapi.json` wins.
- Explicit path wins over auto.
- Explicit URL wins over local.
- Missing schema returns structured `schema_not_found`.
- Files over 5 MB are skipped.
- URL probe only runs when target origin is provided.

Command:

```bash
bun test api/modules/api-schema-fuzz/schema-discovery.test.ts
```

### Task 3: Add Schemathesis Runner

Files:

- `api/modules/api-schema-fuzz/schemathesis-runner.ts`
- `api/modules/api-schema-fuzz/schemathesis-runner.test.ts`
- `docker/toolbox/Dockerfile`
- `api/modules/scans/tools/tool-process-runner.ts`

Steps:

1. Add `checkVersion()` using `st --version`.
2. Build `st run` command with JUnit and NDJSON output paths.
3. Save sanitized JUnit, NDJSON, stdout, stderr artifacts.
4. Add Docker toolbox install support.
5. Add Docker allowlist for `st`.
6. Reject Docker auto-target mode with clear error.

Tests:

- Missing binary returns clear error.
- Command includes `st run`, reports, sanitize flag, timeout options.
- Raw artifacts are saved and redacted.
- Docker allowlist allows `st --version` and `st run`.
- Docker allowlist rejects other `st` first args.

Commands:

```bash
bun test api/modules/api-schema-fuzz/schemathesis-runner.test.ts
bun test api/modules/scans/tools/tool-process-runner.test.ts
```

### Task 4: Add Normalizer

Files:

- `api/modules/api-schema-fuzz/schemathesis-normalizer.ts`
- `api/modules/api-schema-fuzz/schemathesis-normalizer.test.ts`
- `tests/fixtures/scans/schemathesis-junit.xml`
- `tests/fixtures/scans/schemathesis-events.ndjson`

Steps:

1. Parse operation-level failures from JUnit when available.
2. Parse richer metadata from NDJSON when available.
3. Fallback to one aggregate finding if artifacts indicate failure but operation parsing fails.
4. Map severity/confidence.
5. Create stable fingerprints.
6. Truncate and redact snippets.

Tests:

- 500 error maps to high severity.
- response schema mismatch maps to medium.
- duplicate failures dedupe by fingerprint.
- aggregate fallback creates one finding.
- clean run creates zero findings.

Command:

```bash
bun test api/modules/api-schema-fuzz/schemathesis-normalizer.test.ts
```

### Task 5: Add Profile Step Executor

Files:

- `api/modules/api-schema-fuzz/schemathesis-step.ts`
- `api/modules/api-schema-fuzz/schemathesis-step.test.ts`
- `api/modules/scans/profile-runner.ts`

Steps:

1. Create `tool_runs` row with `toolName: "schemathesis"`.
2. Resolve target and schema.
3. Execute runner.
4. Register artifacts.
5. Normalize findings.
6. Insert findings and evidence.
7. Return `ApiSchemaFuzzStepResult`.
8. Preserve optional vs required failure behavior.
9. Stop auto target in `finally`.

Tests:

- Required profile fails when schema is missing.
- Optional comprehensive step records warning and continues when schema is missing.
- Successful run creates tool run, artifacts, findings, evidence.
- Runner error before execution marks tool run failed and creates no finding.
- Auto target is stopped on success and failure.

Command:

```bash
bun test api/modules/api-schema-fuzz/schemathesis-step.test.ts
bun test api/modules/scans/profile-runner.test.ts
```

### Task 6: Add Profiles

Files:

- `api/modules/scans/profiles.ts`
- `api/modules/scans/profiles.test.ts` if present, otherwise add one.

Steps:

1. Add `AUTO_API_SCHEMA_FUZZ_STEP`.
2. Add `REQUIRED_AUTO_API_SCHEMA_FUZZ_STEP`.
3. Add `api-schema-fuzz`.
4. Add `api-web-security`.
5. Append optional Schemathesis step to `full-security-scan`.
6. Confirm `baseline` and `web-app-baseline` stay lightweight.

Tests:

- `api-schema-fuzz` dry-run has exactly one `api_schema_fuzz:schemathesis` step.
- `api-web-security` includes static, DAST, Schemathesis.
- `full-security-scan` includes Schemathesis after DAST.
- `web-app-baseline` does not include Schemathesis.

Command:

```bash
bun run scan:profile -- --profile api-schema-fuzz --dry-run true
bun run scan:profile -- --profile api-web-security --dry-run true
bun run scan:profile -- --profile full-security-scan --dry-run true
```

### Task 7: Add CLI Wrapper

Files:

- `api/cli/scan-schemathesis.ts`
- `package.json`

Steps:

1. Add CLI parse args.
2. Use `runProfileScan`.
3. Support explicit schema/base-url override.
4. Emit JSON only.
5. Write final report when requested.

Tests:

- Dry-run works without project id.
- Missing project id fails outside dry-run.
- Invalid schema kind fails.
- JSON output includes `stepResults`.

Command:

```bash
bun run scan:schemathesis -- --dry-run true
```

### Task 8: Update Reports

Files:

- `api/modules/scans/report-builder.ts`
- `api/modules/scans/report-builder.test.ts`

Steps:

1. Add API schema fuzzing summary section.
2. Add coverage gap when expected but missing.
3. Add finding-level API operation details.
4. Update scan readiness / handoff wording.

Tests:

- Report includes API Schema Fuzzing summary when tool run exists.
- Report includes coverage gap when optional step cannot find schema.
- Report includes method/path/check evidence for Schemathesis finding.

Command:

```bash
bun test api/modules/scans/report-builder.test.ts
```

### Task 9: Update UI Labels

Files:

- `web/src/domains/scans/*`
- `web/src/domains/scans/components/*`
- `web/src/domains/scans/work-states.ts`

Steps:

1. Render `api_schema_fuzz` step results without falling back to unknown JSON.
2. Show schema source, target origin, outcome, finding count.
3. Update profile descriptions surfaced in UI.
4. Keep manual schema input out of the normal create panel.

Checks:

```bash
bun run build:web
```

### Task 10: Documentation

Files:

- `README.md`
- `README.jp.md`

Steps:

1. Add `scan:schemathesis` command.
2. Add `api-schema-fuzz` and `api-web-security` to profile examples.
3. Explain that Schemathesis is API schema fuzzing, not DAST replacement.
4. Note MIT license and bounded `st run` usage.

## Acceptance Criteria

Functional:

- `bun run scan:profile -- --profile api-schema-fuzz --dry-run true` shows `api_schema_fuzz:schemathesis`.
- `bun run scan:profile -- --profile full-security-scan --dry-run true` includes Schemathesis as optional step after DAST.
- A project with `openapi.json` can run Schemathesis and save tool run/artifacts.
- A project without schema fails `api-schema-fuzz` but only warns in `full-security-scan`.
- Schemathesis findings appear in report and LLM handoff context.

Safety:

- Auto-started project is stopped after the step.
- No LLM/provider credentials are passed to the tool.
- Timeout and max examples are bounded.
- Docker runner cannot silently run auto-target Schemathesis against an unreachable loopback URL.

Quality:

- No new DB migration is required.
- Existing DAST profiles still pass.
- Existing static profiles still pass.
- Report output is deterministic enough for tests.

Verification:

```bash
git diff --check
bun run scan:profile -- --profile api-schema-fuzz --dry-run true
bun run scan:profile -- --profile api-web-security --dry-run true
bun run scan:profile -- --profile full-security-scan --dry-run true
bun test api/modules/api-schema-fuzz/schema-discovery.test.ts
bun test api/modules/api-schema-fuzz/schemathesis-normalizer.test.ts
bun test api/modules/api-schema-fuzz/schemathesis-runner.test.ts
bun test api/modules/api-schema-fuzz/schemathesis-step.test.ts
bun test api/modules/scans/profile-runner.test.ts
bun test api/modules/scans/report-builder.test.ts
bun run build:web
bun run verify
```

## Stop Conditions

Stop and revise the plan if any of these become true:

- Schemathesis CLI no longer supports bounded `st run` report generation.
- JUnit/NDJSON output cannot be parsed into stable operation-level evidence.
- Auto target startup becomes unreliable enough that tests require arbitrary sleeps.
- Docker networking forces broad host networking or Docker socket access.
- Report integration requires schema-level source browsing by LLM instead of saved evidence.

## Future Work

- Authenticated API fuzzing with explicit safe header profiles.
- GraphQL-specific schema discovery and operation rendering if initial implementation only validates OpenAPI.
- Stateful testing as a separate explicit long-running profile.
- Manual schema/base URL advanced UI.
- CI scheduled scan integration.
- Coverage HTML artifact if Schemathesis coverage reporting is enabled later.
