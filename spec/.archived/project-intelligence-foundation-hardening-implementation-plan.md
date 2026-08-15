# Project Intelligence Foundation Hardening Implementation Plan

- Status: Implementation complete through the rollout gate — Slices 0-5 implemented; Slice 6 decided `INSUFFICIENT_EVIDENCE`; Slice 7 not authorized by the gate
- Date: 2026-08-09
- Scope: `vulnWorkbench` producer + `NightWorkers` consumer
- Follow-up: [Project Intelligence and Ontology Evolution Roadmap](./project-intelligence-ontology-evolution-roadmap.md)

## Implementation progress (2026-08-09)

| Slice | Status | Evidence |
| --- | --- | --- |
| 0. Baseline and contract freeze | Implemented | producer / consumerの同一Catalog V2 JSON fixtureとschema parse testを追加 |
| 1. vulnWorkbench V2 catalog projection | Implemented | path-first catalogをProject Structure V2へ切替え、TS/JS・Java・Python・Go、V2 module ID、resolved reference、budget、determinismをtest |
| 2. Producer readiness and revision | Implemented | ready statusとcatalogへ同じpersisted generation由来のsource revision、snapshot ref、typed readiness / coverageを追加 |
| 3. NightWorkers revision guard | Implemented | prepare完了時とcatalog利用時にGit HEADをexpected HEADと照合し、tree-hash-only・unusable・schema不正をfail-open |
| 4. MCP boundary and conditional exposure | Implemented | generic MCP bridgeで専用3 toolをexact-name拒否し、eligible runでのみworker tool definitionを公開 |
| 5. Readiness and observability | Implemented | degraded usable reason / coverageをrun pinとmodel-safe resultへ保持し、既存measurementをV2 model projectionへ対応 |
| 6. Controlled paired pilot | Executed; insufficient evidence | [5 complete pair + partial/warm-up evidence](./evidence/project-intelligence-paired-pilot-2026-08-09.json)を保存。provider capacity、competing process、run lossにより10 pair未達 |
| 7. Namespace cleanup | Not executed by gate | [rollout decision](./project-intelligence-rollout-decision-2026-08-09.md)が`INSUFFICIENT_EVIDENCE`のため、責務移動を行わない |

feature flagはOFFへ復元済みである。Slice 6のGO判断がないためdefault ONやnamespace移動を行わない。

### Slice 6 outcome

2026-08-09に固定task setとresumable paired pilot runnerを追加し、warm-up 1 pair、正式5 complete pair、partial 1 pairを実行した。全formal catalog pinはProject Structure V2、同一Git revision、`degraded_usable` readinessで成功し、wrong revision / wrong project / unsafe path incidentは0件だった。

一方、formal catalog runは5/5件で専用toolを呼ぶ前にlocal provider capacity failureとなり、baseline/catalogともcompletion・verification evidenceを得られなかった。さらに常駐NightWorkers API processとのpilot DB競合によりrun interruptionとrun record lossが発生したため、安全上追加投入を中止した。

判定は`INSUFFICIENT_EVIDENCE`であり、性能gateの失敗を意味する`NO-GO`とは区別する。runnerにはclean consumer、単一NightWorkers process、provider cooldownのpreflight guardを追加済みである。再pilot条件とnamespace判断は[rollout decision](./project-intelligence-rollout-decision-2026-08-09.md)を正本とする。

## 1. Purpose

この計画は、既に実装されている Project Structure Scanner、path-first MCP、NightWorkers の run-scoped catalog adapter を作り直さず、Project Exploration MVP として安全に評価できる状態まで整備するための cross-repository 実装計画である。

今回の目的は Ontology 製品を作ることではない。次の一つの価値仮説を検証可能にする。

> 同じ repository revision に対する構造解析を一度だけ行い、coding agent が実装前に繰り返す `list_dir`、`search_files`、`rg`、無関係な source read の一部を、一回の bounded catalog query へ置き換えられる。

本計画の完了は「コードが存在すること」ではなく、revision 安全性、consumer 境界、readiness、paired runtime evidence がすべて確認された状態を指す。

### Document precedence

- 本書は、Project Exploration MVPの現行実装に対する差分計画の正本である。
- `project-scan-exploration-reduction-mcp-concept.md`の価値仮説とmetricは維持する。
- `static-intelligence-coding-agent-consumer-companion-plan.md`のうち、internal ID pinningやNightWorkersがcanonical Project Ontologyを所有するという記述は本書の責務境界で置き換える。
- NightWorkersの`project-path-first-vulnworkbench-integration-implementation-plan.md`は既存path-first実装の根拠として維持し、本書はその未完了のcorrectness hardeningとpaired rolloutを追加する。
- 実コードと文書が矛盾した場合、完了宣言ではなく実コードと再現可能なtestをbaselineとする。

## 2. Executive Decision

1. `vulnWorkbench` は task 非依存の Project Structure facts と bounded projection を所有する。
2. `NightWorkers` は run、worktree、expected revision、worker tool、fallback、利用計測を所有する。
3. `.agent-ontology` は repository-owned execution contract として維持するが、本計画では拡張しない。
4. `vulnWorkbench` の Project Structure Snapshot V2 を catalog の正本にする。
5. path-first active pilot は新しい catalog V2 contract を使用し、legacy ID-based catalog V1 は互換読取のため残す。
6. NightWorkers は catalog 応答の source revision と run の expected HEAD を必ず照合する。
7. Project Intelligence 専用 MCP tool は generic model-facing MCP bridge から呼び出せないようにする。
8. feature flag は既定 OFF、native API implementation lane 限定を維持する。
9. paired run で探索削減と品質非劣化が確認できるまで default ON にしない。
10. `scanRun` を再利用する現在の内部永続化は MVP では変更しない。

## 3. Responsibility Boundary

| Concern | vulnWorkbench | NightWorkers | Target repository / future Ontology Core |
| --- | --- | --- | --- |
| source inventory / parsing | owns | does not reimplement | supplies source |
| symbol / reference / module facts | owns | consumes bounded projection | may declare semantic mapping later |
| structure generation lifecycle | owns | explicitly requests preparation | does not control |
| task / run / worktree | does not own | owns | does not own |
| expected revision binding | returns observed revision | validates against run HEAD | Git is source of revision |
| catalog ranking | owns deterministic task-neutral rules | supplies task focus | does not own |
| worker tool exposure | does not own | owns | does not own |
| fallback to normal exploration | reports failure/readiness | owns | does not own |
| canonical domain / invariant | candidate-only | applies run contract | repository declaration is authoritative |
| usage / completion measurement | aggregate producer telemetry only | owns paired runtime measurement | provides task acceptance criteria |

判定規則は次とする。

- 同じ revision なら task が変わっても変わらない事実は `vulnWorkbench` に置く。
- task、run、worktree によって変わる選択は `NightWorkers` に置く。
- 「何であるべきか」「誰が所有するか」という規範は repository declaration または将来の Ontology Core に置く。

## 4. Verified Baseline

### 4.1 vulnWorkbench

実装済み:

- Project Structure Scanner V2
- TypeScript / JavaScript、Java、Python、Go analyzer
- inventory、typed references、module inference、coverage、diagnostics
- Project Structure V2 + Code Structure V1 + Static Intelligence Export の generation 永続化
- source fingerprint、prepare job dedupe、lease、restart recovery
- `vuln_prepare_project_intelligence`
- `vuln_get_project_intelligence_status`
- `vuln_get_project_exploration_catalog`
- allowed root、canonical path、symlink alias rejection
- structure-only preparation
- source change 中の generation publish 拒否
- bounded catalog response と secret/path redaction

確認済み focused test:

```bash
bun test \
  api/modules/static-intelligence/project-path-mcp.test.ts \
  api/modules/static-intelligence/exploration-catalog.test.ts \
  api/modules/static-intelligence/project-structure/builder.test.ts \
  api/modules/static-intelligence/module-candidates.test.ts \
  api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
```

2026-08-09 baseline: 40 tests passed, 0 failed.

### 4.2 NightWorkers

実装済み:

- repository feature flag、既定 OFF
- native API implementation lane eligibility
- server-side prepare coordinator
- bounded status polling と timeout fail-open
- registered root / execution worktree / expected HEAD の確認
- internal-ID-free availability snapshot V2
- focus-only `project_exploration_catalog` worker tool
- model-safe catalog projectionと audit payload の分離
- stale、workspace mismatch、source mutation 時の fail-open
- catalog call、探索回数、source read、token、time-to-mutation、completion、verification、replan の計測
- baseline / catalog pair summarizer

確認済み focused test:

```bash
node scripts/run-vitest.mjs run \
  tests/project-exploration-source.service.test.ts \
  tests/project-exploration-catalog-tool.test.ts \
  tests/project-exploration-measurement.test.ts \
  tests/project-exploration-run-pinning.test.ts \
  tests/project-exploration-settings.service.test.ts
```

2026-08-09 baseline: 5 files / 33 tests passed, 0 failed.

### 4.3 Agent Ontology

`.agent-ontology` には module manifest、owned path、invariant、cross-module policy、verification plan があり、validator、goal classification、context compilation、boundary audit が実装されている。

```bash
node scripts/agent-ontology/validate-manifests.mjs
node scripts/agent-ontology/smoke-mcp-contract.mjs
```

2026-08-09 baseline: validation and smoke passed.

これは本計画の入力条件であり、Project Exploration の一部として変更しない。

## 5. Confirmed Gaps

### G1. Catalog is backed by the V1 projection

現在の catalog は `CodeStructureSnapshot` V1 を読み、V1 projector は TypeScript / JavaScript analyzer の file だけを残す。そのため V2 では解析済みの Java、Python、Go が catalog 候補にならない。

また、V2 module ID と V1 path grouping module ID が異なるため、V2 snapshot / ontology handoff から得た module ID を catalog focus に使うと一致しない。

### G2. Run revision and returned generation revision are not compared

NightWorkers は execution worktree が expected HEAD かを検査するが、catalog 応答に含まれる `sourceRevision` を expected HEAD と比較していない。path-first query が provider 側の別 source state を選んだ場合、run と異なる revision の clue を受け入れる余地がある。

### G3. Dedicated tool boundary can be bypassed through generic MCP

generic `mcp_call_tool` は `readOnlyHint !== false` の tool を呼べるため、model は専用 adapter を通さず status / catalog を直接呼び出せる。これにより NightWorkers が固定注入する registered project path 境界を迂回できる。

### G4. Readiness is not transported end-to-end

NightWorkers の availability snapshot は `codeStructure: available` を固定値として保存している。producer の inventory、analysis、resolution、module inference coverage が run preparation 時に伝達されないため、usable degraded と unusable を分けられない。

### G5. Tool definition is exposed when unavailable

native API tool registry は profile input を無視して全 tool を返す。dispatcher では失敗するが、無効 run でも schema token を消費し、誤呼び出しが可能になる。

### G6. Runtime value evidence is absent

offline ranking fixture と計測コードは存在するが、同じ base revision / task / model 条件で行った baseline / catalog paired run evidence は保存されていない。従って default activation の価値判断は未完了である。

## 6. Target Contracts

### 6.1 Producer path-first preparation

```ts
vuln_prepare_project_intelligence({ projectPath })
vuln_get_project_intelligence_status({ projectPath })
```

原則:

- prepare だけが side effect を持つ。
- status は read-only で、暗黙 prepare を行わない。
- 同一 source fingerprint + pipeline version は再利用する。
- external security scanner を開始しない。
- `scanRun` は内部 provenance であり consumer key にしない。

### 6.2 Path-first catalog V2

```ts
vuln_get_project_exploration_catalog({
  projectPath,
  focus: { paths?, modules?, terms? },
  limits?
})
```

V2 response の必須意味:

```ts
type ProjectExplorationCatalogV2 = {
  ok: true;
  status: "completed" | "degraded";
  version: "v2";
  freshness: { status: "fresh" | "stale" };
  source: {
    structureSchemaVersion: "project-structure-v2";
    snapshotRef: string;
    revision: {
      kind: "git" | "tree_hash_only";
      head?: string;
      value: string;
    };
  };
  readiness: {
    usability: "usable" | "degraded_usable" | "unusable";
    reasonCodes: string[];
    coverage: {
      inventoriedFiles: number;
      analyzedFiles: number;
      resolvedReferences: number;
      unresolvedReferences: number;
      inferredModules: number;
    };
  };
  focusResolution: unknown;
  likelyFiles: unknown[];
  relatedTests: unknown[];
  verificationCandidates: unknown[];
  truncation: unknown;
  degradedReasons: string[];
};
```

制約:

- source body / snippet を返さない。
- absolute project pathを model projectionへ含めない。
- internal project / scan / generation ID を model projectionへ含めない。
- candidate-only verification command を実行済み evidence と表現しない。
- response hard cap を維持する。

### 6.3 Consumer worker tool

```ts
project_exploration_catalog({
  focus: { paths?, modules?, terms? }
})
```

NightWorkers adapter が固定注入するもの:

- MCP server ID
- registered repository path
- execution worktree path
- expected run HEAD

model が入力できないもの:

- absolute project path
- MCP internal IDs
- scan / generation ID
- source revision override

## 7. Implementation Slices

### Slice 0: Baseline and contract freeze

Owner: both repositories

Changes:

1. 本計画を implementation source of truth とする。
2. 既存 focused test と現在の offline ranking evidence を保存する。
3. path-first V2 schema の fixture を producer / consumer で同じ JSON contract として固定する。
4. historical V1 run snapshot と legacy ID-based catalog の保持期間を明記する。

Do not change:

- ranking weight
- Agent Ontology behavior
- security scan workflow

Verification:

- 4.1、4.2、4.3 の baseline command が成功する。
- producer fixture を NightWorkers schema が parse できる。

Failure handling:

- baseline failureがある場合は既存不具合として分離し、V2変更へ進まない。

### Slice 1: vulnWorkbench V2 catalog projection

Owner: `vulnWorkbench`

Primary files:

- `api/modules/static-intelligence/exploration-catalog.ts`
- `api/modules/static-intelligence/exploration-catalog-policy.ts`
- `api/modules/static-intelligence/mcp-path-tools.ts`
- `shared/schemas/static-intelligence-exploration-catalog.schema.ts`
- `shared/schemas/project-structure.schema.ts`
- catalog / path-first / multi-language tests

Changes:

1. catalog builder の primary input を `ProjectStructureSnapshotV2` にする。
2. resolved `code_module` reference から direct dependency / importer を作る。
3. V2 file tags、exported symbols、identifiers、module membership を ranking source にする。
4. Java、Python、Goの file / relation / test候補を同じ出力へ含める。
5. module focus は V2 module ID または exact path prefix を受け付ける。
6. V2 module IDを応答・source refの正本にする。
7. readiness、coverage、source revision をV2 schemaへ追加する。
8. V2 response の deterministic ordering と response budget を維持する。
9. path-first endpoint はV2を返す。
10. legacy generation-ID endpoint / evaluator に必要なV1 adapterは互換読取として残す。

Usability policy:

- `usable`: inventory / analysis が利用可能で、候補fileが一件以上ある。
- `degraded_usable`: coverage gapまたは未解決referenceがあるが、候補と根拠を返せる。
- `unusable`: inventory失敗、schema不正、候補fileゼロ、source不一致のいずれか。
- resolution degradationだけを理由に全catalogをunusableにしない。

Verification:

```bash
bun test \
  api/modules/static-intelligence/exploration-catalog.test.ts \
  api/modules/static-intelligence/project-path-mcp.test.ts \
  api/modules/static-intelligence/project-structure/builder.test.ts \
  api/modules/static-intelligence/project-structure/python-go-analyzer.test.ts \
  api/modules/static-intelligence/project-structure/java-analyzer.test.ts
bun run typecheck
```

Required new cases:

- TS/JS direct import and importer
- Java package/import relation
- Python relative/absolute import relation
- Go module import relation
- V2 module ID focus
- degraded usable catalog
- unusable readiness
- reversed input ordering determinism
- response hard cap

Failure handling:

- V2 ranking regression の原因を schema、focus resolution、reference resolution、ranking に分ける。
- offline changed-file recallだけを理由にV1へ戻さない。
- response budget超過時は候補を決定論的に切り詰め、JSONをbyte sliceしない。

### Slice 2: Producer readiness and revision contract

Owner: `vulnWorkbench`

Changes:

1. status `ready` responseへ source revision と構造readiness summaryを追加する。
2. catalog response の revision は実際に選んだ persisted generation から返す。
3. path facade の `freshness: fresh` と generation revision の組み合わせをtestする。
4. source変更中は fresh responseをpublishしない。
5. provenance internal IDs と model-facing source metadata を別fieldとして扱う。

Do not change:

- consumerからexpected revisionを渡すAPIにはしない。
- NightWorkersへgeneration IDを再導入しない。
- query内で暗黙prepareしない。

Verification:

```bash
bun test \
  api/modules/static-intelligence/project-path-mcp.test.ts \
  api/modules/static-intelligence/mcp-tools.test.ts \
  api/modules/static-intelligence/generation-repository.test.ts
```

Required assertions:

- ready statusとcatalogのrevisionが同じ。
- stale generationは`fresh`にならない。
- prepare中source変更時にgenerationをpublishしない。
- model-safe contractにinternal IDがない。

### Slice 3: NightWorkers run revision guard

Owner: `NightWorkers`

Primary files:

- `shared/schemas/project-exploration-catalog.schema.ts`
- `api/modules/ontology/exploration/project-exploration-source.service.ts`
- `api/modules/ontology/exploration/project-exploration-catalog-tool.ts`
- `api/modules/ontology/exploration/project-intelligence-contract.ts`
- source / catalog tool tests

Changes:

1. path-first catalog V2 schemaで`source.revision`を必須化する。
2. Git eligible runでは `catalog.source.revision.head === expectedHead` を必須にする。
3. tree-hash-only support は別feature gateまでunavailableとする。
4. catalog call前後のexecution source検査を維持する。
5. revision mismatchは`PROJECT_EXPLORATION_STALE`としてfail-openする。
6. raw responseとrevision mismatch理由をauditへ残すがmodelへは返さない。
7. readiness usabilityが`unusable`ならtool結果を通常探索へfail-openする。
8. `degraded_usable`はreason codeを保持したまま候補を返す。

Verification:

```bash
node scripts/run-vitest.mjs run \
  tests/project-exploration-source.service.test.ts \
  tests/project-exploration-catalog-tool.test.ts \
  tests/project-exploration-run-pinning.test.ts
```

Required new cases:

- expected HEAD一致
- providerが別HEADのfresh catalogを返す
- call中にexecution worktreeがdirtyになる
- degraded usable
- unusable
- revision field missing / malformed

Failure handling:

- schema不一致、revision不一致、unusableはrun failureにせず通常探索へ戻す。
- wrong-revision clueを一件でもmodelへ返した場合はpilot flagをOFFにする。

### Slice 4: NightWorkers MCP boundary hardening

Owner: `NightWorkers`

Primary files:

- `api/services/worker-tools/mcp-call-tool.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest.ts`
- generic MCP bridge / LLM contract tests

Changes:

1. generic model-facing MCP bridgeから次を明示拒否する。
   - `vuln_prepare_project_intelligence`
   - `vuln_get_project_intelligence_status`
   - `vuln_get_project_exploration_catalog`
2. 拒否判定はserver descriptionやmodel promptではなくexact tool name policyで行う。
3. dedicated adapterだけがcatalogを呼び出せることをtestする。
4. `projectExplorationCatalogEnabled`をtool registryで実際に使用する。
5. unavailable runでは`project_exploration_catalog` definitionをproviderへ送らない。
6. available runではfocus-only schemaだけを公開する。
7. existing contextStill / unrelated MCP read-only toolsは変更しない。

Verification:

```bash
node scripts/run-vitest.mjs run \
  tests/services.mcp-tool-bridge.test.ts \
  tests/services.native-api-runner.test.ts \
  tests/project-exploration-catalog-tool.test.ts \
  tests/worker-tool-dispatcher-extra-coverage.test.ts
```

Required assertions:

- generic bridgeでprepare/status/catalogが拒否される。
- dedicated toolはregistered pathを固定注入する。
- unavailable runのprovider tool listにcatalogがない。
- available runのtool inputにproject path / internal IDがない。

### Slice 5: Readiness, observability, and fail-open semantics

Owner: both repositories

Changes:

1. producer status / catalog と NightWorkers availability snapshot のreason code vocabularyを対応づける。
2. preparation、catalog、fallbackを別metricとして保持する。
3. catalog未使用、catalog失敗、catalog後のbroad explorationを区別する。
4. wrong revision、unsafe path、contract invalidを一般的なno-dataへ畳み込まない。
5. model-visible resultには候補と利用上の制約だけを返す。
6. auditにはserver、provenance、response bytes、failure categoryを残す。

Verification:

```bash
node scripts/run-vitest.mjs run \
  tests/project-exploration-measurement.test.ts \
  tests/project-exploration-source.service.test.ts \
  tests/project-exploration-catalog-tool.test.ts
```

Failure handling:

- measurement parse failureでrunを失敗させない。
- telemetry欠損runは価値評価sampleから除外し、成功sampleとして補完しない。

### Slice 6: Controlled paired pilot

Owner: `NightWorkers` rollout, `vulnWorkbench` producer support

Preconditions:

- Slice 0-5がgreen。
- NightWorkersの対象branch / worktreeがclean。
- `STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS`が最小範囲で設定済み。
- pilot repositoryだけfeature flagを切り替えられる。
- producer / consumer contract versionをrun evidenceに記録できる。

Protocol:

1. 代表taskを事前に固定する。
2. baseline / catalogを同じbase commit、task prompt、provider、model、reasoning effort、runtime laneで実行する。
3. 各pairは独立worktreeで開始する。
4. baselineはfeature flag OFF、catalogはONとする。
5. 変更前探索、最初のmutation、verification、completionまで記録する。
6. 最低10 pairを集め、task種別が一種類へ偏らないようにする。
7. failed / timed-out runを都合よく除外しない。

Primary metrics:

- pre-mutation exploratory tool calls
- pre-mutation unique files read
- non-cached input tokens
- cached input tokens
- time to first mutation
- catalog response bytes
- catalog-before-broad-exploration rate
- completion
- verification pass
- replan count
- fallback reason

GO gates:

- median pre-mutation exploratory tool callsが20%以上減る、またはそれと同等の明確なtool round-trip削減がある。
- median pre-mutation input tokensが15%以上減る。
- completion率がbaselineより悪化しない。
- verification pass率がbaselineより悪化しない。
- wrong revision / wrong project / unsafe path incidentが0件。
- catalog由来のrework増加がない。
- catalog failureがrun failureへ波及した件数が0件。

Decision:

- `GO`: gateを満たし、対象repositoryまたはtask種別を段階的に拡大する。
- `NO-GO`: catalogが探索に追加されるだけ、または品質が悪化する。flagをOFFにしてranking/activationを再評価する。
- `INSUFFICIENT_EVIDENCE`: sample数、token telemetry、verification evidenceが不足。default判断を保留する。

Offline changed-file recallはranking診断として使い、production gateにはしない。

### Slice 7: Namespace cleanup after pilot

Owner: `NightWorkers`

このsliceはbehavioral gateではない。NightWorkersの既存未コミット変更が解消し、pilot経路が安定した後に行う。

Target structure:

```text
api/modules/project-intelligence/
  exploration/
  runtime/
  settings/
  measurement/

api/modules/ontology/
  core/
  runtime/
  handoff/
  debug/
```

Changes:

- `api/modules/ontology/exploration`を`api/modules/project-intelligence`へ移す。
- HTTP path `/settings/project-exploration`は互換維持する。
- historical importsが必要なら一releaseだけre-exportを置く。
- `.agent-ontology`、ontology runtime snapshot、boundary auditは移動しない。
- Project ExplorationをSecurity Oracle / ontology eligibilityから独立したfeatureとして維持する。

Verification:

- import boundary check
- focused exploration tests
- ontology validation / smoke
- existing HTTP contract tests

## 8. Cross-Repository Change Order

```text
PR 1  vulnWorkbench: V2 catalog schema + fixtures
  -> PR 2  vulnWorkbench: path-first revision/readiness
  -> PR 3  NightWorkers: V2 consumer + revision guard
  -> PR 4  NightWorkers: generic MCP boundary + conditional tool exposure
  -> PR 5  paired pilot evidence only
  -> PR 6  namespace cleanup
```

Rules:

- producer contractがmergeされる前にconsumerを有効化しない。
- cross-repository変更を一つのcommitへ混ぜない。
- schema fixtureとfocused testを各PRへ含める。
- NightWorkersの既存working tree変更を上書きしない。
- migration中もfeature flag OFFをrollback手段として維持する。

## 9. Out of Scope

- independent Ontology Core
- canonical domain / capability generation
- `.agent-ontology` schema redesign
- Security Oracle / 50,000 LOC eligibility redesign
- `scanRun` tableからのProject Structure永続化分離
- graph database
- embedding search
- full call graph
- source body / snippet export
- task generation from catalog
- Codex SDK / planning / review lane rollout
- cross-repository dependency graph
- automatic ontology mutation from worker success

これらは `spec/project-intelligence-ontology-evolution-roadmap.md` の移行条件を満たした場合だけ別計画化する。

## 10. Rollback

第一のrollbackはNightWorkers feature flag OFFである。

Immediate rollback conditions:

- wrong project / wrong revision clueを一件でもmodelへ返す。
- generic MCP bridgeから専用catalogを呼べる。
- absolute path / internal ID / secretがmodel payloadへ漏れる。
- catalog failureがrun failureへ波及する。
- completion / verificationがbaselineより悪化する。
- prepare latencyが運用上許容できない。

Rollback時もprepare job、generation、run audit、paired measurementは削除しない。原因を修正し、focused testとshadow preparationから再開する。

## 11. Definition of Done

次をすべて満たしたときだけFoundation Hardeningを完了とする。

1. path-first catalogはProject Structure V2を正本としている。
2. TS/JS、Java、Python、Goのrepresentative fixtureが同じV2 contractを通る。
3. NightWorkersはcatalog source revisionとrun expected HEADを照合する。
4. generic model-facing MCP bridgeは専用Project Intelligence toolを拒否する。
5. unavailable runではcatalog tool definitionをproviderへ送らない。
6. readiness / coverage / degraded reasonがproducerからrun auditまで保持される。
7. wrong revision、unsafe path、unusable catalogは通常探索へfail-openする。
8. focused tests、typecheck、contract fixtureがgreenである。
9. controlled paired pilot evidenceが保存されている。
10. GO / NO-GO / INSUFFICIENT_EVIDENCEの判断がmetric付きで記録されている。
11. default ONはGO判断後に別の明示変更として行われる。
12. canonical OntologyやAgent Ontologyの責務を本計画へ混ぜていない。

## 12. Deliverables

- Project Exploration Catalog V2 schema
- producer / consumer shared fixture
- V2-backed deterministic catalog builder
- revision-safe NightWorkers adapter
- generic MCP dedicated-tool deny policy
- typed readiness and coverage audit
- conditional worker tool exposure
- focused cross-repository tests
- paired pilot result artifact
- rollout decision record
