# Phase 8: Docker Toolbox Runner Implementation Plan

## Purpose

この計画は、vulnWorkbench の Phase 8 として、Phase 7 の scan profile orchestration が使う tool execution backend に Docker toolbox runner を追加するためのもの。

目的は、Semgrep/Gitleaks/OSV-Scanner/Trivy の実行環境を host 直実行だけに依存しない形へ拡張し、tool version、実行環境、secret 境界、target repo への影響低減を改善すること。

重要な責務境界:

- heavy scan work は引き続き CLI に委譲する。
- Phase 8 は Phase 7 の profile orchestration を作り直さない。
- Docker runner は tool process/container execution の backend であり、finding/evidence/report の意味付けは既存 normalizer と builder に任せる。
- LLM は Docker runner 内でも呼ばない。
- Docker toolbox は sandbox reproduction ではない。finding を exploit/reproduce する機能は Phase 9 で扱う。

## Source Baseline

前提実装:

- `scan:profile` CLI が存在する。
- profile runner が 1 つの scan run に複数 `tool_runs` / artifacts / findings / evidence を保存できる。
- Semgrep/Gitleaks/OSV-Scanner/Trivy adapter が host runner で動く。
- tool execution は argv 配列で行われ、shell interpolation を使わない。
- raw JSON/stdout/stderr artifact は redaction 済みで保存される。
- `tool_runs.metadata` に adapter、elapsedMs、artifactIds、finding/evidence count、error などを保存できる。
- `scan_events` が profile/tool lifecycle event を保存できる。

実装前に確認する baseline:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --runner host
```

確認すること:

- host runner で baseline profile scan が完了する。
- `tool_runs.metadata.runner` が未設定または `host` 相当として扱える。
- raw artifact/stdout/stderr/finding/evidence/report の既存 flow が壊れていない。
- Docker runner 追加前の `bun run verify` が通る。

## Scope

Phase 8 で実装するもの。

- Docker toolbox image definition
- Docker image build script
- tool execution backend abstraction
- host backend / docker backend の選択
- `scan:profile --runner host|docker`
- 必要なら個別 scan CLI の `--runner host|docker`
- read-only repo mount
- writable artifact/output mount
- secret env filtering
- Docker command allowlist
- non-privileged container execution
- network mode selection
- timeout/resource limit
- tool version capture
- Docker unavailable / image missing / mount failure の明確な failure
- Docker runner unit tests
- opt-in Docker smoke test
- host runner regression tests

Phase 8 で実装しないもの。

- Phase 7 profile orchestration の再設計
- durable background queue
- parallel execution
- arbitrary user command execution
- exploit reproduction
- sanitizer/fuzzing
- DAST/browser automation
- browser automation
- Docker socket passthrough
- privileged container
- target repo write
- image scan / Kubernetes scan / remote repository scan
- network-open scan by default
- CI 必須化

## Definition of Done

Phase 8 は、次を満たしたら完了とする。

- `bun run scan:profile -- --project-id <project-id> --profile baseline --runner host` が従来通り動く。
- `bun run scan:profile -- --project-id <project-id> --profile baseline --runner docker --docker-image vuln-workbench-toolbox:local` が Docker toolbox で実行できる。
- Docker runner は allowlist された Semgrep/Gitleaks/OSV-Scanner/Trivy invocation だけを実行する。
- target repo は container 内で read-only mount される。
- artifact/output mount だけが writable になる。
- LLM/API key/host secret env が container に渡らない。
- Docker socket は mount されない。
- privileged mode は使われない。
- Docker unavailable 時に host runner へ暗黙 fallback しない。
- tool failure でも既存 artifact/finding を削除しない。
- `tool_runs.metadata.runner` に `docker`、image、networkMode、mountMode、resourceLimits、containerId または container name、tool version が保存される。
- `scan_events` に docker container lifecycle event が残る。
- Docker がない環境でも通常の `bun run verify` は通る。
- Docker smoke は明示 opt-in で実行できる。

## Runner Model

Phase 8 では、既存 runner の normalizer と DB 保存ロジックは変更しない。変更対象は process/container execution 境界に限定する。

追加する抽象:

```text
ToolExecutionBackend
  host
  docker
```

候補 interface:

```text
executeTool({
  toolId,
  argv,
  repoPath,
  outputFileName,
  timeoutSec,
  env,
  resourceLimits,
  networkMode
}) -> {
  ok,
  exitCode,
  stdout,
  stderr,
  elapsedMs,
  rawOutputHostPath,
  metadata
}
```

Backend responsibilities:

- argv 配列での実行
- timeout
- process/container cleanup
- stdout/stderr capture
- clean env
- raw output path の host path と container path の対応
- elapsed time
- backend metadata 生成

Adapter responsibilities:

- tool-specific argv の組み立て
- exit code interpretation
- raw JSON parse
- redacted artifact 保存
- normalizer 呼び出し
- finding/evidence 保存

禁止:

- Docker backend が finding/evidence を直接作る。
- Docker backend が LLM を呼ぶ。
- API route が Docker backend を直接呼ぶ。
- shell string を組み立てて実行する。

## Docker Path Contract

Docker runner は host path と container path を deterministic に対応させる。

Container paths:

```text
/workspace/repo
  target repo read-only mount

/workspace/out
  tool raw output write mount

/workspace/cache
  optional tool cache mount, read-write, target repoとは分離
```

Host paths:

```text
repoPath
  project.repoPath

toolOutputDir
  temporary host directory under os.tmpdir()
  mounted to /workspace/out
  removed after ArtifactStorage saves raw artifact

toolCacheDir
  optional cache under artifact root or app cache root
  must not contain user secrets
```

Rules:

- tool command inside container must reference `/workspace/repo` and `/workspace/out/<file>`.
- adapter must receive `rawOutputHostPath` for `ArtifactStorage.saveRawArtifact`.
- target repo must never be used as output directory.
- output file missing is a tool failure, not a normalizer failure.
- output file is saved only after redaction.
- cleanup failure is logged as warning event but does not delete DB records.

## Docker Image

Image location:

```text
docker/toolbox/Dockerfile
docker/toolbox/README.md
scripts/build-toolbox-image.ts or scripts/build-toolbox-image.sh
```

Image contains:

```text
semgrep
gitleaks
osv-scanner
trivy
minimal shell utilities needed by tools
non-root runtime user
```

Image should not contain:

```text
application source
user repo
LLM credentials
Docker CLI requirement inside container
Docker socket
```

Version policy:

- build step prints and records tool versions.
- runtime scan captures tool `--version` into `tool_runs.toolVersion` and metadata.
- image label should include toolbox version.
- version mismatch must not change finding schema.
- if a tool output schema differs by version, add fixture and normalizer branch before supporting it.

Cache/network policy:

- Default scan execution should use `--network none` where possible.
- Tools that need vulnerability DB or advisory DB updates must use one of:
  - prebuilt image with cached DB, or
  - explicit `--network default` run requested by CLI option.
- Phase 8 must not silently open network.
- If network is required but disabled, return clear failed JSON and scan event.

## Security Boundary

Docker runner must enforce:

- target repo mount is read-only.
- artifact/output mount is the only required writable mount.
- cache mount is separate from repo and artifact output.
- container runs without `--privileged`.
- Docker socket is never mounted.
- host secret env is filtered.
- LLM/API keys are not passed into container.
- command is selected from allowlist, not arbitrary user input.
- no shell interpolation.
- optional `--network default` is explicit.
- resource limits are applied when provided.
- container cleanup is attempted on timeout/failure.

Environment allowlist:

```text
PATH
HOME inside container only
tool-specific non-secret env explicitly required by adapter
```

Environment denylist must include:

```text
OPENAI
AZURE
LLM
SECRET
KEY
TOKEN
PASSWORD
PRIVATE
CREDENTIAL
```

## CLI Contract

Primary command:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --runner docker \
  --docker-image vuln-workbench-toolbox:local
```

Options:

```text
--runner host|docker
--docker-bin <path>
--docker-image <image>
--network none|default
--memory <limit>
--cpus <limit>
--tool-cache-dir <path>
```

Defaults:

```text
runner: host
docker-bin: docker or VULN_WORKBENCH_DOCKER_BIN
network: none
docker-image: vuln-workbench-toolbox:local
memory/cpus: unset unless provided
```

Required behavior:

- stdout is JSON only.
- `--runner host` keeps existing behavior.
- `--runner docker` never falls back to host implicitly.
- Docker unavailable returns failed JSON.
- invalid Docker option returns failed JSON before scan run creation when possible.
- scan run created before tool execution must be moved to failed if Docker setup fails after creation.
- tool failure keeps already persisted artifacts/findings from other tools.

Success JSON should include:

```json
{
  "ok": true,
  "scanRunId": "...",
  "profileId": "baseline",
  "runner": "docker",
  "profileOutcome": "completed",
  "toolResults": []
}
```

Failure JSON should include:

```json
{
  "ok": false,
  "scanRunId": "...",
  "runner": "docker",
  "status": "failed",
  "message": "Docker image not found: vuln-workbench-toolbox:local"
}
```

## Data Model

Do not add a new table in Phase 8 unless existing metadata fields are insufficient.

Store runner metadata in `tool_runs.metadata`:

```json
{
  "runner": "docker",
  "docker": {
    "image": "vuln-workbench-toolbox:local",
    "containerName": "vuln-workbench-scan-...",
    "containerId": "...",
    "networkMode": "none",
    "mountMode": {
      "repo": "read-only",
      "output": "read-write",
      "cache": "read-write"
    },
    "resourceLimits": {
      "memory": "2g",
      "cpus": "2"
    }
  },
  "elapsedMs": 1234,
  "toolVersion": "..."
}
```

Store lifecycle in `scan_events`:

```text
docker.container.create
docker.container.start
docker.container.exit
docker.container.timeout
docker.container.cleanup_failed
```

Metadata must not contain secrets or full env dumps.

## API Contract

Phase 8 should not make API execute heavy scan work in-process.

If Phase 7 has `POST /api/projects/:id/scans` as a CLI bridge, extend request schema:

```json
{
  "profile": "baseline",
  "runner": "docker",
  "dockerImage": "vuln-workbench-toolbox:local",
  "network": "none",
  "memory": "2g",
  "cpus": "2"
}
```

API behavior:

- validate ownership.
- validate runner options.
- call `scan:profile` CLI via argv array.
- parse JSON stdout.
- return runner/profile outcome.
- never call Docker backend directly from route handler.
- never pass request-provided arbitrary command to CLI.

## Implementation Steps

### P0: Baseline Inspection

- `git status --short` を確認する。
- `scan:profile --runner host` の現状を確認する。
- Phase 7 の tool execution boundary を確認する。
- current `tool-process-runner` / adapter runner が argv と output path をどう扱うか確認する。
- artifact storage root と temp output directory の関係を確認する。

Completion criteria:

- Docker backend が差し込む interface が決まっている。
- Phase 7 orchestration を変更しなくても backend を選べる見通しがある。

### P1: Execution Backend Abstraction

- `ToolExecutionBackend` interface を追加する。
- host backend を既存 `Bun.spawn` logic から作る。
- adapter runner が backend を受け取れるようにする。
- host runner regression tests を維持する。

Completion criteria:

- `--runner host` で既存 test が通る。
- backend なしの adapter 直実行パターンが残らない。

### P2: Docker Toolbox Image

- `docker/toolbox/Dockerfile` を追加する。
- non-root user を作る。
- Semgrep/Gitleaks/OSV-Scanner/Trivy を install する。
- version check command を image build/smoke に含める。
- build script を追加する。

Completion criteria:

- `docker build -t vuln-workbench-toolbox:local -f docker/toolbox/Dockerfile .` が成功する。
- container 内で対象 tool の version が取れる。

### P3: Docker Backend

- Docker backend module を追加する。
- Docker binary path を `--docker-bin` または `VULN_WORKBENCH_DOCKER_BIN` で差し替え可能にする。
- repo read-only mount を実装する。
- output mount を実装する。
- optional cache mount を実装する。
- env filtering を実装する。
- timeout/resource limit/network mode を実装する。
- container cleanup を実装する。
- lifecycle scan events を保存する呼び出し口を用意する。

Completion criteria:

- mocked Docker command test が通る。
- Docker unavailable path が failed JSON になる。
- generated docker args に `--privileged` や Docker socket mount が含まれない。

### P4: Adapter/Profile Integration

- `scan:profile` に `--runner host|docker` を追加する。
- profile tool execution に Docker backend を渡す。
- 必要なら個別 scan CLI にも `--runner` を追加する。
- `tool_runs.metadata` に runner metadata を保存する。
- Docker failure が profile outcome rules に従って保存されるようにする。

Completion criteria:

- host runner と docker runner を CLI option で切り替えられる。
- Docker runner の tool result が既存 normalizer で finding/evidence になる。

### P5: Smoke and Regression

- Docker smoke test を opt-in で追加する。
- host regression test を維持する。
- Docker image missing / Docker daemon unavailable / mount failure を確認する。
- report generation が Docker runner metadata を壊さないことを確認する。

Completion criteria:

- Docker なしでも `bun run verify` が通る。
- Docker smoke を明示実行すると toolbox scan が完了する。

## Verification Commands

通常 verification:

```bash
git diff --check
bun run test
bun run verify
```

Expected:

- Docker がない環境でも通る。
- host runner の既存挙動が壊れない。

Docker image build:

```bash
docker build \
  -t vuln-workbench-toolbox:local \
  -f docker/toolbox/Dockerfile .
```

Expected:

- build succeeds.
- image contains semgrep/gitleaks/osv-scanner/trivy.
- image does not require Docker socket.

Docker version smoke:

```bash
docker run --rm --network none vuln-workbench-toolbox:local semgrep --version
docker run --rm --network none vuln-workbench-toolbox:local gitleaks version
docker run --rm --network none vuln-workbench-toolbox:local osv-scanner --version
docker run --rm --network none vuln-workbench-toolbox:local trivy --version
```

Expected:

- each command exits 0.
- version output is visible.

Profile Docker smoke:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --runner docker \
  --docker-image vuln-workbench-toolbox:local \
  --network none
```

Expected:

- scan run is created.
- tool runs include `metadata.runner = "docker"`.
- repo mount is read-only.
- raw artifacts are saved.
- findings/evidence are generated through existing normalizers.
- no LLM/API key appears in tool metadata, stdout/stderr artifact, or container env.

Docker unavailable:

```bash
VULN_WORKBENCH_DOCKER_BIN=/tmp/vuln-workbench-missing-docker \
  bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --runner docker
```

Expected:

- command returns failed JSON.
- host runner is not used.
- scan run is either not created, or created and marked failed with clear scan event.

Report regression:

```bash
bun run report:scan -- \
  --scan-run-id <docker-scan-run-id> \
  --format markdown \
  --output /tmp/vuln-workbench-docker-report.md
```

Expected:

- report is generated from stored DB/artifacts only.
- report generation does not run Docker, scan tools, or LLM.

## Failure Handling

Docker unavailable:

- fail before scan run creation when possible.
- otherwise set scan run failed and add scan event.
- do not fallback to host.

Image missing:

- return clear failed JSON.
- include image name.
- do not attempt pull unless explicit option is added in a later phase.

Mount failure:

- fail tool run.
- keep previous tool artifacts/findings.
- record mount path category, not sensitive host env.

Tool output missing:

- fail tool run.
- save stdout/stderr artifact if present.
- save scan event with expected output path category.

Timeout:

- kill/remove container.
- mark tool run failed.
- include elapsedMs and timeoutSec in metadata.

Cleanup failure:

- record warning event.
- do not mark successful scan failed solely because cleanup warning happened after all required artifacts were saved.

## Stop Conditions

- Docker socket mount becomes necessary.
- privileged container becomes necessary.
- target repo write becomes necessary.
- arbitrary user command execution becomes necessary.
- API route wants to execute Docker backend directly.
- host runner would be silently used after Docker failure.
- network must be open by default.
- Phase 9 sandbox reproduction starts entering Phase 8.
- normalizer schema changes are needed without fixture evidence.
- implementation requires redesigning Phase 7 profile orchestration.

## Handoff to Phase 9

Phase 9 will use the toolbox runner as an execution substrate for limited sandbox reproduction.

Phase 8 should hand off:

- stable `ToolExecutionBackend` interface
- Docker image build process
- mount contract
- runner metadata shape
- network/resource option handling
- Docker unavailable/failure behavior
- proof that scan/report flows still work from stored artifacts
