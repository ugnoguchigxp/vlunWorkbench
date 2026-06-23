# Phase 2: Semgrep Adapter Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 2として、最初の実tool adapterであるSemgrepをCLI主導のscan pipelineへ載せるためのもの。

Phase 1で作ったscan domain、artifact storage、finding/evidence保存、CLI import基盤を再利用し、fixture artifactではなく実際のSemgrep CLI出力からfindingを作る。

Phase 2ではLLM reviewは実装しない。Semgrepが一次証拠を生成し、deterministic parserがfinding/evidenceへ正規化し、既存APIで確認できるところまでを対象にする。

## Source Baseline

前提文書:

- `spec/vuln-workbench-concept.md`
- `spec/phase-1-cli-scan-foundation-plan.md`

Phase 1で成立している前提:

- `projects`, `scan_runs`, `tool_runs`, `scan_artifacts`, `findings`, `finding_evidence` が保存できる。
- `scan:import` はfixture artifactを取り込み、finding/evidenceを作れる。
- artifact本体はartifact root配下に保存され、DBには相対path、sha256、sizeを保存する。
- LLMなしでscan foundationが成立する。

## Scope

Phase 2で実装するもの。

- Semgrep CLI runner
- Semgrep JSON artifact保存
- Semgrep stdout/stderr log保存
- Semgrep version capture
- Semgrep JSON normalizer
- Semgrep finding/evidence mapping
- `scan:semgrep` CLI command
- Semgrep fixture parser tests
- Semgrep CLI smoke test

Phase 2で実装しないもの。

- LLM review
- Docker toolbox image
- Gitleaks/OSV/Trivy adapter
- SARIF parser
- Semgrep rule generation
- custom Semgrep rules UI
- Web UIの本格review画面
- reviewer decision workflow
- cross-scan dedupe
- sandbox/DAST/fuzzing

## Definition of Done

Phase 2は、次を満たしたら完了とする。

- `scan:semgrep` がprojectのrepo pathに対してSemgrep CLIを実行できる。
- Semgrep raw JSON、stdout、stderrがscan artifactとして保存される。
- `tool_runs` にSemgrepのtool name、version、command、exit code、statusが保存される。
- Semgrep JSONからdeterministicにfinding/evidenceが生成される。
- LLM provider未設定でもSemgrep scanが完了する。
- Semgrep未インストール時は分かりやすい入力/環境エラーになり、DBに中途半端なcompleted scanを残さない。
- 既存fixture importの挙動が壊れていない。
- `bun run verify` が通る。

## Semgrep Execution Policy

Phase 2ではDocker toolboxを使わず、host上のSemgrep CLIを呼ぶ。

理由:

- Phase 1のCLI/artifact/finding契約を先に実toolで検証したい。
- Docker runnerやtoolbox imageまで同時に入れると、問題の原因がrunner、container、parser、DBのどこにあるか分かりにくくなる。
- Semgrep CLIのraw JSONを安定して保存できれば、Docker化は後続で差し替え可能。

Semgrep commandの基本形:

```bash
semgrep scan --config auto --json --output <raw-json-path> <repo-path>
```

実装時には、Semgrepのversion差を吸収するために、次も許容する。

```bash
semgrep --config auto --json --output <raw-json-path> <repo-path>
```

どちらを採用するかは実装前に手元の `semgrep --version` と `semgrep --help` で確認する。

## CLI Contract

追加するscript:

```json
{
  "scan:semgrep": "bun run api/cli/scan-semgrep.ts"
}
```

Command shape:

```bash
bun run scan:semgrep -- \
  --project-id <project-id> \
  --profile semgrep-baseline \
  --config auto
```

Optional inputs:

```text
--config <semgrep-config>
--timeout-sec <seconds>
--max-target-bytes <bytes>
```

Required behavior:

- repo pathはprojectから読む。
- LLM設定は読まない。
- Semgrep raw JSONはartifact root配下へ保存する。
- stdout/stderrもartifact root配下へ保存する。
- CLI stdoutはmachine-readable JSONだけにする。
- Semgrepのログや警告はartifactへ保存し、CLI stdoutに混ぜない。

Successful output:

```json
{
  "ok": true,
  "scanRunId": "...",
  "toolRunId": "...",
  "artifactIds": ["..."],
  "findingCount": 3,
  "evidenceCount": 6,
  "status": "completed"
}
```

Failure output:

```json
{
  "ok": false,
  "scanRunId": "...",
  "status": "failed",
  "message": "Semgrep executable not found"
}
```

## Semgrep Exit Handling

Semgrep may return non-zero for different reasons. Phase 2 must classify the minimum useful cases.

```text
exit 0:
  command completed. Parse JSON and create findings.

exit 1 with valid JSON:
  command completed with findings or policy result depending on Semgrep behavior. Parse JSON if present.

exit non-zero without valid JSON:
  scan failed. Save stdout/stderr artifacts and mark scan/tool_run failed.

timeout:
  scan failed. Save stdout/stderr captured so far if available.

executable missing:
  input/environment failure. Do not mark scan completed.
```

Implementation should not infer vulnerability severity from exit code. Severity comes from Semgrep JSON result fields.

## Semgrep Normalizer

Add:

```text
api/modules/scans/normalizers/semgrep.ts
api/modules/scans/normalizers/semgrep.test.ts
tests/fixtures/scans/semgrep-result.json
```

Minimum Semgrep JSON fields to parse:

```text
results[].check_id
results[].path
results[].start.line
results[].start.col
results[].end.line
results[].end.col
results[].extra.message
results[].extra.severity
results[].extra.metadata
results[].extra.lines
```

Mapping:

```text
ruleId = check_id
title = extra.message or check_id
description = extra.message
severity = mapSemgrepSeverity(extra.severity)
confidence = static
status = open
primaryLocation = path/start/end
fingerprint = hash("semgrep", check_id, path, start line, start col)
```

Severity mapping:

```text
ERROR -> high
WARNING -> medium
INFO -> low
unknown/missing -> unknown
```

Evidence:

- `source-location` evidence from Semgrep location and `extra.lines`
- `tool-output` evidence linked to raw JSON artifact
- `scan-log` evidence linked to stderr artifact when stderr is non-empty

Redaction:

- Reuse existing redaction helper or extract it into a shared scan normalizer utility.
- Do not send or store obvious secret values unredacted in snippets.

## Runner Design

Add a small Semgrep runner module:

```text
api/modules/scans/tools/semgrep-runner.ts
```

Responsibilities:

- Check executable availability with `semgrep --version`.
- Build command args without shell string interpolation.
- Run Semgrep with `Bun.spawn` or an equivalent structured process API.
- Capture stdout, stderr, exit code, elapsed time.
- Enforce timeout.
- Write raw JSON, stdout, stderr through `ArtifactStorage`.

Avoid:

- `exec` or shell-based command construction.
- Passing secrets or LLM API keys into Semgrep env.
- Mutating the target repo.
- Mixing parser logic into runner logic.

## CLI Workflow

`scan-semgrep.ts` should follow this order.

1. Parse CLI args.
2. Validate project exists.
3. Create `scan_run` with `running`.
4. Create `tool_run` with `running`.
5. Emit `scan.started`.
6. Run Semgrep.
7. Save raw JSON/stdout/stderr artifacts.
8. Update `tool_run` with version, exit code, completed/failed.
9. If raw JSON is valid, parse and normalize findings.
10. Insert findings/evidence.
11. Emit `finding.created` events.
12. Mark scan completed or failed.
13. Print machine-readable JSON to stdout.

If parser fails after raw artifact was saved:

- keep raw artifact
- mark scan failed
- mark tool_run failed if not already completed
- emit `scan.failed`
- print failure JSON

## Task Plan

### P0. Baseline

Work:

- Confirm clean worktree or intentionally scoped changes.
- Run current verify.
- Confirm Phase 1 fixture import still works.

Commands:

```bash
bun run verify
bun test ./api/modules/scans/**/*.test.ts
```

Expected:

```text
OK verify complete
12 pass
```

Stop condition:

- Do not implement Semgrep adapter if Phase 1 fixture path is failing.

### P1. Semgrep Fixture and Normalizer

Work:

- Add `tests/fixtures/scans/semgrep-result.json`.
- Add `api/modules/scans/normalizers/semgrep.ts`.
- Add parser tests for severity mapping, location mapping, fingerprint stability, redaction, and empty results.

Verification:

```bash
bun test ./api/modules/scans/normalizers/semgrep.test.ts
```

Expected:

- Semgrep fixture creates deterministic findings/evidence.
- Empty `results` produces zero findings without failure.
- Unknown severity maps to `unknown`.

Failure handling:

- If Semgrep JSON shape differs from expected fixture, adjust parser to the observed official JSON fields only.

### P2. Shared Normalizer Utilities

Work:

- Extract redaction and fingerprint helpers from fixture normalizer if needed.
- Keep fixture normalizer behavior unchanged.
- Avoid a broad adapter abstraction until Semgrep mapping is working.

Verification:

```bash
bun test ./api/modules/scans/normalizers/*.test.ts
```

Expected:

- Existing fixture tests still pass.
- Semgrep tests pass.

Failure handling:

- If extraction adds complexity, keep helpers duplicated for Phase 2 and revisit after the second real adapter.

### P3. Semgrep Runner

Work:

- Add `api/modules/scans/tools/semgrep-runner.ts`.
- Implement executable check, version capture, structured args, timeout, stdout/stderr capture.
- Ensure Semgrep receives no LLM-related environment variables.

Verification:

```bash
bun test ./api/modules/scans/tools/semgrep-runner.test.ts
```

Expected:

- Command args are built without shell interpolation.
- Missing executable returns a typed failure.
- Timeout returns a typed failure.
- stdout/stderr are captured.

Failure handling:

- If live Semgrep is unavailable in CI/local, keep runner unit tests mocked and make live smoke opt-in.

### P4. CLI Command

Work:

- Add `api/cli/scan-semgrep.ts`.
- Add `scan:semgrep` package script.
- Reuse Phase 1 repositories and `ArtifactStorage`.
- Save raw JSON/stdout/stderr artifacts.
- Insert normalized findings/evidence.

Verification:

```bash
bun run scan:semgrep -- --project-id <project-id> --profile semgrep-baseline --config auto
```

Expected:

- stdout is a single JSON object.
- scan/tool_run/artifacts/findings/evidence are persisted.
- LLM env vars are not required.

Failure handling:

- If Semgrep is missing, command exits non-zero with machine-readable failure JSON.
- If Semgrep runs but JSON parse fails, raw artifacts remain and scan is failed.

### P5. E2E Smoke

Work:

- Add an e2e test that creates a temp repo with a known Semgrep-detectable pattern.
- If Semgrep is unavailable, test should assert the missing-executable failure path or be explicitly skipped with a clear reason.
- Keep temp DB and artifact root isolated like Phase 1 E2E.

Verification:

```bash
bun test ./api/modules/scans/scan-semgrep.e2e.test.ts
```

Expected:

- With Semgrep available: at least one finding is saved.
- Without Semgrep: failure JSON path is tested without marking scan completed.

Failure handling:

- Do not make `bun run verify` depend on a globally installed Semgrep unless the repo also provides installation/bootstrap instructions.

### P6. API Compatibility Check

Work:

- Confirm existing `/api/scans/:scanRunId/artifacts`, `/findings`, and `/api/findings/:findingId` can read Semgrep-created rows without route changes.
- Add tests only if Semgrep-specific row shapes expose serialization problems.

Verification:

```bash
bun run test -- api/routes/scans.route.test.ts api/routes/findings.route.test.ts
```

Expected:

- Existing route tests pass.
- No Semgrep-specific route is needed in Phase 2.

Failure handling:

- If route response shape needs adjustment, keep it generic to all scan tools.

### P7. Final Verification

Work:

- Run focused Semgrep tests.
- Run all scan tests.
- Run full verify.
- Run whitespace check.

Commands:

```bash
bun test ./api/modules/scans/**/*.test.ts
bun run verify
git diff --check
```

Expected:

- All commands pass.

Stop condition:

- Do not proceed to LLM review planning until Semgrep raw artifact, parser, findings, evidence, and CLI smoke are stable.

## Completion Review

Before marking Phase 2 complete, verify:

- `scan:semgrep` is the only new real tool command.
- Semgrep raw JSON is preserved as a `scan_artifact`.
- stdout/stderr are stored as artifacts, not mixed into CLI stdout.
- `tool_runs` has Semgrep version, command, exit code, and status.
- Findings come only from Semgrep JSON, not from LLM analysis.
- No LLM provider is required.
- Existing `scan:import` fixture path still passes.
- No Docker toolbox work has been mixed in.

## Phase 3 Handoff

Phase 3 should not start until Phase 2 has a stable Semgrep adapter.

Recommended Phase 3 target:

```text
LLM review for existing findings
```

Phase 3 should take Semgrep findings as immutable input and produce review records/evidence. It should not let the LLM freely inspect arbitrary repository files.
