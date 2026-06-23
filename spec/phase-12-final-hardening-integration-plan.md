# Phase 12: Final Hardening and Full Diagnostic Integration Plan

## Purpose

この計画は、vulnWorkbench のPhase 12として、Phase 1から11までの診断能力を統合し、十分な脆弱性診断ワークベンチとして仕上げるためのもの。

Phase 12は新しい大きな診断カテゴリを追加するPhaseではない。既存のCLI scan、multi-tool adapters、LLM review、human decision、report、Docker toolbox、sandbox reproduction、dynamic verification、DASTを、実運用で破綻しにくい形に統合する。

## Source Baseline

前提実装:

- CLI scan foundation
- Semgrep/Gitleaks/OSV/Trivy adapters
- scan profile orchestration
- LLM finding review
- reviewer decision workflow
- Markdown report export
- Docker toolbox runner
- sandbox reproduction
- test/sanitizer/lightweight fuzzing
- DAST/browser automation

## Scope

Phase 12で実装するもの。

- full diagnostic workflow review
- evidence traceability hardening
- security boundary audit
- scan/profile/report UI統合
- artifact browsing hardening
- failure mode整理
- docs更新
- end-to-end fixture suite
- final verification checklist

Phase 12で実装しないもの。

- CI統合の必須化
- multi-tenant SaaS化
- patch自動適用
- exploit generation
- destructive DAST
- unlimited fuzz campaign
- new major scan tool追加

## Full Workflow

Phase 12で閉じるworkflow:

```text
project registration
  -> scan profile selection
  -> Docker/host tool execution
  -> raw artifact persistence
  -> finding/evidence normalization
  -> LLM review
  -> human decision
  -> reproduction/dynamic/DAST evidence
  -> report export
  -> artifact-backed audit trail
```

この全体で、どの表示/判断もraw artifactまたは保存済みrecordへ遡れる必要がある。

## Definition of Done

Phase 12は、次を満たしたら完了とする。

- 主要workflowがUIとCLIの両方で説明可能である。
- findingからraw artifact、LLM review、decision、reproduction、reportへ辿れる。
- raw artifactから関連findingへ辿れる。
- secret redaction boundaryが確認されている。
- Docker/container実行にLLM API keyが渡らないことを確認できる。
- unauthorized target/pathが拒否される。
- tool failure、parse failure、LLM failure、sandbox failureが別々に表示される。
- full E2E fixtureが通る。
- READMEとspecが現在の実装に合っている。
- `bun run verify` が通る。

## Hardening Areas

### Evidence Traceability

確認項目:

- finding -> evidence
- evidence -> artifact
- review -> input bundle
- decision -> linked review
- report -> source finding/evidence
- reproduction/dynamic/DAST run -> artifacts

必要なら、metadataにstable referenceを追加する。

### Security Boundary

確認項目:

- repo path traversal拒否
- symlink repo escape拒否
- raw secret display redaction
- LLM prompt redaction
- container env filtering
- Docker socket non-mount
- DAST target allowlist
- command profile allowlist

### Failure Mode

区別すべきfailure:

```text
tool_missing
tool_timeout
tool_exit_nonzero
artifact_write_failed
normalizer_failed
llm_provider_unconfigured
llm_output_invalid
decision_validation_failed
docker_unavailable
sandbox_profile_rejected
dast_target_rejected
```

UI/API/CLIで近いエラーを混ぜない。

## UI Integration

統合対象:

- project list/detail
- scan profile selection
- scan summary
- findings list
- finding detail
- evidence/artifact view
- LLM review panel
- decision panel
- reproduction/dynamic/DAST panel
- report panel

UI原則:

- primary evidenceとLLM reviewを混ぜない。
- human decisionをLLM reviewと混ぜない。
- raw artifactへの参照を常に残す。
- destructive-looking actionには明示的な境界表示を出す。

## Documentation

更新対象:

- README
- `.env.example`
- spec index or roadmap
- CLI command examples
- security boundary notes
- troubleshooting
- tool installation/toolbox build notes

CIは必須にしない。ただしlocal verify手順は明確にする。

## Implementation Steps

### P0: Baseline Audit

- 全Phaseのschema/API/CLI/UIを一覧化する。
- `rg`でTODO、old RAG copy、stale route名を確認する。
- current verify結果を記録する。

Completion criteria:

- hardening対象リストができている。

### P1: Traceability Fixes

- missing referencesをmetadataへ追加する。
- artifact/finding/review/decision/reportの相互参照を確認する。
- UI/APIで必要なreferenceを返す。

Completion criteria:

- findingからreportまで追跡できる。

### P2: Security Boundary Tests

- path traversal testsを確認/追加する。
- env filtering testsを確認/追加する。
- DAST target validation testsを確認/追加する。
- command allowlist testsを確認/追加する。

Completion criteria:

- boundary regression testsが揃う。

### P3: Failure Mode Cleanup

- error code/messageを整理する。
- CLI failed JSONを揃える。
- UI error表示を整理する。

Completion criteria:

- 主要failureが区別して表示される。

### P4: UI Workflow Pass

- project -> scan -> finding -> review -> decision -> reproduction -> report の導線を確認する。
- 表示密度と状態表示を整理する。
- stale RAG copyを削除または明確にlegacy扱いにする。

Completion criteria:

- MVP workflowがUIで一巡できる。

### P5: Docs and Verification Suite

- READMEを更新する。
- troubleshootingを追加する。
- E2E fixture suiteを追加する。
- final verifyを実行する。

Completion criteria:

- docsと実装が一致する。
- `bun run verify` が通る。

## Verification Commands

```bash
bun run test
bun run verify
git diff --check
```

追加確認:

```bash
rm -f /tmp/vuln-workbench-phase12-fresh.sqlite
DATABASE_URL=file:/tmp/vuln-workbench-phase12-fresh.sqlite bun run db:migrate
bun run scan:profile -- --project-id <project-id> --profile baseline
bun run report:scan -- --scan-run-id <scan-run-id> --format markdown
```

Expected results:

- fresh migrationが通る。
- baseline scanがartifact/finding/evidenceを作る。
- review/decision/report導線が壊れていない。
- Docker/sandbox/DAST failureが他のworkflowを壊さない。

Failure handling:

- migration failureは順序/FKを最優先で直す。
- traceability failureはreference保存を先に直す。
- redaction failureはリリース不可として扱う。
- UI failureはAPI response shapeとfrontend typeを合わせる。

## Stop Conditions

- hardening中に新しいmajor scan toolを追加したくなる。
- CI必須化を同時に入れたくなる。
- patch自動適用へ進みたくなる。
- destructive DASTやunbounded fuzzingを許可したくなる。
- evidence traceabilityを省略してUIだけ整えたくなる。

## Completion Boundary

Phase 12完了時点で、CIなしでも次が成立している状態を目標にする。

```text
十分な脆弱性診断:
  static analysis
  secret detection
  dependency vulnerability detection
  IaC/filesystem scan
  Docker-isolated tool execution
  bounded reproduction
  test/sanitizer/light fuzz verification
  scoped DAST/browser checks
  LLM review
  human decision
  report export
  artifact-backed traceability
```

Phase 12以降の候補:

- CI integration
- patch workflow
- team approval workflow
- additional scanners
- long-running fuzz campaigns
- advanced DAST profiles
