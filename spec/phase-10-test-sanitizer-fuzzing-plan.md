# Phase 10: Test Harness, Sanitizer, and Lightweight Fuzzing Implementation Plan

## Purpose

この計画は、vulnWorkbench の Phase 10 として、Phase 9 の sandbox reproduction 基盤を踏まえ、bounded な test / sanitizer / lightweight fuzzing 実行を追加するためのもの。

Phase 10 の目的は、静的 scan や bounded recheck だけでは分からない runtime failure / sanitizer finding / short fuzz crash を、CLI 実行と保存済み artifact / evidence として扱えるようにすること。LLM は実行主体ではない。LLM は保存済み dynamic artifact / evidence を後段でレビューするだけで、test command、sanitizer command、fuzz target を自由生成しない。

重要な責務境界:

- heavy dynamic work は CLI に委譲する。
- API route は Docker / dynamic runner を直接呼ばない。API は `dynamic:run` CLI への argv bridge に限定する。
- Phase 10 は project-defined script 実行を扱うため、Phase 9 より強い明示設定と consent boundary を要求する。
- target repository は host 上では変更しない。
- container 内で write が必要な場合は read-only source mount から ephemeral workdir へコピーして実行する。
- network は default deny。依存 install や外部 probing は Phase 10 の通常実行に含めない。

## Source Baseline

前提実装:

- Phase 8 Docker toolbox runner が存在する。
- Phase 9 reproduction schema / repository / artifact / evidence の実装が存在する。
- Phase 9 で `reproduction_runs` は finding-scoped の bounded recheck として使われる。
- Reproduction artifact storage pattern が存在する。
- API は heavy work を CLI bridge 経由で実行する方針になっている。
- Finding detail UI に artifact / evidence / review / decision を表示する導線がある。

実装前に確認する baseline:

```bash
git status --short
git diff --check
bun run verify
bun run repro:finding -- --finding-id <finding-id> --profile semgrep-path-recheck --runner docker --dry-run true
```

確認すること:

- Phase 9 実装が未コミットの場合は、Phase 10 の変更と混ぜて壊さない。
- Phase 9 の `reproduction_runs.finding_id` が non-null の場合、Phase 10 の project-level 実行に無理に流用しない。
- Docker runner が read-only source mount と writable output mount を維持している。
- 通常 `bun run verify` は Docker daemon / image build を要求しない。

## Scope

Phase 10 で実装するもの。

- dynamic profile config schema
- dynamic run DB schema / migration
- dynamic artifact DB schema / migration
- dynamic evidence DB schema / migration
- dynamic profile registry / validator
- dynamic runner with bounded Docker sandbox execution
- read-only source mount + optional ephemeral writable workdir copy
- stdout / stderr / crash / summary artifact保存
- test / sanitizer / fuzz outcome判定
- `dynamic:run` CLI
- dynamic API
- project / finding detail UI の Dynamic Verification panel
- mocked Docker tests so normal verify does not require Docker
- opt-in Docker smoke test documentation

Phase 10 で実装しないもの。

- full DAST
- browser automation
- external target scan
- network attack
- unrestricted fuzzing
- long-running fuzz campaign
- exploit generation
- patch generation
- package install by default
- dependency update
- Docker socket passthrough
- privileged container
- target repo write on host
- CI 必須化

## Definition of Done

Phase 10 は、次を満たしたら完了とする。

- Project owner が許可した dynamic profile だけを実行できる。
- `dynamic:run` CLI から project ID と profile ID を指定して bounded dynamic run を実行できる。
- API は Docker runner を直接呼ばず、CLI bridge を通す。
- command は validated argv array として保存・実行される。
- shell string、`bash -c`、`sh -c` は拒否される。
- sanitizer / fuzz profile は明示設定がある場合だけ実行できる。
- target repo は host 上で変更されない。
- stdout / stderr / crash / summary artifact が redaction 後に保存される。
- dynamic evidence が project / scan / finding のいずれかへ安全に紐づく。
- dynamic run failure は既存 scan / finding / review / decision / reproduction / report を壊さない。
- timeout / resource limit が効く。
- 通常 `bun run verify` は Docker daemon / toolbox image なしで通る。

## Dynamic Run Model

Phase 10 は dedicated `dynamic_runs` を追加する。Phase 9 の `reproduction_runs` は finding-scoped bounded recheck として残し、project-level test / sanitizer / fuzz execution へ無理に流用しない。

基本フロー:

```text
project
  -> allowed dynamic profile selection
  -> deterministic argv construction
  -> Docker sandbox run
  -> stdout / stderr / crash / summary artifacts
  -> dynamic outcome
  -> optional finding linkage
  -> UI / human review
```

Dynamic kind:

```text
test
sanitizer
fuzz
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
failed
crashed
timed_out
inconclusive
error
```

Rules:

- `dynamicKind=test` may produce `passed|failed|timed_out|inconclusive|error`.
- `dynamicKind=sanitizer` may produce `passed|failed|crashed|timed_out|inconclusive|error`.
- `dynamicKind=fuzz` may produce `passed|crashed|timed_out|inconclusive|error`.
- A non-zero exit code is not always `error`; it may be `failed` or `crashed` depending on profile evaluator.
- Artifact persistence failure is always `status=failed`, `outcome=error`.

## Configuration Model

Use a dedicated project dynamic profile config instead of free-form command submission.

Recommended storage:

```text
dynamic_profile_configs
  id
  project_id
  profile_id
  dynamic_kind
  display_name
  enabled
  command_json
  working_directory
  timeout_sec
  network
  memory
  cpus
  writable_workdir
  allow_project_scripts
  expected_artifacts_json
  metadata
  created_by_user_id
  created_at
  updated_at
```

Rules:

- `command_json` is an argv array.
- `working_directory` is repository-relative.
- `timeout_sec` must be positive and bounded by a global max, for example 300 seconds.
- `network` defaults to `none`.
- `writable_workdir` defaults to `false`.
- `allow_project_scripts` defaults to `false`.
- `dynamicKind=sanitizer|fuzz` requires explicit project config.
- No request-time arbitrary command override.

Command validation:

```text
Allowed binary families:
  bun
  node
  npm
  pnpm
  yarn
  python
  python3
  pytest
  cargo
  go

Rejected:
  sh
  bash
  zsh
  fish
  curl
  wget
  nc
  ncat
  ssh
  docker
  sudo
  chmod
  chown
  rm
  mv
  cp
```

Project script rules:

- `npm test`, `pnpm test`, `yarn test`, `bun run <script>` are project script execution.
- Project script execution requires `allow_project_scripts=true`.
- UI must display that project scripts run inside Docker sandbox and may execute project-defined code.
- Project scripts still run without host repo write and without network by default.

## Execution Contract

## Docker Image Policy

Phase 8 の toolbox image は Semgrep / Gitleaks / OSV / Trivy 実行用であり、Node / Python / Rust / Go の test harness 実行を保証しない。

Phase 10 は dedicated dynamic image を追加する。

Suggested files:

```text
docker/dynamic/Dockerfile
docker/dynamic/README.md
scripts/build-dynamic-image.ts
```

Default image:

```text
vuln-workbench-dynamic:local
```

Minimum runtime set:

```text
bun
node/npm
python/pytest
rust/cargo
go
basic build tools needed for tests
```

Rules:

- Image must not include application source.
- Image must not include host secrets.
- Image must not require Docker socket.
- Image should run as non-root by default where practical.
- Runtime version output should be available for metadata.
- Missing runtime in image is a dynamic run failure, not a reason to run on host.

Build script:

```json
{
  "docker:dynamic:build": "bun run scripts/build-dynamic-image.ts"
}
```

Normal `bun run verify` must not build this image.

Container paths:

```text
/workspace/repo
  read-only source mount

/workspace/workdir
  optional writable copy of source for tests that write build/cache files

/workspace/out
  writable artifacts and run summaries

/workspace/cache
  optional cache mount separate from repo and out
```

Execution modes:

```text
read-only
  command runs in /workspace/repo
  no writes to source

writable-workdir-copy
  command first copies /workspace/repo to /workspace/workdir
  command runs in /workspace/workdir
  host repo remains unchanged
```

Rules:

- Phase 10 must not write to host repo.
- If a profile requires writes, use `writable_workdir=true`.
- Dependency install is not part of Phase 10 normal execution.
- If dependencies are missing, the run fails with artifact evidence rather than installing packages.
- Network open requires explicit `network=default` in saved profile config.
- Docker unavailable must not fallback to host.

## Built-In Profile Templates

Templates create validated config records; runtime execution always reads saved config.

### `bun-test`

Applicability:

- `package.json` exists.
- `bun.lock` or `bun.lockb` exists, or user explicitly enables the profile.

Command:

```text
["bun", "test"]
```

Defaults:

```text
dynamicKind: test
timeoutSec: 120
network: none
writableWorkdir: true
allowProjectScripts: false
```

Evaluator:

- exit code 0 -> `outcome=passed`
- non-zero exit code with completed process -> `outcome=failed`
- timeout -> `outcome=timed_out`

### `npm-test`

Applicability:

- `package.json` has `scripts.test`.
- profile requires `allowProjectScripts=true`.

Command:

```text
["npm", "test", "--", "--runInBand"]
```

If the repo does not use Jest, the extra args may be wrong. Implementation may instead default to:

```text
["npm", "test"]
```

and store the exact argv in config. The key requirement is explicit project script consent.

### `pytest`

Applicability:

- `pyproject.toml`, `pytest.ini`, or `tests/` exists.

Command:

```text
["pytest", "-q"]
```

Defaults:

```text
dynamicKind: test
timeoutSec: 120
network: none
writableWorkdir: true
allowProjectScripts: false
```

### `cargo-test`

Applicability:

- `Cargo.toml` exists.

Command:

```text
["cargo", "test", "--locked"]
```

Defaults:

```text
dynamicKind: test
timeoutSec: 180
network: none
writableWorkdir: true
```

### `go-test`

Applicability:

- `go.mod` exists.

Command:

```text
["go", "test", "./..."]
```

Defaults:

```text
dynamicKind: test
timeoutSec: 180
network: none
writableWorkdir: true
```

## Sanitizer Profiles

Sanitizer profiles are config-gated and not auto-enabled.

Supported minimum:

```text
cargo-asan-test
```

Example command:

```text
["cargo", "test", "--locked"]
```

Environment:

```text
RUSTFLAGS=-Zsanitizer=address
```

Rules:

- Sanitizer env allowlist must be explicit per profile.
- Sanitizer output is parsed from stderr/stdout.
- If sanitizer signature is detected, outcome is `crashed`.
- If command exits non-zero without sanitizer signature, outcome is `failed`.
- Nightly Rust / toolchain installation is out of scope. Missing toolchain is `failed` or `inconclusive`, not auto-install.

Phase 10 may define sanitizer profile schema before providing broad language support.

## Lightweight Fuzzing Profiles

Fuzz profiles are config-gated and not auto-discovered.

Rules:

- Fuzz command must be saved in project config.
- Timeout max should be short, for example 60 seconds by default and 300 seconds maximum.
- A timeout may be expected for fuzzing. If no crash artifact exists, outcome can be `passed` or `inconclusive` based on evaluator.
- Crash signatures create `outcome=crashed`.
- Corpus directories must be inside writable workdir or output mount, not host repo.
- Long-running campaigns are out of scope.

Suggested minimal schema fields:

```json
{
  "profileId": "parser-light-fuzz",
  "dynamicKind": "fuzz",
  "command": ["bun", "run", "fuzz:parser"],
  "timeoutSec": 60,
  "writableWorkdir": true,
  "allowProjectScripts": true,
  "crashPatterns": ["panic", "AddressSanitizer", "segmentation fault"],
  "expectedArtifactGlobs": ["crashes/**", "artifacts/**"]
}
```

## Data Model

Add migration after the current latest migration.

### `dynamic_profile_configs`

```text
id
project_id
profile_id
dynamic_kind
display_name
enabled
command_json
working_directory
timeout_sec
network
memory
cpus
writable_workdir
allow_project_scripts
expected_artifacts_json
metadata
created_by_user_id
created_at
updated_at
```

Indexes:

- unique `(project_id, profile_id)`
- index `project_id`
- index `dynamic_kind`
- index `enabled`

### `dynamic_runs`

```text
id
project_id
scan_run_id nullable
finding_id nullable
profile_config_id
profile_id
dynamic_kind
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

Indexes:

- `project_id`
- `scan_run_id`
- `finding_id`
- `profile_config_id`
- `status`
- `outcome`
- `dynamic_kind`

### `dynamic_artifacts`

```text
id
dynamic_run_id
project_id
finding_id nullable
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
stdout
stderr
log
crash
summary
coverage
raw_result
```

### `dynamic_evidence`

```text
id
dynamic_run_id
project_id
finding_id nullable
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
dynamic-test-log
sanitizer-finding
fuzz-crash
dynamic-result
```

Rules:

- `finding_id` is nullable so project-level test runs are possible.
- If launched from finding detail, set `finding_id`.
- Dynamic evidence is displayed separately from reproduction evidence and static finding evidence.
- Do not mutate existing scan findings from Phase 10 dynamic run results.

## Storage Contract

Add dynamic artifact storage helper, mirroring reproduction artifact storage.

Required methods:

```text
saveDynamicRawArtifact(dynamicRunId, sourcePath, suggestedFilename)
saveDynamicLog(dynamicRunId, logType, content, suggestedFilename?)
saveDynamicTextArtifact(dynamicRunId, subDir, content, filename)
readDynamicTextArtifact(relativePath)
```

Rules:

- Store under `artifacts/dynamic/<dynamicRunId>/...`.
- Validate paths against dynamic artifact root.
- Redact stdout/stderr/raw results before persistence.
- Persist stdout/stderr even when command fails or times out if captured.
- Expected crash artifact globs are copied from container output mount only.

## CLI Contract

Add script:

```json
{
  "dynamic:run": "bun run api/cli/dynamic-run.ts"
}
```

Primary command:

```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test \
  --runner docker \
  --docker-image vuln-workbench-dynamic:local \
  --network none
```

Options:

```text
--project-id <id>                  required
--profile <profile-id>             required
--finding-id <id>                  optional
--scan-run-id <id>                 optional
--runner docker                    default docker
--docker-bin <path>
--docker-image <image>
--network none|default
--timeout-sec <seconds>
--memory <limit>
--cpus <limit>
--tool-cache-dir <path>
--output-summary <path>
--dry-run true|false
```

Required behavior:

- stdout is JSON only.
- invalid args return failed JSON before DB mutation.
- profile missing / disabled returns failed JSON before DB mutation.
- dangerous command config returns failed JSON before DB mutation.
- `--dry-run true` returns resolved command, execution mode, and policy checks without creating a run.
- Docker unavailable after run creation marks `dynamic_runs.status=failed`, `outcome=error`.
- No host fallback when `runner=docker`.

Success JSON:

```json
{
  "ok": true,
  "dynamicRunId": "...",
  "projectId": "...",
  "findingId": null,
  "profileId": "bun-test",
  "dynamicKind": "test",
  "status": "completed",
  "outcome": "passed",
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
  "dynamicRunId": "...",
  "projectId": "...",
  "profileId": "parser-light-fuzz",
  "dynamicKind": "fuzz",
  "status": "timed_out",
  "outcome": "timed_out",
  "runner": "docker",
  "message": "Dynamic run timed out after 60 seconds"
}
```

## API Contract

Add routes:

```text
GET  /api/projects/:projectId/dynamic-profiles
POST /api/projects/:projectId/dynamic-profiles
PATCH /api/projects/:projectId/dynamic-profiles/:profileId
GET  /api/projects/:projectId/dynamic-runs
POST /api/projects/:projectId/dynamic-runs
GET  /api/findings/:findingId/dynamic-runs
POST /api/findings/:findingId/dynamic-runs
GET  /api/dynamic-runs/:dynamicRunId
GET  /api/dynamic-runs/:dynamicRunId/artifacts
```

Required behavior:

- Validate auth.
- Validate project ownership.
- Validate finding ownership when finding ID is provided.
- Validate profile config before storing it.
- Validate profile allowlist before CLI invocation.
- POST run calls `dynamic:run` CLI via argv array.
- GET routes read repository only.
- Never pass request-provided arbitrary command to runner.
- Never call Docker runner directly from route handler.

HTTP behavior:

- Invalid profile config: `400`.
- Not found: `404`.
- Forbidden project: `403`.
- CLI bridge parse failure: `500`.
- Valid CLI JSON with `ok=false` and `dynamicRunId`: return `200` with failed run body, so UI can show persisted artifacts/error.

## Frontend Scope

Add Dynamic Verification panel.

Locations:

- Project detail or scan area: project-level dynamic profiles and runs.
- Finding detail: finding-linked dynamic runs.

UI behavior:

- Show available dynamic profiles.
- Show whether profile is built-in, configured, disabled, or unsafe.
- Show command argv in read-only form before running.
- Require explicit confirmation for `allowProjectScripts=true`.
- Start run via API.
- Show latest run status, outcome, kind, exit code, timeout, created/completed time.
- Show stdout/stderr/crash artifact links or expandable snippets.
- Show sanitizer/fuzz crash evidence separately from:
  - static finding evidence
  - reproduction evidence
  - LLM review
  - human decision

Copy rules:

- Do not imply fuzz timeout means safe.
- Do not imply test pass means vulnerability is fixed.
- Use wording such as "bounded dynamic check" and "observed crash" rather than broad security claims.

## Implementation Steps

### P0: Baseline Inspection

- Confirm Phase 9 reproduction implementation status.
- Confirm current latest migration number.
- Confirm whether Phase 9 `reproduction_runs.finding_id` is non-null.
- Confirm Docker runner can support writable ephemeral workdir. If not, plan the minimal extension.
- Confirm UI location for project-level dynamic panel.

Completion criteria:

- Dynamic run uses dedicated tables, not Phase 9 tables.
- Execution mode for writable workdir is decided.

### P1: Schema and Repository

- Add migration for `dynamic_profile_configs`, `dynamic_runs`, `dynamic_artifacts`, `dynamic_evidence`.
- Add DB schema exports.
- Add shared zod schemas.
- Add repository for configs, runs, artifacts, evidence.

Completion criteria:

- Repository tests cover create/update/list/get.
- Nullable finding linkage is covered.
- Foreign key failures are covered.

### P2: Profile Config and Validation

- Implement profile config validator.
- Implement command binary allowlist.
- Reject shell strings and shell binaries.
- Reject network default unless explicitly configured.
- Reject project scripts unless `allow_project_scripts=true`.
- Implement built-in template detection and suggested configs.

Completion criteria:

- Validation tests cover allowed and rejected commands.
- Project script consent tests pass.
- Dry-run can show policy decisions.

### P3: Dynamic Docker Runner

- Add dynamic runner module.
- Reuse Phase 8 Docker execution where possible.
- Add writable-workdir-copy support if needed.
- Capture stdout/stderr/exit code/elapsed time.
- Collect expected crash artifacts from output mount.
- Apply timeout/resource/network settings.

Completion criteria:

- Mocked Docker tests pass without Docker daemon.
- No host repo write occurs.
- Docker unavailable does not fallback to host.

### P4: Outcome Evaluators

- Implement test evaluator.
- Implement sanitizer evaluator using crash/sanitizer patterns.
- Implement fuzz evaluator using crash patterns and expected artifacts.
- Store evaluator result in `dynamic_runs.metadata`.

Completion criteria:

- Evaluator tests cover passed, failed, crashed, timed_out, inconclusive, error.

### P5: Artifact and Evidence

- Add dynamic artifact storage helper.
- Persist redacted stdout/stderr/log/crash/summary artifacts.
- Create dynamic evidence rows.
- Ensure artifact persistence failure prevents completed status.

Completion criteria:

- Path traversal tests pass.
- Redaction tests pass.
- Failed and timed out runs still persist captured logs.

### P6: CLI

- Add `api/cli/dynamic-run.ts`.
- Add `dynamic:run` script.
- Implement JSON-only stdout.
- Implement `--dry-run`.
- Implement `--output-summary`.

Completion criteria:

- CLI tests cover success, invalid profile, unsafe command, Docker unavailable, timeout, output summary failure.

### P7: API

- Add dynamic routes.
- Wire auth middleware.
- Route run creation through CLI bridge only.
- Route reads through repository only.

Completion criteria:

- Route tests cover ownership, config validation, run create, run get, artifact list.
- Route tests assert Docker runner is not imported/called from route.

### P8: UI

- Extend web API client.
- Add Dynamic Verification panel.
- Add profile config/read UI if needed.
- Add run list and artifact/evidence summary.
- Keep dynamic evidence visually separate from reproduction/review/decision.

Completion criteria:

- UI builds.
- Existing scan/finding/reproduction/report flows still work.
- Unsafe/disabled/no-profile states are clear.

### P9: Verification and Smoke

- Add unit tests for config validation, repository, runner, evaluator, CLI, routes.
- Add mocked Docker tests for normal verify.
- Document opt-in Docker smoke commands.

Completion criteria:

- `git diff --check` passes.
- `bun run verify` passes without Docker.
- Opt-in Docker smoke can be run manually when image exists.

## Verification Commands

Normal verification:

```bash
git diff --check
bun run test
bun run verify
```

Expected:

- Docker daemon / dynamic image is not required.
- Existing scan/reproduction/review/decision/report tests still pass.
- Dynamic tests use mocks unless explicitly marked smoke.

CLI dry-run:

```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test \
  --runner docker \
  --dry-run true
```

Expected:

- JSON stdout only.
- No DB run row created.
- Resolved argv and policy checks are shown.
- No shell string appears.

Unsafe command validation:

```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile unsafe-shell-profile \
  --runner docker \
  --dry-run true
```

Expected:

- failed JSON.
- no DB mutation.
- reason mentions rejected shell command or unsafe binary.

Docker unavailable:

```bash
VULN_WORKBENCH_DOCKER_BIN=/tmp/vuln-workbench-missing-docker \
  bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test \
  --runner docker
```

Expected:

- failed JSON.
- host runner is not used.
- if run was created, it is marked failed with `outcome=error`.
- captured stdout/stderr artifacts are saved only if available.

Opt-in Docker smoke:

```bash
bun run docker:dynamic:build
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test \
  --runner docker \
  --docker-image vuln-workbench-dynamic:local \
  --network none
```

Expected:

- dynamic run is created.
- stdout/stderr artifacts are saved.
- outcome is persisted.
- host repo is unchanged.
- no LLM/API key appears in metadata or artifacts.

## Failure Handling

Invalid profile config:

- Fail before DB mutation.
- Return reason in JSON.
- Do not create run/artifact/evidence rows.

Unsafe command:

- Fail before DB mutation.
- Include rejected token/binary in safe error message.
- Do not attempt Docker execution.

Docker unavailable / image missing:

- Do not fallback to host.
- If failure occurs after run creation, mark run failed and store error metadata.

Timeout:

- Attempt container cleanup.
- Mark `status=timed_out`.
- Use `outcome=timed_out` unless artifact persistence failed, then `outcome=error`.
- Save captured stdout/stderr when available.

Crash detected:

- Mark `outcome=crashed`.
- Save crash artifact and create `dynamic_evidence.kind=fuzz-crash` or `sanitizer-finding`.

Artifact persistence failure:

- Mark failed/error.
- Do not mark dynamic run complete.

Missing dependencies:

- Treat as command failure or inconclusive based on evaluator.
- Do not install packages automatically.
- Save logs so user can see missing dependency.

Network required:

- If profile needs network but `network=none`, fail clearly or mark inconclusive.
- Do not silently open network.

## Security Requirements

- No arbitrary request-time command execution.
- No shell interpolation.
- No `bash -c` / `sh -c`.
- No Docker socket mount.
- No privileged container.
- No host repo write.
- No package install by default.
- No network open by default.
- No host fallback for Docker requested runs.
- No env dump in metadata.
- Secret-like stdout/stderr/crash/raw content is redacted before persistence.
- Project script execution requires explicit saved config and UI confirmation.

## Stop Conditions

Stop implementation and revise the plan if any of these become necessary:

- unbounded fuzzing
- LLM-generated test/fuzz/sanitizer command
- external network probing
- package install / dependency update
- privileged container
- Docker socket passthrough
- host repo write
- long-running fuzz campaign
- browser automation
- changing existing finding/reproduction/review/decision semantics to fit dynamic runs

## Handoff to Phase 11

Phase 11 adds DAST / browser automation. It must use a separate target scope and network boundary model. Phase 10 dynamic profiles must not be stretched into browser automation or external target probing.
