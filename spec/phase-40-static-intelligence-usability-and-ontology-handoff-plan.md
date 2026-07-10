# Phase 40: Static Intelligence Usability and Ontology Handoff Plan

## Purpose

この計画は、Phase 29-39 で実装された Static Intelligence の CLI / MCP / Project UI を、日常的に使える一つの分析体験へ統合する。

中心課題は見た目ではなく、現在分断されている次のライフサイクルを一本化することである。

```text
registered project
  -> selected scan evidence
  + persisted code structure snapshot
  -> versioned Static Intelligence generation
  -> Project Intelligence explorer
  -> read-only Ontology handoff
  -> NightWorkers Project Ontology / Task Compiler
```

Phase 40 は、Project UI のリクエストループ、agent-facing path 境界、code structure snapshot の非永続化、selected scan と表示内容の不一致、構造情報の閲覧性、downstream Ontology handoff の不透明さをまとめて解消する。

## Decision Summary

- Phase 39 の Project Intelligence UI を改善し、別の top-level product を増やさない。
- `scan_artifacts` と既存 artifact storage を使い、code structure snapshot と Static Intelligence export を永続化する。
- 一つの分析世代を `generationId` で束ね、途中失敗した世代を active にしない。
- UI / CLI / MCP は同じ persisted generation を読む。
- MCP は引き続き read-only とし、生成、scanner 実行、verification 実行、contextStill 登録、NightWorkers task 作成を行わない。
- Project UI には derived analysis の明示的な refresh を許可するが、scanner、finding、review、decision、Ontology、task を変更しない。
- Project UI の refresh POST は local derived-generation control であり、consumer-facing read-only source surface には含めない。manifest / MCP から発見または実行できる write path にしない。
- vulnWorkbench は Project Ontology を所有しない。`Ontology Handoff` は、downstream が Ontology に写像するための module candidate、構造事実、risk/evidence refs、freshness を表示する read model とする。
- graph canvas、source code browser、LSP、call graph、taint analysis、browser E2E はこの phase に含めない。

## Relationship to Existing Phases

- Phase 29-33 の export / semantic / community / landscape / agent-query を再利用する。
- Phase 34-37 の manifest / guardrail / MCP / fixture contract を維持する。
- Phase 38 の `CodeStructureSnapshot` を persisted generation の structure payload として使う。
- Phase 39 の Projects route と Project Intelligence view を置き換えず、取得と表示の一貫性を修正する。
- coding-agent consumer 側の source discovery、generation pinning、Ontology mapping、task/runtime/closeout 接続は `spec/static-intelligence-coding-agent-consumer-companion-plan.md` に分離する。

Phase 39 では UI-specific table、background generation、graph canvas を非目標とした。Phase 40 でも UI 専用 table と graph canvas は追加しない。一方、実運用で code structure が常に `missing` になる問題を解消するため、既存 artifact storage への derived snapshot 永続化は Phase 40 の必須範囲とする。

Phase 40 の producer completion は NightWorkers mutation を必須にしない。ただし cross-repository end-to-end adoption は companion plan の consumer completion まで完了扱いにしない。

## Responsibility Boundary

### vulnWorkbench owns

- registered project path からの bounded code structure extraction
- persisted structure / export generation
- scanner-backed file risk と Diagnostic Evidence Graph
- deterministic module candidate projection
- generation freshness / provenance / degraded reason
- Project Intelligence の read-only exploration
- downstream が pull できる Ontology handoff material

### NightWorkers owns

- canonical Project Ontology
- domain / capability / invariant の採用と編集
- task graph generation
- queue admission
- implementation / review / verification orchestration

### contextStill owns

- generalized knowledge
- reusable procedures and guardrails
- candidate lifecycle and retrieval

### Phase 40 must not do

- code structure facts を vulnerability proof として扱う。
- module candidate を canonical domain / capability と断定する。
- Project Intelligence から scanner を開始する。
- Project Intelligence から contextStill candidate を登録する。
- Project Intelligence から NightWorkers task を作る。
- MCP に refresh / write tool を追加する。
- raw source body、raw artifact body、secret、private absolute path を browser / CLI / MCP payload に含める。

## Current Baseline

実装開始前に、以下を regression baseline として固定する。

### Request baseline

- `App.tsx` の `runWithBusy` は render ごとに新しい function identity を持つ。
- `ProjectsDomainSection` の passive `useEffect` は `runWithBusy` を dependency に持つ。
- Projects route を開くと、`fetchProjects`、project intelligence overview、scan list が再実行を繰り返す。
- API global rate limit に達すると UI に `Too many requests` が表示される。

### Data baseline

- `intelligence:code-structure` は full `CodeStructureSnapshot` を生成できる。
- snapshot は CLI output file または MCP の一時結果にしか存在せず、Project Intelligence API が再利用できる persisted reference がない。
- `buildStaticIntelligenceExport` は `codeStructureSnapshot` option が渡された場合だけ enrichment を含める。
- browser API は option を渡さず export を再構築するため、通常の Project UI では code structure が `missing` になる。
- `vuln_get_code_structure_snapshot` は呼び出しごとに repository を再走査し、Project UI / export と同じ generation を保証しない。

### Context baseline

- project intelligence overview は単純に timestamp が最新の scan を選ぶ。
- `?scanRunId=` で過去 scan を選択しても、degraded reasons は latest overview 由来のままになる。
- selected scan の ownership は検証されるが、route の `projectId` と selected scan の `projectId` の一致を一つの nested contract として保証していない。
- Project Intelligence から Scans へ移動するとき、projectId / scanRunId が失われる導線がある。

### Safety baseline

- `normalizeStaticIntelligencePath` は slash normalization だけを行う。
- absolute finding path が file risk path、graph node、community id、agent source ref、UI table に伝播する。
- Source Health がコピーする agent-query command は `--query-kind` を使うが、CLI contract は `--kind` である。

### UI baseline

- Files は flat table であり drilldown がない。
- Evidence Graph は node / edge kind の件数だけを表示する。
- Code Structure は file / parsed / import / package count だけを表示し、file tags を表示しない。
- Agent Bundle は title / body / item count / source-ref count だけを表示する。
- Source Health は command list だけで、snapshot freshness、generation、hash、schema readiness を表示しない。

## Target Experience

Project Intelligence を開いた利用者が、上から順に次を判断できる状態にする。

1. どの scan とどの analysis generation を見ているか。
2. scan evidence、code structure、semantic index、handoff が ready / stale / degraded / missing のどれか。
3. どの module / file に risk が集中し、何の evidence に支えられているか。
4. code structure extractor が何を解析し、何を解析できなかったか。
5. downstream agent が何を読み、Ontology 接続に何が不足しているか。
6. missing / stale の場合、どの bounded action または working CLI command で更新できるか。

## Target Data Flow

```text
Project list
  -> batch ProjectIntelligenceSummary
  -> no per-card export rebuild

Project Intelligence route
  -> projectId + optional scanRunId
  -> resolve selected scan within project
  -> resolve latest complete persisted generation
  -> return one consistent view envelope

Refresh derived analysis
  -> resolve stored project path on server
  -> build code structure snapshot
  -> normalize scanner paths
  -> build Static Intelligence export with structure
  -> persist structure + export under one generationId
  -> expose generation through UI / CLI / MCP read paths
```

## Artifact Persistence Contract

新しい UI 専用 table は作らない。既存 `scan_artifacts` と `ArtifactStorage` を使う。

### Artifact kinds

```text
code_structure_snapshot
static_intelligence_export
```

両 artifact は同じ `scanRunId` と `generationId` を持つ。

### Required metadata

```ts
type StaticIntelligenceArtifactMetadata = {
  generationId: string;
  projectId: string;
  scanRunId: string;
  artifactRole: "structure" | "export";
  schemaVersion: "code-structure-v1" | "static-intelligence-export-v1";
  status: "available" | "degraded";
  generatedAt: string;
  sourceTreeHash: string;
  sourceStateHash: string;
  sourceRevision?: {
    kind: "git" | "tree_hash_only";
    head?: string;
    dirtyHash?: string;
    value: string;
  };
  rootRef: string;
  snapshotRef?: string;
  exportHash?: string;
  contentHash: string;
  degradedReasons: string[];
  summary: Record<string, string | number | boolean | null>;
};
```

Rules:

- `sourceTreeHash` は sorted `file.path + file.contentHash` から計算する。
- `sourceStateHash` は scan、tool run、finding、evidence、diagnostic artifact、latest review の stable identifiers / updatedAt / sha256 から計算する。
- `code_structure_snapshot` と `static_intelligence_export` は derived artifact として source bundle、artifact count、Diagnostic Evidence Graph、sourceStateHash から除外する。Static Intelligence 自身を scanner evidence として再入力しない。
- `rootRef` は current `CodeStructureSnapshot.project.rootRef` を使う。
- `snapshotRef` は `code_structure:<rootRef>:<sourceTreeHash-prefix>` とし、summary count hash を identity に使わない。
- git repository では build 時に HEAD と bounded dirty-state hash を `sourceRevision` に保存する。non-git repository は `tree_hash_only` とする。
- artifact database `path` は server-side storage path であり、browser / MCP payload に返さない。
- active generation は、structure と export の両方が同じ `generationId` で揃い、schema parse に成功した最新世代とする。
- incomplete generation は degraded history として残してもよいが、read path の active generation にしない。
- 新しい generation が失敗した場合、最後の valid generation を失わない。

### Generation write order

1. source state を読み、`generationId` を発行する。
2. structure payload を temporary path に書く。
3. export payload を同じ generation の temporary path に書く。
4. 両 payload を schema parse し、hash を確定する。
5. final artifact paths へ rename する。
6. artifact rows を transaction で insert する。
7. database insert が失敗した場合、今回作った final files を cleanup する。
8. 古い valid generation は新しい pair の確定後にのみ非active扱いにする。

## Read Model Contracts

### Readiness

```ts
type IntelligenceReadinessStatus =
  | "available"
  | "stale"
  | "degraded"
  | "missing"
  | "failed";

type IntelligenceCapabilityReadiness = {
  status: IntelligenceReadinessStatus;
  reasonCodes: string[];
  generatedAt?: string;
  generationId?: string;
  sourceRef?: string;
};

type StaticIntelligenceReadiness = {
  export: IntelligenceCapabilityReadiness;
  fileRiskIndex: IntelligenceCapabilityReadiness;
  evidenceGraph: IntelligenceCapabilityReadiness;
  codeStructure: IntelligenceCapabilityReadiness;
  semanticIndex: IntelligenceCapabilityReadiness;
  agentBundle: IntelligenceCapabilityReadiness;
  ontologyHandoff: IntelligenceCapabilityReadiness;
};
```

Status rules:

- `missing`: persisted payload が存在しない。
- `failed`: payload load / schema parse / ownership validation が失敗した。
- `stale`: persisted sourceStateHash と current DB source state が一致しない、または bounded git revision probe と persisted sourceRevision が一致しない。
- `degraded`: payload は利用可能だが extractor / scan / review の degraded reasons がある。
- `available`: hash が一致し、blocking degraded reason がない。

Freshness probe rules:

- Project detail GET は registered project path に対する bounded git revision probe を行ってよいが、source parse / structure extraction / artifact write は行わない。
- project list batch summary は repository filesystem を fan-out probe せず、last persisted generation と DB sourceStateHash だけを使う。
- git revision を取得できない non-git project は、次の explicit refresh まで tree freshness を断定せず `degraded` + `source_revision_unavailable` とする。

### Project Intelligence view envelope

既存 browser endpoint を次の一貫した envelope に更新する。

```ts
type ProjectIntelligenceView = {
  project: Project;
  latestUsableScan: ScanRun | null;
  selectedScan: ScanRun | null;
  selection: {
    requestedScanRunId: string | null;
    selectedScanRunId: string | null;
    isLatest: boolean;
    selectionReason:
      | "requested"
      | "latest_completed"
      | "latest_terminal_degraded"
      | "none";
  };
  generation: {
    generationId: string;
    generatedAt: string;
    sourceTreeHash: string;
    sourceStateHash: string;
    snapshotRef?: string;
    exportHash: string;
  } | null;
  export: StaticIntelligenceExportV1 | null;
  readiness: StaticIntelligenceReadiness;
  degradedReasons: string[];
};
```

Selection rules:

- requested `scanRunId` がある場合、必ず route `projectId` の scan であることを server-side で検証する。
- requested scan が別 project の場合は `404` とし、別 project の存在を推測できる `403` response にしない。
- requested scan がない場合、最新の completed scan を優先する。
- completed scan がない場合のみ、findings / artifacts / reviews のいずれかを持つ最新 terminal scan を degraded default とする。
- selected scan 由来の export / readiness / degraded reasons だけを envelope に含める。
- latest と selected を混在させない。

### Project list summary

Project card ごとに full export を再構築しない。

```ts
type ProjectIntelligenceSummary = {
  projectId: string;
  selectedScanRunId: string | null;
  scanStatus: string | null;
  riskBand: StaticIntelligenceRiskBand;
  evidenceQuality: StaticIntelligenceEvidenceQuality;
  findingCount: number;
  codeStructureStatus: IntelligenceReadinessStatus;
  generationStatus: IntelligenceReadinessStatus;
  generatedAt: string | null;
  degradedReasonCount: number;
};
```

`GET /api/projects/intelligence-summaries` は authenticated owner の全 project summary を一括で返す。scan と artifact metadata を batch load し、project ごとの `buildStaticIntelligenceExport` を実行しない。

### Module candidate

Module candidate は canonical Ontology node ではなく、structure explorer と downstream handoff の deterministic projection である。

```ts
type StaticIntelligenceModuleCandidate = {
  id: string;
  pathPrefix: string;
  label: string;
  fileCount: number;
  entrypointFiles: string[];
  roleTags: CodeStructureFileTag[];
  exportedSymbols: string[];
  internalDependencies: string[];
  packageDependencies: string[];
  risk: {
    findingCount: number;
    maxSeverity: StaticIntelligenceSeverity;
    evidenceQuality: StaticIntelligenceEvidenceQuality;
    fileRefs: string[];
    findingIds: string[];
  };
  confidence: number;
  reasons: string[];
};
```

Projection rules:

- source は persisted structure snapshot と selected export に限定する。
- first-party boundaries は deterministic path prefix から作る。
- `apps/*`、`packages/*`、`api/*`、`web/*`、`shared/*`、`src/*` を優先し、該当しない project は top-level source directory でまとめる。
- role tags、exported symbols、import edges、file risk を集約する。
- LLM synthesis を使わない。
- capability / domain / invariant を断定しない。
- pathPrefix と evidence refs を必ず残す。

### Ontology handoff

```ts
type StaticIntelligenceOntologyHandoff = {
  status: IntelligenceReadinessStatus;
  projectId: string;
  scanRunId: string;
  generationId: string;
  snapshotRef: string;
  exportHash: string;
  sourceTreeHash: string;
  modules: StaticIntelligenceModuleCandidate[];
  graphSummary: {
    nodeCounts: Record<string, number>;
    edgeCounts: Record<string, number>;
  };
  verificationCommands: string[];
  sourceRefs: string[];
  degradedReasons: string[];
  consumerBoundary: {
    ownsCanonicalOntology: false;
    ownsTaskCompilation: false;
    consumer: "NightWorkers";
  };
};
```

Ontology handoff readiness requires:

- selected scan と generation の projectId / scanRunId が一致する。
- structure snapshot と export が同じ generationId を持つ。
- paths が project-relative である。
- sourceTreeHash、exportHash、snapshotRef が存在する。
- module candidate に pathPrefix と source-backed reasons がある。
- scanner finding が code structure facts だけから生成されていない。

## Path Boundary Contract

Static Intelligence 全体で一つの helper を使う。

```ts
type RelativePathResult =
  | { ok: true; path: string }
  | {
      ok: false;
      path: "unknown";
      reason: "empty_path" | "outside_project" | "invalid_path";
    };

toProjectRelativePath(projectRoot: string, candidate: unknown): RelativePathResult
```

Rules:

- POSIX / Windows separator を正規化する。
- relative input は project root 基準で解釈する。
- absolute input は lexical containment を検証して relative path に変換する。
- source file が削除済みでも判定できるよう、path の存在を必須にしない。
- `..`、別 drive、project 外 absolute path は `unknown` に落とす。
- project 外 path を payload、node id、edge id、community id、source ref、markdown に残さない。
- project card は repository basename または project display name だけを表示し、home 以下の short path を組み立てない。
- `StaticIntelligenceExportV1.project.rootPath` は agent-facing build では常に omit する。
- redaction された path は `external_path_redacted` degraded reason に集約する。
- path conversion は file risk を作る前に行い、下流で absolute-path-shaped identifiers を作らせない。

## Unified Build Contract

Add:

```bash
bun run intelligence:build -- \
  --scan-run-id <scan-run-id> \
  --include-semantic false \
  --pretty true
```

Primary stages:

```text
validate_source
build_code_structure
normalize_paths
build_export
persist_generation
build_manifest
optional_semantic_index
```

Result:

```ts
type StaticIntelligenceBuildResult = {
  ok: true;
  status: "completed" | "partial";
  projectId: string;
  scanRunId: string;
  generationId: string;
  generatedAt: string;
  stages: Array<{
    name: string;
    status: "completed" | "degraded" | "skipped";
    reasonCodes: string[];
    durationMs: number;
  }>;
  artifacts: {
    structure: { id: string; sha256: string; snapshotRef: string };
    export: { id: string; sha256: string; exportHash: string };
  };
  readiness: StaticIntelligenceReadiness;
  degradedReasons: string[];
};
```

CLI rules:

- project path は browser / caller から受け取らず、scan の registered project から解決する。
- read-oriented CLI には optional `--generation-id` を追加し、指定時は exact persisted generation だけを返す。省略時だけ latest valid generation を解決する。
- stdout は JSON object 1 件だけにする。
- required stage が usable partial output を作った場合は exit `0` + status `partial`。
- invalid scan / ownership-independent local input は exit `2`。
- runtime / persistence failure は exit `1`。
- semantic provider unavailable は `include-semantic=true` の場合でも core generation を失わせず、stage degraded とする。
- old `intelligence:code-structure` と `intelligence:export --code-structure-snapshot` は low-level / compatibility path として残す。

## Browser API Contract

Add or update:

```http
GET /api/projects/intelligence-summaries
GET /api/projects/:projectId/intelligence?scanRunId=<optional>
GET /api/projects/:projectId/intelligence/structure?scanRunId=<required>&query=&tag=&status=&cursor=&limit=
GET /api/projects/:projectId/intelligence/structure/file?scanRunId=<required>&path=<relative-path>
GET /api/projects/:projectId/intelligence/ontology-handoff?scanRunId=<required>
POST /api/projects/:projectId/intelligence/refresh
```

Refresh body:

```ts
{
  scanRunId: string;
  includeSemantic?: boolean;
}
```

Refresh rules:

- authenticated owner の registered project と scan だけを対象にする。
- `scanRunId` が project に属することを server-side で確認する。
- arbitrary filesystem path を受け取らない。
- scanner、review、verification、report、context registration、task creation を実行しない。
- 同じ scan の concurrent refresh は `409 analysis_refresh_in_progress` にする。
- response は completed build result を返す。background queue はこの phase では追加しない。
- max file count と filesystem containment は extractor 既存 guard を使う。

Structure list rules:

- full snapshot を browser へ一括返却しない。
- default limit は `100`、maximum は `500`。
- file row は relative path、tags、language、parse status、import/export/package counts、risk summary だけを返す。
- contentHash は Source Health / advanced detail 以外では返さない。
- file detail は persisted snapshot 内の exact relative path を検索し、filesystem を読み直さない。

## MCP Contract

MCP tool names は変更しない。

Changes:

- `vuln_get_code_structure_snapshot` は live filesystem extraction をやめ、selected scan の latest valid persisted structure artifact を読む。
- manifest / evidence / verification / code structure read tools に optional `generationId` を追加する。指定時は exact generation を読み、存在しない、incomplete、scan mismatch の場合は structured failure を返す。
- persisted generation がない場合は `missing` failure/degraded result を返し、暗黙に refresh しない。
- manifest、evidence bundle、verification commands、code structure は同じ generation resolution service を使う。
- manifest に additive `readiness` / `generation` metadata を追加する。
- MCP server は refresh tool、scanner tool、verification execution tool を持たない。

Consumer pinning rules:

- coding agent / supervisor は planning 時に選んだ generationId を run context に固定する。
- run 中の read call は pinned generationId を渡す。
- latest valid generation が更新されても、既存 run は自動的に切り替えない。
- refresh 後の generation は次の planning / run で採用する。

## UI Information Architecture

### Project list

- one batch summary request を使う。
- card に risk、evidence、findings、code structure、generation freshness、last generated time を表示する。
- `stale` と `missing` を同じ表示にしない。
- card load failure を silent `null` にせず、project 単位の degraded status として表示する。

### Project Intelligence header

- page top に selected scan control を置く。
- profile、status、created/completed time、finding count を選択肢に表示する。
- `Latest` badge と historical selection を明確に分ける。
- URL `scanRunId` を source of truth にする。
- Refresh Analysis は selected scan に対する derived refresh だけを実行する。
- Open Scan Workspace は projectId / scanRunId を維持する。

### Readiness strip

次を `available / stale / degraded / missing / failed` で表示する。

```text
Scan Evidence
Code Structure
Evidence Graph
Semantic Index
Agent Bundle
Ontology Handoff
```

各 status は reason code と next action を持つ。raw internal error をそのまま表示しない。

### Inner navigation

長い一枚ページを次の section navigation に分ける。

```text
Overview | Structure | Risk & Evidence | Agent Context | Ontology Handoff | Source Health
```

router を深く増やす必要はない。phase first implementation は URL hash または local section state でよい。ただし selected scan は常に query string で維持する。

### Structure Explorer

左側:

- module candidate list
- path / tag / parse-status filter
- risk count / max severity

右側:

- selected module summary
- files
- entrypoints
- imports / imported-by adjacency
- exported symbols
- package dependencies
- related findings / evidence quality
- extractor degraded reasons

Rules:

- source code body は表示しない。
- graph canvas は使わない。
- large collection は pagination / limit を使う。
- tag には heuristic reason / confidence を併記できる model を用意する。

### Risk & Evidence

- Files table の row を選択可能にする。
- rule ids、finding ids、evidence refs、artifact-backed status、verification refs を detail panel に表示する。
- Evidence Graph は kind count に加え、selected node の incoming / outgoing adjacency list を表示する。
- finding -> evidence -> artifact -> file -> verification の関係を辿れるようにする。
- finding の真偽や decision は変更しない。編集操作は Scans に残す。

### Agent Context

- summary title / body だけでなく、result items、source refs、degraded reasons を表示する。
- verification mode では candidate command と関連 refs を表示する。
- export mode は raw JSON 全体を default 表示せず、bundle metadata と copy/download reference を表示する。
- evidence mode を UI に追加する場合は finding selection を必須にする。
- copy command は knowledge source manifest の command array から生成し、UI に手書きしない。

### Ontology Handoff

- canonical Ontology editor にしない。
- module candidates と構造/risk evidence の対応を表示する。
- sourceTreeHash、exportHash、snapshotRef、generationId を表示する。
- readiness を blocking / non-blocking reason に分ける。
- NightWorkers が pull する MCP tool / CLI command を copy できるようにする。
- consumer boundary として `vulnWorkbench does not own canonical ontology or task compilation` を表示する。

### Source Health

表示項目:

- generation status / generationId
- generatedAt
- sourceTreeHash
- sourceStateHash
- snapshotRef
- exportHash / manifest contentHash
- schema version
- semantic index status / indexed row count
- migration/schema readiness の generic status
- last refresh result and degraded reason codes
- manifest-derived CLI commands

表示しない項目:

- artifact absolute storage path
- registered project absolute root path
- provider secret / credential source detail
- raw stack trace

## Implementation Phases

### Phase 40.1: Request Stability and Load Consolidation

Files:

- `web/src/App.tsx`
- `web/src/domains/projects/projects-domain.tsx`
- `web/src/domains/projects/projects-domain.test.tsx`
- `web/src/api.ts`

Tasks:

- `runWithBusy` を stable `useCallback` にする。
- passive data-load effect から global busy wrapper を外す。
- list route と detail route の load effect を分離する。
- stale request result を捨てる cancellation / generation guard を追加する。
- project list は batch summary endpoint を一回だけ読む。
- detail route で project list 全体を毎回再取得しない。
- manual refresh / registration だけ global busy state を使う。

Acceptance:

- passive render 後に request count が収束する。
- state update が同じ endpoint の再取得を誘発しない。
- list と detail の error が互いを上書きしない。
- Project UI の通常利用で global rate limiter に到達しない。

Verification:

```bash
bunx vitest run web/src/domains/projects/projects-domain.test.tsx
bun run typecheck
```

Required tests:

- initial list render calls project list and summary once each。
- detail render calls one consistent view request。
- prop / busy state rerender does not refetch。
- route scanRunId change fetches exactly once for the new selection。
- stale response cannot replace a newer selection。

### Phase 40.2: Path Boundary and Command Contract

Files:

- add `api/modules/static-intelligence/path-boundary.ts`
- add `api/modules/static-intelligence/path-boundary.test.ts`
- update `api/modules/static-intelligence/file-risk-index.ts`
- add `api/modules/static-intelligence/file-risk-index.test.ts`
- update `api/modules/static-intelligence/evidence-graph.ts`
- update `api/modules/static-intelligence/community-builder.ts`
- update `api/modules/static-intelligence/agent-query.ts`
- update `api/modules/static-intelligence/knowledge-source-manifest.ts`
- update relevant tests under `api/modules/static-intelligence/`

Tasks:

- project-relative path conversion を一箇所に実装する。
- file risk grouping 前に path を normalize / redact する。
- graph IDs、community IDs、file refs、source refs、markdown を relative path から構築する。
- external path を `unknown` と structured degraded reason に変換する。
- Source Health command を manifest command array から描画する。
- shared `formatCommandTokens()` を追加し、CLI / manifest の token array から copy text を生成する。
- `--query-kind` の手書き command を削除し、CLI `--kind` contract と一致させる。

Acceptance:

- `/Users/`, `/home/`, Windows user root が agent-facing output に残らない。
- project 内 absolute input は relative POSIX path になる。
- project 外 path は identifier に埋め込まれない。
- current fixture redaction / stable hash guarantees が維持される。
- UI からコピーした command が current CLI parser で成功する。

Verification:

```bash
bun test api/modules/static-intelligence/path-boundary.test.ts
bun test api/modules/static-intelligence/file-risk-index.test.ts
bun test api/modules/static-intelligence/agent-query.test.ts
bun test api/modules/static-intelligence/knowledge-source-manifest.test.ts
bun run fixture:static-intelligence-source
```

### Phase 40.3: Persisted Generation Repository

Files:

- add `api/modules/static-intelligence/generation-types.ts`
- add `api/modules/static-intelligence/generation-repository.ts`
- add `api/modules/static-intelligence/generation-repository.test.ts`
- update `api/modules/scans/artifact-storage.ts`
- reuse `api/modules/scans/repositories.ts`
- update `api/modules/static-intelligence/repository.ts`
- update `api/modules/static-intelligence/export-builder.ts`
- update `api/modules/static-intelligence/evidence-graph.ts`
- update `shared/schemas/static-intelligence*.schema.ts`

Tasks:

- artifact kind / metadata schemas を追加する。
- sourceTreeHash / sourceStateHash builder を追加する。
- derived artifact kinds を diagnostic source bundle、graph、artifact count、sourceStateHash から除外する。
- generation pair write / load / parse / cleanup を実装する。
- latest valid generation resolver を実装する。
- corrupt / incomplete / mismatched artifact pair を active にしない。
- old valid generation を failure fallback として残す。

Acceptance:

- generated structure と export が process restart 後も読める。
- generationId が異なる structure / export を組み合わせない。
- projectId / scanRunId / rootRef mismatch を拒否する。
- failed replacement が前回 valid generation を消さない。
- generation を繰り返し作っても、過去の derived artifacts が finding evidence / artifact count / sourceStateHash を増やさない。
- 同じ summary count でも source bytes が違えば snapshotRef が変わる。
- artifact path は server boundary の外へ出ない。

Verification:

```bash
bun test api/modules/static-intelligence/generation-repository.test.ts
bun test api/modules/static-intelligence/code-structure/export-enrichment.test.ts
bun test api/modules/static-intelligence/export-builder.test.ts
```

### Phase 40.4: Unified Build Service and CLI

Files:

- add `api/modules/static-intelligence/build-service.ts`
- add `api/modules/static-intelligence/build-service.test.ts`
- add `api/cli/intelligence-build.ts`
- add `api/modules/static-intelligence/intelligence-build-cli.test.ts`
- update `package.json`
- update `api/modules/static-intelligence/knowledge-source-manifest.ts`

Tasks:

- build stages と structured stage result を実装する。
- registered scan から project path を server-side resolve する。
- structure、normalized export、manifest を同じ generation で作る。
- optional semantic indexing を non-blocking stage として接続する。
- persistence 前の schema parse と hash verification を行う。
- package script `intelligence:build` を追加する。
- current low-level CLI compatibility を維持する。

Acceptance:

- one command で reusable generation が作られる。
- stdout は JSON object 1 件だけである。
- partial structure / missing review は usable partial result になる。
- invalid scan、unreadable project、persistence failure の exit code が区別される。
- failed build 後も previous generation を読める。

Verification:

```bash
bun test api/modules/static-intelligence/build-service.test.ts
bun test api/modules/static-intelligence/intelligence-build-cli.test.ts
bun run intelligence:build -- --scan-run-id <fixture-scan-id> --pretty true
```

### Phase 40.5: Consistent Read Resolver and Browser API

Files:

- add `api/modules/static-intelligence/read-model-resolver.ts`
- add `api/modules/static-intelligence/read-model-resolver.test.ts`
- update `api/routes/static-intelligence.route.ts`
- update `api/routes/static-intelligence.route.test.ts`
- update `web/src/api.ts`

Tasks:

- UI / agent-query / manifest / MCP で共有する generation resolver を作る。
- resolver は optional exact generationId と latest-valid resolution の両方を扱う。
- selected scan resolution と project ownership/membership を一箇所に寄せる。
- latest usable scan selection helper を追加する。
- batch project summaries endpoint を追加する。
- one consistent Project Intelligence view envelope を返す。
- structure list / file detail / ontology handoff / refresh endpoints を追加する。
- missing generation の fallback は明示的 `missing` とし、GET request から filesystem extraction を行わない。

Acceptance:

- selected scan と export / readiness / degraded reasons が常に一致する。
- 別 project の owned scan を query に入れても現在 project の画面で表示できない。
- GET endpoint は derived artifacts を生成しない。
- one project card request が full export rebuild を発生させない。
- code structure endpoint は persisted snapshot を読む。
- exact generation read は別 generation の artifact を混在させない。

Verification:

```bash
bun test api/modules/static-intelligence/read-model-resolver.test.ts
bun test api/routes/static-intelligence.route.test.ts
```

### Phase 40.6: Scan Selection and Readiness UI

Files:

- update `web/src/domains/projects/projects-domain.tsx`
- add `web/src/domains/projects/project-intelligence-readiness.ts`
- add `web/src/domains/projects/project-intelligence-readiness.test.ts`
- update `web/src/domains/projects/project-intelligence-view-model.ts`
- update `web/src/styles-projects.css`
- update Scans link handling under `web/src/domains/scans/`

Tasks:

- selected scan control を page top に移す。
- latest / historical / degraded fallback を表示する。
- readiness strip と reason code copy を実装する。
- Refresh Analysis control を selected scan に接続する。
- refresh completion 後に一回だけ current view を reload する。
- Project Intelligence <-> Scans link で projectId / scanRunId を維持する。
- stale / degraded / missing / failed の色と copy を分ける。

Acceptance:

- historical selection の全 section が selected scan の値になる。
- current URL から同じ selection を再構成できる。
- refresh が scanner / review / verification を開始しない。
- refresh failure でも前の visible generation を維持する。
- Scans へ移動したとき同じ scan が選択される。

Verification:

```bash
bunx vitest run web/src/domains/projects/project-intelligence-readiness.test.ts
bunx vitest run web/src/domains/projects/project-intelligence-view-model.test.ts
bun run typecheck
```

### Phase 40.7: Structure Explorer and Module Candidates

Files:

- add `api/modules/static-intelligence/module-candidates.ts`
- add `api/modules/static-intelligence/module-candidates.test.ts`
- add `shared/schemas/static-intelligence-module.schema.ts`
- add components under `web/src/domains/projects/components/structure-explorer/`
- add view models and tests under `web/src/domains/projects/`
- update `web/src/styles-projects.css`

Tasks:

- deterministic module candidate projection を実装する。
- structure list pagination / filtering を実装する。
- module list + detail split view を追加する。
- file tags、parse state、imports、imported-by、exports、packages、risk refs を表示する。
- tag heuristic reason / confidence を view model に含める。
- missing/degraded snapshot の empty state と next action を表示する。

Acceptance:

- 利用者が top risk module から関連 file / finding / evidence へ辿れる。
- full source body を表示しない。
- 5000-file snapshot を一括 browser payload にしない。
- module candidate が canonical Ontology node として表示されない。
- every module candidate has deterministic id, pathPrefix, confidence, reasons。

Verification:

```bash
bun test api/modules/static-intelligence/module-candidates.test.ts
bunx vitest run web/src/domains/projects/structure-explorer-view-model.test.ts
bun run typecheck
```

### Phase 40.8: Evidence Drilldown and Agent Context

Files:

- add/update view models under `web/src/domains/projects/`
- add components under `web/src/domains/projects/components/evidence-explorer/`
- add components under `web/src/domains/projects/components/agent-context/`
- update `web/src/domains/projects/projects-domain.tsx`

Tasks:

- Files row selection と detail panel を追加する。
- graph selected node の incoming / outgoing adjacency を表示する。
- evidence / artifact / verification refs を関連付けて表示する。
- Agent Bundle preview に result items、source refs、candidate commands を追加する。
- command は manifest-derived token array から shell-safe display string を作る。
- raw JSON / raw artifact body は advanced metadata にも出さない。

Acceptance:

- count だけでなく、risk の根拠と verification candidate を説明できる。
- selected file と selected graph node が同じ scan generation に属する。
- agent context が candidate-only であることを明示する。
- evidence がない item は empty success ではなく degraded reason を表示する。

Verification:

```bash
bunx vitest run web/src/domains/projects/evidence-explorer-view-model.test.ts
bunx vitest run web/src/domains/projects/agent-context-view-model.test.ts
bun test api/modules/static-intelligence/agent-query.test.ts
```

### Phase 40.9: Ontology Handoff and Source Health

Files:

- add `api/modules/static-intelligence/ontology-handoff.ts`
- add `api/modules/static-intelligence/ontology-handoff.test.ts`
- update `api/modules/static-intelligence/mcp-tools.ts`
- update `api/modules/static-intelligence/mcp-tools.test.ts`
- update `api/modules/static-intelligence/knowledge-source-manifest.ts`
- add UI components under `web/src/domains/projects/components/ontology-handoff/`
- add/update Source Health components and tests

Tasks:

- Ontology handoff builder と readiness rules を実装する。
- persisted generation provenance を manifest に追加する。
- MCP code structure tool を persisted read path に切り替える。
- Source Health に generation/hash/schema/index readiness を表示する。
- NightWorkers pull command / MCP tool reference を表示する。
- consumer boundary と non-goals を UI に明示する。

Acceptance:

- UI / CLI / MCP が同じ generationId / snapshotRef / exportHash を示す。
- handoff は module candidates と evidence refs を含む。
- handoff は canonical domain / capability / task を生成しない。
- MCP call は repository filesystem を再走査せず、mutation を起こさない。
- stale generation を available と表示しない。

Verification:

```bash
bun test api/modules/static-intelligence/ontology-handoff.test.ts
bun test api/modules/static-intelligence/mcp-tools.test.ts
bun test api/modules/static-intelligence/knowledge-source-manifest.test.ts
bun run fixture:static-intelligence-source
```

### Phase 40.10: Documentation and Final Verification

Files:

- update `README.md`
- update `README.jp.md`
- update `spec/static-intelligence-layer-concept.md`
- update `spec/contextstill-static-intelligence-bridge-concept.md`
- update Phase 37 fixture contract if its expected payload changes
- update Phase 39 status / follow-up references where appropriate

Tasks:

- `intelligence:build` を primary generation command として記載する。
- low-level code structure / export commands の位置づけを説明する。
- persisted generation / refresh / freshness / Ontology handoff boundary を記載する。
- MCP remains read-only を明示する。
- browser E2E が Phase 40 completion gate ではないことを記載する。

Verification:

```bash
bun run bootstrap:check
bun run fixture:static-intelligence-source
bun run typecheck
bun run verify
```

Expected:

- migrations are current。
- fixture returns `ok: true`。
- typecheck / lint / format / tests / web build pass。
- unrelated dirty-tree changes are preserved。

## Test Strategy

Browser E2E / Playwright suite は追加しない。

Required layers:

| Layer | Responsibility |
| --- | --- |
| pure unit | path boundary, hash, freshness, module projection, readiness |
| repository integration | artifact pair persistence, rollback, latest valid generation |
| route tests | ownership, project/scan membership, pagination, refresh boundary |
| component/view-model tests | request convergence, scan consistency, explorer selection, copy commands |
| existing fixture | CLI/MCP parity, redaction, deterministic hashes, candidate-only contract |
| repo gate | typecheck, lint, format, full tests, build |

No browser E2E means request-loop regression を無検証にしてよいという意味ではない。component test で mocked request count と rerender behavior を直接検証する。

## Compatibility and Migration

- schema migration は新規 snapshot table のためには追加しない。
- current pending migrations は implementation 前に適用し、`bootstrap:check` を baseline gate とする。
- old scan に persisted generation がない場合、Project UI は `missing` と refresh action を表示する。
- GET / MCP は old scan を暗黙 refresh しない。
- existing `intelligence:code-structure`、`intelligence:export`、`intelligence:agent-query` command は残す。
- manifest commands は token array を source of truth とし、README / UI で別々に組み立てない。
- additive readiness / generation fields で existing manifest v1 consumers を壊さない。breaking schema change が必要になった場合だけ version bump を別 phase とする。

## Performance Constraints

- project list は project count に比例する browser request fan-out を作らない。
- Project Intelligence GET は source parse / full filesystem scan / artifact write を行わない。registered project に対する bounded git revision probe だけを freshness check として許可する。
- full snapshot は browser へ一括返却しない。
- structure list default `100` / max `500`。
- extractor current `maxFiles` hard limit `20000` を維持する。
- module projection は file + edge count に対して linear または `O(n log n)` に収める。
- hash comparison だけで freshness を判定できる場合、payload body を再parseしない metadata fast path を許可する。

## Security and Privacy Checklist

- [ ] browser request cannot pass arbitrary project path.
- [ ] refresh resolves project path only from owned project + scan.
- [ ] project-relative path conversion happens before graph/community/source-ref construction.
- [ ] private absolute paths are absent from UI / CLI / MCP / markdown.
- [ ] artifact storage paths remain server-side.
- [ ] raw source body and arbitrary string literals are not emitted.
- [ ] source snippets and raw artifact bodies are not added to explorer payloads.
- [ ] code structure facts do not become confirmed findings.
- [ ] selected scan must belong to route project.
- [ ] MCP remains read-only.
- [ ] Ontology handoff does not mutate NightWorkers or contextStill.
- [ ] refresh cannot execute verification commands.

## Review Checklist

- [ ] request loop is fixed at the effect/function identity boundary.
- [ ] project list uses one summary request.
- [ ] selected scan is the source of truth for all visible sections.
- [ ] latest and historical context are not mixed.
- [ ] structure/export generation is persisted and versioned.
- [ ] UI/CLI/MCP resolve the same generation.
- [ ] stale generation is distinguishable from missing/degraded.
- [ ] path redaction covers IDs and refs, not only visible labels.
- [ ] copied commands come from manifest tokens and run successfully.
- [ ] Structure Explorer uses persisted facts and bounded payloads.
- [ ] Evidence Graph supports adjacency drilldown without graph canvas.
- [ ] Agent Context shows actual candidate items/refs/commands.
- [ ] Ontology Handoff is evidence-backed and non-canonical.
- [ ] Source Health exposes freshness and provenance without private paths.
- [ ] tests do not depend on browser E2E.
- [ ] existing Static Intelligence fixture remains green.
- [ ] `bun run verify` passes.

## Stop Conditions

- A GET or MCP tool starts filesystem extraction or writes derived state.
- Project Intelligence refresh starts scanners, review, verification, report generation, context registration, task creation, or patching.
- structure artifact and export artifact from different generation IDs are combined.
- a failed generation replaces the last valid generation.
- absolute user-home paths remain in any agent-facing identifier or ref.
- full source body or raw artifact body is required for the UI.
- module candidate is presented as canonical Ontology truth.
- NightWorkers or contextStill must read vulnWorkbench SQLite directly.
- browser E2E becomes required to prove core contracts that can be tested deterministically below the browser layer.
- unrelated dirty-tree changes must be overwritten to complete the phase.

## Completion Definition

Phase 40 is complete when:

- Projects UI request count converges and normal navigation cannot self-trigger rate limiting.
- project list loads intelligence summaries without per-card full export rebuilds.
- all Static Intelligence paths are project-relative or redacted before IDs/refs are created.
- one `intelligence:build` command creates a persisted, versioned structure + export generation.
- Project UI, CLI, manifest, and MCP report the same generationId / snapshotRef / exportHash.
- selected scan controls every visible summary, degraded reason, explorer, and link.
- Structure Explorer exposes modules, files, tags, imports, exports, packages, risks, and degraded reasons without source bodies.
- Risk & Evidence explains finding/evidence/artifact/verification relationships beyond aggregate counts.
- Agent Context shows actual candidate items, source refs, and candidate commands.
- Ontology Handoff provides evidence-backed module candidates and provenance while leaving canonical Ontology / Task Compiler ownership to NightWorkers.
- Source Health distinguishes available, stale, degraded, missing, and failed states.
- deterministic unit, repository, route, component, fixture, and repo verification gates pass without adding browser E2E.
