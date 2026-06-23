# Phase 10: Test Harness, Sanitizer, and Lightweight Fuzzing Plan

## Purpose

この計画は、vulnWorkbench のPhase 10として、限定的な動的検証能力を追加するためのもの。

Phase 10の到達点は、静的/依存/secret/IaC診断に加えて、test harness、sanitizer、軽量fuzzingをsandbox内で実行し、十分な脆弱性診断ワークベンチと呼べる状態にすること。

Phase 10でも、LLMは実行主体ではない。LLMは保存済み結果をレビューするだけで、テストやfuzz commandを自由生成しない。

## Source Baseline

前提実装:

- Docker toolbox runnerが存在する。
- sandbox reproduction profileが存在する。
- reproduction artifact/evidenceが保存できる。
- reviewer decision/report導線がある。

## Scope

Phase 10で実装するもの。

- test harness profile
- sanitizer profile
- lightweight fuzzing profile
- language/runtime detection
- bounded execution policy
- crash artifact保存
- dynamic evidence mapping
- dynamic result UI
- profile tests/smoke

Phase 10で実装しないもの。

- full DAST
- browser automation
- external target scan
- unrestricted fuzzing
- long-running fuzz campaign
- exploit generation
- patch generation
- CI integration

## Capability Boundary

Phase 10で許可する動的検証:

```text
existing test command
sanitizer-enabled test command
short bounded fuzz command
targeted package audit recheck
targeted static rule recheck
```

許可しないもの:

```text
unbounded fuzzing
network attack
external target probing
LLM-generated shell script
repo mutation by default
privileged container
```

## Profile Examples

```text
bun-test:
  command: bun test
  max duration: short

npm-test:
  command: npm test
  max duration: short

pytest:
  command: pytest
  max duration: short

asan-test:
  command: configured sanitizer test command
  requires explicit project config

light-fuzz:
  command: configured fuzz target
  max duration: short
  requires explicit project config
```

Fuzzingは自動発見ではなく、project configに登録されたtargetだけを実行する。

## Data Model

Phase 9の `reproduction_runs` を拡張するか、dynamic run kindを追加する。

追加metadata:

```text
dynamicKind: test | sanitizer | fuzz
runtime
commandProfile
durationMs
crashDetected
crashArtifactIds
coverageSummary
```

Evidence kind候補:

```text
dynamic-test-log
sanitizer-finding
fuzz-crash
```

## Definition of Done

Phase 10は、次を満たしたら完了とする。

- projectごとの許可済みtest profileを実行できる。
- sanitizer/fuzz profileは明示設定がある場合だけ実行できる。
- 実行はDocker sandbox内でboundedに行われる。
- stdout/stderr/crash artifactが保存される。
- findingに紐づくdynamic evidenceを表示できる。
- dynamic run失敗で既存scan/finding/review/decisionを壊さない。
- `bun run verify` が通る。

## Configuration Model

project metadataまたは専用config fileで許可profileを管理する。

例:

```json
{
  "testProfiles": [
    {
      "id": "bun-test",
      "command": ["bun", "test"],
      "timeoutSec": 120
    }
  ],
  "fuzzProfiles": [
    {
      "id": "parser-fuzz",
      "command": ["bun", "run", "fuzz:parser"],
      "timeoutSec": 60
    }
  ]
}
```

Required behavior:

- commandはarray形式で保存する。
- shell stringは使わない。
- profileはuserが明示登録したものだけ実行する。

## CLI Contract

追加script:

```json
{
  "dynamic:run": "bun run api/cli/dynamic-run.ts"
}
```

Command shape:

```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test
```

Optional:

```text
--finding-id <finding-id>
--timeout-sec <seconds>
```

## API Contract

追加API:

```text
GET  /api/projects/:id/dynamic-profiles
POST /api/projects/:id/dynamic-runs
GET  /api/dynamic-runs/:id
```

Required behavior:

- project ownershipを確認する。
- profile allowlistを確認する。
- artifact referencesを返す。

## Frontend Scope

- project/scan/finding detailにDynamic Verification panelを追加する。
- available dynamic profilesを表示する。
- run status、exit code、artifactを表示する。
- sanitizer/fuzz crashをevidenceとして目立たせる。

## Implementation Steps

### P0: Baseline Inspection

- Phase 9 reproduction runnerを再利用できるか確認する。
- project config保存場所を決める。
- supported runtime detectionの最小範囲を決める。

Completion criteria:

- dynamic profile configの保存方式が決まっている。

### P1: Profile Config

- project dynamic profile schemaを追加する。
- command array validationを追加する。
- UI/APIでprofileを読めるようにする。

Completion criteria:

- shell stringが拒否される。
- profile allowlistが保存/取得できる。

### P2: Dynamic Runner

- test/sanitizer/fuzz run kindを実装する。
- Docker sandboxでbounded executionする。
- crash detectionを最小実装する。

Completion criteria:

- configured test profileが実行できる。

### P3: Evidence Mapping

- dynamic evidenceをfindingまたはproject/scanに紐づける。
- crash/log artifactを保存する。

Completion criteria:

- finding detailでdynamic evidenceを確認できる。

### P4: CLI/API/UI

- `dynamic:run` CLIを追加する。
- dynamic run APIを追加する。
- UI panelを追加する。

Completion criteria:

- UI/CLIからdynamic runを実行できる。

### P5: Verification

- profile validation testsを追加する。
- timeout/crash testsを追加する。
- full verifyを実行する。

Completion criteria:

- `bun run verify` が通る。
- `git diff --check` が通る。

## Verification Commands

```bash
bun run test
bun run verify
git diff --check
```

個別確認:

```bash
bun run dynamic:run -- --project-id <project-id> --profile bun-test
```

Expected results:

- dynamic runが保存される。
- stdout/stderr/crash artifactが保存される。
- LLM provider未設定でも実行できる。

Failure handling:

- profile configが危険ならvalidationを先に直す。
- timeoutが効かない場合はrunnerを止めて修正する。
- crash artifact欠落ならartifact保存境界を先に直す。

## Stop Conditions

- unbounded fuzzingを入れたくなる。
- LLMにfuzz targetやtest scriptを生成させたくなる。
- external network probingを混ぜたくなる。
- project repoへのwriteをdefault許可したくなる。

## Handoff to Phase 11

Phase 11では、Web app向けにDAST/browser automationを追加する。ただしtarget scopeとnetwork boundaryを明示して扱う。
