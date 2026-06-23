# Phase 9: Sandbox Reproduction Foundation Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 9として、findingに対する限定的な再現確認をsandbox内で実行し、再現log/evidenceとして保存するためのもの。

Phase 9は任意コマンド実行基盤ではない。許可済みのreproduction profileだけを実行し、LLMが自由にcommandを生成して実行することはしない。

## Source Baseline

前提実装:

- Docker toolbox runnerが存在する。
- finding/evidence/review/decision/reportが保存できる。
- scan profile runnerがmulti-tool結果を扱える。

## Scope

Phase 9で実装するもの。

- reproduction profile model
- allowed command profile
- finding-to-reproduction mapping
- sandbox run table
- reproduction artifact/evidence保存
- `repro:finding` CLI command
- reproduction API
- reproduction result UI
- timeout/resource/network boundary

Phase 9で実装しないもの。

- LLMによる任意command生成
- exploit generation
- patch適用
- full DAST
- browser automation
- fuzzing
- CI連携

## Reproduction Model

基本フロー:

```text
finding
  -> allowed reproduction profile selection
  -> Docker sandbox run
  -> stdout/stderr/log/artifacts
  -> reproduction evidence
  -> human review
```

Profile例:

```text
node-test:
  command: npm test or bun test
  allowed when package manifest exists

python-test:
  command: pytest
  allowed when pytest config exists

dependency-advisory-check:
  command: package manager audit or osv recheck

static-rule-recheck:
  command: targeted Semgrep rule rerun
```

Phase 9では、projectごとの任意command設定は扱ってもよいが、allowlistと明示的なuser設定を必須にする。

## Data Model

追加table案:

```text
reproduction_runs
  id
  finding_id
  scan_run_id
  profile
  status
  command
  runner
  exit_code
  started_at
  completed_at
  metadata
  created_by_user_id
```

追加evidence kind候補:

```text
reproduction-log
reproduction-result
```

または、dedicated `reproduction_artifacts` を作る。いずれの場合もraw stdout/stderr/logを保存する。

## Definition of Done

Phase 9は、次を満たしたら完了とする。

- finding IDとprofileを指定してsandbox reproductionを実行できる。
- 実行commandはallowlistされたprofileからのみ作られる。
- LLMはcommandを自由生成しない。
- stdout/stderr/logがartifactとして保存される。
- reproduction resultがfinding detailで確認できる。
- reproduction失敗でもfinding/evidence/review/decisionを壊さない。
- timeout/resource limitが効く。
- `bun run verify` が通る。

## CLI Contract

追加script:

```json
{
  "repro:finding": "bun run api/cli/repro-finding.ts"
}
```

Command shape:

```bash
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile static-rule-recheck
```

Optional:

```text
--runner docker
--timeout-sec <seconds>
--network none|default
```

Required behavior:

- stdoutはJSONだけにする。
- profileが未許可ならfailed JSONを返す。
- sandbox runをDBに保存する。
- reproduction artifactを保存する。

## API Contract

追加API:

```text
GET  /api/findings/:id/reproductions
POST /api/findings/:id/reproductions
GET  /api/reproduction-runs/:id
```

Required behavior:

- project ownershipを確認する。
- profile allowlistを確認する。
- run resultをfinding detailで参照できる。

## Frontend Scope

- finding detailにReproduction panelを追加する。
- available profileを表示する。
- run buttonを置く。
- status、exit code、log artifact linkを表示する。
- reproduction resultをLLM review/decisionと混ぜない。

## Implementation Steps

### P0: Baseline Inspection

- Docker runnerのmount/network/resource制限を確認する。
- finding locationとtool metadataからprofile候補を作れるか確認する。
- artifact storageのlog保存経路を確認する。

Completion criteria:

- allowed profileの最小セットが決まっている。

### P1: Schema and Repository

- reproduction run schema/tableを追加する。
- shared schemaを追加する。
- repositoryを追加する。

Completion criteria:

- run create/update/list/getができる。

### P2: Profile Registry

- profile registryを追加する。
- profile applicability checkを実装する。
- command constructionをshell interpolationなしで実装する。

Completion criteria:

- findingに対するavailable profilesが取得できる。

### P3: Runner Integration

- Docker runnerでprofile commandを実行する。
- artifactsを保存する。
- status/exit codeを保存する。

Completion criteria:

- targeted recheck profileが動く。

### P4: CLI/API/UI

- `repro:finding` CLIを追加する。
- reproduction APIを追加する。
- finding detail UIへpanelを追加する。

Completion criteria:

- UI/CLIからreproduction runを作成できる。

### P5: Verification

- repository/profile testsを追加する。
- Docker smoke testを追加する。
- timeout failure testを追加する。

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
bun run repro:finding -- --finding-id <finding-id> --profile static-rule-recheck --runner docker
```

Expected results:

- reproduction runが保存される。
- stdout/stderr/log artifactが保存される。
- timeout/resource limitがmetadataに残る。

Failure handling:

- profile mismatchならapplicability checkを修正する。
- Docker failureならrunner境界でfailedに閉じ込める。
- command constructionにshell文字列が混じったら実装を止めて修正する。

## Stop Conditions

- LLMにcommandを自由生成させたくなる。
- arbitrary shell command入力を許可したくなる。
- exploit生成や攻撃payload生成へ進みたくなる。
- target repo writeが必須になる。

## Handoff to Phase 10

Phase 10では、sandbox reproductionを土台に、test harness、sanitizer、lightweight fuzzingを診断profileとして追加する。
