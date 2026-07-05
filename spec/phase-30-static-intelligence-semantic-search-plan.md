# Phase 30: Static Intelligence Semantic Search Plan

## Purpose

この計画は、Phase 29 の Static Intelligence Export を土台に、finding / evidence / review / file risk summary を semantic search できるようにする。

到達点は次の 2 本に絞る。

```text
StaticIntelligenceExportV1
  -> sanitized embedding source documents
  -> sqlite-vec backed embedding index

natural language query
  -> query embedding
  -> vector search + exact filters
  -> source refs / evidence refs 付き risk candidates
```

この phase は、脆弱性を確定する検出器を作るものではない。semantic similarity は candidate signal であり、confirmed finding の根拠にはしない。

## Product Boundary

vulnWorkbench が担当すること:

- Phase 29 export から embedding source を作る。
- embedding source を stale 判定可能な形で DB に保存する。
- embedding model で vector を生成する。
- sqlite-vec の `vec_distance_cosine` で semantic search する。
- exact filter と vector result を統合して candidate を返す。
- source refs / evidence refs / finding ids を保持する。

vulnWorkbench が担当しないこと:

- vector similarity だけで confirmed finding を作る。
- severity や true positive を distance だけで決める。
- raw source code 全文を RAG 化する。
- raw scanner artifact 全文を embedding 化する。
- secret value を embedding input に含める。
- Risk Community / Security Landscape を作る。
- LSP enrichment を入れる。
- MCP server を作る。

## Prerequisites

Phase 29 が次を提供している前提で進める。

- `shared/schemas/static-intelligence.schema.ts`
  - `staticIntelligenceExportV1Schema`
  - `StaticIntelligenceExportV1`
  - `FileRiskIndexEntry`
  - `DiagnosticEvidenceGraph`
- `api/modules/static-intelligence/repository.ts`
  - `StaticIntelligenceRepository`
  - `loadSourceBundle(scanRunId)`
- `api/modules/static-intelligence/export-builder.ts`
  - Static Intelligence Export v1 を作る builder
- `api/cli/intelligence-export.ts`
  - `bun run intelligence:export -- --scan-run-id <scan-run-id>`

Phase 29 の実装で名前が変わった場合は、この phase の実装時に計画書ではなく import 名を合わせる。責務は変えない。

## Current Code Anchors

既存で参考にする実装:

- `api/db/index.ts`
  - `sqliteVec.load(sqlite)` で sqlite-vec をロード済み。
- `api/db/schema.ts`
  - `EMBEDDING_DIMENSIONS = 1536`
  - `sourceFragments.embedding` の `blob("embedding", { mode: "buffer" })`
- `api/modules/sources/source.repository.ts`
  - `embeddingToBlob`
  - `ensureEmbeddingShape`
  - `createEmbeddingForContent`
  - `vectorSearchSourceContent`
  - `vec_distance_cosine`
  - text search helper patterns
- `api/providers/types.ts`
  - `EmbeddingProvider`
- `api/providers/AzureOpenAiProvider.ts`
  - `createEmbedding(input)`
- `api/providers/azureOpenAiProviderFactory.ts`
  - `createAzureOpenAiProviderFromAppEnv(env)`
- `scripts/bootstrap-check.ts`
  - `select vec_version() as version` smoke check
- `api/cli/report-scan.ts`
  - CLI JSON output / DB close / failure handling pattern

新設候補:

- `shared/schemas/static-intelligence-search.schema.ts`
- `api/modules/static-intelligence/embedding-source-builder.ts`
- `api/modules/static-intelligence/embedding-repository.ts`
- `api/modules/static-intelligence/embedding-indexer.ts`
- `api/modules/static-intelligence/semantic-query.ts`
- `api/modules/static-intelligence/semantic-search.test.ts`
- `api/cli/intelligence-index.ts`
- `api/cli/intelligence-query.ts`

既存ファイルへの変更候補:

- `api/db/schema.ts`
  - `staticIntelligenceEmbeddings` table を追加。
- `drizzle/0013_static_intelligence_embeddings.sql`
  - table / indexes を追加。
- `package.json`
  - `intelligence:index`
  - `intelligence:query`

## Data Model

新規 table: `static_intelligence_embeddings`

Drizzle shape:

```ts
export const staticIntelligenceEmbeddings = sqliteTable(
  "static_intelligence_embeddings",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    scanRunId: text("scan_run_id").notNull().references(() => scanRuns.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDim: integer("embedding_dim").notNull(),
    metadata: jsonObject("metadata"),
    indexedAt: timestampMs("indexed_at"),
    createdAt: timestampMs("created_at"),
    updatedAt: timestampMs("updated_at"),
  },
  (table) => ({
    scanRunIdx: index("static_intel_embed_scan_run_idx").on(table.scanRunId),
    projectIdx: index("static_intel_embed_project_idx").on(table.projectId),
    sourceIdx: index("static_intel_embed_source_idx").on(table.sourceKind, table.sourceId),
    contentHashIdx: index("static_intel_embed_hash_idx").on(table.contentHash),
    uniqueSourceIdx: uniqueIndex("static_intel_embed_source_unique_idx").on(
      table.scanRunId,
      table.sourceKind,
      table.sourceId,
    ),
  }),
);
```

SQL migration:

- add `drizzle/0013_static_intelligence_embeddings.sql`
- include table creation
- include indexes
- include unique index on `(scan_run_id, source_kind, source_id)`
- keep `content_hash` as a normal indexed column for stale detection

Migration verification:

```bash
bun run db:migrate
bun run bootstrap:check -- --skip-port
```

Expected:

- migration applies once.
- `sqlite-vec` check still reports loaded.
- DB opens with new table available.

## Source Kinds

Initial source kinds:

```text
finding
evidence
scan_review
improvement_request
file_risk_summary
```

Do not add raw source code or raw artifact source kinds in this phase.

## Source Identity Rules

Each embedding source must have a stable `sourceId` and a readable `sourceRef`.

Rules:

| sourceKind | sourceId | sourceRef |
| --- | --- | --- |
| `finding` | finding id | `finding:<findingId>` |
| `evidence` | evidence id | `evidence:<evidenceId>` |
| `scan_review` | scan review id | `scan_review:<reviewId>` |
| `improvement_request` | scan review id | `improvement_request:<reviewId>` |
| `file_risk_summary` | normalized file path | `file:<normalizedPath>` |

If the file path is unknown, use `unknown` as the file path and include a degraded reason in metadata. Do not generate random source ids for embedding sources.

## Embedding Source Builder

Add `api/modules/static-intelligence/embedding-source-builder.ts`.

Input:

- `StaticIntelligenceExportV1`
- Phase 29 `StaticIntelligenceSourceBundle` when needed for review/finding text

Output:

```ts
type StaticIntelligenceEmbeddingSource = {
  projectId: string;
  scanRunId: string;
  sourceKind:
    | "finding"
    | "evidence"
    | "scan_review"
    | "improvement_request"
    | "file_risk_summary";
  sourceId: string;
  sourceRef: string;
  title: string;
  content: string;
  contentHash: string;
  metadata: {
    findingIds?: string[];
    evidenceRefs?: string[];
    artifactRefs?: string[];
    filePath?: string;
    severity?: string;
    ruleId?: string;
    scanner?: string;
    candidateOnly: true;
  };
};
```

Content rules:

- `finding`
  - include title, description, source tool, rule id, severity, normalized file path.
  - do not include evidence snippet.
- `evidence`
  - include evidence title, kind, location path/file, finding id.
  - do not include `FindingEvidence.snippet`.
- `scan_review`
  - include scan review summary / risk overview / coverage notes if available.
  - do not include raw prompt or raw artifact.
- `improvement_request`
  - include handoff title, objective, acceptance criteria, verification commands, constraints, non-goals.
  - keep as request context, not confirmed vulnerability.
- `file_risk_summary`
  - include path, finding count, max severity, evidence quality, scanners, rule ids.

Hash rules:

- `contentHash = sha256(sourceKind + "\n" + sourceId + "\n" + content)`
- Reindex is required when content hash changes for the same `(scanRunId, sourceKind, sourceId)`.
- Reindex replaces the existing row for the same source identity. Do not accumulate old rows for stale content.

Sorting rules:

- sources sorted by `sourceKind`, then `sourceRef`.
- generated content is deterministic.

## Embedding Provider

Use existing `EmbeddingProvider` interface.

Initial CLI provider path:

- read env via `readAppEnv()`
- create provider with `createAzureOpenAiProviderFromAppEnv(env)`
- use `provider.createEmbedding(content)`
- record `embeddingModel` from `env.azureOpenAiEmbeddingsDeployment`

Do not add provider routing in this phase.

Failure behavior:

- provider missing/config invalid -> CLI exits with code `2` and JSON failure.
- provider execution failure -> CLI exits with code `1` and JSON failure.
- partial indexing is allowed only if recorded in output; default should fail the command before reporting completed.

Embedding shape:

- expected dimension: `EMBEDDING_DIMENSIONS`
- invalid dimension or non-finite values fail indexing.
- store vector as `Buffer.from(new Float32Array(embedding).buffer)`.

## Indexing CLI

Add CLI:

```bash
bun run intelligence:index -- --scan-run-id <scan-run-id>
```

Options:

```text
--scan-run-id <uuid> required
--force true|false optional, default false
--limit <number> optional
```

Behavior:

1. load Phase 29 export/source bundle for scan run.
2. build sanitized embedding sources.
3. compare `(scanRunId, sourceKind, sourceId)` against existing rows.
4. skip existing rows unless `--force true`.
5. treat a row as stale when the stored `contentHash`, `embeddingModel`, or `embeddingDim` differs.
6. upsert rows with embedding blob and metadata.
7. delete or replace rows for source identities that no longer exist in the rebuilt source set.
8. print JSON result to stdout.

Success output:

```json
{
  "ok": true,
  "status": "completed",
  "scanRunId": "...",
  "indexed": 12,
  "skipped": 4,
  "staleReplaced": 2,
  "deleted": 1,
  "embeddingModel": "text-embedding-3-small",
  "embeddingDim": 1536
}
```

Invalid input output:

```json
{
  "ok": false,
  "status": "failed",
  "message": "Missing required argument: --scan-run-id is required."
}
```

stdout:

- JSON object 1 件のみ。

stderr:

- progress
- provider diagnostics
- degraded warnings

Exit code:

| Code | Meaning |
| ---: | --- |
| 0 | indexing completed |
| 1 | runtime / provider / DB failure |
| 2 | invalid argument, missing scan run, missing provider config |

Package script:

```json
"intelligence:index": "bun run api/cli/intelligence-index.ts"
```

## Query CLI

Add CLI:

```bash
bun run intelligence:query -- \
  --scan-run-id <scan-run-id> \
  --query "auth 周りの入力検証と認可境界のリスク"
```

Options:

```text
--scan-run-id <uuid> required for Phase 30
--query <text> required
--top-k <number> optional, default 10
--source-kind <csv> optional
--file <path> optional exact filter
--rule-id <ruleId> optional exact filter
--scanner <scanner> optional exact filter
```

Behavior:

1. validate query and scan run id.
2. create query embedding.
3. run vector search over indexed rows for the scan run.
4. apply exact filters when provided.
5. merge vector score and exact match signals.
6. return candidate results with refs.

If no indexed rows exist for the scan run, return `ok: true`, `status: "completed"`, and an empty `results` array with a `degradedReasons` entry. Do not silently trigger indexing from the query command.

Output shape:

```ts
type StaticIntelligenceSemanticQueryResult = {
  ok: true;
  status: "completed";
  scanRunId: string;
  query: string;
  topK: number;
  results: Array<{
    id: string;
    sourceKind: string;
    sourceId: string;
    sourceRef: string;
    title: string;
    score: number;
    vectorScore: number;
    exactScore: number;
    candidateOnly: true;
    relatedFindingIds: string[];
    evidenceRefs: string[];
    artifactRefs: string[];
    filePath?: string;
    metadata: Record<string, unknown>;
  }>;
  degradedReasons: string[];
};
```

Score rules:

- `vectorScore = 1 - vec_distance_cosine(...)`
- `exactScore` is additive and small:
  - file path exact match: `0.20`
  - rule id exact match: `0.20`
  - scanner exact match: `0.10`
  - query term present in title/content: up to `0.10`
- `score = vectorScore + exactScore`
- Always return `candidateOnly: true`.

Package script:

```json
"intelligence:query": "bun run api/cli/intelligence-query.ts"
```

## Repository and Search Implementation

Add `api/modules/static-intelligence/embedding-repository.ts`.

Responsibilities:

- upsert embedding source rows.
- list existing rows by `(scanRunId, sourceKind, sourceId)`.
- replace stale rows when content hash, model, or dimension changes.
- delete rows whose source identity no longer appears in the rebuilt source set.
- vector search by scan run.
- exact filter search by metadata/title/content.

Use patterns from `SourceRepository`:

- `embeddingToBlob`
- `ensureEmbeddingShape`
- `vec_distance_cosine`
- deterministic ordering

Add `api/modules/static-intelligence/embedding-indexer.ts`.

Responsibilities:

- orchestrate source building and embedding provider calls.
- skip unchanged sources.
- record indexed/skipped/stale counts.

Add `api/modules/static-intelligence/semantic-query.ts`.

Responsibilities:

- create query embedding.
- run vector search.
- compute exact scores.
- shape query result.

## Shared Schemas

Add `shared/schemas/static-intelligence-search.schema.ts`.

Include:

- `staticIntelligenceEmbeddingSourceKindSchema`
- `staticIntelligenceEmbeddingIndexResultSchema`
- `staticIntelligenceSemanticQueryResultSchema`
- `staticIntelligenceSemanticQueryResultItemSchema`

CLI outputs should validate against these schemas before writing success JSON.

## Tests

Add `api/modules/static-intelligence/semantic-search.test.ts`.

Minimum test cases:

1. source builder excludes raw snippets
   - seed export/source bundle with secret-like evidence snippet.
   - generated embedding source content does not include snippet.

2. deterministic source generation
   - repeated source build returns same order and same content hashes.

3. stale detection
   - same source and same content hash is skipped.
   - changed content hash is reindexed/replaced.
   - changed embedding model or dimension is reindexed/replaced.
   - source identities missing from the rebuilt source set are deleted.

4. embedding shape validation
   - valid 1536-length embedding passes.
   - wrong dimension fails.
   - non-finite number fails.

5. sqlite-vec smoke search
   - insert two rows with deterministic fake vectors.
   - query vector returns expected nearest row using `vec_distance_cosine`.

6. hybrid filters
   - `--file` or repository-level file filter boosts/filters expected row.
   - source refs and evidence refs are preserved.

7. candidate-only guarantee
   - every result has `candidateOnly: true`.
   - no result field claims confirmed vulnerability.

8. empty index query
   - query against a scan run with no indexed rows returns empty results.
   - output includes a degraded reason instead of auto-indexing.

Optional CLI tests:

- If test DB/provider helpers are cheap, add CLI smoke for invalid args.
- Otherwise verify CLI manually with the commands below.

## Verification Commands

After implementation:

```bash
bun run db:migrate
bun run bootstrap:check -- --skip-port
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

Manual index smoke:

```bash
bun run intelligence:index -- --scan-run-id <existing-scan-run-id>
```

Expected:

- stdout is JSON.
- `ok` is `true`.
- `indexed + skipped + staleReplaced` is greater than or equal to 0.
- embedding dimension is `1536`.

Manual query smoke:

```bash
bun run intelligence:query -- \
  --scan-run-id <existing-scan-run-id> \
  --query "auth 周りの入力検証と認可境界のリスク" \
  --top-k 5
```

Expected:

- stdout is JSON.
- `ok` is `true`.
- `results` is an array.
- every result has `candidateOnly: true`.
- each result has `sourceRef` and provenance metadata.
- if no rows are indexed, `results` is empty and `degradedReasons` explains the missing index.

sqlite-vec direct smoke:

```sql
select vec_version() as version;
```

Expected:

- returns a version string.

## Failure Handling

Invalid scan run:

- exit code `2`
- JSON failure

Missing embedding provider config:

- exit code `2`
- JSON failure
- no partial completed output

Provider execution failure:

- exit code `1`
- JSON failure
- partial rows should not be reported as completed

Vector search unavailable:

- exit code `1`
- JSON failure
- do not silently fall back to text-only and call it semantic search

Secret leakage in test:

- stop implementation
- fix source builder exclusion/redaction before continuing

## Stop Conditions

Stop and revise the plan if any of these happen:

- semantic similarity is used as confirmed vulnerability evidence.
- exact identifier search is replaced by vector search.
- raw source code or raw artifact content is embedded.
- `FindingEvidence.snippet` enters embedding content.
- migration cannot be applied and verified.
- sqlite-vec search only exists in schema but no query path calls `vec_distance_cosine`.
- indexing works but query cannot retrieve source refs.
- query command auto-indexes instead of reporting missing index state.
- CLI stdout includes progress logs.

## Completion Definition

Phase 30 is complete when:

```bash
bun run intelligence:index -- --scan-run-id <scan-run-id>
bun run intelligence:query -- --scan-run-id <scan-run-id> --query "<query>"
```

both return valid JSON, query results are candidate-only and provenance-backed, and the verification command set passes.

Confirmed finding creation, Risk Community, Security Landscape, LSP enrichment, and MCP tool implementation are not part of this phase.
