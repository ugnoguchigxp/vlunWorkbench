# Project Scan Exploration Reduction MCP Concept

## Purpose

この文書は、vulnWorkbench が persisted Static Intelligence generation から、NightWorkers のコーディングエージェント向けに「探索の手がかり目録」を read-only MCP tool として提供する全体構想を定義する。

目的はエージェントへ追加情報を大量投入することではない。実装前に繰り返される `list_dir`、`search_files`、`rg`、無関係な source read、test / verification 探索の一部を、構造化済み generation への一回の限定 query へ置き換えることである。

```text
unplanned repository exploration
  -> many directory/search/read calls
  -> large source context
  -> implementation scope is discovered late

becomes

pinned Project Scan generation
  -> one bounded exploration-catalog MCP call
  -> ranked file/test/verification clues
  -> targeted source reads only
```

## Executive Decision

- 新しい MCP surface は、project overview 全体ではなく、探索削減に必要な file、test、verification の限定目録を返す。
- MCP response は既存探索へ追加する情報ではなく、広い探索を置き換える情報として使う。
- source body、snippet、全file一覧、全graph、全finding、raw artifact は返さない。
- worker は supervisor が planning 時に pin した `scanRunId` / `generationId` だけを使い、run 中に latest generation を選び直さない。
- source discovery / binding は raw repository path を MCP へ渡さず、既存 code structure の `rootRef` と persisted generation provenance を使う。
- MCP は read-only のままとし、scan、generation build、verification、task creation、NightWorkers mutation を行わない。
- 最初の価値判定は、出力件数やactual changed-file recallではなく、探索tool call、source read、input token、completion / verification非劣化で行う。actual changed-file recallは同一fixture上のranking回帰診断にだけ使う。
- 実測で探索を置き換えられなければ、AST fact、LSP、Project Graph、Embedding への追加投資を止める。

## Problem

### Current agent behavior

repository の実装範囲が明示されていないTaskでは、コーディングエージェントは通常、次の探索を行う。

1. directory tree と package manifest を読む。
2. Task文中の語を `rg` / `search_files` で検索する。
3. route、service、schema、repository、test を順に読む。
4. import元・import先を追加検索する。
5. package scripts、CI、既存taskからverification commandを探す。
6. 読み落としが判明すると、実装途中で探索へ戻る。

この探索は必要だが、毎回LLMがraw sourceに対して再計算している。複数Task・複数run・複数agentが同じrepositoryで同じ探索を繰り返すと、入力tokenとtool round-tripが重複する。

### Existing producer assets

vulnWorkbench には既に次がある。

- bounded TypeScript / JavaScript structure extraction
- file path、file tag、exported symbol、import、package dependency
- deterministic module candidate
- scanner-backed file risk / evidence refs
- verification command candidate
- persisted structure + export generation
- `generationId` を指定した exact read
- read-only MCP server

不足しているのは解析機能そのものより、これらを「エージェントが最初に読むべき場所を絞る小さな目録」へ投影するconsumer-facing queryである。

## Value Hypothesis

価値は次の式で判断する。

```text
net value
  = avoided exploratory input tokens
  + avoided tool round-trips
  + avoided rework from missed boundaries/tests
  + reuse across tasks on the same generation
  - MCP request/response tokens
  - generation preparation cost
  - wrong-clue correction cost
```

MCP responseを既存探索へ単純追加した場合、net valueは負になる。価値が出る条件は、MCP後にdirectory全走査や同じ語のbroad searchを行わず、上位候補だけをtargeted readすることである。

### Primary value

1. **探索tokenの削減**
   - raw sourceを読む前に候補を絞り、無関係なfile内容をcontextへ入れない。
2. **tool round-tripの削減**
   - tree、複数回のsearch、test探索、verification探索を一回のread-only queryへ圧縮する。
3. **探索結果の再利用**
   - AST / manifest / scanner解析をgeneration作成時に一度だけ行い、同じGit状態の複数Taskで再利用する。
4. **見落としによるreworkの削減**
   - direct importer、related test、repository verification entrypointを実装開始前に提示する。
5. **provenanceとfreshness**
   - どのgenerationの事実かを固定し、staleな目録をcurrent truthとして扱わない。

### Secondary value

- NightWorkersのTask decompositionがlikely fileとtest境界を参照できる。
- Review / closeoutがplanning時の手がかりと実変更を比較できる。
- どのsource refが判断に使われたかをrun eventで説明できる。
- scanner evidenceが存在する場合、security-focused queryだけが限定的に参照できる。

Security evidenceは通常のimplementation explorationのprimary valueではない。通常Taskへ常時含めるとresponseを肥大化させるため、別intentまたは明示opt-inにする。

## Position in the Existing Architecture

```text
vulnWorkbench
  scanners / manifests / TypeScript Compiler API
    -> persisted Static Intelligence generation
       -> bounded exploration catalog projection
          -> read-only MCP

NightWorkers supervisor
  repository identity
    -> source discovery by rootRef
    -> generation selection and pinning
    -> runtime context with exact generation reference

NightWorkers coding agent
  task / todo / module focus
    -> one exploration catalog call when needed
    -> targeted file reads
    -> implementation
    -> repository-native verification
```

### vulnWorkbench owns

- persisted code / scan facts
- deterministic catalog ranking and bounded projection
- generation provenance / readiness / degraded reasons
- MCP schema、handler、redaction、response budget
- candidate-only file/test/verification clues

### NightWorkers supervisor owns

- NightWorkers repository と vulnWorkbench source のbinding
- generation selection and pinning
- Task / run にMCPを公開するactivation policy
- runtime contextへfocusとexact generation referenceを渡すこと
- usage / tool-call / file-read telemetry

### Worker coding agent owns

- MCPを呼ぶ必要があるかの最終判断
- clueを確定変更対象と誤認せず、対象sourceを実際に読むこと
- targeted searchで仮説を検証すること
- repository policyに従ってverificationを選ぶこと
- MCPがmissing / stale / degradedなら通常探索へfallbackすること

### MCP does not own

- canonical Project Ontology
- Task generation / task approval
- source mutation
- scan / generation refresh
- verification execution
- queue admission / provider routing
- vulnerability confirmation

## Terminology

### Project Scan generation

同じ`generationId`に束ねられたpersisted code structure snapshotとStatic Intelligence export。MCP readはこのgenerationをsource of truthとして使う。

### Exploration catalog

特定のTask focusに対して、最初に確認すべきfile、related test、verification candidateをrank付きで返す小さなread model。source codeの代替ではなく、source codeへ到達する索引である。

### Focus

NightWorkersまたはworkerがqueryへ渡す限定条件。初期surfaceでは次を扱う。

- known project-relative path
- NightWorkers / vulnWorkbench module id or path prefix
- Task titleから抽出した少数のlexical term

focusが空の場合、MCPはproject全体を返さず`focus_required`を返す。

### Clue

変更対象の断定ではなく、persisted factに基づくcandidate。各clueはrank、reason code、source refを持つ。

## Tool Surface

全体構想のprimary toolは一つとする。

```text
vuln_get_project_exploration_catalog
```

既存の次のtoolsはsource discoveryやdeep diveに残す。

- `vuln_list_knowledge_sources`
- `vuln_get_knowledge_source_manifest`
- `vuln_get_code_structure_snapshot`
- `vuln_get_verification_commands`
- `vuln_get_evidence_bundle`

新toolはこれらをすべてまとめて返さない。探索削減に必要なsubsetを、一つのgenerationから一貫して投影する。

### Conceptual input

```ts
type ProjectExplorationCatalogInput = {
  scanRunId: string;
  generationId: string;
  focus: {
    paths?: string[];
    moduleIds?: string[];
    terms?: string[];
  };
  limits?: {
    files?: number;
    tests?: number;
    verificationCommands?: number;
  };
};
```

`generationId`はworker-facing callでは必須とする。latest resolutionはsupervisorのplanning責務であり、worker queryのたびに変化させない。

### Conceptual output

```ts
type ProjectExplorationCatalog = {
  ok: true;
  status: "completed" | "degraded";
  generation: {
    scanRunId: string;
    generationId: string;
    snapshotRef: string;
    sourceTreeHash: string;
    sourceStateHash: string;
    readiness: "available" | "stale" | "degraded";
  };
  focusResolution: {
    matchedPaths: string[];
    matchedModuleIds: string[];
    matchedTerms: string[];
    unmatched: string[];
  };
  likelyFiles: Array<{
    rank: number;
    path: string;
    roleTags: string[];
    reasonCodes: string[];
    sourceRefs: string[];
  }>;
  relatedTests: Array<{
    rank: number;
    path: string;
    reasonCodes: string[];
    sourceRefs: string[];
  }>;
  verificationCandidates: Array<{
    rank: number;
    command: string;
    reasonCodes: string[];
    sourceRefs: string[];
    candidateOnly: true;
  }>;
  truncation: {
    truncated: boolean;
    omittedFiles: number;
    omittedTests: number;
    omittedVerificationCommands: number;
  };
  degradedReasons: string[];
};
```

## Ranking Model

初期rankingはdeterministicで説明可能にする。EmbeddingやLLM rerankingを必須にしない。

優先順位の基本は次とする。

1. exact focus path
2. matched moduleのentrypoint / route / handler
3. focus pathのdirect import target
4. focus pathのdirect importer
5. matched exported symbol / path term
6. same moduleのschema / worker / config
7. direct importerであるtest file
8. same moduleのtest file

同順位はproject-relative pathの昇順で固定する。scoreだけを返さず、必ず`reasonCodes`を返す。

初期Project Scanのedgeはfile-level `imports`と`depends_on_package`に限定されるため、symbol referenceやcall graphを暗黙に推定しない。精度不足は`degradedReasons`または評価結果として残し、事実を作らない。

## Response Budget

MCPはtokenizerに依存しないserver-side budgetを持つ。

- default: files 12、tests 6、verification commands 4
- hard maximum: files 20、tests 10、verification commands 6
- target serialized JSON budget: 8 KiB
- hard serialized JSON budget: 12 KiB
- source body / snippet: 0 bytes
- raw evidence / artifact body: 0 bytes

budgetを超える場合はJSON文字列を途中で切らない。rankの低いitemをdeterministicに除外し、`truncation`へomitted countを保存する。paginationで全projectを取りに行く設計にはしない。focusを狭めて再queryする。

## Source Discovery and Binding

MCPにarbitrary filesystem pathを渡してはならない。bindingは次の順序で行う。

1. NightWorkersが自身のrepository rootから、Phase 40と同じcanonicalizationで`rootRef`を計算する。
2. `vuln_list_knowledge_sources`がoptional `rootRef` filterと、各sourceの`rootRef`を返す。
3. supervisorが同じ`rootRef`のcandidate setからselection policyで一つのgenerationを選び、`scanRunId` / `generationId` / hashesをrun contextへpinする。
4. workerはexact IDsでexploration catalogを読む。

`rootRef`はlocal absolute pathそのものではなくhash identityである。project name一致だけでbindingしてはならない。同じprojectの複数scan/generationは通常のcandidate setであり、supervisorがreadinessとgeneration生成時刻で一つを選ぶ。異なるproject identityが同じbinding候補へ混在する、またはselection policyで一意に決められない場合は自動採用しない。

`rootRef`はcanonical realpathのhashであり、同じlocal checkoutを参照するconsumer間のidentityである。別machineや別checkout pathをまたぐportable repository IDとして扱わない。

## Freshness and Pinning

- `available`: current source stateと一致し、通常のclueとして使える。
- `degraded`:利用できるがextractor gapなどを併記する。
- `stale`: historical clueとしてのみ使い、current impactを断定しない。
- `missing` / `failed`: MCPを使わず通常探索へfallbackする。

run中にnew generationが作られても、既存runはpinned generationを維持する。新generationは次のplanning / runから採用する。

## Activation Policy

### Use the MCP when

- Taskに編集fileが明示されていない。
- primary moduleは分かるがentrypoint / related testが不明である。
- 複数layerにまたがる可能性がある。
- repositoryが大きく、broad searchの候補が多い。
- 同じgenerationを複数Taskで再利用できる。

### Skip the MCP when

- 編集fileとverificationが既に明示されている。
- 1 fileのtrivial fixである。
- generationがmissing / failedである。
- stale generationしかなく、current構造を必要とする。
- 対象言語がextractorでほぼ`skipped`になっている。
- catalogを読んだ後も必ずrepository全体を再探索する運用になっている。

### Agent instruction

NightWorkersがagentへ与えるinstructionは次の意味を持つ。

> 対象範囲が不明な場合、broadなdirectory/search/read探索を始める前に、pinned generationのexploration catalogを一度だけ取得する。結果は候補であり、編集前に対象sourceを読む。catalog取得後は上位候補からtargeted readし、同じ情報を得るためのproject-wide searchを繰り返さない。

## Agent Workflow

```text
Task / Todo starts
  -> explicit file scope already sufficient?
       yes -> skip MCP
       no  -> pinned generation available and usable?
                no  -> normal exploration
                yes -> call exploration catalog once
                        -> targeted reads of top clues
                        -> narrow search only for unresolved questions
                        -> implement
                        -> repository-native verification
```

MCP callが失敗したことはTask failureではない。fallback理由をrun eventへ残し、通常探索へ移る。

## Measurement Model

### Primary metrics

- input tokens before first successful source mutation
- `list_dir` / `search_files` / command-based search calls before first mutation
- unique source files read before first mutation
- time to first mutation
- total task input tokens
- MCP response bytes

### Quality guard metrics

- recall@N: catalog top-Nにactual changed filesが含まれた割合。同一fixture上のranking回帰診断であり、scan coverageやproduction gateではない
- related-test hit rate
- selected verification command acceptance rate
- Task completion / failure / correction count
- boundary miss / reopen / replan count

### Measurement rule

- 同じrepository revision、Task prompt、model/provider、runtime laneでMCP off/onを比較する。
- generation build costはgeneration単位で記録し、再利用Task数で償却する。
- cached input tokensとnon-cached input tokensを分ける。
- MCPを呼んだだけで探索が減っていないrunをsuccess扱いしない。
- sample不足時は価値を断定しない。

## Rollout Gates

初期pilotの推奨gateは次とする。

- response hard capを全caseで守る。
- representative requestsへのCLI / MCP direct smokeで、実装・testの有用な探索開始地点が得られる。
- paired runsでmedian pre-mutation exploratory tool callが20%以上減る。
- paired runsでmedian pre-mutation input tokensが15%以上減る。
- completion / verification successがbaselineより悪化しない。
- clue誤りによるreplan増加がない。

固定recall閾値は置かない。変更file数が10件を超えるTaskではtop-10 recallの上限自体がTaskごとに異なり、catalogは全変更fileの予測器ではない。未達の場合はranking、activation、source readinessのどこが原因かを分離し、広いAST/LSP/Graph追加へ直ちに進まない。

## Evolution Roadmap

### Stage 1: File-level exploration catalog

- current file/tag/import/module factsを再利用
- related tests and verification candidates
- strict response budget
- NightWorkers controlled pilot

### Stage 2: Measured ranking improvements

- historical diff feedbackを使ったdeterministic ranking調整
- test associationの改善
- reverse dependency / bounded depth query

### Stage 3: Fact enrichment driven by misses

- `defines`
- `tested_by`
- `uses_schema`
- route / handler relation
- symbol relation

追加factはrecall missの原因が既存fact不足と証明された場合だけ導入する。

### Stage 4: Optional enrichments

- multi-language extractor
- optional LSP definition / references
- semantic candidate expansion
- security-focused exploration intent

### Stage 5: Closeout feedback

- planned cluesとactual changed filesの比較
- before / after generation link
- ranking評価datasetの継続更新

Graph canvasと専用Graph DBは、探索削減の価値に直接必要になるまで導入しない。

## Security and Privacy

- MCPはread-only annotationを維持する。
- raw repository pathをtool input/outputへ出さない。
- project-relative normalized pathだけを返す。
- source code、snippet、secret、raw evidenceを返さない。
- verification commandはcandidate-onlyであり実行しない。
- findingは通常intentに含めない。
- NightWorkers / contextStill DBをvulnWorkbenchから読まない。
- NightWorkersはvulnWorkbench SQLite / artifact pathを直接読まない。
- missing generationを理由にMCPがfilesystem extractionやbuildを開始しない。

## Non-Goals

- source code browser
- repository全体の要約
- full Project Graph export
- Graph UI / canvas
- Graph DB導入
- LSP server常駐
- call graph / taint analysis
- Task自動生成・自動承認
- verification実行
- security findingの自動確定
- current Project Signal全体の置き換え
- trivial Taskへの強制利用

## Stop Conditions

- MCP responseが探索削減用の限定目録ではなく、project dumpになる。
- source body / raw artifact / secretを返す必要が生じる。
- workerがlatest generationをrun中に選び直す。
- MCPがscan、build、verification、task mutationを始める。
- catalog取得後も同じbroad explorationが必須で、tokenが純増する。
- project nameだけでsourceを自動bindingする。
- stale generationをcurrent impact truthとして使う。
- pilot gate未達のままAST/LSP/Graphの大規模拡張を正当化する。

## Completion Definition

この構想の最終的な成功は、NightWorkersのコーディングエージェントが、pinned Project Scan generationから小さな探索目録を取得し、実装前のbroad tool explorationとsource readを実際に減らしながら、Task completionとverification品質を維持できたときに成立する。

MCP toolが存在するだけ、またはlikely fileを表示できるだけでは完了ではない。MCPなしのbaselineと比較してnet token / tool-call valueが確認できることを必須とする。

## Relationship to Existing Documents

- `spec/static-intelligence-layer-concept.md`: vulnWorkbench全体のStatic Intelligence責務境界
- `spec/phase-36-static-intelligence-readonly-mcp-wrapper-plan.md`: existing read-only MCP transport / safety contract
- `spec/phase-38-static-intelligence-code-structure-layer-mvp-plan.md`: current file/import/tag facts
- `spec/phase-40-static-intelligence-usability-and-ontology-handoff-plan.md`: persisted generation / exact read / pinning contract
- `spec/static-intelligence-coding-agent-consumer-companion-plan.md`: broader Ontology / Task / runtime / closeout consumer adoption
- `spec/phase-42-project-scan-exploration-catalog-mcp-plan.md`: 本構想の最初のconsumer proof実装計画
