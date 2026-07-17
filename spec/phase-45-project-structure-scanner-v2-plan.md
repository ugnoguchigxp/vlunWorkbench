# Phase 45: Project Structure Scanner v2 再設計・移行計画

- Status: Implemented
- Target: vulnWorkbench
- Depends on: Phase 44 projectPath-first Static Intelligence MCP
- Consumers: Web UI / CLI / Static Intelligence MCP / NightWorkers
- Last updated: 2026-07-16

## 1. 目的

現行の Code Structure extractor を、TypeScript / JavaScript のファイル集合と相対 import 解決を一体化した MVP 実装から、次の責務を分離した Project Structure Scanner v2 へ移行する。

1. 安全で一貫した project inventory
2. 言語・ファイル種別ごとの analyzer
3. typed reference extraction と resolver
4. manifest と graph に基づく module boundary 推定
5. capability ごとの readiness と structured diagnostics
6. v1 CLI / MCP / persisted generation を壊さない互換 projection

この phase の主目的は、特定の拡張子、`src`、`web`、`apps`、`packages` などの固定配置を、構造解析の成否条件から外すことである。

CSS、JSON、SVG、HTML、画像など、コードとして解析しないファイルも「存在する参照先」として正しく扱う。analyzer がないファイル種別は coverage 情報には含めるが、それだけで project 全体を degraded にしない。

## 2. 結論

Project Structure Scanner v2 は、次の順序で処理する。

```text
registered project root
  -> canonical inventory
  -> safe file classification
  -> analyzer registry
  -> typed references
  -> resolver chain
  -> module boundary inference
  -> structured diagnostics
  -> capability readiness
  -> ProjectStructureSnapshot v2
  -> CodeStructureSnapshot v1 compatibility projection
```

次の設計は採用しない。

```text
TS/JSだけを列挙
  -> 全 relative import を同じ集合で解決
  -> 1件でも未解決なら全体 partial
  -> generation 全体の degraded を全 readiness card にコピー
```

v2 を canonical model とするが、移行期間中は v1 snapshot と Static Intelligence Export v1 を同時生成する。既存の `intelligence:code-structure` CLI と `vuln_get_code_structure_snapshot` MCP は v1 を返し続ける。

## 3. 現状の問題とベースライン

### 3.1 file discovery と import resolution の集合が同一

`api/modules/static-intelligence/code-structure/extractor.ts` は、次の拡張子だけを discovery 対象にする。

- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.mts`
- `.cts`
- `.mjs`
- `.cjs`

一方、TypeScript AST からは CSS、JSON、SVG などを含む全 static relative import を抽出する。その後、TS/JSだけを含む `filePathSet` で全 import を解決するため、実在する非TS/JSファイルが unresolved になる。

これは directory layout の問題ではなく、parse target と resolvable target の集合を混同している問題である。

### 3.2 project walker が二重化し、走査規則が一致していない

| 実装 | 用途 | max files | symlink | secret/runtime data | 主な ignore |
| --- | --- | ---: | --- | --- | --- |
| `code-structure/extractor.ts` | structure snapshot | 5,000 default | root内fileは追跡 | `.env`、鍵、SQLite等を除外 | `.git`、`node_modules`、`dist`、`.next`、`.turbo`、`.vite`、`vendor`等 |
| `project-source-fingerprint.ts` | Phase 44 prepare freshness | 20,000 | 全てskip | 専用除外なし | `.git`、`node_modules`、`dist-web`、`artifacts`等 |

この差により、prepare job が見ている source と structure snapshot が見ている source が一致しない。

現在の project tree では、後者の規則は `vuln-workbench.sqlite`、WAL、SHMを含むSQLite関連ファイルまでハッシュ対象にする。runtime data の変化で structure preparation が stale になり得る一方、CSSの扱いは別経路で不整合になる。

### 3.3 current repository baseline

2026-07-16時点で、次のコマンドを実行した。

```bash
bun run api/cli/intelligence-code-structure.ts --project-path . \
  | jq '.snapshot | {status, degradedReasons, summary}'
```

観測値:

```text
status: partial
fileCount: 543
parsedFileCount: 542
importEdgeCount: 1901
packageDependencyCount: 40
degraded reason: web/src/main.tsx からのCSS import 8件
```

実在するCSSを除けば構造解析の大半は完了しているが、snapshot全体がpartialになる。

filesystem walkerで既存runtime/build directoryだけを除外した参考値は579 filesであり、その中にはSQLite関連4 filesが含まれる。v2 baselineでは、inventory policy適用後の件数と除外理由別件数を改めて固定する。

### 3.4 module boundary が固定directory名に依存

`module-candidates.ts` の `modulePrefix` は、`apps`、`packages`、`api`、`web`、`shared`、`src` を特別扱いする。その他は先頭directoryだけでmodule化する。

これは degraded の直接原因ではないが、任意構造のrepository、nested workspace、feature-based layoutでmodule候補の粒度を誤る。directory名は補助signalに留め、manifest、workspace boundary、reference graphを優先する必要がある。

### 3.5 degraded reason が capability を越えて伝播

現行generation metadataは次を一つの配列へ結合する。

- structure extractor reasons
- scan export reasons
- completed review missing
- path redaction reasons

そのgeneration statusを `fileRiskIndex`、`evidenceGraph`、`codeStructure`、`agentBundle`、`ontologyHandoff`のbase statusとして再利用するため、CSS import 1件やreview missingが無関係なcardまでdegradedにする。

### 3.6 v1 contract が複数consumerに固定

次が `CodeStructureSnapshot` v1 を直接参照している。

- generation persistence / validation
- Static Intelligence Export v1 enrichment
- Structure Explorer API / Web UI
- module candidates / ontology handoff
- exploration catalog
- CLI
- read-only MCP
- Phase 44 path-first facade

v1をin-placeでv2へ変更すると、strict Zod schemaとpersisted artifact loaderが既存generationを無効化する。v2 canonical + v1 projectionが必要である。

## 4. Scope

### 4.1 In scope

- canonical project inventory service
- unified ignore、secret、runtime-data、symlink、budget policy
- analyzer registry
- TypeScript / JavaScript analyzerの移植
- CSS analyzer
- HTML entry/reference analyzer
- manifest/config analyzer
- opaque resourceの存在解決
- typed reference resolver
- workspace / manifest / graph based module inference
- ProjectStructureSnapshot v2 schema
- structured diagnosticsとcapability readiness
- v1 compatibility projector
- dual artifact persistence
- CLI / API / MCPのversioned access
- Web UIのcoverage / scoped degraded表示
- shadow / dual-write / prefer-v2 rollout

### 4.2 Initial analyzer support

Phase 45で実際にsemantic analysisする対象は次に限定する。

| Analyzer | 対象 | 抽出内容 |
| --- | --- | --- |
| TypeScript | `.ts`、`.tsx`、`.mts`、`.cts` | import/export、identifier、module kind、role hints |
| JavaScript | `.js`、`.jsx`、`.mjs`、`.cjs` | import/export、require、identifier、module kind、role hints |
| CSS | `.css`、`.module.css` | `@import`、`@reference`、`url()` reference |
| HTML | `.html`、`.htm` | script src、stylesheet link、module entry reference |
| Manifest/config | basename allowlist | `package.json`、`tsconfig*.json`、`jsconfig*.json`、workspace manifest |
| Opaque resource | その他のsafe file | path existence、media/resource classificationのみ |

JSONはbasename allowlistだけをparseし、任意のdata JSONを構造解析しない。画像、font、WASM、archive、database、scanner artifactの内容はparseしない。

### 4.3 Non-goals

- Phase 45でPython、Go、Rust等のsemantic parserを実装すること
- LSP、typecheck、call graph、dataflow analysis
- Vite / webpack configのJavaScript実行
- package install、build、code generationの実行
- security findingのsource of truthをstructure graphへ移すこと
- Semgrep、Trivy、OSV等のsecurity scan profile自体を置換すること
- source bodyやsecret-bearing pathをMCPへ公開すること
- Static Intelligence Export v2の同時導入

architectureは将来のlanguage adapter追加を許容するが、Phase 45の受入条件は上記initial analyzersで固定する。

## 5. Design principles

1. **Inventory first**: 全後続処理は同一inventoryを入力にする。
2. **Parseability is not existence**: parseできないfileもreference targetとして存在し得る。
3. **Unsupported is not broken**: analyzer未対応だけではdegradedにしない。
4. **No layout correctness rule**: directory名はconfidence signalであり、成功条件ではない。
5. **Capability scoped quality**: inventory、analysis、resolution、review、semantic等を別々に評価する。
6. **No executable config**: configから得る情報は静的に読める範囲だけにする。
7. **Safe persisted surface**: secret/runtime dataはpathを含めてpersistしない。
8. **Deterministic output**: 順序、hash、diagnostic code、module idを安定化する。
9. **Bounded work**: file count、bytes、concurrency、response sizeを明示する。
10. **Compatibility by projection**: v1のためにv2設計を歪めず、projectionで互換を保つ。

## 6. Canonical project inventory

### 6.1 Responsibilities

新規 `api/modules/static-intelligence/project-structure/inventory.ts` が次を一元管理する。

- project root realpath
- deterministic directory traversal
- path containment
- symlink handling
- ignore policy
- secret/runtime data exclusion
- file kind classification
- size and read budget
- content hashing policy
- inventory diagnostics
- structure input fingerprint

`code-structure/extractor.ts` と `project-source-fingerprint.ts` は独自walkをやめ、このserviceを利用する。

### 6.2 Internal inventory contract

```ts
type ProjectInventory = {
  version: "inventory-v2";
  rootRef: string;
  structureInputHash: string;
  entries: SafeInventoryEntry[];
  coverage: {
    discoveredFileCount: number;
    includedFileCount: number;
    analyzableFileCount: number;
    resourceFileCount: number;
    excludedFileCount: number;
    excludedByReason: Record<string, number>;
    unhashedFileCount: number;
    totalIncludedBytes: number;
    budgetHit: boolean;
  };
  diagnostics: StructureDiagnostic[];
};

type SafeInventoryEntry = {
  path: string;
  realPathRef: string;
  kind: "source" | "style" | "markup" | "manifest" | "config" | "resource";
  mediaType: string;
  sizeBytes: number;
  contentHash?: string;
  hashMode: "content" | "path_only";
  analyzerIds: string[];
};
```

`realPathRef`はraw absolute pathではなくroot-relative identity hashとする。persisted v2 snapshotにはabsolute pathを含めない。

### 6.3 Ignore and exclusion policy

優先順位を次で固定する。

1. project root containment違反を拒否
2. secret/runtime data hard exclusion
3. scanner-owned artifact / database exclusion
4. built-in generated directory exclusion
5. `.vulnworkbenchignore`
6. Git repositoryではtracked + untracked non-ignored filesを対象
7. non-Git repositoryではsafe filesystem walk

hard exclusion例:

- `.env`、`.env.*`
- key/certificate formats
- SQLite / DB / WAL / SHM
- scanner artifact directory
- VCS object store
- package dependency store

hard exclusionはuser設定で解除しない。除外fileのpathはpersistせず、reason codeとcountだけを残す。

`.vulnworkbenchignore`はrepository固有の生成物を追加除外するために使う。fixed source directoryの指定には使わない。

### 6.4 Symlink policy

- symlink自体はinventory eventとして検査する。
- realpathがproject root外ならexcludeし、`inventory_symlink_outside_root`を記録する。
- root内のregular fileを指す場合は、同じreal fileを一度だけinventoryへ登録する。
- symlink cycleは`inventory_symlink_cycle`としてscoped degradedにする。
- persisted pathはproject内のlexical pathを使い、absolute targetを出力しない。

### 6.5 Default budgets

| Budget | Default | Status impact |
| --- | ---: | --- |
| inventory files | 20,000 | 超過時 inventory degraded |
| analyzed files | 5,000 | 超過時該当analyzer degraded |
| single parsed text file | 2 MiB | file skipped、analyzer coverage degraded |
| total parsed bytes | 128 MiB | analyzer stage degraded |
| concurrent reads | 8 | status impactなし |
| persisted diagnostics | 1,000 | 超過分をcode別countへ集約 |

budget値はCLI optionで下げられる。上限を上げる場合もserver-side absolute capを超えない。

### 6.6 Fingerprint semantics

Phase 44の単一`project-source-v1` hashを次へ分離する。

- `structureInputHash`: analyzer input content + resolver config content + resolvable resource path inventory
- `scanSourceStateHash`: scan run、tool artifact、finding、review等の既存state
- `sourceRevision`: Git HEAD / dirty state provenance

resourceのbinary bytesはstructureに影響しないため、原則として`structureInputHash`へ含めない。resourceの追加・削除・renameはpath inventoryを通じてhashへ反映する。

CSS、HTML、manifest、tsconfigはanalyzer inputなのでcontent hashを含める。runtime databaseはinventoryから除外する。

既存`sourceTreeHash`の意味をsilentに変更しない。v2では`structureInputHash`を新しいfield名で保存する。

## 7. Analyzer registry

### 7.1 Contract

```ts
type ProjectStructureAnalyzer = {
  id: string;
  version: string;
  supports(entry: SafeInventoryEntry): boolean;
  analyze(input: {
    entry: SafeInventoryEntry;
    bytes: Uint8Array;
    inventory: ProjectInventoryLookup;
  }): Promise<FileAnalysis>;
};

type FileAnalysis = {
  path: string;
  analyzerId: string;
  status: "analyzed" | "partial" | "failed";
  language: string;
  symbols: StructureSymbol[];
  references: UnresolvedReference[];
  roleHints: StructureRoleHint[];
  diagnostics: StructureDiagnostic[];
};
```

analyzerはfilesystem walk、status aggregation、persistを行わない。input file以外を直接読む必要がある場合はinventory lookup経由にする。

### 7.2 TypeScript / JavaScript analyzer

現行TypeScript Compiler API parserを移植し、次を維持する。

- static import/export
- dynamic import string literal
- CommonJS require/module.exports
- exported symbols
- bounded identifiers
- parse diagnostics

次を変更する。

- relative importをanalyzer内で解決しない。
- `packageImports`を最終分類とせず、reference kind hintとして出力する。
- CSS、JSON、asset importもreference factとして保持する。
- module resolutionはresolver stageへ移す。

### 7.3 CSS analyzer

CSS parserをdirect dependencyとして追加し、文字列regexだけでCSS全体を解析しない。候補はPostCSSだが、実装開始時に現在のdirect dependency policyとlicenseを確認する。

抽出対象:

- `@import`
- Tailwind等の`@reference`
- `url()`

remote URL、data URL、fragment-only URLはexternal/inlineとして分類し、missing local file扱いしない。

CSS parse errorはCSS analyzerのreadinessだけをdegradedにし、TS/JS code structureをdegradedにしない。

### 7.4 HTML analyzer

既存dependencyのCheerioを利用し、少なくとも次を抽出する。

- `<script src>`
- `<script type="module" src>`
- `<link rel="stylesheet" href>`
- module preload

inline script/style本文は保存しない。Phase 45ではinline JavaScriptの再parseを行わない。

### 7.5 Manifest/config analyzer

basename allowlistで次を静的に読む。

- `package.json`
- `tsconfig.json` / `tsconfig.*.json`
- `jsconfig.json` / `jsconfig.*.json`
- workspace manifest

抽出対象:

- package name
- workspace declarations
- package exports/imports/main/module/types
- tsconfig baseUrl / paths / extends
- source entrypoint hints

config moduleのexecutionは行わない。JavaScriptでしか表現されないVite alias等は`config_not_statically_resolved` coverage noteとし、project全体を即degradedにしない。

## 8. Typed reference resolver

### 8.1 Reference model

```ts
type StructureReference = {
  from: string;
  specifier: string;
  kind:
    | "code_module"
    | "stylesheet"
    | "asset"
    | "manifest"
    | "workspace_package"
    | "external_package"
    | "runtime_builtin"
    | "virtual_module"
    | "remote_url";
  status:
    | "resolved"
    | "resolved_unparsed"
    | "external"
    | "ambiguous"
    | "unresolved"
    | "blocked";
  target?: string;
  resolverId: string;
  confidence: number;
  diagnosticCodes: string[];
};
```

### 8.2 Resolver chain

resolverは次の順で実行する。

1. inline / data / fragment / remote URL classifier
2. runtime builtin / virtual module classifier
3. exact project-relative path resolver
4. CSS / HTML resource resolver
5. TypeScript module resolver with nearest static tsconfig/jsconfig
6. workspace package resolver
7. external package classifier
8. unresolved / ambiguous classifier

resolverはconfig codeをexecuteしない。project root外へのrelative referenceは`blocked`とし、absolute pathをdiagnosticへ含めない。

### 8.3 Required semantics

- `import "./styles.css"` でfileが存在する場合は`resolved`。
- targetにanalyzerがない場合でも`resolved_unparsed`であり、degradedではない。
- extensionless TS/JS importはTypeScript resolution rulesを使う。
- tsconfig pathsは静的configから解決する。
- workspace packageはmanifest boundaryで内部targetへ解決する。
- Node builtin、package import、Vite virtual moduleはmissing relative fileにしない。
- case mismatchはcase-sensitive target platform policyに応じてdiagnosticを出す。
- true missing relative targetは`unresolved`にするが、source fileのparse statusは`analyzed`のままにする。
- cycleはgraph factであり、それだけではdegradedにしない。

### 8.4 Resolution quality

reference graph readinessは次で判定する。

- `available`: 全required resolverが完了し、blocking unresolvedがない。
- `degraded`: missing local target、ambiguous alias、budget truncationがあるがgraphは利用可能。
- `failed`: resolver stage自体が実行不能、またはinventory identity不一致。
- `missing`: v2 artifactがない。
- `stale`: structureInputHashが現在値と異なる。

analyzer未対応fileの存在は`available`を妨げない。

## 9. Module boundary inference

固定directory名による`modulePrefix`をprimary ruleから外す。

優先順位:

1. workspace/package manifest boundary
2. package exports / entrypoint boundary
3. framework/static route entrypoint hints
4. reference graphのstrongly connected componentとdirectory locality
5. stable directory fallback
6. conventional directory nameはconfidence bonusのみ

module candidateには`boundaryKind`と`confidenceReasons`を持たせる。

```ts
type StructureModule = {
  id: string;
  label: string;
  pathPrefix: string;
  boundaryKind: "workspace" | "package" | "entrypoint" | "graph" | "directory";
  files: string[];
  entrypoints: string[];
  internalDependencies: string[];
  externalDependencies: string[];
  confidence: number;
  confidenceReasons: string[];
};
```

module idは`rootRef + boundaryKind + canonical boundary key`から生成する。同一repository内容で入力順を変えても変化しない。

`apps`、`packages`、`api`、`web`、`shared`、`src`という名前は、manifestがない場合のconfidence bonusには使えるが、file groupingの分岐条件にはしない。

## 10. Structured diagnostics and readiness

### 10.1 Diagnostic model

free-form degraded reasonをcanonical sourceにしない。

```ts
type StructureDiagnostic = {
  code: string;
  scope:
    | "inventory"
    | "analysis"
    | "resolution"
    | "module_inference"
    | "persistence";
  severity: "info" | "warning" | "error";
  impact: "none" | "degraded" | "failed";
  path?: string;
  specifier?: string;
  analyzerId?: string;
  count?: number;
};
```

messageはUI側のcode mappingで生成する。path/specifierはredaction後のproject-relative valueだけを許可する。

### 10.2 Capability mapping

| Condition | inventory | codeStructure | evidenceGraph | fileRiskIndex | agentBundle | ontologyHandoff | semanticIndex |
| --- | --- | --- | --- | --- | --- | --- | --- |
| valid CSS import | available | available | 影響なし | 影響なし | 影響なし | 影響なし | 影響なし |
| missing local CSS target | available | degraded | 影響なし | 影響なし | 必要時のみdegraded | 必要時のみdegraded | 影響なし |
| TS parse error | available | degraded | 影響なし | 影響なし | structure利用時degraded | structure利用時degraded | 影響なし |
| completed review missing | 影響なし | 影響なし | 既存graph生成可否で判定 | 影響なし | degradedまたはmissing | degradedまたはmissing | 影響なし |
| zero findings | 影響なし | 影響なし | graph emptyならmissing | evidence quality none | review有無で判定 | review/structureで判定 | 影響なし |
| semantic index absent | 影響なし | 影響なし | 影響なし | 影響なし | mode依存 | 影響なし | missing |
| external finding path redacted | 影響なし | 影響なし | evidence側のみdegraded | fileRiskIndex degraded | evidence利用時degraded | 影響なし | 影響なし |
| inventory budget exhausted | degraded | degraded | 影響なし | 影響なし | structure利用時degraded | structure利用時degraded | 影響なし |

既存`StaticIntelligenceReadiness`は既にcapability別fieldを持つため、Phase 45ではshapeを増やさず、各fieldを独立計算する。inventory/reference resolutionの詳細はcodeStructure capabilityのsubstatusとしてv2 APIへ返す。

### 10.3 Generation validity separation

次を分離する。

- artifact pair/tripleが完全でschema/hash検証済みか
- 各analysis capabilityのquality
- optional review/semanticが存在するか

generation metadataのlegacy `status`は互換用途として残すが、readiness resolverはその値を全capabilityへコピーしない。

## 11. ProjectStructureSnapshot v2

新規schemaを `shared/schemas/project-structure.schema.ts` に追加する。

```ts
type ProjectStructureSnapshotV2 = {
  version: "v2";
  generatedAt: string;
  project: {
    id?: string;
    rootRef: string;
    rootPath?: string;
    rootPathIncluded: boolean;
  };
  status: "completed" | "partial";
  structureInputHash: string;
  inventory: {
    entries: SafePersistedInventoryEntry[];
    coverage: InventoryCoverage;
  };
  files: StructureFileFact[];
  references: StructureReference[];
  modules: StructureModule[];
  packages: StructurePackage[];
  diagnostics: StructureDiagnostic[];
  readiness: {
    inventory: StructureStageReadiness;
    analysis: StructureStageReadiness;
    resolution: StructureStageReadiness;
    moduleInference: StructureStageReadiness;
  };
  summary: ProjectStructureSummaryV2;
};
```

persisted inventory entryはsafe relative path、kind、media type、size、hash modeだけを含む。absolute path、source body、secret exclusion pathを含めない。

snapshot identityは次とする。

```text
project_structure:v2:<rootRef>:<structureInputHash-prefix>
```

legacy `code_structure:<rootRef>:...` と混同しない。

## 12. v1 compatibility and persistence

### 12.1 Compatibility projector

`projectStructureV2ToCodeStructureV1(snapshot)`を追加する。

projection規則:

- v1 `files`にはTS/JS analyzer outputを中心に、既存consumerが扱えるfile factsだけを入れる。
- resolved `code_module` referencesをv1 `imports` edgeへ変換する。
- external package referencesをv1 package dependencyへ変換する。
- stylesheet / asset referencesはv1 code import edgeへ無理に変換しない。
- valid non-code referenceはv1 degraded reasonへ入れない。
- true missing code-module reference、TS/JS parse failure、budget truncationだけをv1 partialへ投影する。
- orderingとcontent hash semanticsを既存contractに合わせる。

### 12.2 Artifact layout

新規generationは移行期間中、同一generation publish単位で次をatomicに保存する。filesystem artifact setとDB rowsのどちらかが不完全な場合はpublishせず、既存repositoryと同様に保存済みartifactをcleanupする。

| Artifact kind | Schema | Role |
| --- | --- | --- |
| `project_structure_snapshot` | `project-structure-v2` | canonical |
| `code_structure_snapshot` | `code-structure-v1` | compatibility projection |
| `static_intelligence_export` | `static-intelligence-export-v1` | existing export |

`STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS`へv2 kindを追加し、scan source stateへderived artifactが混入しないようにする。

generation loaderは次を許可する。

- legacy pair: code structure v1 + export v1
- v2 triple: project structure v2 + code structure v1 + export v1

v2 generationでcanonical artifactが欠けている場合はinvalidとする。legacy generationは従来どおりvalidに読み込む。

### 12.3 CLI compatibility

- 既存 `intelligence:code-structure` はv1 projectionを返す。
- 新規 `intelligence:project-structure` はv2を返す。
- 両CLIで同一inventory/build coreを使用する。
- v1 CLIの引数、exit code、stdout one-JSON-object contractを変更しない。

### 12.4 MCP compatibility

- 既存 `vuln_get_code_structure_snapshot` はv1を返す。
- 新規 `vuln_get_project_structure_snapshot` をread-only toolとして追加する。
- v2 toolは`summary`、`files`、`references`のview selectorとpaginationを持ち、full snapshotを無制限に返さない。
- Phase 44の`projectPath` selectorをprimary inputとする。
- query toolが暗黙にprepareを開始しない原則を維持する。

### 12.5 API / UI compatibility

- existing structure endpointsはv1 fallbackを維持する。
- v2 generationではv2 summaryとstage readinessを追加で返す。
- Web UIはv2があれば優先し、legacy generationでは現在のv1 viewを表示する。
- historical v1 generationを再書換えしない。

## 13. Build pipeline v2

build stagesを次へ変更する。

```text
validate_source
build_inventory
analyze_files
resolve_references
infer_modules
build_v2_snapshot
project_v1_compatibility
build_export
persist_generation
build_manifest
optional_semantic_index
```

各stageは独自statusとdiagnostic codesを返す。後段で一つのstring arrayへ潰さない。

required core stageがpartialでも安全なsnapshotを生成できる場合、build自体はexit 0 + partialを維持する。ただしどのcapabilityがpartialかを明示する。

## 14. Implementation slices

### Slice 0: Baseline and characterization tests

変更対象:

- `api/modules/static-intelligence/code-structure/extractor.test.ts`
- `api/modules/static-intelligence/build-service.test.ts`
- `api/modules/static-intelligence/read-model-resolver.test.ts`
- 新規fixture directory

実装:

1. 現在のCSS false positiveを現行挙動のcharacterization testとして記録し、Slice 4で期待値をresolvedへ更新する。
2. review missingがcodeStructureへ伝播する現状testを記録し、Slice 8でcapability分離後の期待値へ更新する。
3. duplicate walkerのignore/symlink差をfixtureで記録する。
4. current repository baseline commandを実行可能なscriptへする。

完了条件:

- v2実装前に、直すべき挙動と維持すべきv1 contractがtestで区別されている。

### Slice 1: v2 schemas and diagnostic codes

追加:

- `shared/schemas/project-structure.schema.ts`
- `api/modules/static-intelligence/project-structure/diagnostics.ts`
- schema fixtures/tests

変更:

- `generation-types.ts`
- artifact metadata schema

完了条件:

- v2 schemaがstrict parseされる。
- raw absolute path、source body、secret path fieldがschemaに存在しない。
- diagnostic code/impact mappingがexhaustiveである。

### Slice 2: Canonical inventory

追加:

- `project-structure/inventory.ts`
- `project-structure/inventory-policy.ts`
- `project-structure/inventory.test.ts`

変更:

- `code-structure/extractor.ts`
- `project-source-fingerprint.ts`
- Phase 44 prepare service/worker

完了条件:

- structure buildとprepare fingerprintが同一inventory resultを使う。
- CSS/HTML/resourceがsafe inventoryへ入る。
- SQLite/secret/runtime dataがpersist対象とhash対象から除外される。
- Git/non-Git fixtureで同じincluded source treeが同じstructureInputHashになる。

### Slice 3: Analyzer registry

追加:

- `project-structure/analyzers/registry.ts`
- `typescript-javascript.ts`
- `css.ts`
- `html.ts`
- `manifest.ts`
- analyzer unit tests

変更:

- TypeScript extraction logicを現行extractorから移動
- CSS parser direct dependency

完了条件:

- analyzerはinventory traversalやstatus aggregationを行わない。
- CSS、HTML、manifest referencesがtyped unresolved factsとして得られる。
- opaque resourceはread/parseせずinventoryに残る。

### Slice 4: Reference resolver

追加:

- `project-structure/resolution/resolver.ts`
- `exact-path.ts`
- `typescript-module.ts`
- `workspace-package.ts`
- `resource.ts`
- resolver tests

完了条件:

- valid CSS/JSON/SVG/asset referencesがresolvedまたはresolved_unparsedになる。
- missing、ambiguous、external、virtual、blockedが区別される。
- tsconfig paths、workspace package、extensionless importが解決される。
- project root外のpathを返さない。

### Slice 5: Module inference

追加:

- `project-structure/modules/infer-modules.ts`
- module inference tests

変更:

- `module-candidates.ts`
- `exploration-catalog.ts`
- ontology handoff builder

完了条件:

- arbitrary directory名のworkspace/packageがmanifest boundaryでmodule化される。
- manifestがないfixtureはgraph/directory fallbackを使う。
- conventional directory名を変更しても、同じmanifest/graphならmodule boundaryが維持される。

### Slice 6: Snapshot builder and v1 projector

追加:

- `project-structure/builder.ts`
- `project-structure/v1-projector.ts`
- deterministic snapshot tests

変更:

- existing `buildCodeStructureSnapshot`をv1 projector facadeへ変更

完了条件:

- v2 snapshotがcanonical outputになる。
- v1 outputがexisting schemaを満たす。
- input array/orderを反転してもstable fieldsがdeep equalになる。
- valid stylesheet/asset referenceがv1 degraded reasonへ入らない。

### Slice 7: Persistence, CLI, MCP

変更:

- `generation-repository.ts`
- `generation-types.ts`
- `build-service.ts`
- `mcp-tools.ts`
- `mcp-tool-schemas.ts`
- CLI package scripts

追加:

- `api/cli/intelligence-project-structure.ts`
- v2 MCP contract tests

完了条件:

- v2 tripleがatomicに保存・検証される。
- old v1 pairを引き続きloadできる。
- existing v1 CLI/MCP responseがcontract testで不変。
- v2 MCP response budgetとpaginationが強制される。

### Slice 8: Scoped readiness

変更:

- `build-service.ts`
- `read-model-resolver.ts`
- `export-builder.ts`
- readiness tests

完了条件:

- review missingがcodeStructure/fileRiskIndexをdegradedにしない。
- CSS parse/resolution issueがscan evidenceをdegradedにしない。
- semantic missingがsemanticIndex以外へ伝播しない。
- legacy generationでは安全なv1 fallback mappingを使う。

### Slice 9: Web UI

変更:

- `web/src/api.ts`
- `web/src/domains/projects/projects-domain.tsx`
- project styles

実装:

- Code Structureにinventory/analyzed/resolved/unresolved/unsupported coverageを表示する。
- reason codeをscope別に表示する。
- generation summaryとcapability cardを分離する。
- `unsupported`をwarning色のdegradedとして表示しない。
- legacy v1 generationには`Legacy structure snapshot`を表示する。

完了条件:

- 1つのreview reasonで全cardが同色degradedにならない。
- valid CSS importがあるprojectでCode Structureがavailableになる。

### Slice 10: Rollout and removal preparation

追加:

- version selection config
- aggregate comparison logs
- rollout documentation

完了条件:

- v1 / dual / v2-preferredを切り替えられる。
- rollbackでv1 read/buildへ戻せる。
- path/source bodyをlogしないcomparison telemetryがある。

## 15. Test matrix

### 15.1 Layouts

- root直下だけのflat project
- `src` layout
- arbitrary directory名
- `apps/*` / `packages/*` monorepo
- nested workspace
- spaces / Unicode / 日本語path
- symlinkを含むproject
- non-Git project

### 15.2 References

- same-directory CSS
- parent-directory CSS
- CSS modules
- CSS `@import` / `@reference` / `url()`
- HTML script / stylesheet
- explicit JSON import
- SVG / image / font asset
- extensionless TS import
- directory index import
- tsconfig path alias
- workspace package
- Node builtin
- external package
- virtual module
- remote/data URL
- missing local target
- case mismatch
- root escape
- ambiguous alias
- cycle

### 15.3 Inventory safety

- `.env`
- key/cert
- SQLite/WAL/SHM
- scanner artifacts
- ignored generated directory
- unreadable directory/file
- symlink outside root
- symlink cycle
- duplicate symlink target
- 2 MiB超text file
- 20,000 files超
- total parsed byte budget超

### 15.4 Compatibility

- persisted v1 generation load
- v2 triple load
- incomplete triple rejection
- existing v1 CLI snapshots
- existing v1 MCP response
- Phase 44 projectPath facade
- exploration catalog with v1 fallback
- ontology handoff with v2-preferred modules
- Web historical generation view

### 15.5 Readiness isolation

各diagnostic conditionについて、影響するcapabilityだけがstatus変化するtable-driven testを追加する。

特に次を必須とする。

```text
completed_scan_review_missing != code_structure_degraded
semantic_index_missing != file_risk_index_degraded
valid_non_code_reference != unresolved_import
unsupported_analyzer != project_partial
```

## 16. Verification commands

### 16.1 Focused tests

```bash
bun test api/modules/static-intelligence/project-structure/**/*.test.ts
bun test api/modules/static-intelligence/code-structure/*.test.ts
bun test api/modules/static-intelligence/build-service.test.ts
bun test api/modules/static-intelligence/generation-repository.test.ts
bun test api/modules/static-intelligence/read-model-resolver.test.ts
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun test api/modules/static-intelligence/project-path-mcp.test.ts
bun test api/routes/static-intelligence.route.test.ts
```

Expected:

- all focused tests pass
- valid CSS import produces no degraded diagnostic
- legacy generation fixtures remain readable

### 16.2 Contract and static checks

```bash
bun run typecheck
bun run lint
bun run build:web
```

Expected:

- strict schemas and exhaustive mappings compile
- no existing Web/API contract regression

### 16.3 Repository acceptance scan

```bash
bun run intelligence:project-structure -- --project-path . --pretty true
bun run intelligence:code-structure -- --project-path . --pretty true
```

Expected:

- v2 inventory includes the 8 CSS files as style entries
- `web/src/main.tsx` stylesheet references resolve
- SQLite/runtime data is excluded with aggregate counts only
- code structure readiness is available when no true code/parser issue exists
- v1 output validates and has no CSS unresolved reason

### 16.4 Determinism

同一projectを固定`generatedAt`で2回buildし、`generatedAt`とruntime metricsを除くsnapshotがdeep equalであることを確認する。

### 16.5 Performance

current repositoryとlarge fixtureで各5回測定する。

Acceptance:

- warm median wall timeがv1 baselineの1.5倍以内
- 単発最大がv1 baselineの2倍以内
- memory peak 512 MiB以内
- budget超過時にprocess crashせずscoped partialを返す

性能目標を満たせない場合、parser concurrency、content hash reuse、inventory cacheを調整する。安全制約やdiagnostic correctnessを外して高速化しない。

## 17. Rollout strategy

### Stage A: Shadow

- production read pathはv1。
- explicit test/CLIだけv2をbuildする。
- v1/v2のfile count、resolved count、diagnostic count、durationだけ比較する。

Exit criteria:

- repository fixture matrix通過
- CSS false positive 0
- v1 contract regression 0

### Stage B: Dual write

- new generationでv2 tripleを保存する。
- Web/MCPはまだv1をprimaryにする。
- v2 artifact failure時はgeneration publishを失敗させ、incomplete tripleをactiveにしない。

Exit criteria:

- persisted generation validation安定
- old generation load regression 0

### Stage C: v2 preferred read

- Web、module inference、exploration catalog、ontology handoffがv2を優先する。
- v2がないhistorical generationはv1 fallback。
- existing v1 MCP/CLIはprojectionを返す。

Exit criteria:

- readiness isolation tests通過
- Phase 44 / NightWorkers pilot regression 0

### Stage D: v2 default

- new buildのcanonical scannerをv2に固定する。
- v1はprojectionとしてのみ生成する。
- v1 removal時期は別phaseで決める。

### Rollback

runtime setting:

```text
PROJECT_STRUCTURE_SCANNER_MODE=v1 | dual | v2
```

- rollbackは`v1`へ戻す。
- v2 artifactは削除しない。
- persisted v1 pairがあるためDB migration rollbackを不要にする。

## 18. Observability

build stageごとに次をstructured logへ出す。

- durationMs
- included/analyzed/resolved/unresolved counts
- diagnostic counts by code
- budget usage
- scanner mode
- v1/v2 comparison counters

次はlogへ出さない。

- source body
- raw absolute path
- excluded secret path
- import周辺snippet
- config values

UIに出すreasonはdiagnostic codeから生成し、backend free-form messageをそのまま表示しない。

## 19. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| inventory拡大で性能悪化 | staged budgets、bounded concurrency、content hash reuse |
| v2 artifactで保存量増加 | compact schema、diagnostic aggregation、MCP pagination |
| CSS parser dependency追加 | direct dependency固定、license確認、parser unit tests |
| tsconfig解決差 | TypeScript official resolver利用、config execution禁止 |
| Git/non-Git差 | canonical inventory contractとparity fixtures |
| secret path露出 | hard exclusion、aggregate counts、schema redaction tests |
| v1 consumer破壊 | projection、dual artifact、old generation tests |
| module ID churn | canonical boundary key、determinism tests |
| global degraded再発 | table-driven readiness isolation tests |

## 20. Acceptance criteria

Phase 45は、次をすべて満たした時に完了する。

- [ ] `import "./styles.css"` はfileが存在すればresolvedになる。
- [ ] CSSのdirectory配置はstructure scanの成功条件にならない。
- [ ] analyzer未対応fileがあるだけではproject snapshotはpartialにならない。
- [ ] true missing local referenceはtyped diagnosticになり、source parse statusと分離される。
- [ ] TS/JS、CSS、HTML、manifestが同じinventoryから解析される。
- [ ] structure buildとPhase 44 source fingerprintが同じinventory policyを使う。
- [ ] SQLite、secret、scanner artifactsはpersisted inventoryへ入らない。
- [ ] fixed `src/web/apps/packages` ruleなしでmodule boundaryを推定できる。
- [ ] completed review missingがcodeStructureをdegradedにしない。
- [ ] semantic missingがsemanticIndex以外をdegradedにしない。
- [ ] v2 tripleとlegacy v1 pairの両方をloadできる。
- [ ] existing v1 CLI/MCP contract testsが通る。
- [ ] current repositoryの8 CSS referencesがdegraded reasonから消える。
- [ ] deterministic、redaction、budget、performance testsが通る。
- [ ] shadow、dual-write、v2-preferredの各exit criteriaを満たす。

## 21. Implementation order

実装順序は次で固定する。

```text
Slice 0 baseline
  -> Slice 1 schemas
  -> Slice 2 inventory
  -> Slice 3 analyzers
  -> Slice 4 resolver
  -> Slice 5 module inference
  -> Slice 6 builder/projector
  -> Slice 7 persistence/CLI/MCP
  -> Slice 8 readiness
  -> Slice 9 UI
  -> Slice 10 rollout
```

resolverだけを先にpatchして完了扱いにしない。canonical inventoryとreadiness isolationが入らない限り、同種のfalse degradedとfreshness mismatchが再発するためである。
