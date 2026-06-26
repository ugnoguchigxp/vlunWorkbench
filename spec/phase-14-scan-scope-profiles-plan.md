# Phase 14: Scan Scope Profiles Plan

## Purpose

この計画は、vulnWorkbench の static scan に対象範囲のバリエーションを追加し、`node_modules`、`dist`、`build`、生成物、vendored dependency を診断目的に応じて扱い分けるためのもの。

到達点は、通常運用では効率と低ノイズを保ちつつ、必要な場面では依存パッケージ本体やビルド成果物まで明示的に scan できる状態である。

重要な判断:

- `node_modules` と `dist` を baseline に無条件で含めない。
- 依存脆弱性は lockfile / manifest を主経路にする。
- deploy される成果物は artifact profile で明示的に扱う。
- installed dependency tree や生成物全体は full/deep profile で扱う。
- 対象範囲は profile metadata と tool run metadata に保存し、scan 結果から後追いできるようにする。

## Source Baseline

現在の scan 基盤:

- `api/modules/scans/profiles.ts` に static profile がある。
- 既存 profile は `baseline`、`secrets`、`dependencies`、`iac`。
- `shared/schemas/scan-profile.schema.ts` の `ProfileToolEntry.options` は任意 object を受け取れる。
- `api/modules/scans/profile-runner.ts` は profile 内 tool を順番に実行し、`tool.options` を `runToolIntoExistingScan` へ渡す。
- Semgrep runner は `config` と `maxTargetBytes` を受け取る。
- Gitleaks / OSV / Trivy runner は現状 `timeoutSec` と lifecycle event 以外の対象範囲 option を受け取っていない。
- `GET /api/scan-profiles` は tool options を返さず、表示用 field だけを返す。

実装前に採取する baseline:

```bash
bun run scan:profile -- --project-id <project-id> --profile baseline
bun run scan:profile -- --project-id <project-id> --profile dependencies
bun run scan:profile -- --project-id <project-id> --profile secrets
bun run scan:profile -- --project-id <project-id> --profile iac
```

確認すること:

- 各 profile が現状の tool order と status を保存する。
- `scan_runs.metadata.profileOutcome` と `tool_runs.metadata.options` が確認できる。
- 既存 profile に対象範囲 option がない状態の結果を比較用に残す。

## Scope

Phase 14 で実装するもの。

- scan scope policy model
- profile ごとの include / exclude / generated / dependency tree policy
- runner へ対象範囲 option を渡す境界
- Semgrep / Gitleaks / OSV / Trivy の tool-specific target mapping
- 新しい static profile
  - `source-baseline`
  - `dependency-manifest`
  - `artifact`
  - `full-deep`
- 既存 `baseline` の後方互換方針
- scan profile API の表示情報拡張
- profile selector UI で scope intent を読める最小表示
- tests / fixtures
- verification command と完了判定

Phase 14 で実装しないもの。

- package manager install 実行
- dependency update / remediation
- SBOM 生成
- container image scan
- remote repository scan
- commit history scan の常時有効化
- DAST target scope の変更
- scan queue / durable background worker
- parallel execution
- LLM による対象範囲推論

## Profile Strategy

対象範囲は profile ごとに分ける。

```text
source-baseline:
  primary use:
    normal development and CI-like local checks
  include:
    first-party source, config, IaC, manifests, lockfiles
  exclude:
    node_modules, dist, build, coverage, .git, generated artifact roots
  tools:
    semgrep, gitleaks, osv, trivy

dependency-manifest:
  primary use:
    dependency vulnerability review
  include:
    package manifests, lockfiles, supported workspace manifests
  exclude:
    node_modules by default
  tools:
    osv, trivy

artifact:
  primary use:
    release/deployable output review
  include:
    dist, dist-web, build, bundled JS, source maps when present
  exclude:
    node_modules unless it is part of the deployable artifact
  tools:
    gitleaks, trivy, semgrep when generated JS rules are useful

full-deep:
  primary use:
    audit, incident investigation, unknown repository intake
  include:
    source, generated outputs, vendored code, installed dependency tree
  exclude:
    only unsafe or irrelevant runtime roots such as .git and scanner artifacts
  tools:
    semgrep, gitleaks, osv, trivy
```

既存 `baseline` は急に意味を変えない。Phase 14 では次のどちらかにする。

1. `baseline` を `source-baseline` と同じ対象範囲に寄せ、description に明記する。
2. `baseline` を alias として残し、UI では `source-baseline` を推奨表示にする。

実装時は 1 を基本方針にする。ただし既存 tests や UI 表示で profile ID 固定の依存が大きい場合は 2 に切り替える。

## Scope Policy Model

`shared/schemas/scan-profile.schema.ts` に profile-level scope を追加する。

```ts
type ScanScopeIntent =
  | "source"
  | "dependency_manifest"
  | "artifact"
  | "full_deep";

type ScanScopePolicy = {
  intent: ScanScopeIntent;
  includeGlobs: string[];
  excludeGlobs: string[];
  includeGenerated: boolean;
  includeInstalledDependencies: boolean;
  includeVendoredDependencies: boolean;
  notes?: string;
};
```

Profile 例:

```ts
{
  id: "artifact",
  name: "Artifact Scan",
  scope: {
    intent: "artifact",
    includeGlobs: ["dist/**", "dist-web/**", "build/**", "*.map"],
    excludeGlobs: ["node_modules/**", ".git/**", "artifacts/**"],
    includeGenerated: true,
    includeInstalledDependencies: false,
    includeVendoredDependencies: false,
  },
  tools: [...]
}
```

Tool entry には、必要な場合だけ override を置けるようにする。

```ts
options: {
  scopeOverride?: Partial<ScanScopePolicy>;
  scanners?: string[];
  maxTargetBytes?: number;
}
```

保存方針:

- `scan_runs.metadata.scope` に resolved profile scope を保存する。
- `tool_runs.metadata.options.scope` に tool へ渡した resolved scope を保存する。
- `tool_runs.command` は秘匿情報を含めず、scope の要約だけを残す。
- raw artifact は従来通り保存する。

## Tool Mapping

各 tool の対象範囲 option は、実装前に手元の `--help` で確認してから固定する。

確認コマンド:

```bash
semgrep scan --help
gitleaks detect --help
osv-scanner --help
trivy fs --help
```

### Semgrep

目的:

- first-party source の静的解析を baseline にする。
- full-deep では vendored code を含められるようにする。
- artifact では generated JS/TS bundle を対象にするかを profile option で制御する。

実装方針:

- `SemgrepRunnerOptions` に `includeGlobs` / `excludeGlobs` を追加する。
- CLI が stable に対応している場合は `--include` / `--exclude` 系へ map する。
- CLI 側の glob 挙動が不十分な場合は、target file list を作る共通 resolver を追加し、Semgrep に渡す対象を制限する。
- `source-baseline` では `node_modules/**`、`dist/**`、`dist-web/**`、`build/**`、`coverage/**`、`artifacts/**` を除外する。

### Gitleaks

目的:

- secrets は first-party source と deployable artifact の両方で見る。
- `node_modules` は通常 profile では除外し、full-deep でのみ含める。

実装方針:

- `GitleaksRunnerOptions` に resolved scope を追加する。
- Gitleaks の ignore / config / path filter の使い方を `gitleaks detect --help` で確認する。
- CLI exclude が profile 要件を満たせない場合は、一時 scoped workspace を作り、include 対象だけを hardlink/copy して scan する。
- artifact profile では `dist/**`、`dist-web/**`、`build/**`、`*.map` を対象にする。
- secret raw data は既存 redaction を維持する。

### OSV-Scanner

目的:

- installed tree 全体ではなく、manifest / lockfile を主対象にする。
- full-deep のみ installed dependency tree を許可する。

実装方針:

- `OsvRunnerOptions` に `dependencyMode: "manifest" | "installed_tree"` を追加する。
- `dependency-manifest` では manifest / lockfile resolver を追加し、対象 file を明示する。
- workspace lockfile と nested package manifests を拾う。
- `node_modules` は default では走査しない。
- full-deep で `includeInstalledDependencies` が true のときだけ recursive repository scan を許可する。

### Trivy

目的:

- filesystem scan の広さを profile で制御する。
- dependency / secret / config scanner の意図を profile option で分ける。

実装方針:

- `TrivyRunnerOptions` に resolved scope と `scanners` を追加する。
- `trivy fs --help` で `--scanners`、skip dirs/files 系 option を確認する。
- `source-baseline` では source/config/IaC/manifest を対象にし、heavy generated dirs を除外する。
- `dependency-manifest` では vulnerability scanner を中心にする。
- `artifact` では secret と vuln を中心にする。
- `full-deep` では timeout を長めにし、`node_modules` と generated dirs を含める。

## Target Resolver

tool-specific mapping を分散させすぎないため、共通 resolver を追加する。

候補ファイル:

```text
api/modules/scans/target-scope.ts
api/modules/scans/target-scope.test.ts
```

責務:

- repository root からの相対 path だけを扱う。
- include / exclude glob を解決する。
- default excluded dirs を一箇所にまとめる。
- symlink が repo root 外へ出る場合は対象外にする。
- `.git`、scanner artifact root、temporary output root は常に除外する。
- resolved scope summary を返す。

戻り値例:

```ts
{
  scope: resolvedScope,
  includedRoots: ["api", "web", "shared", "package.json", "bun.lock"],
  excludedRoots: ["node_modules", "dist", "dist-web", "coverage", ".git"],
  reason: "source baseline excludes generated and installed dependency trees"
}
```

## Implementation Order

### P1: Baseline and schema

- Add `scope` to scan profile schema.
- Add scope definitions to `api/modules/scans/profiles.ts`.
- Keep existing profile IDs valid.
- Add tests for profile validation and `listProfiles`.
- Extend `GET /api/scan-profiles` response with safe display fields:
  - `scope.intent`
  - `scope.includeGenerated`
  - `scope.includeInstalledDependencies`
  - `scope.includeVendoredDependencies`

Completion gate:

```bash
bunx vitest run api/modules/scans/profile-runner.test.ts api/routes/scans.route.test.ts
```

### P2: Target resolver

- Implement shared target resolver.
- Add unit tests for:
  - `node_modules` excluded by source baseline.
  - `dist` / `dist-web` included by artifact profile.
  - lockfiles included by dependency-manifest profile.
  - full-deep includes installed dependency tree when requested.
  - symlink escape is rejected.
  - scanner artifact dirs are always excluded.

Completion gate:

```bash
bunx vitest run api/modules/scans/target-scope.test.ts
```

### P3: Runner option plumbing

- Pass resolved scope from profile runner to each tool.
- Store resolved scope in scan run and tool run metadata.
- Update runner option types for Semgrep, Gitleaks, OSV, and Trivy.
- Keep existing individual CLI commands working without explicit scope.
- Ensure stdout remains machine-readable JSON only.

Completion gate:

```bash
bunx vitest run api/modules/scans/profile-runner.test.ts api/modules/scans/tools
```

### P4: Tool-specific target mapping

- Implement Semgrep include/exclude mapping.
- Implement Gitleaks path filtering or scoped workspace fallback.
- Implement OSV manifest mode.
- Implement Trivy skip/include/scanner mapping.
- Record selected mapping in `tool_runs.metadata`.
- Add fixture tests proving each profile sends the intended target policy.

Completion gate:

```bash
bunx vitest run api/modules/scans/tools api/modules/scans/normalizers
```

### P5: Profile additions and UI display

- Add `source-baseline`, `dependency-manifest`, `artifact`, `full-deep`.
- Decide final `baseline` compatibility path.
- Update scan profile selector display so users can distinguish:
  - normal source scan
  - dependency manifest scan
  - artifact scan
  - full/deep scan
- Do not expose raw command strings or unsafe host paths in API/UI.

Completion gate:

```bash
bunx vitest run api/routes/scan-profiles.route.test.ts
bunx vitest run web/src
```

If there is no focused web test target, use the repo's existing frontend verification command.

### P6: End-to-end verification

Create a temporary fixture repository with:

```text
package.json
bun.lock or package-lock.json
api/source.ts
dist/bundle.js
dist/bundle.js.map
node_modules/example-package/package.json
artifacts/scans/ignored.json
```

Run:

```bash
bun run scan:profile -- --project-id <project-id> --profile source-baseline
bun run scan:profile -- --project-id <project-id> --profile dependency-manifest
bun run scan:profile -- --project-id <project-id> --profile artifact
bun run scan:profile -- --project-id <project-id> --profile full-deep
```

Confirm:

- source-baseline excludes `node_modules` and `dist`.
- dependency-manifest reads manifest / lockfile and does not deep scan `node_modules`.
- artifact includes `dist` / `dist-web` / `build` when present.
- full-deep includes generated output and installed dependency tree.
- every run stores resolved scope metadata.
- report and summary still render completed scan data.

Final gate:

```bash
bun run verify
```

## Definition of Done

Phase 14 is complete when:

- users can choose source, dependency, artifact, and full/deep scan variants.
- baseline behavior remains backward-compatible or has an explicit alias path.
- `node_modules` is not silently included in normal scan.
- `dist` and build outputs are scanable through artifact profile.
- installed dependency tree scan is available only through full/deep intent.
- Semgrep, Gitleaks, OSV, and Trivy receive deterministic scope options.
- resolved scope is saved in scan and tool metadata.
- scan profile API/UI explain the scope without exposing raw commands.
- focused tests and `bun run verify` pass.

## Stop Conditions

Stop and reassess before merging if:

- a tool's current installed version cannot support deterministic include/exclude behavior and scoped workspace fallback is not yet implemented.
- `node_modules` becomes part of default baseline unintentionally.
- a profile broadens scan target scope without metadata recording.
- raw tool output or CLI stdout starts mixing non-JSON logs into machine-readable output.
- full-deep runtime is high enough to make default UI selection risky.
- scoped workspace creation follows symlinks outside the repository root.

## Notes

- This phase should not attempt remediation. It only controls what is scanned and how that choice is recorded.
- The security value comes from explicit scan intent, not from making every scan maximal.
- The full/deep profile should be visibly heavier and should not become the default.
