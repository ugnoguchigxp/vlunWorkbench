# Phase 9: Sandbox Reproduction Foundation Implementation Plan

## Purpose

この計画は、vulnWorkbench の Phase 9 として、既存 finding に対する限定的な再現確認を Docker sandbox 内で実行し、再現 run / artifact / evidence として保存するためのもの。

Phase 9 の目的は、exploit を生成することではない。Phase 8 の Docker toolbox runner を実行基盤として使い、Semgrep / Gitleaks / OSV-Scanner / Trivy の既存 artifact / normalizer / matching logic を再利用しながら、finding が現在の repository state でも観測できるかを bounded に確認する。

重要な責務境界:

- heavy reproduction work は CLI に委譲する。
- API route は Docker / tool runner を直接呼ばない。API は `repro:finding` CLI への argv bridge に限定する。
- LLM は reproduction command を生成しない。
- LLM が使われる場合でも、保存済み reproduction artifact / evidence を読む後段 review に限定する。
- Phase 9 は sandbox reproduction foundation であり、test harness / sanitizer / fuzzing は Phase 10、DAST / browser automation は Phase 11 で扱う。
- target repository は Docker container 内で read-only mount される。結果出力だけが writable output mount に書かれる。

## Source Baseline

前提実装:

- Phase 8 Docker toolbox runner が存在する。
- `runToolProcess` が `runner: docker`、read-only repo mount、writable output mount、network mode、timeout/resource option、secret env filtering を扱える。
- `scan:profile --runner docker` が host runner へ暗黙 fallback しない。
- scan finding / evidence / review / decision / report が保存できる。
- ArtifactStorage は scan artifact を保存できる。
- Semgrep / Gitleaks / OSV / Trivy normalizer が存在する。

実装前に確認する baseline:

```bash
git status --short
git diff --check
bun run verify
bun run scan:profile -- --dry-run true --profile baseline --runner docker --network none
```

確認すること:

- Phase 8 の未完了差分がある場合は内容を把握し、Phase 9 の変更と混ぜて壊さない。
- Docker runner が shell string ではなく argv array を使っている。
- Docker runner の allowlist、read-only repo mount、writable output mount、no privileged、no Docker socket が維持されている。
- 通常 `bun run verify` は Docker daemon / image build を要求しない。

## Scope

Phase 9 で実装するもの。

- reproduction run DB schema / migration
- reproduction artifact DB schema / migration
- reproduction evidence DB schema / migration
- reproduction repository
- reproduction profile registry
- finding-to-reproduction applicability check
- deterministic command construction using argv arrays
- Docker sandbox execution through Phase 8 runner
- stdout / stderr / raw result artifact保存
- deterministic outcome判定
- `repro:finding` CLI
- reproduction API
- finding detail UI の reproduction panel
- Docker unavailable / image missing / timeout / profile mismatch failure handling
- repository / profile / CLI / route / UI の focused tests
- opt-in Docker smoke test documentation

Phase 9 で実装しないもの。

- LLM による任意 command 生成
- project user が任意 shell command を入力して実行する機能
- exploit generation
- PoC payload generation
- patch適用
- full DAST
- browser automation
- sanitizer / fuzzing
- package install / dependency update
- target repo write
- Docker socket passthrough
- privileged container
- CI 必須化

## Definition of Done

Phase 9 は、次を満たしたら完了とする。

- `repro:finding` CLI から finding ID と reproduction profile ID を指定して Docker sandbox reproduction を実行できる。
- 実行 command は registry に定義された profile からのみ argv array として生成される。
- API は Docker runner を直接呼ばず、CLI bridge を通す。
- LLM は command を生成せず、保存済み artifact / evidence の後段 review に限定される。
- `reproduction_runs`、`reproduction_artifacts`、`reproduction_evidence` が保存される。
- stdout / stderr / raw JSON artifact が redaction 後に保存される。
- deterministic matching により `reproduced` / `not_reproduced` / `inconclusive` / `error` が保存される。
- reproduction failure は既存 finding / evidence / review / decision / report を変更しない。
- Docker unavailable / image missing / timeout / artifact failure が別々に失敗扱いできる。
- target repo は Docker container 内で read-only mount される。
- 通常 `bun run verify` は Docker daemon / toolbox image なしで通る。

## Reproduction Model

基本フロー:

```text
finding
  -> allowed reproduction profile selection
  -> deterministic argv construction
  -> Phase 8 Docker toolbox runner
  -> raw JSON / stdout / stderr artifacts
  -> deterministic matching against original finding
  -> reproduction outcome
  -> UI / human review
```

Outcome:

```text
reproduced
  The bounded command completed and produced a finding that deterministically matches the original finding.

not_reproduced
  The bounded command completed and produced valid output, but no matching finding was observed.

inconclusive
  The bounded command ran but output could not support a reliable yes/no answer.

error
  Setup, profile validation, Docker, timeout, parse, or artifact persistence failed.
```

Run status:

```text
queued
running
completed
failed
timed_out
cancelled
```

Rules:

- `status=completed` may have `outcome=reproduced|not_reproduced|inconclusive`.
- `status=failed|timed_out` must have `outcome=error`.
- Already persisted scan finding/evidence/review/decision/report must not be modified or deleted by reproduction failure.
- Reproduction evidence is additive and separate from LLM review / human decision.

## Profile Registry

Phase 9 の最小 profile set は、既存 scan tool の bounded recheck に限定する。Node/Python test harness は Phase 10 に送る。

### `semgrep-path-recheck`

Applicability:

- `finding.sourceTool === "semgrep"`
- `finding.primaryLocation.path` が repository 内の relative path として解決できる

Command:

```text
binary: semgrep
argv:
  scan
  --config <profile config, default auto>
  --json
  --output <raw-output-json-host-path>
  --include <safe-relative-finding-path>
  <repoPath>
```

Default scope:

- finding path がある場合はその path だけを対象にする。
- path がない場合は profile rejected。
- Docker path rewrite は `repoPath` と `raw-output-json-host-path` にだけ依存する。finding path は repository-relative path として `--include` に渡し、absolute host path を command argv に混ぜない。

Match:

- normalized Semgrep finding の `ruleId` が original finding の `ruleId` と一致する。
- normalized primary location path が original finding path と一致する。
- line は exact match できれば reproduced、path/rule only match は `metadata.matchStrength = "path_rule"` として reproduced にする。

### `gitleaks-recheck`

Applicability:

- `finding.sourceTool === "gitleaks"`

Command:

```text
binary: gitleaks
argv:
  detect
  --source <repoPath>
  --report-format json
  --report-path <raw-output-json-host-path>
  --redact
```

Match:

- normalized Gitleaks finding の `ruleId` が original finding の `ruleId` と一致する。
- original path がある場合は path も一致する。
- secret value は比較しない。redacted outputのみを使う。

### `osv-dependency-recheck`

Applicability:

- `finding.sourceTool === "osv"`
- finding metadata に `packageName` または advisory id 相当がある

Command:

```text
binary: osv-scanner
argv:
  --format json
  --output <raw-output-json-host-path>
  --recursive
  <repoPath>
```

Match:

- normalized OSV finding の advisory id / ruleId が original finding の `ruleId` と一致する。
- package name が取れる場合は package name も一致する。

### `trivy-fs-recheck`

Applicability:

- `finding.sourceTool === "trivy"`

Command:

```text
binary: trivy
argv:
  fs
  --format json
  --output <raw-output-json-host-path>
  <repoPath>
```

Match:

- vulnerability: `vulnerabilityId` / `ruleId` と package name が一致する。
- config: rule id と path が一致する。
- secret: rule id と path が一致する。secret value は比較しない。

## Profile Data Shape

Suggested internal type:

```ts
type ReproductionProfile = {
  id: string;
  displayName: string;
  description: string;
  sourceTools: string[];
  defaultTimeoutSec: number;
  defaultNetworkMode: "none" | "default";
  buildCommand(input: ReproductionInput): ReproductionCommand;
  isApplicable(input: ReproductionInput): ApplicabilityResult;
  evaluate(input: ReproductionEvaluationInput): ReproductionOutcomeResult;
};

type ReproductionCommand = {
  binaryName: "semgrep" | "gitleaks" | "osv-scanner" | "trivy";
  args: string[];
  rawOutputFileName: string;
  outputFormat: "json";
};
```

Rules:

- `buildCommand` returns argv arrays only.
- No shell interpolation.
- No `bash -c`, `sh -c`, `npm`, `python`, `curl`, package manager install, or project-defined script in Phase 9.
- User-provided profile id selects a known registry entry only.
- Request-provided arbitrary command is rejected before DB mutation.

## Data Model

Add migration after the current latest migration.

### `reproduction_runs`

```text
id
project_id
scan_run_id
finding_id
profile_id
status
outcome
runner
command_json
exit_code
started_at
completed_at
summary
error_message
metadata
created_by_user_id
created_at
updated_at
```

Constraints / indexes:

- `finding_id` references `findings.id` on delete cascade.
- `scan_run_id` references `scan_runs.id` on delete cascade.
- `project_id` references `projects.id` on delete cascade.
- index on `finding_id`.
- index on `scan_run_id`.
- index on `project_id`.
- index on `status`.
- index on `outcome`.

Metadata must include only non-secret execution details:

```json
{
  "profileVersion": 1,
  "timeoutSec": 120,
  "networkMode": "none",
  "resourceLimits": {
    "memory": "2g",
    "cpus": "2"
  },
  "runnerMetadata": {
    "runner": "docker",
    "docker": {
      "image": "vuln-workbench-toolbox:local",
      "containerName": "vuln-workbench-...",
      "networkMode": "none",
      "mountMode": {
        "repo": "read-only",
        "output": "read-write",
        "cache": "read-write"
      }
    }
  },
  "match": {
    "matchedFindingIds": [],
    "matchStrength": "exact|path_rule|rule_only|none"
  }
}
```

### `reproduction_artifacts`

```text
id
reproduction_run_id
finding_id
kind
format
path
sha256
size_bytes
metadata
created_at
```

Allowed `kind`:

```text
raw_result
stdout
stderr
log
summary
```

Rules:

- Artifacts are stored under `artifacts/reproductions/<reproductionRunId>/...`.
- Do not reuse scan artifact rows for reproduction artifacts in Phase 9. Keep scan artifact and reproduction artifact ownership clear.
- Artifact paths are relative to the reproduction artifact root.
- Raw JSON and logs must be redacted before persistence using the existing redaction helpers.

### `reproduction_evidence`

```text
id
reproduction_run_id
finding_id
kind
title
artifact_id
location
snippet
metadata
created_at
```

Allowed `kind`:

```text
reproduction-result
reproduction-log
tool-output
```

Rules:

- Evidence references `reproduction_artifacts.id`.
- Evidence is displayed separately from existing `finding_evidence`.
- Phase 9 does not mutate existing `finding_evidence`.

## Storage Contract

Add a reproduction artifact storage helper, or extend `ArtifactStorage` with an explicit reproduction namespace.

Required methods:

```text
saveReproductionRawArtifact(reproductionRunId, sourcePath, suggestedFilename)
saveReproductionLog(reproductionRunId, logType, content, suggestedFilename?)
readReproductionTextArtifact(relativePath)
```

Rules:

- Validate paths against `artifacts/reproductions`.
- Suggested filenames are sanitized.
- `stdout` / `stderr` are saved even when command exits non-zero.
- Raw output missing is a command failure if the profile requires JSON output.
- Cleanup failure does not delete DB records and is recorded as warning metadata.

## CLI Contract

Add script:

```json
{
  "repro:finding": "bun run api/cli/repro-finding.ts"
}
```

Primary command:

```bash
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile semgrep-path-recheck \
  --runner docker \
  --docker-image vuln-workbench-toolbox:local \
  --network none
```

Options:

```text
--finding-id <id>                  required
--profile <profile-id>             required
--runner docker                    default docker; host is not exposed through API
--docker-bin <path>                default docker or VULN_WORKBENCH_DOCKER_BIN
--docker-image <image>             default vuln-workbench-toolbox:local
--network none|default             default from profile, normally none
--timeout-sec <seconds>            positive integer
--memory <limit>
--cpus <limit>
--tool-cache-dir <path>
--output-summary <path>
--dry-run true|false               default false
```

Required behavior:

- stdout is JSON only.
- invalid args return failed JSON before DB mutation.
- finding not found returns failed JSON before DB mutation.
- profile not found / not applicable returns failed JSON before DB mutation.
- Docker unavailable after run creation marks `reproduction_runs.status=failed`.
- No host fallback when `runner=docker`.
- `--dry-run true` returns selected profile, applicability result, command argv, and runner options without creating a run.

Success JSON:

```json
{
  "ok": true,
  "reproductionRunId": "...",
  "findingId": "...",
  "profileId": "semgrep-path-recheck",
  "status": "completed",
  "outcome": "reproduced",
  "runner": "docker",
  "exitCode": 0,
  "artifactIds": ["..."],
  "evidenceIds": ["..."]
}
```

Failure JSON after run creation:

```json
{
  "ok": false,
  "reproductionRunId": "...",
  "findingId": "...",
  "profileId": "semgrep-path-recheck",
  "status": "failed",
  "outcome": "error",
  "runner": "docker",
  "message": "Docker image not found: vuln-workbench-toolbox:local"
}
```

Failure JSON before run creation:

```json
{
  "ok": false,
  "status": "failed",
  "outcome": "error",
  "message": "Profile semgrep-path-recheck is not applicable to finding ..."
}
```

## API Contract

Add routes:

```text
GET  /api/findings/:findingId/reproduction-profiles
GET  /api/findings/:findingId/reproductions
POST /api/findings/:findingId/reproductions
GET  /api/reproduction-runs/:reproductionRunId
GET  /api/reproduction-runs/:reproductionRunId/artifacts
```

Request:

```json
{
  "profileId": "semgrep-path-recheck",
  "runner": "docker",
  "dockerImage": "vuln-workbench-toolbox:local",
  "network": "none",
  "timeoutSec": 120,
  "memory": "2g",
  "cpus": "2"
}
```

Required behavior:

- Validate auth.
- Validate project ownership through finding -> scanRun -> project.
- Validate profile allowlist and applicability before CLI invocation.
- Call `repro:finding` CLI via argv array.
- Parse JSON stdout.
- Return run status, outcome, artifacts, evidence.
- Never pass request-provided arbitrary command to CLI.
- Never call Docker runner directly from route handler.

HTTP behavior:

- Validation / not applicable before run creation: `400`.
- Not found: `404`.
- Forbidden project: `403`.
- CLI bridge parse failure: `500`.
- Valid CLI JSON with `ok=false` and `reproductionRunId`: return `200` with failed run body, so UI can show persisted artifacts/error.

## Frontend Scope

Add a Reproduction panel to finding detail.

UI behavior:

- Load available reproduction profiles for selected finding.
- Show profile name, applicability reason, default timeout/network.
- Disable run button when no profile is applicable.
- Start reproduction via API.
- Show latest runs with status, outcome, profile, exit code, created/completed time.
- Show artifact links or expandable stdout/stderr snippets.
- Show reproduction evidence separately from:
  - static finding evidence
  - LLM review
  - human decision
- Do not imply `reproduced` means exploitability. Use copy such as "Observed again by bounded recheck".

Implementation files likely touched:

```text
web/src/api.ts
web/src/domains/scans/scans-domain.tsx
web/src/styles.css
```

Keep UI minimal. Phase 9 does not need charts, long timelines, or background queue UI.

## Implementation Steps

### P0: Baseline Inspection

- Confirm worktree state.
- Confirm Phase 8 Docker runner tests pass.
- Confirm current DB latest migration number.
- Confirm finding detail UI data flow.
- Confirm ArtifactStorage extension point.

Completion criteria:

- Reproduction DB table names and artifact storage strategy are fixed.
- Minimal profile set is fixed to existing scan tools only.

### P1: Schema and Repository

- Add migration for `reproduction_runs`, `reproduction_artifacts`, `reproduction_evidence`.
- Add schema exports to `api/db/schema.ts`.
- Add shared zod schemas in `shared/schemas/reproduction.schema.ts`.
- Add repository in `api/modules/reproductions/reproduction-repository.ts`.

Repository methods:

```text
createRun
updateRunStatus
getRun
listRunsForFinding
createArtifact
listArtifacts
createEvidence
listEvidence
```

Completion criteria:

- Repository tests can create/update/list runs, artifacts, evidence.
- Foreign key failures are covered.

### P2: Reproduction Profile Registry

- Add `api/modules/reproductions/profiles.ts`.
- Implement the four minimal profiles:
  - `semgrep-path-recheck`
  - `gitleaks-recheck`
  - `osv-dependency-recheck`
  - `trivy-fs-recheck`
- Implement applicability checks.
- Implement deterministic argv construction.
- Implement deterministic outcome matching using existing normalizers.

Completion criteria:

- Profile unit tests cover applicable / not applicable cases.
- Command construction tests assert no shell string, no `bash`, no arbitrary user command.
- Matching tests cover reproduced / not_reproduced / inconclusive.

### P3: Artifact Storage

- Add reproduction artifact storage helper.
- Save redacted raw JSON, stdout, stderr.
- Store DB rows in `reproduction_artifacts`.
- Create reproduction evidence rows with short snippets and artifact references.

Completion criteria:

- Artifact path traversal tests pass.
- Failed command still saves stdout/stderr when available.
- Raw JSON secrets are redacted before persistence.

### P4: Runner

- Add `api/modules/reproductions/reproduction-runner.ts`.
- Load finding, scan run, project.
- Validate profile applicability before run creation.
- Create `reproduction_runs.status=running`.
- Execute profile through Phase 8 Docker runner.
- Save artifacts.
- Normalize raw output.
- Evaluate outcome.
- Update run to completed / failed / timed_out.

Completion criteria:

- Docker unavailable creates a failed persisted run only when failure happens after run creation.
- profile mismatch fails before DB mutation.
- No host fallback.
- Existing finding/evidence/review/decision remain unchanged.

### P5: CLI

- Add `api/cli/repro-finding.ts`.
- Add `repro:finding` script.
- Implement `--dry-run`.
- Implement JSON-only stdout.
- Implement `--output-summary`.

Completion criteria:

- CLI tests cover success, invalid profile, not applicable, Docker unavailable, output summary failure.

### P6: API

- Add reproduction routes.
- Wire auth middleware in `api/app/hono.ts`.
- Route `POST` calls CLI bridge only.
- Route `GET` reads repository only.

Completion criteria:

- Route tests cover ownership, not found, profile list, create run, get run.
- Route tests assert Docker runner is not imported/called from route.

### P7: UI

- Extend web API client.
- Add finding detail reproduction panel.
- Show profile selector, run button, latest run list, artifact/evidence summary.
- Keep reproduction outcome separate from LLM review/decision.

Completion criteria:

- UI builds.
- Existing scan/finding/report flows still work.
- Empty/no-profile state is clear.

### P8: Verification and Smoke

- Add unit tests for repository, profiles, runner matching, CLI, routes.
- Add mocked Docker runner tests so normal verify does not require Docker.
- Document opt-in Docker smoke command.

Completion criteria:

- `git diff --check` passes.
- `bun run verify` passes without Docker.
- Opt-in Docker smoke command is documented and can be run manually when Docker image exists.

## Verification Commands

Normal verification:

```bash
git diff --check
bun run test
bun run verify
```

Expected:

- Docker daemon / toolbox image is not required.
- Existing scan, review, decision, report tests still pass.
- Reproduction tests use mocks unless explicitly marked smoke.

CLI dry-run:

```bash
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile semgrep-path-recheck \
  --runner docker \
  --dry-run true
```

Expected:

- JSON stdout only.
- No DB row created.
- Command argv is shown.
- No shell string appears.

Docker unavailable:

```bash
VULN_WORKBENCH_DOCKER_BIN=/tmp/vuln-workbench-missing-docker \
  bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile semgrep-path-recheck \
  --runner docker
```

Expected:

- failed JSON.
- host runner is not used.
- if run was created, it is marked failed with `outcome=error`.
- stdout/stderr artifacts are saved only if available.

Opt-in Docker smoke:

```bash
bun run docker:toolbox:build
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile semgrep-path-recheck \
  --runner docker \
  --docker-image vuln-workbench-toolbox:local \
  --network none
```

Expected:

- reproduction run is created.
- runner metadata includes Docker image, network mode, mount mode, resource limits.
- raw result/stdout/stderr artifacts are saved.
- outcome is one of `reproduced`, `not_reproduced`, `inconclusive`, `error`.
- no LLM/API key appears in metadata or artifacts.

API smoke:

```bash
curl -X GET /api/findings/<finding-id>/reproduction-profiles
curl -X POST /api/findings/<finding-id>/reproductions \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"semgrep-path-recheck","runner":"docker","network":"none"}'
curl -X GET /api/findings/<finding-id>/reproductions
```

Expected:

- ownership is enforced.
- POST returns persisted run result.
- GET lists the run and artifacts/evidence summary.

## Failure Handling

Profile not applicable:

- Fail before run creation.
- Return reason in JSON.
- Do not create artifact/evidence rows.

Docker unavailable / image missing:

- Do not fallback to host.
- If failure occurs after run creation, mark run failed and store error metadata.
- Return clear JSON message.

Timeout:

- Attempt container cleanup.
- Mark run `status=timed_out`, `outcome=error`.
- Save stdout/stderr if captured.
- Cleanup failure is warning metadata, not a reason to delete records.

Raw output missing:

- Save stdout/stderr.
- Mark run failed with `outcome=error`.
- Evidence should explain that raw output was missing.

Parse failure:

- Save raw output after redaction.
- Mark run completed with `outcome=inconclusive` only if command itself completed and artifacts were persisted.
- Mark run failed if artifact persistence failed.

Artifact persistence failure:

- Mark run failed.
- Do not mark reproduction complete.
- Return failed JSON.

Matching ambiguity:

- Prefer `inconclusive` over overclaiming `reproduced`.
- Store match candidates and reason in metadata.

## Security Requirements

- No arbitrary shell command input.
- No shell interpolation.
- No `bash -c` / `sh -c`.
- No Docker socket mount.
- No privileged container.
- No target repo write.
- No project script execution in Phase 9.
- No package install.
- No network open by default.
- No host fallback for Docker requested runs.
- No env dump in metadata.
- Secret-like stdout/stderr/raw JSON content is redacted before artifact persistence.

## Stop Conditions

Stop implementation and revise the plan if any of these become necessary:

- arbitrary user command execution
- LLM-generated command execution
- exploit payload generation
- Docker privileged mode
- Docker socket passthrough
- target repo write
- package install / dependency update
- browser automation
- sanitizer/fuzzing
- changing existing finding/review/decision semantics to fit reproduction

## Handoff to Phase 10

Phase 10 can build on `reproduction_runs` by adding bounded test harness, sanitizer, and lightweight fuzzing profiles.

Phase 10 must not assume Phase 9 profiles can run arbitrary project scripts. If project scripts become necessary, Phase 10 must add a separate allowlist and consent model rather than weakening Phase 9.
