# Project-Wide Evaluation Remediation Implementation Plan

Status: Completed for technical release; professional capability remains `not_met`

Planning baseline commit: `5a4df84`

Baseline date: 2026-08-15

Owner: vulnWorkbench maintainers

Target: 前回の多角評価で確認したrelease blocker、保守性、検出能力、CI、運用、性能、継続性の改善を、同一commitの再現可能な証拠でcloseoutする。

Related plan: [Phase 54: Release Trust and Product Value Realization Plan](./phase-54-release-trust-and-product-value-realization-plan.md)

## Closeout summary

The implementation completed every technical remediation slice without lowering
an existing policy threshold. The final measured state is:

- dependency audit: no blocking advisory; `nanoid` is fixed at `3.3.18`;
- source-size violations: 0, including all three baseline offenders;
- API test inventory: 252 files with 0 failures and 0 Writer leaks;
- browser E2E: 14/14, with standard and optional Semgrep behavior separated;
- critical API coverage: 22/22 thresholded targets passing;
- repository measurement: 584/654 production files instrumented, observed line
  coverage 74.2162%, with 70 uninstrumented files explicitly retained;
- migration readiness: 28 migrations, fresh and one-version-behind upgrade
  passing, SQLite integrity `ok`;
- local runtime: all versioned policy gates passing with 0 workload errors or
  rejections under the documented single-node boundary;
- maintained containers: toolbox, dynamic, and Semgrep images build and pass
  the High/Critical fixed-vulnerability gate; toolbox OSV and Trivy run with
  network mode `none`;
- owned real-scanner DAST: Nuclei, Schemathesis, and ZAP execute and pass their
  request-budget gates;
- maintainership: every critical domain has a primary role and the absent
  backup roles remain explicitly `unassigned`.

The professional capability claim remains `not_met`: OWASP recall is 0.7088,
precision 0.6946, false-positive rate 0.3121, and score 0.3967; Juice Shop has
20 eligible scenarios across 9 categories but 0 accepted runtime observations.
This is a truthful completion under the success metric that requires either
passing thresholds or an explicit `not_met` claim.

## 1. 目的

この計画は、現行の強いsecurity boundary、evidence model、test inventoryを維持したまま、前回評価で確認したすべての弱点を実装可能なsliceへ分解するための統合計画である。

主な出口は次の6点である。

1. 現在失敗しているsource-size、dependency audit、contract、browser E2Eを復旧する。
2. optional scanner化後の契約、fixture、profile、E2Eの意味を一致させる。
3. secret scanとcontainer dependency更新を、他gateの成否に依存しない供給網管理へ変える。
4. coverageの対象範囲を明示し、全production sourceの未測定領域を継続的に縮小する。
5. local single-node製品としての性能限界を測定し、remote/multi-node化の判断条件を固定する。
6. 検出能力、tagged release、maintainershipをPhase 54の未完了条件と統合してcloseoutする。

この計画の完了は、単に`verify`を一度通すことではない。clean checkout、同一commit、固定toolchain、必要なDocker/corpusを使った検証結果が保存され、文書と実装が一致した状態を完了とする。

## 2. 文書の位置付け

- 現行コードと再現可能なtest結果を最優先の事実とする。
- 本書は、2026-08-15の多角評価で確認した改善項目の実行順とcloseout条件の正本とする。
- Phase 54の検出能力、SARIF、packaging、release governanceの詳細設計は再利用し、本書で重複実装しない。
- Phase 46〜54のhistorical evidenceは書き換えない。新しい結果はcurrent release evidenceとして別に生成する。
- benchmark policyを下げて完了扱いにしない。未達は未達のまま明示する。

## 3. Planning baseline

### 3.1 Repository state

- Branch: `main`
- Commit: `5a4df84`
- Upstream state at planning time: `origin/main`より1 commit ahead
- Runtime: Bun `1.3.14`
- Test inventory: 282 files（Vitest 40、Bun 242）
- TypeScript規模: 約18万行
- Production TypeScript files: 643前後

### 3.2 Passing evidence

| Gate | Baseline result | Notes |
| --- | --- | --- |
| `bun run typecheck` | pass | app/scriptsともstrict TypeScript |
| `bun run lint` | pass | production sourceに既知の`any`、TODOはなし |
| `bun run format:check` | pass | Biome format contractを満たす |
| `bun run build` | pass | Vite production build成功 |
| `bun run check:bundle` | pass | initial JS/CSSとlargest chunkがbudget内 |
| `bun run check:override-docs` | pass | 14 overrideの文書対応は存在 |
| `bun run check:artifact-tracking` | pass | tracked runtime artifactなし |
| `bun run test:coverage` | pass | selected Web lines 94.0%、critical API全targetが個別下限以上 |

### 3.3 Failing evidence

| ID | Gate | Baseline failure | Release impact |
| --- | --- | --- | --- |
| F1 | `bun run check:audit` | `nanoid 3.3.17`、GHSA-2v37-7h3g-55p8、patched `3.3.18` | Security Policyによりrelease block |
| F2 | `bun run verify:security-intelligence-contract` | NightWorkers v1 fixture hash mismatch | pinned integration contractを証明できない |
| F3 | `bun run test:e2e` | 13件中1件、optional化されたSemgrep findingを標準profileで待機 | strict gate fail |
| F4 | `bun run check:source-size` | 735、509、503行の3 production file | fast gateがtest前に停止 |
| F5 | `bun run bootstrap:check -- --skip-port` | local DBに`0028_finding_pagination_index.sql`が未適用 | planning hostの運用readyではない |

### 3.4 Capability baseline

- Professional capability claim: `not_met`
- OWASP Benchmark recall: `0.7088`
- OWASP Benchmark precision: `0.6946`
- OWASP Benchmark false-positive rate: `0.3121`
- Juice Shop eligible scenarios: 20
- Juice Shop executed scenarios: 0

上記は欠陥を隠すために削除しない。policy thresholdを実測で満たした場合にだけclaimを変更する。

## 4. Scope

### 4.1 In scope

- vulnerable dependency overrideとlockfile
- NightWorkers v1 fixture/baseline contract
- optional Semgrep profileと実DB browser E2E
- source-size budgetを超えた3 production module
- GitHub Actions secret scanの実行独立性
- Docker base/tool dependencyの自動更新
- selected coverageとrepository-wide coverageの区別
- critical coverage対象の拡張手順
- local API、SQLite Writer、scan admissionの性能測定
- local single-node support boundaryの明文化
- OWASP Benchmark precision/FPR改善とJuice Shop実行
- tagged release、changelog、support policy、maintainership
- planning hostのmigration readiness

### 4.2 Non-goals

- SQLiteからremote DBへの即時移行
- multi-tenant SaaS化
- scanner license境界を無視してSemgrepをcore toolboxへ戻すこと
- benchmark thresholdの引き下げ
- LLMだけによるfindingの`confirmed`昇格
- production targetへのactive attack
- source body、credential、absolute private pathをtelemetryへ送信すること
- 全production fileへ一度に一律80% coverageを要求すること
- 人員が存在しない状態で形式だけのapprovalを捏造すること

## 5. Fixed decisions

### 5.1 Release blocker first

- Slice 0〜4のP0が完了するまで、新しいfeature sliceをrelease branchへ混在させない。
- `verify`の途中で止まった場合も、dependency audit、secret scan、contract testの結果を個別に採取する。
- release blockerの修正PRは、無関係なrefactorやfeatureを含めない。

### 5.2 Optional Semgrep boundary

- Semgrepはoptional adapterのまま維持する。
- standard profileへSemgrepを暗黙に戻さない。
- Semgrep findingを要求するtestは、`VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep`と`semgrep-baseline`を明示する。
- standard `baseline`の実DB E2EはGitleaks/OSVのcontractを検証し、Semgrep findingを期待しない。

### 5.3 NightWorkers v1 compatibility

- schema versionは、wire shapeにbreaking changeがない限りv1を維持する。
- fixtureのSemgrepからGitleaksへの変更は、optional adapter境界に合わせた意図的なexample変更として扱う。
- baseline hashはblind regenerationしない。fixture diff、schema compatibility、consumer testをreviewしたcommitでのみ更新する。
- verifierの`unchanged`は「承認済みbaselineと一致」を意味し、historical fixtureから一切変化していないという意味にはしない。

### 5.4 Source-size policy

- 3対象は期限なし例外へ登録せず、責務単位に分割して各production fileを500行未満にする。
- public export、CLI output、DB mutation順序、error kind、artifact cleanupをcharacterization testで固定してから分割する。
- 行数だけを移すwrapperや循環依存を作らない。

### 5.5 Coverage semantics

- 現在の94.0%はselected Web coverageであり、repository-wide coverageとは表記しない。
- critical file coverageはsecurity boundaryのrelease gateとして維持する。
- repository-wide coverageは最初にmeasurement-onlyで導入し、未測定領域を可視化してからratchetする。
- include/exclude変更だけで数値を改善しない。production path追加とtest追加を同一PRにする。

### 5.6 Performance and scale boundary

- 初期support boundaryはlocal、single application instance、single SQLite Writerとする。
- remote DB、distributed limiter、multi-node writerはmeasurementで必要性が示されるまで実装しない。
- performance regressionは固定fixture、固定toolchain、記録されたhost classで比較する。
- 絶対SLOはSlice 7のbaseline PRでreviewし、以後versioned policyとして固定する。

### 5.7 Claim integrity

- `benchmark-policy.v1.json`をPhase 54内で変更しない。
- OWASP、Juice Shopのいずれかが未達ならprofessional capability claimは`not_met`を維持する。
- unavailable corpus、Docker、scanner dataをpassへ変換しない。

## 6. Priority and dependency map

| Slice | Priority | Effort | Objective | Depends on |
| --- | --- | --- | --- | --- |
| 0 | P0 | S | baselineと変更凍結 | none |
| 1 | P0 | S | dependency advisory解消 | 0 |
| 2 | P0 | M | NightWorkers contract整合 | 0 |
| 3 | P0 | M | optional scanner E2E整合 | 2 |
| 4A | P0 | M | exploration catalog分割 | 0 |
| 4B | P0 | M | reproduction runner分割 | 0 |
| 4C | P0 | M | Docker tool runner分割 | 0 |
| 5 | P1 | M | CIと供給網hardening | 1〜4 |
| 6 | P1 | M | coverage scope拡張 | 3〜4 |
| 7 | P2 | L | performance baselineとscale gate | 4、6 |
| 8 | P1 | XL | measured detection effectiveness | 1〜5、Phase 54.4 |
| 9 | P1 | M | operations、tag、maintainership | 1〜8 |
| 10 | P0 | M | same-commit closeout | selected release scope complete |

Slice 4A〜4Cはfileが重ならないため並行可能である。Slice 8はP0 gate復旧後にのみ開始する。

## 7. Slice 0 — Baseline and change freeze

### Objective

修正前の失敗を同じcommitから再現し、後続PRが何を直したか比較できるようにする。

### Changes

- current release evidenceをsource tree外の一時directoryへ生成する。
- commit、dirty state、Bun version、test inventory、failure ID、command、exit code、durationを保存する。
- F1〜F5を`failed`、環境不足のDocker/corpus検証を`blocked`として区別する。
- `spec/evidence`のhistorical reportは編集しない。

### Acceptance

- F1〜F5が同一baseline reportから参照できる。
- credential、source body、absolute home pathを含まない。
- baseline生成中にsource stateが変わった場合は失敗する。

### Verification

```bash
bun run phase-54:baseline
bun run test:inventory -- --assert-complete
git status --short
git diff --check
```

### Failure handling / rollback

- baseline採取中にHEADまたはworking treeが変わった場合はartifactを破棄し、clean stateから再取得する。
- baselineの失敗を修正扱いにせず、Slice 1以降で個別に解消する。

## 8. Slice 1 — Dependency advisory remediation

### Objective

`nanoid < 3.3.18`をdependency graphから除去し、Security Policyのrelease blockを解消する。

### Changes

- `package.json`の`overrides.nanoid`を`3.3.18`以上の互換patched versionへ更新する。
- `bun.lock`を更新し、全resolved `nanoid` versionを確認する。
- `docs/dependency-overrides.md`のversion、理由、review dateを更新する。
- PostCSS/Vite buildでcustom generator APIを直接使用していないことをdependency/applicability noteへ記録する。

### Acceptance

- `bun audit`にmoderate/high/critical findingが0件。
- dependency treeに`nanoid < 3.3.18`が存在しない。
- Web build、bundle budget、selected coverageが非劣化。
- override documentとpackage manifestが一致する。

### Verification

```bash
bun install --frozen-lockfile
bun run check:audit
bun run check:override-docs
bun run build
bun run check:bundle
bun run test:web
```

### Failure handling / rollback

- patched overrideを古いvulnerable versionへ戻さない。
- transitive consumerが非互換なら、consumer upgradeまたはoverride removalでpatched graphを作り直す。
- 解決までreleaseはblockedのまま維持する。

## 9. Slice 2 — NightWorkers v1 contract reconciliation

### Objective

optional Semgrep化に伴うfixture変更を、明示的にreviewされたv1-compatible contract changeとして固定する。

### Changes

- `shared/fixtures/nightworkers-security-scan-integration-v1.ts`のpreview stepをGitleaks例として維持する。
- Semgrep→Gitleaks diffがwire schemaを変更しないことをschema parse testで証明する。
- NightWorkers consumer fixture/testが同じexampleを受理することを確認する。
- `security-intelligence-stage-0-baseline.json`のNightWorkers fixture hashを、reviewed commitと変更理由付きで更新する。
- verifier output/documentationで`unchanged`の意味を「approved baseline matched」と明記する。

### Acceptance

- schema contract versionは1のまま。
- baseline hash更新がfixtureの意図した差分だけに対応する。
- positive/negative Security Intelligence assessment fixture hashは変化しない。
- producer/consumer双方のv1 contract testがpassする。

### Verification

```bash
bun run verify:security-intelligence-contract
bun test scripts/verify-security-intelligence-contract.test.ts
bun test api/modules/integrations/nightworkers
bun run integration:nightworkers:capabilities -- --project-path .
git diff --check
```

### Failure handling / rollback

- consumer非互換が見つかった場合はbaselineを更新せず、fixture変更を戻す。
- wire shapeの変更が必要ならv1 hash更新ではなくv2 contract計画へ分離する。

## 10. Slice 3 — Optional scanner and real-DB E2E alignment

### Objective

standard profileとoptional Semgrep profileの双方を、実DB・実API・実scan processを通るE2Eで正しい意味に固定する。

### Changes

- 現在のreal-DB testを二つのcontractへ分割する。
  - standard `baseline`: Gitleaks/OSVでscan完了、coverage、zero/non-zero result、automatic reportを確認。
  - optional `semgrep-baseline`: opt-in環境とfixture binaryを使い、`E2E unsafe eval finding`を確認。
- optional test serverにだけ`VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep`を渡す。
- profile catalogに`semgrep-baseline`がopt-in時だけ現れることをbrowser/API双方で確認する。
- Semgrep無効時にstandard profileへ暗黙追加されないnegative testを維持する。
- automatic diagnosticの最終状態を待ってからUI assertionを行い、polling途中の表示をfinal resultと誤認しない。

### Acceptance

- Chromium E2Eが全件passする。
- standard profileはSemgrep binaryの有無に依存しない。
- optional profileはopt-inなしでは非表示・実行不能。
- optional profileのfindingはproduction normalizer/repositoryを通る。
- Axe serious/critical violationが0件。

### Verification

```bash
bun test api/modules/scans/static-scanner-adapter-registry.test.ts
bun test api/modules/scans/nightworkers-profile-contract.test.ts
bun run test:e2e
```

### Failure handling / rollback

- flaky waitをtimeout延長だけで隠さない。scan/diagnosticのauthoritative persisted stateをpollする。
- optional profile setupが不安定ならtestをskipせず、fixture process contractを修正する。

## 11. Slice 4A — Exploration catalog decomposition

### Objective

`exploration-catalog.ts`を735行から500行未満へ分割し、ranking、projection、budgetの変更を独立reviewできるようにする。

### Proposed boundary

- `exploration-catalog.ts`: public orchestrationとexportのみ
- `exploration-catalog-candidates.ts`: file/test candidate生成
- `exploration-catalog-ranking.ts`: priority、sort、reason code集約
- `exploration-catalog-projection.ts`: V1/V2 snapshot projectionとresult assembly
- 既存`exploration-catalog-policy.ts`: normalization、redaction、response budget policy

### Acceptance

- 全production fileが500行未満。
- V1/V2 result schema、stable ordering、hash、budget、redactionが不変。
- V2 language coverageとmodule ID semanticsが非劣化。
- 循環importがない。

### Verification

```bash
bun test \
  api/modules/static-intelligence/exploration-catalog.test.ts \
  api/modules/static-intelligence/exploration-catalog-v2.test.ts \
  api/modules/static-intelligence/intelligence-exploration-catalog-cli.test.ts \
  api/modules/static-intelligence/mcp-tools.test.ts
bun run check:source-size
bun run typecheck
```

### Failure handling / rollback

- schema outputまたはcanonical orderingが変化した場合、抽出単位を戻してcharacterization testを先に追加する。
- ranking改善を同じPRへ混ぜない。

## 12. Slice 4B — Reproduction runner decomposition

### Objective

`reproduction-runner.ts`を509行から500行未満へ分割し、validation、execution、persistence、cleanupを明確にする。

### Proposed boundary

- `reproduction-runner.ts`: public facadeとworkflow orchestration
- `reproduction-run-context.ts`: finding/project/profile解決とapplicability
- `reproduction-execution.ts`: temp directory、command、sandbox execution
- `reproduction-outcome.ts`: failure classification、evaluation、metadata

### Acceptance

- dry-run JSON、run status、failure kind、artifact metadataが不変。
- timeout、Docker unavailable、invalid JSON、storage failureでtemp fileが残らない。
- finding/project ownershipの解決順序を維持する。
- 全production fileが500行未満。

### Verification

```bash
bun test \
  api/modules/reproductions/profiles.test.ts \
  api/modules/reproductions/reproduction-runner.test.ts \
  api/routes/reproductions.route.test.ts
bun run check:source-size
bun run typecheck
```

### Failure handling / rollback

- persistence順序またはcleanup保証が変わった場合は抽出を戻し、failure-path testを追加してから再分割する。

## 13. Slice 4C — Docker tool runner decomposition

### Objective

`docker-tool-process-runner.ts`を503行から500行未満へ分割し、policy、argv生成、lifecycle、cleanupを独立検証できるようにする。

### Proposed boundary

- `docker-tool-process-runner.ts`: process lifecycle orchestration
- `docker-tool-invocation-policy.ts`: binary/first-arg allowlist registration
- `docker-tool-command.ts`: mount、network、resource、argument rewrite
- `docker-tool-cleanup.ts`: timeout、limit、container force removal

### Acceptance

- repo mountはread-only、output/cacheだけread-write。
- default networkは`none`、resource limitは常時付与。
- stdout/stderr/result size超過、timeout、observer failureの意味が不変。
- container name、provenance、cleanup eventが維持される。
- 全production fileが500行未満。

### Verification

```bash
bun test \
  api/modules/scans/tools/tool-process-runner.test.ts \
  api/modules/scans/tools/scanner-provenance.test.ts \
  api/modules/reproductions/reproduction-runner.test.ts
bun run test:coverage:critical
bun run check:source-size
bun run typecheck
```

### Failure handling / rollback

- Docker argv snapshotがsecurity boundaryを弱める場合はmergeしない。
- cleanup regression時は新moduleだけを戻し、既存single-file implementationへ戻す。

## 14. Slice 5 — CI and supply-chain hardening

### Objective

fast/strict gateの失敗に関係なくsecret scanとdependency monitoringが動作し、供給網の失敗を独立して観測できるようにする。

### Changes

- `verify.yml`のGitleaksを`verify` job後の通常stepから独立した`secret-scan` jobへ移す。
- `secret-scan`は`verify`失敗時にも実行し、checkout以外の不要なsetupへ依存させない。
- workflowへ`concurrency`と`cancel-in-progress`を追加し、同一PRの古いstrict runを停止する。
- Dependabotへ次のDocker directoryを追加する。
  - `/docker/toolbox`
  - `/docker/dynamic`
  - `/docker/plugins/semgrep`
- Docker base digest更新PRでもcontainer-security workflowが起動することをpath testで確認する。
- CI jobとactionは最小permission、commit SHA pinを維持する。

### Acceptance

- 意図的に`verify`を失敗させたworkflow testでもsecret scan jobが実行される。
- npm、GitHub Actions、3 Docker directoryがupdate対象になる。
- container workflowはSBOMを生成し、High/Criticalをblockする。
- strict failure、secret failure、container failureが別checkとして表示される。

### Verification

```bash
bun test scripts/verify-steps.test.ts
bun run check:audit
bun run check:artifact-tracking
git diff --check
```

CI上で次を確認する。

```text
verify: pass
secret-scan: pass
container-security/toolbox: pass or explicitly blocked by environment
container-security/dynamic: pass
```

### Failure handling / rollback

- secret scanをstrict job末尾へ戻さない。
- Action互換問題時は独立jobを維持したままaction versionだけを前のpinned SHAへ戻す。

## 15. Slice 6 — Coverage scope transparency and expansion

### Objective

selected coverageを全体coverageと誤認させず、重要な未測定production pathを継続的に縮小する。

### Changes

- coverage reportへ`scopeKind: selected_web | critical_api | repository_measurement`を付ける。
- 全production TS/TSX fileと、coverage対象・critical target・E2E-only・未測定の分類を出すinventory scriptを追加する。
- repository-wide V8 coverageをmeasurement-onlyで生成し、CI artifactとして保存する。
- 初期ratchetは、総率ではなく「未測定critical file数を増やさない」をgateにする。
- auth、outbound URL、project path、secret crypto、Docker runner、active DAST、integration serviceのcritical thresholdは維持する。
- controller exclusionは対応E2E test IDをmanifestへ必須記録する。

### Acceptance

- README、CI artifact、console outputが94.0%をselected Web coverageと明記する。
- 全production fileが四つのcoverage classificationのいずれかに属する。
- unknown/unclassified production fileが0件。
- 新しいcritical production fileをtest/thresholdなしで追加するとgateが失敗する。
- 既存thresholdは下がらない。

### Verification

```bash
bun run test:coverage
bun run test:e2e
bun run test:inventory -- --assert-complete
bun run verify
```

### Failure handling / rollback

- repository-wide数値が低いことを理由にexcludeを増やさない。
- measurement collectorが不安定ならrelease threshold化せずartifact生成だけに戻す。

## 16. Slice 7 — Performance baseline and scale decision gate

### Objective

local single-node用途での性能と資源境界を定量化し、最適化またはremote architecture着手の判断根拠を作る。

### Workload

- health/readiness endpoint
- authenticated project/scan/finding list
- SQLite Writer single mutation latency
- 4/16/64 concurrent Writer mutation latencyとqueue depth
- scan admissionからchild process startまでの時間
- 10k finding pagination query
- Static Intelligence current-generation read
- automatic diagnostic queue admission（LLMはfixture provider）

### Changes

- `scripts/benchmark/local-runtime.ts`とversioned policy schemaを追加する。
- hardware class、OS、Bun、SQLite、commit、fixture hashを結果へ保存する。
- p50/p95/p99、throughput、max queue depth、error/rejection、RSSを記録する。
- first baseline PRでabsolute SLOをreviewして固定する。
- subsequent PRでは少なくとも次をgateにする。
  - error/rejection 0
  - queue depthがhard maximumへ到達しない
  - p95が承認済みbaselineから20%以上悪化しない
  - RSSが承認済みbaselineから25%以上悪化しない
- multi-node要求は、single-node policy未達または実利用capacity不足のevidenceがある場合だけ別ADRへ進める。

### Acceptance

- 同じhost classで3回実行し、中央値結果を生成できる。
- benchmark dataにsource body、credential、absolute home pathがない。
- Writer queue full、timeout、memory growthをpassへ丸めない。
- support matrixにsingle-node上限と未対応条件が記載される。

### Verification

```bash
bun run scripts/benchmark/local-runtime.ts -- --repeat 3
bun test api/db/writer
bun test api/modules/scans/scan-process-supervisor.test.ts
bun run check:artifact-tracking
```

### Failure handling / rollback

- flaky timingをtimeout拡大だけで解決しない。fixture、warm-up、host classを固定する。
- thresholdが現実的でない場合は結果を削除せず、policy major changeとして旧新比較を残す。

## 17. Slice 8 — Measured detection effectiveness

### Objective

professional capability claimの未達を、threshold変更ではなくscanner precision、recall、実行証拠の改善で解消する。

### Relationship to Phase 54

実装詳細はPhase 54 Slice 54.4と54.5を正とする。本sliceは今回のcloseout dependencyとして、その出口を固定する。

### Workstream A — OWASP Benchmark

- false negative 412件、false positive 441件をCWE/rule/source別に分類する。
- SQL injection、trust boundary、XSS等の弱いcategoryを優先する。
- rule変更ごとにpositive recallとnegative false-positiveをpaired fixtureで確認する。
- optional Semgrep image、owned rule manifest、normalized resultのhashを同じrunへ結び付ける。
- overallだけでなくpolicy対象category recallを保存する。

### Workstream B — Juice Shop

- 20 eligible scenarioをreset→execute→evidence→cleanupの順で実行する。
- scenarioごとに一意のevidence artifactを要求する。
- cleanup failure、auth failure、未実行は`blocked`または`failed`とし、observation済みにしない。
- credential canary leakage 0、production/public active request 0を維持する。

### Acceptance

- OWASP recall `>= 0.7`
- OWASP precision `>= 0.8`
- OWASP false-positive rate `<= 0.1`
- OWASP score `>= 0.6`
- applicable category recallがpolicy minimum以上
- Juice Shop eligible scenarios `>= 20`
- Juice Shop categories `>= 8`
- Juice Shop recall `>= 0.6`
- Juice Shop precision `>= 0.8`
- threshold未達時はclaim `not_met`と具体的limitationを維持

### Verification

```bash
bun run security-corpora:verify
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
  bun run benchmark:all
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
  bun run verify:professional-capability
bun run verify:phase-50-evidence
```

### Failure handling / rollback

- precision改善でrecallがpolicy未満になったrule変更は戻す。
- corpus/input hashが一致しないrunは比較対象から除外するが、失敗artifactは保持する。
- claimを手動で`met`へ変更しない。

## 18. Slice 9 — Operations, release, and maintainership

### Objective

実装品質を再現可能な配布、support policy、複数人で継続可能な運用へ変換する。

### Workstream A — Migration readiness

- planning hostへ`bun run db:migrate`を実行し、`0028_finding_pagination_index.sql`を適用する。
- migration前にWriter-consistent backupを作成・検証する。
- fresh DBとone-version-behind DBのupgrade testを維持する。
- bootstrap checkがpending migrationを明示し、勝手にpass扱いしないことを確認する。

### Workstream B — Tagged release

- 既存公開releaseの有無を確認し、最初のtagを`v1.0.0`または修正release `v1.0.1`のどちらにするかrelease decisionで固定する。
- package version、tag、CHANGELOG、release evidence、container/toolbox digestを一致させる。
- Security Policyのsupported versionsを、実在するtagだけを参照する表へ変更する。
- tag作成前にclean-checkout strict、backup restore、container security、capability stateを確認する。
- professional capability `not_met`でもtechnical releaseは可能だが、release noteにlimitationを残す。

### Workstream C — Maintainership

- `docs/maintainership.md`へdomain、primary role、backup role、review pathを記載する。
- security boundary、DB writer、scanner runtime、release evidenceの変更はowner review対象にする。
- backup maintainerが存在しないdomainは空欄を隠さず`unassigned`とし、bus-factor riskとしてrelease reportへ残す。
- onboardingとしてarchitecture map、最小focused test、release drillを用意する。
- 実在するbackup maintainerがrelease drillを完了した時だけbus factor改善を完了扱いにする。

### Acceptance

- `bootstrap:check -- --skip-port`がpassする。
- backup create/verifyとrestore drillがpassする。
- package versionとGit tagが一致する。
- tagが参照するcommitのcurrent release reportが全technical release gateを満たす。
- Security Policyが存在しないreleaseをsupportedと宣言しない。
- critical domainのownerまたは明示的`unassigned`状態が一覧化される。

### Verification

```bash
bun run backup:create -- --output /absolute/secure/path/pre-upgrade.sqlite
bun run backup:verify -- --input /absolute/secure/path/pre-upgrade.sqlite
bun run db:migrate
bun run bootstrap:check -- --skip-port
bun run verify:clean-checkout -- HEAD
git tag --points-at HEAD
```

### Failure handling / rollback

- migration失敗時はapplicationを開始せず、検証済みbackupへisolated restoreして原因を調査する。
- tag作成後にgate不備が見つかった場合、同じtagを付け替えず、新しいpatch versionで修正する。
- backup maintainer未確保を文書だけで解消扱いにしない。

## 19. Slice 10 — Same-commit closeout

### Objective

選択したrelease scopeを、clean checkoutと必要なexternal inputsを使って同一commitで証明する。

### Required gates

```bash
bun install --frozen-lockfile
bun run bootstrap:check -- --skip-port
bun run verify:strict
bun run verify:security-capability
bun run verify:phase-50-evidence
bun run verify:phase-51-baseline
bun run verify:dast-capability
bun run verify:phase-54-baseline
bun run verify:clean-checkout -- HEAD
git diff --check
```

Container releaseでは追加で実行する。

```bash
bun run docker:toolbox:build
bun run verify:toolbox-offline
bun run benchmark:dast-real-scanners
bun run verify:dast-real-scanners
```

### Acceptance

- source-size violation 0。
- moderate/high/critical dependency advisory 0、またはpolicy形式の期限付き例外のみ。
- test inventory duplicate/missing 0。
- unit/integration/contract/browser E2E failure 0。
- selected Web/critical coverageが既存threshold以上。
- secret scanがstrict jobとは独立してpass。
- current release reportがHEAD、clean state、input hashes、command resultsへ結び付く。
- technical release claimとprofessional capability claimが別々に正しく表現される。
- 未確認gateを`pass`として記録しない。

### Failure handling / rollback

- 一つでもrequired gateがfailedならtagを作らない。
- Docker/corpus不足は`blocked`としてrelease decisionへ上げ、無条件passへ変換しない。
- closeout後の変更は新しいrelease candidate commitとして全gateを再実行する。

## 20. PR sequence

| PR | Scope | Must not include |
| --- | --- | --- |
| 1 | baseline evidenceとfailure inventory | production behavior変更 |
| 2 | nanoid patched overrideとlock/docs | unrelated dependency upgrade |
| 3 | NightWorkers v1 fixture/baseline reconciliation | v2 API設計 |
| 4 | standard/optional scanner E2E分離 | production profileへのSemgrep暗黙追加 |
| 5A | exploration catalog分割 | ranking policy変更 |
| 5B | reproduction runner分割 | profile behavior変更 |
| 5C | Docker runner分割 | resource/network policy緩和 |
| 6 | independent secret scan、Docker Dependabot、CI concurrency | scanner feature追加 |
| 7 | coverage inventoryとscope labels | threshold引き下げ |
| 8 | local performance baselineとpolicy | remote DB migration |
| 9A | OWASP category改善 | benchmark threshold変更 |
| 9B | Juice Shop execution/evidence | claim status手動変更 |
| 10 | migration、tag、support policy、maintainership | new feature |
| 11 | same-commit closeout | source変更 |

PR 5A〜5Cは並行可能である。PR 9A/9BはP0〜P1 gateがgreenになってから開始する。

## 21. Risk register

| Risk | Impact | Mitigation | Rollback trigger |
| --- | --- | --- | --- |
| baselineを機械的更新して契約回帰を隠す | external consumer break | fixture diffとconsumer testを必須化 | consumer/schema mismatch |
| Semgrepをstandardへ戻してlicense境界を崩す | distribution/compliance risk | optional profile明示 | core profileへの混入 |
| file分割でcleanup/persistence順序が変わる | artifact leak、inconsistent state | characterization/failure-path test | output/status/hash drift |
| secret scanが他job失敗でskip | credential leak見逃し | independent job | skipped secret check |
| coverage数値だけ改善 |未検査領域を隠す | file classificationとE2E link | exclude増加のみの差分 |
| benchmark overfit | external efficacy非改善 | category/negative fixture/real repo比較 | precision/recall tradeoff違反 |
| timing benchmark flaky |誤った性能判断 | host class、warm-up、3 run median | variance policy超過 |
| tagとartifact不一致 | unreproducible release | same-commit report、immutable tag | post-tag source change |
|形式的CODEOWNERSでbus factorを隠す | operational continuityなし |実在backup drill | backup未割当 |

## 22. Success metrics

### Release correctness

- `verify:strict` pass rate: 100% on release commit
- clean-checkout pass: true
- source-size violation: 0
- blocking dependency advisory: 0
- contract drift: 0
- browser E2E failure: 0
- skipped secret scan: 0

### Maintainability

- 3対象production file: each `< 500` lines
- unclassified production coverage file: 0
- new critical file without threshold/test: 0
- circular dependency introduced by refactor: 0

### Product effectiveness

- OWASP and Juice Shop metrics: `benchmark-policy.v1.json` minimum以上、またはclaim `not_met`を維持
- credential canary leakage: 0
- public/production active requests: 0
- confirmed finding without executable evidence: 0

### Operations and sustainability

- pending migration: 0
- verified backup/restore drill: pass
- package/tag/release report version mismatch: 0
- critical domain ownership state: 100% documented
- backup maintainer drill: completedまたはrisk `unassigned`を明示

## 23. Definition of Done

- [x] F1〜F5にそれぞれcloseout evidenceがある。
- [x] `nanoid < 3.3.18`がdependency graphに存在しない。
- [x] NightWorkers v1 baseline更新がconsumer compatibility testを伴う。
- [x] standard/optional scanner E2Eが分離され、全件passする。
- [x] 3 large production fileが500行未満である。
- [x] secret scanがstrict failureに関係なく実行される。
- [x] npm、GitHub Actions、Docker dependenciesが自動更新対象である。
- [x] selected coverageとrepository-wide measurementが明確に区別される。
- [x] local performance baselineとversioned regression policyがある。
- [x] benchmark threshold未達を偽って`met`へ変更していない。
- [x] planning hostとfresh/upgrade fixtureのmigration readinessがpassする。
- [x] 実在するtag、package version、changelog、release reportが一致する。
- [x] maintainershipの未割当riskが隠されていない。
- [x] 同一commitのclean checkoutでrequired gateが完了する。
- [x] 未実行・blocked・failedをpassとして記録していない。
