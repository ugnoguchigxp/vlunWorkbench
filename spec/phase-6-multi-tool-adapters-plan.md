# Phase 6: Multi-Tool Adapters Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 6として、Semgrep以外の主要CLI security toolをscan pipelineへ接続するためのもの。

対象は Gitleaks、OSV-Scanner、Trivy。Phase 6では、静的解析、secret検出、依存脆弱性、IaC/filesystem scanの診断面を広げる。

LLMは引き続き診断主体ではない。各toolがraw artifactを生成し、deterministic normalizerがfinding/evidenceへ変換する。

## Source Baseline

前提実装:

- scan run / tool run / artifact / finding / evidenceが保存できる。
- Semgrep adapterが実tool adapterの基準になっている。
- report builderが複数findingを扱える。

実装前に確認する現在の基盤:

- `scan:semgrep` はhost CLI runner、raw JSON/stdout/stderr artifact、normalizer、finding/evidence保存を持つ。
- `ArtifactStorage` はscan run単位でartifact root配下へ保存し、DBには相対path、sha256、sizeを保存する。
- `finding.confidence` はPhase 6では `static` のままにする。
- `finding.status` はPhase 6では `open` のままにする。
- LLM review、reviewer decision、report exportはadapter実行の必須依存にしない。

Phase 6ではSemgrep adapterの設計を基準にしつつ、tool別のexit codeとJSON schema差だけをadapter内に閉じ込める。

## Scope

Phase 6で実装するもの。

- Gitleaks runner/normalizer
- OSV-Scanner runner/normalizer
- Trivy runner/normalizer
- tool別fixture
- tool別CLI command
- shared redaction utilityの整理
- tool capability metadata
- adapter tests
- tool unavailable / invalid JSON / timeout failure tests

Phase 6で実装しないもの。

- Docker toolbox runner
- scan orchestration
- cross-tool grouping
- sandbox reproduction
- DAST/fuzzing
- LLM reviewの変更
- report formatの大改修
- tool install automation
- tool version pinning
- SARIF共通parser
- profile runnerへの統合

## Tool Targets

### Gitleaks

目的:

- secret検出
- secret値のredaction
- working tree / filesystem検出
- commit history scanはPhase 6では対象外

想定artifact:

```text
gitleaks JSON
stdout
stderr
exit code
version
```

実装前確認:

```bash
gitleaks version
gitleaks detect --help
```

候補command:

```bash
gitleaks detect \
  --source <repo-path> \
  --report-format json \
  --report-path <raw-json-path> \
  --redact
```

`--redact` が利用できないversionでは、normalizer側でsecret値を必ずredactする。commit history scanはPhase 6では有効化しない。

### OSV-Scanner

目的:

- lockfile / manifest ベースの依存脆弱性検出
- package name、version、advisory ID、severity、fixed versionを保存

想定artifact:

```text
osv-scanner JSON
stdout
stderr
exit code
version
```

実装前確認:

```bash
osv-scanner --version
osv-scanner --help
```

候補command:

```bash
osv-scanner \
  --format json \
  --output <raw-json-path> \
  --recursive <repo-path>
```

OSV-Scannerはversionによってsubcommand形式が変わる可能性があるため、implementation baselineで手元の `--help` を確認し、runner test fixtureに採用commandを明記する。Phase 6ではlockfile/manifest検出を主対象にし、container image scanは扱わない。

### Trivy

目的:

- filesystem scan
- dependency scan
- IaC scan
- secret補助

想定artifact:

```text
trivy JSON
stdout
stderr
exit code
version
```

実装前確認:

```bash
trivy --version
trivy fs --help
```

候補command:

```bash
trivy fs \
  --format json \
  --output <raw-json-path> \
  <repo-path>
```

Phase 6のTrivyは `fs` scanに限定する。image scan、kubernetes scan、remote repository scanは対象外にする。

## Definition of Done

Phase 6は、次を満たしたら完了とする。

- Gitleaks/OSV-Scanner/Trivyをhost CLIとして実行できる。
- 各toolのraw JSON/stdout/stderrをartifactとして保存できる。
- `tool_runs` にtool name、version、command、exit code、status、adapter metadataが保存される。
- 各toolのJSONからfinding/evidenceを作れる。
- secret値は保存/表示/LLM review前にredactされる。
- tool未インストール時は分かりやすいfailed JSONになる。
- valid JSONがないnon-zero exitはscan/tool_run failedとして保存される。
- valid JSONがあるfinding-detected exitはcompletedとしてparseできる。
- 同一raw JSONをnormalizerへ渡した場合、同一finding/evidenceが生成される。
- LLM provider未設定でもscanが完了する。
- Semgrep adapterの既存挙動が壊れていない。
- `bun run verify` が通る。

## Adapter Contract

各adapterは次を満たす。

```text
checkVersion()
run(scanRunId, repoPath, options)
normalize(rawJson, context)
```

Runner responsibilities:

- executable存在確認
- shell interpolation禁止
- secret env filtering
- timeout
- stdout/stderr capture
- raw artifact保存
- raw artifact pathをnormalizerへ渡す
- process cleanup
- temporary directory cleanup
- elapsed time metadata保存

Normalizer responsibilities:

- deterministic mapping
- severity mapping
- fingerprint generation
- source/dependency location mapping
- redaction
- malformed JSONの明確なfailure
- duplicate suppression keyの生成

禁止:

- shell文字列でcommandを組み立てる。
- LLM API keyやsecret envをtool processへ渡す。
- raw JSONを保存せずにnormalized findingだけ保存する。
- LLMにJSON parseやseverity mappingを任せる。
- target repoを変更する。

## Shared Runner Utilities

Phase 6では、Semgrep runnerから共通化できるものだけを抽出する。

候補:

```text
api/modules/scans/tools/tool-process-runner.ts
api/modules/scans/tools/tool-env.ts
api/modules/scans/normalizers/redaction.ts
```

共通化対象:

- executable availability check
- env filtering
- timeout handling
- stdout/stderr capture
- temp output file cleanup
- JSON artifact registration helper
- secret redaction helper

共通化しないもの:

- tool固有command args
- exit code classification
- JSON schema interpretation
- severity mapping

既存Semgrep adapterを大きく書き換えない。必要な共通化だけを小さく抽出し、Semgrep regression testで確認する。

## Exit Handling Policy

各toolはfinding検出時にnon-zeroを返すことがある。exit codeだけでscan失敗と判断しない。

共通分類:

```text
executable missing:
  scan record作成前にfailed JSONを返す。completed scanを残さない。

timeout:
  scan/tool_run failed。stdout/stderrを保存できる場合は保存する。

exit 0 with valid JSON:
  completed。parseしてfinding/evidenceを作る。

tool-specific finding exit with valid JSON:
  completed。parseしてfinding/evidenceを作る。

non-zero without valid JSON:
  failed。stdout/stderrを保存し、findingは作らない。

invalid JSON:
  failed。raw artifactは保存し、normalizer error eventを残す。
```

Tool-specific finding exit:

```text
gitleaks:
  exit 1 with valid report JSON may mean leaks found. Treat as completed.

osv-scanner:
  verify current behavior with --help/docs before implementation. Valid JSON with vulnerabilities should be parseable even if exit is non-zero.

trivy:
  default fs scan often returns 0 even with findings unless exit-code option is set. Do not set a vulnerability exit-code in Phase 6.
```

Implementation must document the observed tool version and exit behavior in adapter tests.

## CLI Contract

追加script:

```json
{
  "scan:gitleaks": "bun run api/cli/scan-gitleaks.ts",
  "scan:osv": "bun run api/cli/scan-osv.ts",
  "scan:trivy": "bun run api/cli/scan-trivy.ts"
}
```

Command shape:

```bash
bun run scan:gitleaks -- --project-id <project-id> --profile secrets
bun run scan:osv -- --project-id <project-id> --profile dependencies
bun run scan:trivy -- --project-id <project-id> --profile filesystem
```

Optional inputs:

```text
--timeout-sec <seconds>
--max-target-bytes <bytes>
--config <tool-specific-config>
```

Required behavior:

- stdoutはJSONだけにする。
- LLM設定は読まない。
- target repoを変更しない。
- raw artifactを必ず保存する。
- stdout/stderrをartifactへ保存し、CLI stdoutに混ぜない。
- project repo pathはDBから読む。
- machine-readable JSONにはscanRunId、toolRunId、artifactIds、findingCount、evidenceCount、statusを含める。

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
  "message": "Gitleaks executable not found"
}
```

## Data Mapping

共通finding fields:

```text
sourceTool
ruleId
title
description
severity
confidence = static
status = open
primaryLocation
fingerprint
metadata
```

Tool-specific metadata examples:

```text
gitleaks:
  detectorName
  ruleId
  redactedSecret
  file
  startLine
  endLine

osv:
  packageName
  packageVersion
  advisoryId
  aliases
  fixedVersions
  ecosystem
  manifestPath

trivy:
  target
  vulnerabilityId
  packageName
  installedVersion
  fixedVersion
  class
  type
```

Severity mapping policy:

```text
gitleaks:
  default to high unless rule metadata indicates lower severity.

osv:
  CRITICAL -> critical
  HIGH -> high
  MODERATE/MEDIUM -> medium
  LOW -> low
  missing -> unknown

trivy:
  CRITICAL -> critical
  HIGH -> high
  MEDIUM -> medium
  LOW -> low
  UNKNOWN/missing -> unknown
```

Fingerprint policy:

```text
gitleaks:
  hash("gitleaks", ruleId, file, startLine, redactedSecret hash or stable fingerprint)

osv:
  hash("osv", advisoryId, packageName, packageVersion, manifestPath)

trivy:
  hash("trivy", vulnerabilityId or misconfiguration id, target, packageName, installedVersion)
```

Evidence policy:

- `tool-output` evidence links to raw JSON artifact.
- `scan-log` evidence links to stderr artifact when stderr is non-empty.
- source findings use `source-location` with redacted snippet when path/line exists.
- dependency findings store package/advisory location in `location` metadata even when file/line is unavailable.
- secret findings never store raw secret in snippet or metadata.

## Fixture Requirements

Add fixtures:

```text
tests/fixtures/scans/gitleaks-result.json
tests/fixtures/scans/osv-result.json
tests/fixtures/scans/trivy-result.json
```

Each fixture must include at least:

- one normal finding
- one missing optional field case
- one severity mapping case
- one location mapping case

Gitleaks fixture must include a secret-like value and test that normalized output redacts it.

OSV fixture must include advisory aliases and fixed versions if available.

Trivy fixture must include vulnerability result and at least one IaC or secret-like result only if current Trivy JSON shape supports it. If not, explicitly document unsupported result type in the test name.

## Implementation Steps

### P0: Baseline Inspection

- Semgrep runner/normalizerの再利用可能箇所を確認する。
- redaction helperを共通化する範囲を確認する。
- 各toolのJSON fixtureを用意する。
- `gitleaks`, `osv-scanner`, `trivy` のversion/helpを確認する。
- missing executable時にscan recordを作る前に失敗する経路を確認する。

Completion criteria:

- adapter共通interfaceが決まっている。
- tool別に必要なmapping fieldが明確である。
- 採用するCLI argsとexit handlingがtool別に記録されている。

### P1: Gitleaks Adapter

- runnerを追加する。
- normalizerを追加する。
- fixture testを追加する。
- CLI commandを追加する。
- secret redaction regression testを追加する。

Completion criteria:

- secret値がredactされる。
- gitleaks finding/evidenceが保存される。
- exit 1 with valid JSONをcompletedとして扱える。
- missing executableでcompleted scanを残さない。

### P2: OSV-Scanner Adapter

- runnerを追加する。
- normalizerを追加する。
- dependency finding mappingを追加する。
- fixture testを追加する。
- advisory/fixed version mapping testを追加する。

Completion criteria:

- advisory/package/fixed versionがmetadataに保存される。
- dependency locationがmanifest/lockfile単位で保存される。
- valid JSONがあればvulnerability検出結果をparseできる。

### P3: Trivy Adapter

- runnerを追加する。
- normalizerを追加する。
- vulnerability/IaC/secret resultをmappingする。
- fixture testを追加する。
- result class/typeごとのmapping testを追加する。

Completion criteria:

- Trivy result typeごとのfinding/evidenceが保存される。
- vulnerability resultのpackage/version/fixedVersionがmetadataに保存される。
- Trivy stderr/stdout artifactが保存される。

### P4: Adapter Regression

- Semgrep既存testを再実行する。
- scan CLI failure pathを確認する。
- fresh migrationを確認する。
- `scan:import` fixture pathを確認する。

Completion criteria:

- 既存Semgrep挙動が壊れていない。
- all adapter testsが通る。
- Phase 5 report builderが新tool findingsを扱える。

## Verification Commands

```bash
bun run test
bun run verify
git diff --check
```

個別確認:

```bash
bun test ./api/modules/scans/*.test.ts ./api/modules/scans/**/*.test.ts
bun run scan:gitleaks -- --project-id <project-id> --profile secrets
bun run scan:osv -- --project-id <project-id> --profile dependencies
bun run scan:trivy -- --project-id <project-id> --profile filesystem
```

Expected results:

- 各toolでraw artifact/stdout/stderrが保存される。
- finding/evidenceがdeterministicに生成される。
- missing executableはDBにcompleted scanを残さない。
- Gitleaks findingにraw secretが残らない。
- OSV findingにpackage/advisory/fixed version metadataが残る。
- Trivy findingにtarget/class/type metadataが残る。
- Semgrep、scan import、Phase 5 report testsが壊れていない。

Failure handling:

- tool version差でJSON schemaが違う場合はfixtureを増やしnormalizerを分岐する。
- secret redaction漏れがあればadapter実装を止めてredactionを先に直す。
- runner failureとnormalizer failureを混ぜずに切り分ける。
- tool CLI argsがversionで違う場合はrunnerにversion-aware branchを入れる前に、採用versionとfallbackのfixture/smokeを追加する。
- dependency locationが取れない場合はsource-locationを作らず、tool-output evidenceとmetadata locationに留める。

## Stop Conditions

- Docker実行をPhase 6へ混ぜたくなる。
- tool outputなしのfindingを作りたくなる。
- LLMにtool outputのparseを任せたくなる。
- secret値をraw evidence snippetとして保存したくなる。
- scan orchestration/profile runnerを同時に作りたくなる。
- external target scanやcontainer image scanを混ぜたくなる。

## Handoff to Phase 7

Phase 7では、複数toolをprofileとしてまとめて実行し、cross-tool groupingやscan summaryを扱う。
