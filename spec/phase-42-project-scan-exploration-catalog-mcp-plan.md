# Phase 42: Project Scan Exploration Catalog MCP and NightWorkers Consumer Proof Plan

## Purpose

この計画は、`spec/project-scan-exploration-reduction-mcp-concept.md` の最初のstepとして、persisted Static Intelligence generationからfile / test / verificationの限定目録を返すread-only MCP toolを追加し、NightWorkersの既存MCP経路を使ったcontrolled consumer proofで探索tool callとinput tokenの削減を測定する。

このphaseは広いcoding-agent integrationを完成させない。次の一本の経路を最後まで通す。

```text
prepared persisted generation
  -> source discovery by rootRef
  -> supervisor pins scanRunId + generationId
  -> coding agent calls one bounded exploration catalog tool
  -> agent reads ranked files selectively
  -> baseline / treatment metrics are compared
```

## Scope Split Decision (2026-07-15)

実装完了の追跡単位を、vulnWorkbenchのCatalog MCP componentと、consumer固有のrollout評価に分離する。

- vulnWorkbench componentは、exact persisted generationのread-only read、deterministic bounded response、安全性、CLI / external MCP stdio client contract一致、repo-native verifyを完了条件とする。判定と再現手順は`spec/evidence/phase-42-vulnworkbench-catalog-mcp-go.md`に記録する。
- NightWorkersのsource binding、run pinning、activation率、exploratory tool call / input token削減、completion / verification非劣化、GO / NO-GOはNightWorkers側の独立したconsumer rollout taskとして追跡する。
- Slice 12のpaired runtime pilotが未完でもvulnWorkbench componentの完了を妨げない。逆に、vulnWorkbench componentのGOだけでNightWorkers rolloutをGOにしない。
- 本文に残るend-to-end gateはoriginal initiative全体の評価設計として維持し、各componentの完了判定と混同しない。

## Decision Summary

- MCP tool名は`vuln_get_project_exploration_catalog`とする。
- toolはexisting persisted generationだけを読み、implicit extraction / build / scanを行わない。
- worker callでは`scanRunId`と`generationId`を必須とする。
- first phaseのfocusはpaths、moduleIds、lexical termsに限定する。
- outputはlikely files、related tests、verification candidatesだけをprimary payloadとする。
- security evidence、raw source、whole graph、whole snapshotは返さない。
- deterministic rankingとhard response budgetを実装する。
- NightWorkersは既存のMCP settings、MCP client、`list_mcp_tools`、`mcp_call_tool`を再利用する。
- NightWorkers固有toolや新しいMCP transportを作らない。
- source bindingには`rootRef`を使い、raw project pathやproject name一致を使わない。
- first consumer proofはNightWorkersの`native-api-runner` implementation laneだけで行う。Codex SDK laneはgo判定後の別phaseとする。
- 両repoともDB migrationは行わない。NightWorkersのflagはexisting `repositories.featureSettings`、pinはrun `contextSnapshot`、計測はexisting events / usageから導出する。
- `rootRef`によるsource discoveryはpersisted artifact metadataをfilterした後にlimitを適用するrepository methodで実装する。
- catalog利用はfeature-gated controlled pilotから始める。
- token/tool-call削減がgo/no-go gateに届かなければ、default enablementと次のfact拡張へ進まない。

## Dependencies

実装開始前に次がmain branch上で利用可能であること。

- Phase 36 read-only MCP server / transport-independent handlers
- Phase 38 `CodeStructureSnapshot`
- Phase 40 persisted generation repository、exact `generationId` read、readiness
- `buildStaticIntelligenceModuleCandidates`
- existing verification command candidates
- NightWorkers effective MCP settings / `McpClientManager`
- NightWorkers native/API `list_mcp_tools` / `mcp_call_tool`
- NightWorkers tool call events、read-file state、LLM usage records

dependencyが欠けている場合、partial duplicateを作らず先に既存contractを修復する。

## Implementation Execution Contract

この節はLuna等の小さいmodelが判断を補わずに実装するための作業規約である。後続の各sliceはこの規約より弱い指示として読まない。

1. `Slice 0`から番号順に一つずつ実行する。並行実装しない。
2. 各sliceの「変更対象」以外を編集しない。ファイル所有者の変更が必要な場合は、先にその理由と候補pathを記録して停止する。
3. 各sliceの最初に「事前に読む」を読み、記載symbolが実在するか`rg`で確認する。symbol不在なら推測で別設計を始めず停止する。
4. 新規のpublic API、DB table / column、MCP transport、schema version、edge kindを追加しない。計画に明記されたadditive field / tool / serviceだけを追加する。
5. 各sliceのfocused testがpassするまで次へ進まない。同じ失敗に2回修正してもpassしない場合は、コマンド、先頭failure、変更file、仮説をhandoffに書いて停止する。
6. `optional`、`if needed`、「実装時に調整」と書かれた別案は実装しない。この計画では主経路を1つに固定する。
7. フォーマッタが触れた無関係fileを「修正」しない。開始時の`git status --short`と各slice終了時のdiffを比較する。
8. コミット、push、pilotの本番有効化はこの計画の実装者が自動で行わない。

各slice終了時に次の4行を作業logへ残す。

```text
Slice: <number and name>
Changed: <project-relative paths>
Proof: <command and pass/fail>
Next: <next slice number or STOP reason>
```

## Fixed Decisions and Forbidden Substitutions

| Topic | Fixed decision | Do not substitute |
| --- | --- | --- |
| producer tool | `vuln_get_project_exploration_catalog` | generic query DSL、resource URI、既存snapshot toolの破壊的変更 |
| discovery | `vuln_list_knowledge_sources({ rootRef, projectId?, limit? })` | project name、raw path、NightWorkersからSQLite direct read |
| generation read | `scanRunId` + required `generationId` | latest-at-call-time selection、missing時のbuild |
| revision match | clean Git generation head must equal NightWorkers worktree baseline HEAD | dirty/tree-hash-only/mismatched generation adoption |
| discovery repository method | `listLatestValidGenerationsByRootRef` | 先頭100 scanを取った後のpost-filter |
| ranking | integer internal priority + matched focus term count + path tie-break; output `rank` is 1-based sequence | LLM / embedding rerank、filesystem mtime |
| response | target 8 KiB / hard 12 KiB | string sliceによるJSON truncation |
| consumer lane | `native-api-runner` implementation only | Codex SDK、planning/test/review laneの同時実装 |
| NightWorkers setting | `repositories.featureSettings.projectExplorationCatalog` | strict `securityIntelligence` schemaへの混入 |
| pin storage | run `contextSnapshot.projectExplorationCatalog` | new DB column/table、task全体のmutable latest pin |
| MCP execution | `getEffectiveMcpServer` + existing `mcpClientManager.listToolsForServer(server)` / `callTool(serverId, ...)` | 専用client、HTTP direct call |
| prompt behavior | optional one call before broad exploration | catalog payloadの常時prompt injection |
| measurement | existing run events + LLM usageからread-only導出 | source/MCP payloadの重複persist、pre-mutation tokenの推測 |
| rollout | default off; fixture/disposable worktree pilot | production-wide enablement |

## Current Baseline

### vulnWorkbench

- MCP registryにはsource list、manifest、guardrail、evidence、verification、full code structure readがある。
- exploration reduction専用のbounded projectionはない。
- `vuln_get_code_structure_snapshot`はfull snapshotを返すため、探索token削減toolとしては大きすぎる。
- code structure edgeは`imports`と`depends_on_package`である。
- file tagはroute、handler、schema、worker、test、config、sourceである。
- module candidateはpath boundary、entrypoint、dependencies、exported symbolsを持つ。
- MCPはexact generation readを扱い、missing generationから暗黙buildしない。

### NightWorkers

- effective MCP serverをsettingsまたはCodex global configから読み込める。
- generic MCP clientはserver toolsのlist/callを行える。
- native/API implementation laneではontology MCP有効時に`list_mcp_tools` / `mcp_call_tool`を公開できる。
- tool call event、command read evidence、file change、task LLM usageを保持している。
- vulnWorkbench handoffはsecurity closeout後には存在するが、pre-implementation explorationを置き換えていない。
- Task Generation Project Signalはbounded file list / excerpts / recent diff中心であり、exploration catalogを含まない。

### Runtime observation to refresh before implementation

2026-07-14の調査時点ではlocal vulnWorkbench DBに18 projects / 51 scan runsがある一方、`code_structure_snapshot`と`static_intelligence_export`のpersisted generation artifactは0件だった。NightWorkersの`ontology.vulnworkbench_handoff_finished` eventも0件だった。

この値は計画上の固定前提にしない。Slice 0で同じread-only queryを再実行し、Slice 11でpilot用generationを明示的に準備する。

## Scope

### In Scope: vulnWorkbench

- exploration catalog shared schema
- deterministic catalog builder
- `rootRef`-based source discovery additive contract
- MCP input schema / handler / registry registration
- stdio server expected-tool / smoke update
- exact generation、budget、redaction、no-mutation tests
- fixture or evaluation helper for historical changed-file recall
- documentation

### In Scope: NightWorkers controlled pilot

- existing MCP server configurationを使ったsource discovery
- `rootRef` matchingとexact generation pinning
- `native-api-runner` implementation laneのpilot-only enablement / runtime context
- agent instruction for one-call-before-broad-exploration behavior
- tool / file-read / token measurement
- MCP off/on comparison report

### Out of Scope

- production-wide default enablement
- canonical Ontology mutation
- Task Candidate schema redesign
- automatic task creation
- security scan auto-run
- MCP build / refresh tool
- source body / snippet response
- symbol graph / call graph / LSP
- multi-language extractor
- embedding or LLM reranking
- Graph UI / Graph DB
- before/after rescan closeout integration
- browser E2E
- Codex SDK laneのactivation / prompt / audit
- planning、test、review、general-answer laneのactivation
- feature flag用UI / public route
- new DB migration / telemetry table

## End-to-End Contract

```text
NightWorkers repository root
  -> compute canonical rootRef
  -> vuln_list_knowledge_sources(rootRef)
  -> exactly one usable source selected
  -> pin scanRunId + generationId + hashes
  -> native/API runtime instruction exposes pinned reference
  -> agent calls vuln_get_project_exploration_catalog once when scope is unclear
  -> target read_file / narrow search
  -> first source mutation
  -> verification
  -> telemetry report
```

MCP failure、source missing、generation staleはTask failureにしない。fallback reasonを記録し、既存探索へ戻す。

## Source Discovery Contract Amendment

`vuln_list_knowledge_sources`へoptional `rootRef` filterをadditiveに追加し、各source summaryへ`rootRef`を追加する。

```ts
type ListKnowledgeSourcesInput = {
  projectId?: string;
  rootRef?: string;
  limit?: number;
};

type KnowledgeSourceSummary = {
  sourceId: string;
  projectId: string;
  rootRef: string;
  scanRunId: string;
  generationId: string;
  generationGeneratedAt: string;
  sourceRevision: {
    kind: "git" | "tree_hash_only";
    head?: string;
    dirtyHash?: string;
    value: string;
  };
  readiness: "available" | "stale" | "degraded";
  // existing fields remain
};
```

`generation-repository.ts`へ次のpublic methodを追加し、`mcp-tools.ts`からこれだけを呼ぶ。

```ts
listLatestValidGenerationsByRootRef(input: {
  rootRef: string;
  projectId?: string;
  limit: number;
}): Promise<PersistedStaticIntelligenceGeneration[]>
```

method内の処理順は固定する。

1. `scanArtifacts`からderived Static Intelligence artifactsを読むqueryで`json_extract(metadata, '$.rootRef') = input.rootRef`を適用する。
2. `projectId`がある場合は`json_extract(metadata, '$.projectId') = input.projectId`もSQL `AND`で適用する。
3. 返ったrowを`staticIntelligenceArtifactMetadataSchema.safeParse`し、parse失敗または入力と不一致のrowをdefense in depthで除外する。
4. `scanRunId:generationId`でdedupeする。
5. 各candidateをexisting `loadGeneration(scanRunId, generationId)`で再構成し、`null`を除外する。
6. `generation.structure.metadata.generatedAt` descending、次に`generation.generationId` ascendingでsortする。
7. 最後に`input.limit`を適用する。

SQLite JSON1はこのrepositoryが使うSQLite runtimeの前提とし、Drizzle `sql` expressionでparameter bindingする。全artifactをapplication memoryへloadしてからrootRef filterしない。

readiness summaryは`mcp-tools.ts`のprivate pure helperで次の優先順位に固定する。

```ts
summarizeGenerationReadiness(readiness, generationStatus):
  | "available"
  | "stale"
  | "degraded"
```

- code structureまたはontology handoffのstatusに`stale`があれば`stale`。
- それ以外でgeneration statusが`degraded`、またはいずれかのstatusが`failed` / `missing` / `degraded`なら`degraded`。
- それ以外は`available`。

Rules:

- `rootRef`はPhase 40 code structure project identityと同じ値を返す。
- `generationGeneratedAt`はmanifest生成時刻ではなくpersisted generation自身の生成時刻を返す。
- `sourceRevision`は同じgenerationのartifact metadataから返す。NightWorkers pilotはclean Git revisionのhead一致を必須とする。
- `readiness`は同じgeneration resolverの結果を返す。
- raw root pathは返さない。
- `projectId`と`rootRef`の両方が指定された場合はAND filterとする。
- filter結果0件は正常なempty discoveryとする。
- `rootRef` filterはglobal result limitより前に適用し、先頭scanだけをpost-filterして候補を落とさない。
- 複数sourceがある場合、listはcandidate setを返すだけで自動adoptionしない。
- NightWorkersはproject nameだけでsourceを選ばない。
- existing `projectId`-only branchは現行の挙動を維持する。`rootRef`がある場合だけ新repository methodへ分岐する。

## MCP Tool Contract

### Tool name

```text
vuln_get_project_exploration_catalog
```

### Description

```text
Read-only bounded exploration clues for one pinned Static Intelligence generation.
Returns ranked project-relative file, test, and verification candidates without
source bodies, raw evidence, repository scanning, command execution, or mutation.
```

### Input schema

```ts
const projectExplorationCatalogInputSchema = z
  .object({
    scanRunId: z.string().trim().min(1),
    generationId: z.string().uuid(),
    focus: z
      .object({
        paths: z.array(z.string().trim().min(1)).max(10).optional(),
        moduleIds: z.array(z.string().trim().min(1)).max(5).optional(),
        terms: z.array(z.string().trim().min(2).max(80)).max(10).optional(),
      })
      .strict(),
    limits: z
      .object({
        files: z.number().int().min(1).max(20).optional(),
        tests: z.number().int().min(0).max(10).optional(),
        verificationCommands: z.number().int().min(0).max(6).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      !input.focus.paths?.length &&
      !input.focus.moduleIds?.length &&
      !input.focus.terms?.length
    ) {
      ctx.addIssue({ code: "custom", path: ["focus"], message: "focus_required" });
    }
  });
```

Input path rules:

- project-relative normalized pathだけを許可する。
- absolute path、`..`、NUL、backslash traversalをrejectする。
- unknown pathはfailureにせず`focusResolution.unmatched`へ入れる。
- empty focusでproject dumpへfallbackしない。

### Output schema

新規`shared/schemas/static-intelligence-exploration-catalog.schema.ts`でresult / failureを定義する。

```ts
type ProjectExplorationCatalogResult = {
  ok: true;
  status: "completed" | "degraded";
  version: "v1";
  generatedAt: string;
  generation: {
    projectId: string;
    scanRunId: string;
    generationId: string;
    snapshotRef: string;
    sourceTreeHash: string;
    sourceStateHash: string;
    sourceRevision: {
      kind: "git" | "tree_hash_only";
      head?: string;
      dirtyHash?: string;
      value: string;
    };
    readiness: "available" | "stale" | "degraded";
  };
  focusResolution: {
    matchedPaths: string[];
    matchedModuleIds: string[];
    matchedTerms: string[];
    unmatched: string[];
  };
  likelyFiles: ExplorationFileClue[];
  relatedTests: ExplorationTestClue[];
  verificationCandidates: ExplorationVerificationClue[];
  truncation: {
    truncated: boolean;
    omittedFiles: number;
    omittedTests: number;
    omittedVerificationCommands: number;
  };
  degradedReasons: string[];
};
```

clue shapeは次で固定する。`priority`はbuilder内部値でありresponseに出さない。`rank`は`likelyFiles`、`relatedTests`、`verificationCandidates`の各array内で独立したsort後の1-based連番とする。

```ts
type ExplorationFileClue = {
  rank: number;
  path: string;
  roleTags: Array<"route" | "handler" | "schema" | "worker" | "test" | "config" | "source">;
  reasonCodes: ExplorationFileReasonCode[];
  sourceRefs: string[];
};

type ExplorationTestClue = {
  rank: number;
  path: string;
  reasonCodes: Array<"direct_test_importer" | "same_module_test">;
  sourceRefs: string[];
};

type ExplorationVerificationClue = {
  rank: number;
  command: string;
  candidateOnly: true;
  sourceRefs: string[];
};
```

Failureはexisting MCP failure envelopeと整合させる。

```ts
{
  ok: false;
  status: "failed";
  message: string;
  reasonCode?:
    | "invalid_input"
    | "generation_missing"
    | "generation_mismatch"
    | "focus_required"
    | "catalog_unavailable";
}
```

handlerのfailure mappingは次で固定する。messageはtestで完全一致contractにせず、`reasonCode`をassertする。

| Condition | reasonCode |
| --- | --- |
| Zod parse failure other than empty focus | `invalid_input` |
| `focus_required` custom issue | `focus_required` |
| `loadGeneration` returns `null` | `generation_missing` |
| loaded IDs differ from input | `generation_mismatch` |
| generation validation/readiness/builder exception or hard-budget failure | `catalog_unavailable` |

existing MCP tool failuresは`reasonCode`をomitできる。他toolのerror mappingをこのsliceで変更しない。

### Required provenance

すべてのsuccess responseに次を含める。

- `projectId`
- `scanRunId`
- `generationId`
- `snapshotRef`
- `sourceTreeHash`
- `sourceStateHash`
- `sourceRevision`
- readiness

itemの`sourceRefs`は`file:<path>`、`module:<id>`、`verification_command:<n>`などkind付きにする。

## Catalog Builder

新規`api/modules/static-intelligence/exploration-catalog.ts`はtransportやDBを知らないpure projectionとする。

```ts
export type ProjectExplorationGenerationView = {
  projectId: string;
  scanRunId: string;
  generationId: string;
  status: "available" | "degraded";
  structure: {
    metadata: Pick<
      StaticIntelligenceArtifactMetadata,
      "generatedAt" | "rootRef" | "snapshotRef" | "sourceTreeHash" | "sourceStateHash" | "sourceRevision"
    >;
    snapshot: CodeStructureSnapshot;
  };
  export: { payload: StaticIntelligenceExportV1 };
};

buildProjectExplorationCatalog({
  generation,
  readiness,
  focus,
  limits,
  generatedAt,
})
```

### Candidate collection

1. exact focus pathsをseedにする。
2. module id / path prefix一致からmodule filesとentrypointsを得る。
3. lexical termsを次へcase-insensitive exact-token / substring orderで照合する。
   - project-relative path segments
   - basename
   - exported symbol
   - module label / path prefix
   - role tag
4. seed fileからdirect outgoing `imports` edgeを追加する。
5. seed fileへのdirect incoming `imports` edgeを追加する。
6. test tagを持つincoming importerをrelated testへ追加する。
7. same moduleのtest fileをfallback test candidateにする。
8. generation exportのverification command candidatesを上限付きで追加する。

module候補はgenerationに別artifactとして保存されていない。builderの先頭でexisting pure functionを1回だけ呼び、そのresultを以後のlookupに使う。

```ts
const modules = buildStaticIntelligenceModuleCandidates({
  snapshot: input.generation.structure.snapshot,
  exportPayload: input.generation.export.payload,
});
```

focus normalizationは次で固定する。

- pathはbackslashを`/`に変換するのではなくrejectし、POSIX project-relative pathだけ受ける。
- lexical comparison用文字列はUnicode `NFKC`、trim、lowercaseする。
- termはschemaで2文字未満をreject済みとし、exact token一致をsubstringより優先する。
- input配列はdedupe後にlexicographic sortし、input orderをrankに使わない。
- edgeは`kind === "imports"`だけ使い、1 hopで停止する。`depends_on_package`はfile候補に使わない。
- verificationは`generation.export.payload.handoff.verificationCommands ?? []`から取り、trimしたempty commandを除外する。

### Deterministic rank

priorityは次で固定する。

| Priority | Reason code |
| ---: | --- |
| 0 | `focus_path_exact` |
| 10 | `path_term_match` |
| 12 | `exported_symbol_match` |
| 15 | `declared_identifier_match` |
| 20 | `module_entrypoint` |
| 30 | `same_module_role` |
| 40 | `imports_from_focus` |
| 50 | `imports_focus` |
| 60 | `test_path_term_match` |
| 70 | `direct_test_importer` |
| 80 | `same_module_test` |

同じfileが複数reasonを持つ場合は最小priorityを採用し、全reason codesをunique sortする。fileの最終sortはpriority、pathで直接一致したfocus term数の降順、全reasonで一致したfocus term数の降順、pathの順とする。testはpriority、test pathで一致したfocus term数の降順、pathの順とし、広いseed集合でも対象機能名を持つtestを先に返す。camelCase、複数形、separator差はdeterministicなtoken normalizationで吸収する。Code Structureの`identifiers`は宣言名とidentifier形式のproperty名だけを最大256件保持し、source本文、literal value、string-literal property名を保持しない。LLMやembeddingでrerankしない。

### Degraded reasons

最低限次を区別する。

- `generation_stale`
- `generation_degraded`
- `focus_path_unmatched`
- `focus_module_unmatched`
- `focus_terms_unmatched`
- `code_structure_partial`
- `unresolved_relative_imports`
- `related_tests_missing`
- `verification_candidates_missing`
- `response_budget_truncated`

## Response Budget Algorithm

default limits:

```ts
{
  files: 12,
  tests: 6,
  verificationCommands: 4
}
```

hard serialized JSON budgetは12 KiB、target budgetは8 KiBとする。

1. rank順でdefault limitを適用する。
2. responseをschema parseしてserializationする。
3. target budget超過時、verification、test、fileの各末尾からrankの低いitemを一件ずつ除外する。
4. required provenance / focus resolution / degraded reasonは残す。
5. `truncation`を更新し、serialized UTF-8 bytesをserver内部で再計測する。
6. hard capを超える場合はsuccess payloadを壊して切らず、structured `catalog_unavailable` failureにする。

source body、snippet、raw metadataを削ってbudgetを合わせる処理は不要である。最初からschemaに含めない。

payload自身にbyte countは含めない。NightWorkers telemetryはMCP clientが受け取った最終text contentのUTF-8 bytesを計測し、self-referentialなsize fieldを作らない。

## NightWorkers Consumer Proof

### Existing seams to reuse

- `api/services/mcp/mcp-config-schema.ts`
- `api/services/mcp/mcp-effective-settings.ts`
- `api/services/mcp/mcp-client-manager.ts`
- `api/services/worker-tools/mcp-call-tool.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run-preparation.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-run-route-preparation.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/llm-usage/*`

新しいMCP clientやvulnWorkbench専用transportを追加しない。

### Pilot configuration

NightWorkers project settingsへ、既存Ontology enablementから分離したpilot flagを追加する。新規schemaは`shared/schemas/project-exploration-catalog.schema.ts`に置き、strictな`projectSecurityIntelligenceSettingsSchema`にfieldを追加しない。

```ts
type ProjectExplorationCatalogPilotSettings = {
  enabled: boolean;
  mcpServerId: string | null;
};
```

repository `featureSettings`の保存shapeは次で固定する。

```json
{
  "projectExplorationCatalog": {
    "enabled": false,
    "mcpServerId": null
  }
}
```

first phaseでUI / routeは追加しない。fixture / pilot setupは`nightworkersRepo.updateRepositoryFeatureSettings`を呼ぶserviceを介して行う。missing / invalid settingsは`{ enabled: false, mcpServerId: null }`へfail closedする。

`rootRef`はNightWorkersのregistered repository path `repoInfo.localPath`のrealpathからPhase 40と同じSHA-256 contractでserver-side計算し、設定値やUI入力として保存しない。task worktreeの`executionRoot`はpathが異なるためrootRef計算に使わない。選択結果のrun snapshotには、監査用identityとして`rootRef`を保存してよい。

### Generation selection

supervisorはrun開始前に次を行う。

1. configured MCP serverで`vuln_list_knowledge_sources({ rootRef })`を呼ぶ。
2. candidateが同じ`rootRef`に属することを再検証する。raw project identityを別経路で推測しない。
3. `available`だけを候補とし、`generationGeneratedAt`降順・`generationId`昇順で一つを選ぶ。`stale` / `degraded`はpilotでは採用しない。
4. selected manifestをexact readし、project / scan / generation / hashesを再検証する。
5. `scanRunId` / `generationId` / hashes / `rootRef`をruntime snapshotへ保存する。
6. stale-only / degraded-only / identity mismatch / missingの場合は採用せずfallback snapshot reasonを残す。新規run eventは追加しない。

workerへlatest選択を委ねない。workerはpinned IDsでcatalog toolだけを呼ぶ。

### Runtime instruction

native/API implementation laneだけで、`contextSnapshot.projectExplorationCatalog.available === true`の場合に次のinstruction cardをworking contextへ追加する。

```text
Project exploration catalog is available for this run at the pinned generation.
When the implementation scope is not already explicit, call the catalog once
before broad directory/search exploration. Treat returned paths as clues, read
the target source before editing, and do not repeat project-wide searches for
facts already supplied by the catalog.
```

次の場合はskipを明示する。

- Task / Todoに編集fileが明示されている。
- trivial single-file task。
- source selection failed。
- generation is stale / missing / failed。

native/APIでは専用model toolを作らず、instructionに次のexact call shapeを出す。

```json
{
  "serverId": "<pinned mcpServerId>",
  "toolName": "vuln_get_project_exploration_catalog",
  "arguments": {
    "scanRunId": "<pinned scanRunId>",
    "generationId": "<pinned generationId>",
    "focus": {
      "paths": ["<known project-relative path, if any>"],
      "moduleIds": ["<known module id, if any>"],
      "terms": ["<task nouns>"]
    }
  }
}
```

少なくとも1 focus fieldを入れること、Taskから作れないmodule IDを捏造しないことをinstructionに書く。

### No automatic source injection

catalog payloadをsystem promptへ常時埋め込まない。agentが必要と判断した場合だけMCP callする。未使用runではMCP response tokenを消費しない。

## Telemetry Contract

### Exploration window

run startから最初のsuccessful source mutationまでを`exploration window`と定義する。first phaseはnative/API implementation laneのみ集計する。

最初のmutation候補:

- native/API `apply_patch` / `replace_content` success

### Recorded fields

```ts
type ExplorationReductionMeasurement = {
  runId: string;
  taskId: string;
  repositoryId: string;
  mode: "baseline" | "catalog";
  generationId: string | null;
  catalogCalled: boolean;
  catalogCallCount: number;
  catalogResponseBytes: number;
  catalogFileCount: number;
  catalogTestCount: number;
  catalogVerificationCount: number;
  listDirCallsBeforeMutation: number;
  searchCallsBeforeMutation: number;
  readFileCallsBeforeMutation: number;
  uniqueFilesReadBeforeMutation: number;
  totalInputTokens: number | null;
  totalCachedInputTokens: number | null;
  usageMode: "measured" | "estimated" | "mixed" | "unavailable";
  timeToFirstMutationMs: number | null;
  taskCompleted: boolean;
  verificationPassed: boolean | null;
  replanCount: number;
  warnings: string[];
};
```

existing event / usage dataから全fieldをread-only導出し、DB / run eventへ新しいmeasurement payloadをpersistしない。tokenはexisting task/run usage recordの全run合計であり、pre-mutation tokenとして扱わない。

`listDirCallsBeforeMutation`は`list_dir`、`searchCallsBeforeMutation`は`search_files`、`readFileCallsBeforeMutation`は`read_file`のsuccessful completionを数える。native/API laneに一般CLI探索toolはないため、実在しないcommand-search指標を追加しない。`uniqueFilesReadBeforeMutation`は`read_file` successのproject-relative pathのunique countとする。

go/no-goの`exploratory tool calls`はbaselineで`list_dir + search_files + read_file`、treatmentでそれらにsuccessful catalog callを加えた値とする。catalog call自体の1回を除外して効果を過大評価しない。

MCP arguments / output全体をtelemetryへ複製しない。generation ID、counts、bytes、reason codesだけを保存する。

## Evaluation Design

### Offline recall evaluation

少なくとも10件のhistorical completed tasksを、2 repository以上から選ぶ。

各Taskについて:

1. Task開始commitに対応するgenerationを作る。
2. Task title / known module / known starting pathからfocusを作る。
3. catalogを生成する。
4. actual git diff file setと比較する。
5. actual diffとの比較はdiagnosticとして、snapshot coverage、top-5 / top-10 hit count、recall@5 / recall@10、precision@10、test hitを記録する。`recall@k`は変更file総数に対する上位k件の包含率であり、catalogのproduction合否やscan coverageの代用にしない。
6. Taskごとに`maxPossibleRecallAt10 = min(10, actualChangedFileCount) / actualChangedFileCount`を記録し、変更file数が異なるTaskのraw recallを根拠なく同列評価しない。

actual diffがgenerated artifact、lockfileだけのTaskは別categoryにし、source-change recallへ混ぜない。

### Paired runtime pilot

少なくとも5件のrepresentative Taskを同じrevision、prompt、model/provider、runtime laneで実行する。

- baseline: catalog disabled
- treatment: catalog enabled

provider nondeterminismが大きい場合は結果を断定せず、tool/read/token差とquality outcomeを併記する。同じTaskで危険な外部mutationを再実行しない。fixtureまたはdisposable worktreeを使う。

### Go / no-go gate

全て満たした場合だけ次phaseへ進む。

- response hard cap違反0件
- raw source / secret / absolute path leak 0件
- persisted generationを使うmachine-readable CLI smokeが、期待する既存integration seam（route、shared schema、HTTP client、related test）を返す
- MCP stdio serverを外部SDK clientから`tools/list` / `tools/call`でき、CLIと同じcatalog contractを返す
- ambiguous-scope treatmentの有効pairのうち80%以上でcatalog callが1回成功
- median exploratory tool calls before mutation >= 20% reduction
- median total input tokens per run >= 15% reduction
- completion rateがbaselineより悪化しない
- verification successがbaselineより悪化しない
- catalog使用後に同等のproject-wide searchを重複するrunが少数例外に留まる

gate未達でもtool correctness testsが通れば実装を壊して戻す必要はない。ただしpilot flagをdefault offに保ち、AST/LSP/Graph expansionへ進まない。

`recall@10 >= 70%`のような固定閾値は置かない。catalogは全変更fileの予測器ではなく探索開始地点の提示toolであり、実変更fileが15件以上のTaskではtop-10 recall 70%が数学的に達成不能になる。offline diff recallは同一fixture上のranking回帰診断に限定し、rollout判断は直接smoke、探索tool call削減、input token削減、completion / verification非劣化で行う。

## Exact Change Inventory

### vulnWorkbench

| Slice | Path | Symbol / change |
| --- | --- | --- |
| 1 | `shared/schemas/static-intelligence-exploration-catalog.schema.ts` | new strict input/result/clue schemas and inferred types |
| 1, 4 | `api/modules/static-intelligence/mcp-tool-schemas.ts` | re-export new input; add `rootRef` input/result fields |
| 2 | `api/modules/static-intelligence/exploration-catalog.ts` | pure `buildProjectExplorationCatalog` and private normalization/ranking/budget helpers |
| 2 | `api/modules/static-intelligence/exploration-catalog.test.ts` | pure builder fixture and assertions |
| 3 | `api/modules/static-intelligence/generation-repository.ts` | public `listLatestValidGenerationsByRootRef` |
| 3 | `api/modules/static-intelligence/generation-repository.test.ts` | filter-before-limit and invalid metadata coverage |
| 4 | `api/modules/static-intelligence/mcp-tools.ts` | discovery branch, readiness summary, handler, registry entry |
| 4 | `api/modules/static-intelligence/mcp-tools.test.ts` | discovery/handler/read-only tests |
| 4 | `api/cli/static-intelligence-mcp-server.ts` | add one expected tool name; smoke remains registry-driven |
| 4 | `api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts` | list/smoke count assertion |
| 5 | `scripts/evaluate-exploration-catalog.ts` | read-only JSON evaluator |
| 5 | `tests/fixtures/scans/exploration-catalog-evaluation.json` | minimum 2-case deterministic smoke fixture |

`package.json`は変更しない。evaluatorは`bun run scripts/evaluate-exploration-catalog.ts`で実行する。

### NightWorkers

| Slice | Path | Symbol / change |
| --- | --- | --- |
| 6 | `shared/schemas/project-exploration-catalog.schema.ts` | pilot settings, discovery response, manifest response, run pin schemas |
| 6 | `api/modules/ontology/exploration/project-exploration-settings.service.ts` | `getProjectExplorationCatalogSettings`, `saveProjectExplorationCatalogSettings` |
| 6 | `tests/project-exploration-settings.service.test.ts` | default, parse, sibling-key preservation |
| 7 | `api/modules/ontology/exploration/project-exploration-source.service.ts` | rootRef, MCP envelope parser, deterministic source selection/pin |
| 7 | `tests/project-exploration-source.service.test.ts` | mocked MCP manager success/fallback matrix |
| 8 | `api/modules/nightworkers/run-orchestration/start-task-run-preparation.ts` | load pilot settings with existing preparation data |
| 8 | `api/modules/nightworkers/run-orchestration/start-task-run.ts` | resolve pin before `createTaskRun`; copy pin into both context snapshots |
| 8 | `tests/project-exploration-run-pinning.test.ts` | native-only pin and fail-open integration |
| 9 | `api/services/agent-runtime/native-api-runner/native-api-tool-manifest.ts` | add `projectExplorationCatalogEnabled?` profile input only |
| 9 | `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts` | expose generic MCP tools when ontology OR catalog is enabled |
| 9 | `api/services/agent-runtime/native-api-runner/native-api-run-route-preparation.ts` | pass catalog-enabled snapshot boolean |
| 9 | `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts` | parse pin and render conditional catalog guidance |
| 9 | `tests/project-exploration-native-api-runtime.test.ts` | tool visibility and prompt assertions |
| 10 | `api/services/llm-usage/repository.ts` | add read-only `listLlmUsageRecordsForRun(runId)` |
| 10 | `api/modules/ontology/exploration/project-exploration-measurement.ts` | pure event/usage aggregation and paired summary |
| 10 | `scripts/evaluate-project-exploration-catalog.ts` | print machine-readable run/pair JSON |
| 10 | `tests/project-exploration-measurement.test.ts` | event boundary and token aggregation fixtures |

`ontology-settings.service.ts`、`ontology-runtime-context.ts`、`codex-runtime-audit.ts`、Codex SDK files、DB schema / migrationは変更しない。

## Implementation Slices

### Slice 0: Baseline and Preconditions

Goal: 開始状態とdependencyを確定し、実装中の回帰と既存変更の混入を防ぐ。

Do not edit files in this slice.

Commands in vulnWorkbench:

```bash
git status --short
rg -n "loadGeneration|loadLatestValidGeneration" api/modules/static-intelligence/generation-repository.ts
rg -n "staticIntelligenceMcpToolRegistry|vuln_list_knowledge_sources" api/modules/static-intelligence/mcp-tools.ts
bun test api/modules/static-intelligence/generation-repository.test.ts
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun test api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
```

Commands in NightWorkers:

```bash
git status --short
rg -n "updateRepositoryFeatureSettings|featureSettings" api/modules/nightworkers/nightworkers.repository.ts api/modules/ontology/ontology-settings.service.ts
rg -n "mcp_call_tool|ontologyMcpEnabled" api/services/agent-runtime/native-api-runner
bun test tests/services.native-api-runner.test.ts
bun test tests/services.native-api-runner-import-project.test.ts
```

Record, but do not mutate, current generation counts:

```bash
sqlite3 -readonly data/vuln-workbench.sqlite \
  "select kind, count(*) from scan_artifacts where kind in ('code_structure_snapshot','static_intelligence_export') group by kind order by kind;"
```

Pass condition:

- named symbols exist;
- focused baseline tests pass;
- both worktree statuses are recorded verbatim.

Stop condition:

- Phase 40 exact-generation read is absent;
- generic NightWorkers MCP call path is absent;
- a baseline focused test fails for a reason unrelated to the two untracked Phase 42 docs.

### Slice 1: Add the Producer Schemas

Pre-read:

- `shared/schemas/static-intelligence-code-structure.schema.ts`
- `shared/schemas/static-intelligence-export.schema.ts`
- `api/modules/static-intelligence/mcp-tool-schemas.ts`
- schema assertions in `api/modules/static-intelligence/mcp-tools.test.ts`

Change only:

- add `shared/schemas/static-intelligence-exploration-catalog.schema.ts`
- update `api/modules/static-intelligence/mcp-tool-schemas.ts`
- update schema-only cases in `api/modules/static-intelligence/mcp-tools.test.ts`

Implementation:

1. Define the exact input, file/test/verification clue, focus resolution, truncation, success, and failure schemas shown in this plan.
2. Export inferred TypeScript types for builder and handler use.
3. Implement project-relative path validation in one schema-local helper. Reject empty, absolute POSIX, Windows drive prefix, backslash, NUL, and any segment equal to `..`.
4. Keep all objects `.strict()` and all bounded arrays at the maxima in the MCP contract.
5. Do not import DB or API modules from `shared/`.
6. Extend `staticIntelligenceMcpToolFailureSchema` with optional `reasonCode` using the five codes in this plan. Existing failures may omit it; the new catalog handler must set it. Add the catalog success/failure types to `StaticIntelligenceMcpToolResult` in Slice 4.

Required tests:

- accepts one valid path, module, or term focus;
- rejects empty focus;
- rejects `/tmp/x`, `C:\\x`, `../x`, `a/../x`, backslash, and NUL;
- rejects 21 files, 11 tests, 7 verification commands, and unknown fields;
- confirms success schema has no `content`, `body`, `snippet`, `rootPath`, or `repoPath` property.

Proof:

```bash
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun run typecheck
```

Handoff check: no runtime handler or builder behavior exists yet; only schemas and tests changed.

### Slice 2: Implement the Pure Catalog Builder

Pre-read:

- `api/modules/static-intelligence/generation-types.ts`
- `api/modules/static-intelligence/module-candidates.ts`
- `shared/schemas/static-intelligence-code-structure.schema.ts`
- the export payload field containing `handoff.verificationCommands`

Change only:

- add `api/modules/static-intelligence/exploration-catalog.ts`
- add `api/modules/static-intelligence/exploration-catalog.test.ts`

Public function:

```ts
export function buildProjectExplorationCatalog(input: {
  generation: ProjectExplorationGenerationView;
  readiness: "available" | "stale" | "degraded";
  focus: ProjectExplorationCatalogInput["focus"];
  limits?: ProjectExplorationCatalogInput["limits"];
  generatedAt: string;
}): ProjectExplorationCatalogResult | ProjectExplorationCatalogFailure;
```

Private helper order:

1. `normalizeFocus`
2. `resolveFocusSeeds`
3. `collectFileCandidates`
4. `collectTestCandidates`
5. `collectVerificationCandidates`
6. `sortAndRankCandidates`
7. `buildCatalogResult`
8. `fitCatalogResponseBudget`

Implementation rules:

- build lookup maps once for files, edges, modules, and incoming imports;
- call `buildStaticIntelligenceModuleCandidates` exactly once and reuse its returned array;
- accept only `ProjectExplorationGenerationView`; do not make pure tests or evaluator fixtures construct DB artifact rows;
- never read filesystem, DB, environment, time, random, network, or MCP;
- use `input.generatedAt`; do not call `new Date()` inside the builder;
- merge duplicate candidate reasons and source refs with `Set`, then sort strings;
- implementation files and tests must not appear in both arrays; `test`-tagged paths go to `relatedTests`;
- rank is assigned only after final deterministic sort;
- count omitted items from the pre-budget candidate arrays, not from default maxima;
- compute bytes with `Buffer.byteLength(JSON.stringify(result), "utf8")`;
- trim in the fixed order verification tail, test tail, file tail until target is met;
- if required provenance alone crosses 12 KiB, return the structured `catalog_unavailable` failure through a typed result union; never slice JSON text.

Use one synthetic generation fixture in the test file with:

- 8 source files across 2 modules;
- 3 test files;
- outgoing and incoming `imports` edges;
- one `depends_on_package` edge that must be ignored;
- exported symbols;
- 5 verification commands;
- a fixed `generatedAt`.

Required tests are exactly the candidate collection, ranking, degraded, budget, and redaction cases listed in `Test Strategy` below. Add one permutation test that reverses every input array and expects deep equality.

Proof:

```bash
bun test api/modules/static-intelligence/exploration-catalog.test.ts
bun run typecheck
```

Stop if the persisted generation does not expose verification commands at the path specified in this plan. Report the actual path; do not invent a second source.

### Slice 3: Add rootRef Generation Discovery

Pre-read:

- `api/modules/static-intelligence/generation-repository.ts`
- `api/modules/static-intelligence/generation-repository.test.ts`
- `api/modules/static-intelligence/generation-types.ts`
- `api/db/schema.ts` definitions for `scanArtifacts` and `scanRuns`

Change only:

- update `api/modules/static-intelligence/generation-repository.ts`
- update `api/modules/static-intelligence/generation-repository.test.ts`

Implementation:

1. Add the exact public `listLatestValidGenerationsByRootRef` method specified under Source Discovery.
2. Reuse the same artifact-kind constants and metadata schema already used by `generationCandidates`; import Drizzle `sql` and apply parameter-bound `json_extract` predicates in the DB query.
3. Do not expose or duplicate the private `generationCandidates` implementation. Extract a private parsed-metadata helper only if both methods can call it without behavior change.
4. Apply exact `rootRef` and optional `projectId` in SQL before grouping and final `limit`.
5. Return only valid structure/export pairs reconstructed by `loadGeneration`.

Fixture setup in the existing DB-backed test:

- create more candidates than the requested limit;
- make the newest nonmatching candidates occupy the leading positions;
- add two matching generations with distinct `generatedAt` values;
- add one malformed metadata artifact and one incomplete pair.

Assertions:

- matching result survives `limit: 1` even when nonmatches are newer;
- optional projectId is ANDed;
- malformed/incomplete artifacts are ignored;
- sort is generatedAt desc then generationId asc;
- returned object equals `loadGeneration` for the same IDs.

Proof:

```bash
bun test api/modules/static-intelligence/generation-repository.test.ts
bun run typecheck
```

### Slice 4: Wire Discovery and the New MCP Tool

Pre-read:

- `api/modules/static-intelligence/mcp-tool-schemas.ts`
- all of `api/modules/static-intelligence/mcp-tools.ts`
- `api/cli/static-intelligence-mcp-server.ts`
- both matching test files

Change only the four files listed in the inventory for Slice 4.

Implementation sequence:

1. Extend source-list input with optional `rootRef`; add `rootRef`, `generationGeneratedAt`, and summary readiness to each result item.
2. Preserve the current projectId-only branch. When `rootRef` is present, call `listLatestValidGenerationsByRootRef`.
3. Add private `summarizeGenerationReadiness` with the exact rule from Source Discovery.
4. Add `handleGetProjectExplorationCatalog(args)` beside existing handlers:
   - schema-parse input;
   - call `loadGeneration(scanRunId, generationId)`;
   - return `generation_missing` when null;
   - verify returned scan/generation IDs before projection;
   - call the same existing readiness resolver used by current generation reads and reduce it with `summarizeGenerationReadiness`;
   - project the persisted generation to `ProjectExplorationGenerationView` and call `buildProjectExplorationCatalog` with the summary readiness and one captured timestamp;
   - wrap the parsed result in the existing MCP JSON text envelope.
5. Register exactly one read-only tool with the exact name and description.
6. Add the name to `EXPECTED_TOOL_NAMES`; do not hard-code a second count elsewhere.

Required handler tests:

- exact generation success and provenance;
- missing generation;
- mismatch guard;
- stale/degraded summary;
- rootRef exact/empty/AND/filter-before-limit;
- no raw root path or source body in serialized text;
- snapshot artifact row count and filesystem fixture mtime unchanged before/after call;
- existing six tools retain their names and responses;
- list-tools includes the seventh tool and smoke passes.

Proof:

```bash
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun test api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
bun run typecheck
```

Expected list-tools condition: output parses as JSON and contains `vuln_get_project_exploration_catalog` exactly once. Do not assert display order unless the existing test already treats order as contract.

### Slice 5: Add the Offline Recall Evaluator

Pre-read:

- existing CLI scripts that keep stdout machine-readable;
- `tests/fixtures/scans/` naming and JSON conventions;
- builder exports from Slice 2.

Change only:

- add `scripts/evaluate-exploration-catalog.ts`
- add `tests/fixtures/scans/exploration-catalog-evaluation.json`

CLI input:

```text
--fixture <absolute-or-cwd-relative-json-path>
```

Fixture case shape:

```ts
type EvaluationCase = {
  caseId: string;
  generation: ProjectExplorationGenerationView;
  readiness: "available" | "stale" | "degraded";
  focus: ProjectExplorationCatalogInput["focus"];
  actualChangedFiles: string[];
  actualChangedTests: string[];
};
```

Output shape:

```ts
{
  ok: true;
  caseCount: number;
  cases: Array<{
    caseId: string;
    actualChangedFileCount: number;
    snapshotCoverage: number | null;
    top5HitCount: number;
    top10HitCount: number;
    recallAt5: number | null;
    recallAt10: number | null;
    maxPossibleRecallAt10: number | null;
    precisionAt10: number | null;
    testHit: boolean;
    generationId: string;
  }>;
  aggregate: {
    meanSnapshotCoverage: number | null;
    meanRecallAt5: number | null;
    meanRecallAt10: number | null;
    meanPrecisionAt10: number | null;
    testHitRate: number | null;
  };
}
```

Implementation rules:

- normalize actual file sets only by slash and duplicate removal; never infer missing files;
- denominator zero produces `null`, not `1`, and aggregate excludes null values;
- stdout contains exactly one JSON document plus trailing newline;
- diagnostics and stack traces go to stderr;
- invalid fixture exits nonzero with `{ ok:false, reasonCode, message }` on stdout;
- do not add a package script and do not mutate target repositories.

Proof:

```bash
bun run scripts/evaluate-exploration-catalog.ts -- --fixture tests/fixtures/scans/exploration-catalog-evaluation.json > /tmp/phase42-eval-1.json
bun run scripts/evaluate-exploration-catalog.ts -- --fixture tests/fixtures/scans/exploration-catalog-evaluation.json > /tmp/phase42-eval-2.json
cmp /tmp/phase42-eval-1.json /tmp/phase42-eval-2.json
```

### Slice 6: Add NightWorkers Pilot Settings

Switch cwd to NightWorkers. Do not edit vulnWorkbench in Slices 6-10.

Pre-read:

- `shared/schemas/ontology.schema.ts`
- `api/modules/ontology/ontology-settings.service.ts`
- `api/modules/nightworkers/nightworkers.repository.ts` functions `getRepository` and `updateRepositoryFeatureSettings`
- service test conventions under `tests/`

Change only the three Slice 6 files in the inventory.

Schemas:

```ts
projectExplorationCatalogPilotSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  mcpServerId: z.string().trim().min(1).nullable().default(null),
}).strict();

projectExplorationCatalogRunPinSchema = z.discriminatedUnion("available", [
  z.object({
    version: z.literal(1), available: z.literal(true), serverId: z.string(),
    rootRef: z.string().regex(/^[a-f0-9]{64}$/),
    projectId: z.string().min(1), scanRunId: z.string().min(1),
    generationId: z.string().uuid(), snapshotRef: z.string().min(1),
    sourceTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevisionHead: z.string().min(1),
    toolName: z.literal("vuln_get_project_exploration_catalog"),
  }).strict(),
  z.object({
    version: z.literal(1), available: z.literal(false),
    reason: z.enum(["disabled", "wrong_runtime_lane", "server_missing", "tool_missing", "source_missing", "source_unusable", "revision_mismatch", "manifest_invalid", "mcp_failed"]),
  }).strict(),
]);
```

Producer responseはNightWorkersで全schemaを複製せず、selectionに必要な次のsubsetだけをlocal schemaでparseする。producerのadditive fieldでconsumerが壊れないよう、responseとnested itemは`.passthrough()`とする。

```ts
projectExplorationKnowledgeSourceListSchema = z.object({
  ok: z.literal(true),
  status: z.literal("completed"),
  sources: z.array(z.object({
    projectId: z.string().min(1),
    rootRef: z.string().regex(/^[a-f0-9]{64}$/),
    scanRunId: z.string().min(1),
    generationId: z.string().uuid(),
    generationGeneratedAt: z.string(),
    sourceRevision: z.object({
      kind: z.enum(["git", "tree_hash_only"]),
      head: z.string().min(1).optional(),
      dirtyHash: z.string().optional(),
      value: z.string().min(1),
    }).strict(),
    readiness: z.enum(["available", "stale", "degraded"]),
  }).passthrough()),
}).passthrough();

projectExplorationManifestSchema = z.object({
  ok: z.literal(true),
  status: z.literal("completed"),
  manifest: z.object({
    project: z.object({ id: z.string().min(1) }).passthrough(),
    scan: z.object({ id: z.string().min(1) }).passthrough(),
    generation: z.object({
      generationId: z.string().uuid(),
      snapshotRef: z.string().min(1),
      sourceTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
      sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
      status: z.enum(["available", "degraded", "stale"]),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

projectExplorationCatalogResultSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["completed", "degraded"]),
  generation: z.object({
    scanRunId: z.string().min(1),
    generationId: z.string().uuid(),
  }).passthrough(),
  likelyFiles: z.array(z.object({ path: z.string().min(1) }).passthrough()),
  relatedTests: z.array(z.object({ path: z.string().min(1) }).passthrough()),
  verificationCandidates: z.array(z.object({
    command: z.string().min(1),
    candidateOnly: z.literal(true),
  }).passthrough()),
}).passthrough();
```

Service behavior:

- `getProjectExplorationCatalogSettings(repositoryId)` reads only the sibling `featureSettings.projectExplorationCatalog` key;
- invalid/missing data returns defaults and does not throw;
- `saveProjectExplorationCatalogSettings` merges that sibling key while preserving all other feature settings;
- enabled with null serverId is allowed to save but resolves unavailable at run start.

Proof:

```bash
bun test tests/project-exploration-settings.service.test.ts
bun run typecheck
```

### Slice 7: Implement NightWorkers Source Selection

Pre-read:

- `api/services/mcp/mcp-client-manager.ts`
- `api/services/worker-tools/mcp-call-tool.ts`
- effective MCP settings schema to confirm `serverId` semantics;
- the shared schemas from Slice 6.

Change only:

- add `api/modules/ontology/exploration/project-exploration-source.service.ts`
- add `tests/project-exploration-source.service.test.ts`

Public function:

```ts
export async function resolveProjectExplorationCatalogPin(input: {
  registeredRepoRoot: string;
  expectedHead: string | null;
  preExistingDirtyPaths: string[];
  settings: ProjectExplorationCatalogPilotSettings;
  runtimeLane: string;
  mcpAccess?: ProjectExplorationMcpAccess;
}): Promise<ProjectExplorationCatalogRunPin>;

type ProjectExplorationMcpAccess = {
  resolveServer(serverId: string): McpServerConfig | undefined;
  listTools(server: McpServerConfig): Promise<McpToolSummary[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
};
```

default `mcpAccess`は`resolveServer: getEffectiveMcpServer`、`listTools: (server) => mcpClientManager.listToolsForServer(server)`、`callTool: (...) => mcpClientManager.callTool(...)`の薄いobjectとする。これはtest double注入用であり、client / transportを新設しない。

Exact algorithm:

1. disabled -> `disabled`; non-native lane -> `wrong_runtime_lane`; null server -> `server_missing`; `expectedHead === null` or dirty baseline -> `revision_mismatch`. These guards make zero MCP calls.
2. `realpath(registeredRepoRoot)`, then lowercase hex SHA-256 of the canonical absolute path. The hash is the only path-derived value sent to MCP. Do not accept or hash task worktree `executionRoot`.
3. `resolveServer(serverId)`; missing/disabled server -> `server_missing`. Resolved configを`listTools(server)`へ渡し、`vuln_list_knowledge_sources`、`vuln_get_knowledge_source_manifest`、`vuln_get_project_exploration_catalog`の3 tool nameをrequireする。一つでも欠ければ`tool_missing`。
4. call discovery with `{ rootRef, limit: 20 }`.
5. Parse MCP `content` by accepting only text blocks, concatenating their text with newline, `JSON.parse`, then local Zod parse. Transport/error content returns `mcp_failed`.
6. Recheck every candidate rootRef and discard non-`available`. Pilotでは`sourceRevision.kind === "git"`、`sourceRevision.head === expectedHead`、`sourceRevision.dirtyHash === undefined`のclean Git generationだけを採用する。
7. Remaining candidatesをgeneratedAt desc then generationId ascでsortし、firstをselectする。Empty -> `source_missing`、readinessだけ不適合なら`source_unusable`、revision不一致なら`revision_mismatch`。
8. Call `vuln_get_knowledge_source_manifest` with `{ scanRunId: selected.scanRunId, generationId: selected.generationId }`.
9. Require manifest project.id, scan.id, generationId to agree with selection and manifest generation status to be `available`. Mismatch -> `manifest_invalid`.
10. Copy snapshotRef, sourceTreeHash, and sourceStateHash from the validated manifest and `sourceRevision.head` from discovery into the pin. Manifest hashes are not present in discovery summary and therefore are not compared to it.
11. Return the available pin. Never cache it globally and never choose again during the run.

Mocked tests must cover every unavailable reason, realpath hashing via a temp directory, clean matching Git head, dirty baseline early fallback, head mismatch, `tree_hash_only` rejection, multiple-candidate tie-break, nonmatching rootRef rejection, malformed JSON, MCP rejection, and manifest mismatch.

Proof:

```bash
bun test tests/project-exploration-source.service.test.ts
bun run typecheck
```

Do not edit `mcp-client-manager.ts`; its existing public methods and `getEffectiveMcpServer` are sufficient. Stop if their signatures differ from this slice and report those signatures.

### Slice 8: Pin the Generation at NightWorkers Run Start

Pre-read:

- all of `start-task-run-preparation.ts`;
- `start-task-run.ts` from function start through `createTaskRun`, and its later `contextSnapshot` construction;
- tests that mock `prepareTaskRunStart` or `createTaskRun`.

Change only the three Slice 8 files in the inventory.

Implementation:

1. In `prepareTaskRunStart`, add `getProjectExplorationCatalogSettings(repoInfo.id)` to the existing `Promise.all`; return it as `projectExplorationCatalogSettings`.
2. In `startTaskRunInProcess`, destructure that value.
3. Keep the existing `const gitBaseline = await readGitBaseline(executionRoot)` position before `createTaskRun`. Immediately after it, call `resolveProjectExplorationCatalogPin` with `registeredRepoRoot: repoInfo.localPath`, `expectedHead: gitBaseline.baselineHead`, `preExistingDirtyPaths: gitBaseline.preExistingDirtyPaths`, settings, and lane. The resolver must never throw; still wrap it in a last-resort catch that maps to `{available:false, reason:"mcp_failed"}`.
4. Add `projectExplorationCatalog: pin` to the initial `createTaskRun.contextSnapshot` and to the later `RuntimePromptSnapshot` object. Do not add it to runtimeOptions.
5. Do not create a new event. Existing persisted context snapshot is the audit source.
6. Planning/test/review/general-answer and Codex SDK runs receive `wrong_runtime_lane` without MCP calls.

Assertions:

- available native run persists identical immutable IDs in both snapshots;
- disabled/wrong-lane run makes zero MCP calls;
- missing HEAD or nonempty `preExistingDirtyPaths` produces `revision_mismatch` and zero MCP calls;
- source revision head different from `gitBaseline.baselineHead` produces `revision_mismatch`;
- MCP failure still reaches `createTaskRun` with unavailable pin;
- exact generation does not change when mocked discovery later returns another source;
- neither raw registered path nor executionRoot appears inside the pin.

Proof:

```bash
bun test tests/project-exploration-run-pinning.test.ts
bun run typecheck
```

### Slice 9: Expose Generic MCP Tools and Guidance in Native/API

Pre-read:

- `native-api-tool-manifest.ts` profile type and MCP registrations;
- `native-api-tool-registry.ts` function `modelVisibleNativeApiToolNames`;
- `native-api-run-route-preparation.ts` tool-profile call;
- `native-api-tool-history.ts` functions `buildNativeApiSystemPrompt`, `buildOntologyGuidance`, and `readOntologyMcpEnabled`.

Change only the five Slice 9 files in the inventory.

Implementation:

1. Add optional `projectExplorationCatalogEnabled` to `NativeApiToolProfileInput` and the private visibility input.
2. Expose `list_mcp_tools` and `mcp_call_tool` when `ontologyMcpEnabled || projectExplorationCatalogEnabled` in implementation mode. Do not change other modes.
3. Export `readProjectExplorationCatalogPin(context)` from `native-api-tool-history.ts`. It schema-parses `context.contextSnapshot.projectExplorationCatalog`; invalid data returns null.
4. In route preparation pass `projectExplorationCatalogEnabled: pin?.available === true`.
5. Add `buildProjectExplorationCatalogGuidance(context)` beside ontology guidance and include it once in `buildNativeApiSystemPrompt`.
6. Guidance contains serverId, exact tool name, scanRunId, generationId, focus rules, one-call rule, clue/read-before-edit rule, and skip rule. It does not contain a catalog result, raw path, hashes, or manifest.

Required assertions:

- catalog available + ontology off exposes both generic MCP tools;
- both off hides them;
- catalog unavailable hides guidance;
- non-implementation mode does not gain MCP tools;
- guidance contains exact pinned IDs and tool name once;
- guidance says explicit-file/trivial work may skip;
- guidance says read returned source before edit;
- no new tool registration/name was introduced.

Proof:

```bash
bun test tests/project-exploration-native-api-runtime.test.ts
bun test tests/services.native-api-runner-import-project.test.ts
bun test tests/services.native-api-runner.test.ts
bun run typecheck
```

### Slice 10: Add Read-Only Measurement and Report CLI

Pre-read:

- `api/modules/nightworkers/nightworkers.runs-event.repository.ts` event read shape;
- `api/services/llm-usage/repository.ts` record fields;
- native tool-call event payloads in existing native runner tests;
- script conventions for DB-backed read-only reports.

Change only the four Slice 10 files in the inventory.

Repository addition:

```ts
export async function listLlmUsageRecordsForRun(runId: string) {
  return db.select().from(llmUsageRecords)
    .where(eq(llmUsageRecords.runId, runId))
    .orderBy(llmUsageRecords.createdAt);
}
```

Measurement API:

```ts
export function measureProjectExplorationRun(input: {
  run: { id: string; taskId: string; repositoryId: string; startedAt: Date; status: string; contextSnapshot: unknown };
  events: TaskEvent[];
  usageRecords: LlmUsageRecord[];
}): ExplorationReductionMeasurement;
```

Implementation:

1. Sort events by seq and stop exploration counts immediately before the first successful `apply_patch` or `replace_content` tool completion.
2. Count only successful tool completions. Failed calls do not increase `catalogCallCount`, file reads, or mutation boundary. Set `catalogCalled = catalogCallCount > 0`.
3. Detect catalog calls when event payload `toolName === "mcp_call_tool"`, `arguments.toolName === "vuln_get_project_exploration_catalog"`, and `ok === true`. The current dispatcher persists these fields; do not add a second projection.
4. Read MCP content from `payload.result.result.content` in the existing `McpCallToolPayload` envelope. `catalogResponseBytes` is the sum of UTF-8 bytes across all successful catalog responses, so repeated-call cost is visible. File/test/verification counts come from the first successful response only. Never add persistence. Parse JSON through the local consumer schema; malformed result still increments call count, leaves item counts zero, and adds `catalog_result_invalid` to measurement warnings.
5. Sum run-scoped usage records. If no records exist, token fields are null; otherwise preserve measured/estimated mode in an additional `usageMode` field.
6. `timeToFirstMutationMs` is mutation timestamp minus run start; null without mutation.
7. `taskCompleted` is `run.status === "completed"`. `verificationPassed` uses the last `run_verification` or `completion_check` tool completion: `ok === true` -> true, `ok === false` -> false, and no such event -> null.
8. `replanCount` counts successful `todo_list` completions whose `arguments.operation === "replace"`; run-start Todo creation is not counted.
9. Paired summary accepts explicit baseline/treatment run IDs; it never pairs by title automatically.

CLI:

```text
bun run scripts/evaluate-project-exploration-catalog.ts -- --baseline-run-id <id> --catalog-run-id <id>
```

It loads the two runs, their events, and run-scoped usage; prints one JSON document; exits nonzero for missing IDs, same IDs, different repository IDs, or different runtime lanes.

Proof:

```bash
bun test tests/project-exploration-measurement.test.ts
bun run scripts/evaluate-project-exploration-catalog.ts -- --help
bun run typecheck
```

### Slice 11: Prepare Evaluation Generations

This slice mutates only vulnWorkbench's local scan artifacts through the existing explicit build CLI. It does not edit code.

1. Select at least 10 historical completed source-changing tasks across at least 2 repositories.
2. Record caseId, repository revision, task text source, actual changed files/tests, scanRunId, and why the case is representative in a temporary working record.
3. For each selected start revision, create or identify the scan run using existing documented workflow.
4. Explicitly run `bun run intelligence:build -- --scan-run-id <id>` outside MCP.
5. Query persisted structure/export artifacts and record exact generationId and hashes.
6. Convert the cases into an evaluator fixture or approved evidence JSON; do not fabricate missing historical facts.

Pass condition: all 10 cases have a valid same-generation structure/export pair. Otherwise stop before runtime pilot and report the missing cases.

### Slice 12: Run the Controlled Consumer Proof

Precondition: Slices 0-11 pass and both repos are clean except known Phase 42 changes/evidence.

For each of at least 5 safe representative tasks:

1. Create two disposable worktrees at the same revision.
2. Use the same task prompt, native/API model/provider/route, timeout, safety policy, and verification policy.
3. Baseline repository feature setting: catalog disabled.
4. Treatment repository feature setting: catalog enabled with the fixed MCP serverId.
5. Run baseline and treatment. Alternate run order across cases.
6. Record both run IDs, pinned generation, terminal state, verification outcome, and any environmental difference.
7. Run the measurement CLI with explicit IDs and save its JSON output.
8. Never reuse a worktree after mutation and never rerun unsafe external side effects.

Valid pairは、同一revision / prompt / routeを確認でき、baselineはpin disabled、treatmentはavailable pinを保持し、両runともusage recordとterminal outcomeがあるpairとする。treatmentのcatalog callが0回のpairは「activation failure」として残し、token削減medianに入れるがcatalog成功数には入れない。不利なrunを除外して効果を過大評価しない。

Create one Markdown decision record under `spec/evidence/phase-42-project-scan-exploration-catalog-pilot.md` containing:

- sample table and exclusions;
- offline recall metrics;
- paired medians for exploration tool calls, files read, total/cached input tokens, and time to first mutation;
- completion, verification, and replan outcomes;
- duplicate broad-search observations;
- every generationId and measurement JSON path;
- explicit `GO`, `NO-GO`, or `INSUFFICIENT_EVIDENCE`.

Use `INSUFFICIENT_EVIDENCE`, not `GO`, when fewer than 5 valid pairs remain or token usage is unavailable for more than one pair.

### Slice 13: Documentation and Final Gates

Change in vulnWorkbench:

- update MCP tool documentation that already lists the six existing tools;
- link the concept and this plan;
- state the difference from `spec/static-intelligence-coding-agent-consumer-companion-plan.md`.

Change in NightWorkers:

- document app-managed MCP server registration prerequisite;
- document the exact featureSettings pilot JSON and default-off behavior;
- document that only native/API implementation lane is supported in Phase 42.

Run focused tests first, then final authority gates.

vulnWorkbench:

```bash
bun test api/modules/static-intelligence/exploration-catalog.test.ts
bun test api/modules/static-intelligence/generation-repository.test.ts
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun test api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
bun run typecheck
bun run verify
git diff --check
git status --short
```

NightWorkers:

```bash
bun test tests/project-exploration-settings.service.test.ts
bun test tests/project-exploration-source.service.test.ts
bun test tests/project-exploration-run-pinning.test.ts
bun test tests/project-exploration-native-api-runtime.test.ts
bun test tests/project-exploration-measurement.test.ts
bun run verify
git diff --check
git status --short
```

External provider or live scanner checks are pilot evidence, not deterministic `verify` prerequisites. Do not mark Phase 42 complete when code gates pass but Slice 12 evidence is missing.

## Implementation Order

1. Slice 0 baseline and preconditions
2. Slice 1 producer schemas
3. Slice 2 pure builder
4. Slice 3 rootRef repository discovery
5. Slice 4 MCP handler / registry / server smoke
6. Slice 5 offline evaluator smoke
7. Slice 6 NightWorkers settings
8. Slice 7 NightWorkers source selection
9. Slice 8 run-start pinning
10. Slice 9 native/API activation and guidance
11. Slice 10 read-only measurement
12. Slice 11 historical generation preparation
13. Slice 12 controlled consumer proof
14. Slice 13 documentation and both repo gates

MCP transport、NightWorkers Task schema、AST/LSP/Graph enrichmentから着手しない。

## Test Strategy

| Layer | Required proof |
| --- | --- |
| schema | strict input、focus required、path guards、limits |
| pure projection | ranking、dedup、tests、verification、stable output |
| budget | target trimming、hard cap、valid JSON、omitted counts |
| generation | exact read、mismatch rejection、readiness propagation |
| discovery | rootRef match、no raw path、no name-only binding |
| MCP handler | JSON envelope、read-only、no mutation |
| server | list-tools / smoke registration |
| offline evaluation | recall metrics are deterministic |
| NightWorkers selection | exact generation pin、fallback、no mid-run switch |
| runtime | conditional one-call guidance、native/API implementation lane only |
| telemetry | native exploration window、run-scoped token/tool counts、no new persistence |
| consumer proof | baseline/treatment value and quality comparison |

## Compatibility

- existing MCP tool names and responses remain compatible。
- `vuln_list_knowledge_sources`の`rootRef`はadditive field / filterとする。
- new toolはexisting registryへのadditive registrationとする。
- existing clients that assert exact tool countを更新する。
- generation v1 artifact formatは変更しない。
- code structure schemaへnew edge kindを追加しない。
- NightWorkers pilotはdefault offとし、既存Task executionを変えない。
- NightWorkersのexisting `securityIntelligence` settings contractは変えず、sibling feature settingのみ追加する。
- 両repoのDB schema / migrationは変更しない。

## Performance Constraints

- catalog builderはone generation payloadに対するin-memory bounded projectionとする。
- filesystem walk、source parse、scanner、network、embedding providerを呼ばない。
- direct import traversalは1 hopに限定する。
- response target 8 KiB / hard 12 KiBを守る。
- default item countsを超えて全snapshotを返さない。
- source discoveryはunbounded project/scan fan-outをしない。

## Security and Privacy Checklist

- [ ] MCP annotation remains read-only.
- [ ] absolute repository paths are absent from input/output and telemetry.
- [ ] source bodies and snippets are absent.
- [ ] raw artifact/evidence bodies are absent.
- [ ] verification commands are candidate-only and never executed by MCP.
- [ ] missing generation does not trigger build or scan.
- [ ] rootRef binding does not fall back to project name.
- [ ] NightWorkers does not read vulnWorkbench SQLite directly.
- [ ] vulnWorkbench does not read NightWorkers state.
- [ ] telemetry stores counts/refs, not source payloads.

## Review Checklist

- [ ] The tool replaces exploration rather than adding a project dump.
- [ ] `generationId` is required for worker-facing catalog calls.
- [ ] source discovery and generation adoption are separate.
- [ ] ranking is deterministic and reason-backed.
- [ ] current file/import facts are not overstated as symbol/call impact.
- [ ] response budget is enforced after serialization.
- [ ] no invalid JSON truncation is possible.
- [ ] related tests are distinguishable from likely implementation files.
- [ ] verification commands remain candidates.
- [ ] fallback does not fail the Task.
- [ ] only native/API implementation lane is activated; every other lane remains fallback-only.
- [ ] one native/API run uses one immutable pinned generation.
- [ ] measurement compares MCP off/on and includes quality guards.
- [ ] default enablement is gated by measured value.

## Stop Conditions

- current persisted generation cannot provide a deterministic file/test catalog without source re-read.
- implementation requires MCP to run `intelligence:build` or a scanner.
- source binding requires raw path input or project-name-only matching.
- pilot generation cannot be proven to match the clean NightWorkers worktree baseline Git HEAD.
- response cannot stay below the hard cap without losing required provenance.
- NightWorkers must add a second MCP client/transport instead of reusing existing infrastructure.
- worker can change generation during a run.
- existing events do not retain successful native tool name, arguments, and result well enough to count exploration calls without new payload persistence.
- run-scoped LLM usage cannot be separated by `runId`.
- consumer proof shows token/tool calls are not reduced because catalog is only additive.
- quality regression appears in completion, verification, or replan outcomes.
- proposed fix is a broad AST/LSP/Graph rewrite before ranking/activation causes are isolated.

If a stop condition is met, preserve read-only investigation evidence, keep the pilot disabled, and revise or reject the phase before broader implementation.

## Original End-to-End Completion Definition

以下はoriginal initiative全体のcompletion definitionである。2026-07-15のscope split後は、vulnWorkbench componentとNightWorkers consumer rolloutを独立して追跡する。

Phase 42 is complete when all of the following are true.

1. `vuln_get_project_exploration_catalog` is registered and read-only.
2. It reads one exact persisted generation and never scans/builds/mutates.
3. It returns deterministic bounded file/test/verification clues with provenance.
4. response target/hard budgets and redaction tests pass.
5. NightWorkers native/API implementation lane can bind by `rootRef`, pin one generation, and call the tool through existing MCP infrastructure.
6. MCP missing/stale/failure safely falls back to existing exploration.
7. offline recall and paired runtime metrics are recorded.
8. go/no-go result is explicit; failed value gates leave rollout default off.
9. vulnWorkbench and NightWorkers repo-native verification gates pass.
10. Codex SDK and non-implementation lanes remain unchanged and are explicitly deferred.

The existence of the tool alone is not completion. A measured consumer proof and an explicit rollout decision are required.
