# Phase 33: Static Intelligence Semantic Community Integration Plan

## Purpose

この計画は、Phase 30 の semantic search 結果を Phase 31 の Risk Community に接続し、Phase 32 の Agent Query から `semantic` basis を持つ community を参照できるようにする。

到達点は次の 1 本に絞る。

```text
Agent Query request
  -> Phase 29 StaticIntelligenceExportV1
  -> Phase 30 semantic query, only when requested
  -> semantic result -> SemanticRiskCommunityCandidate[]
  -> Phase 31 buildRiskCommunities(export, { semanticCandidates })
  -> candidate-only community / query result JSON
```

この phase は semantic similarity を検出器に昇格させない。semantic community は review focus を探すための候補であり、finding の confirm / dismiss、severity 引き上げ、risk band 引き上げには使わない。

## Product Boundary

vulnWorkbench が担当すること:

- Phase 30 semantic query result を Phase 31 community builder の `semanticCandidates` に変換する。
- `includeSemantic: true` かつ `includeCommunities: true` の Agent Query で semantic community を含める。
- semantic-only community の confidence を必ず `low` のままにする。
- semantic enrichment が使えない場合も exact / graph community を返し、`degradedReasons` に理由を入れる。
- semantic community から finding / evidence / artifact / file refs に戻れるようにする。
- query-only の `risk_context` / `related_findings` でも semantic community を result item として返せるようにする。
- 既存の `intelligence:query`、`intelligence:communities`、`intelligence:landscape` の契約を壊さない。

vulnWorkbench が担当しないこと:

- semantic similarity だけで vulnerability を確定する。
- semantic similarity だけで severity / risk band / review status を変更する。
- `intelligence:communities` CLI に embedding provider や free text query を追加する。
- DB migration を追加する。
- cross scan trend を永続化する。
- Project Ontology、task graph、queue admission、patch planning を作る。
- raw source snippet、raw artifact body、secret value を semantic community に含める。

## Prerequisites

Required:

- Phase 29 が完了していること。
- Phase 30 が完了していること。
- Phase 31 が完了していること。
- Phase 32 が完了していること。

Existing anchors:

- `api/modules/static-intelligence/export-builder.ts`
  - `buildStaticIntelligenceExport(db, scanRunId)`
- `api/modules/static-intelligence/semantic-query.ts`
  - `runStaticIntelligenceSemanticQuery(...)`
- `api/modules/static-intelligence/community-builder.ts`
  - `buildRiskCommunities(exportPayload, options)`
  - `SemanticRiskCommunityCandidate`
- `api/modules/static-intelligence/agent-query.ts`
  - `runStaticIntelligenceAgentQuery(...)`
- `shared/schemas/static-intelligence-search.schema.ts`
  - `StaticIntelligenceSemanticQueryResult`
  - `StaticIntelligenceSemanticQueryResultItem`
- `shared/schemas/static-intelligence-landscape.schema.ts`
  - `RiskCommunity`

No DB migration is required.

## Current Gap

現在の Phase 31 community builder は `semanticCandidates` を受け取れる。

```ts
buildRiskCommunities(exportPayload, {
  semanticCandidates,
});
```

しかし、Phase 30 の `StaticIntelligenceSemanticQueryResult` から `SemanticRiskCommunityCandidate[]` を作る正式な変換経路がない。Phase 32 の Agent Query も semantic result と community result を別々に扱っており、semantic result を community generation に渡していない。

Phase 33 はこの接続だけを追加する。

## Design Decisions

### Primary Integration Path

semantic community integration は `agent-query` 側に実装する。

理由:

- Agent Query はすでに `query`、`includeSemantic`、`includeCommunities`、`semanticProvider` を持っている。
- `intelligence:communities` CLI は scan-run-id だけで動く exact / graph community の安定した入口として残す方がよい。
- semantic query は free text query と embedding provider が必要なので、community-only CLI に混ぜると CLI contract が重くなる。

### CLI Policy

`intelligence:communities` には `--include-semantic` を追加しない。

semantic community を CLI から使う場合は `intelligence:agent-query` を使う。

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind risk_context \
  --query "auth bypass around session validation" \
  --include-semantic true \
  --include-communities true
```

### Confidence Policy

- semantic-only community confidence is always `low`.
- semantic basis can merge with exact / graph community when finding sets match.
- merged community may keep exact / graph confidence, but the result must still show `basis` includes `semantic`.
- semantic community must keep `candidateOnly: true`.
- semantic result must not change `scanSummary.riskBand`, `landscape.risk.band`, or finding severity.

### Threshold Policy

Semantic result items are eligible only when:

- `candidateOnly === true`
- `relatedFindingIds.length > 0`
- all accepted finding ids exist in the Phase 29 export
- `vectorScore >= minVectorScore`

Default thresholds:

```ts
type SemanticCommunityIntegrationOptions = {
  minVectorScore?: number; // default 0.65
  maxSemanticItems?: number; // default 10
  maxSemanticCommunities?: number; // default 5
};
```

If all semantic results are filtered out, exact / graph communities still return and `degradedReasons` includes:

```text
semantic community candidates did not meet confidence threshold
```

## Implementation Files

Add:

- `api/modules/static-intelligence/semantic-community-integration.ts`
- `api/modules/static-intelligence/semantic-community-integration.test.ts`

Modify:

- `api/modules/static-intelligence/agent-query.ts`
- `api/modules/static-intelligence/agent-query.test.ts`
- `api/modules/static-intelligence/intelligence-agent-query-cli.test.ts`

Do not modify:

- `api/cli/intelligence-communities.ts`
- `api/cli/intelligence-landscape.ts`
- `api/modules/static-intelligence/semantic-query.ts`
- DB schema / migrations

Only modify the do-not-modify list if a test proves the existing contract is impossible to preserve.

## New Module

Add `api/modules/static-intelligence/semantic-community-integration.ts`.

### Public API

```ts
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceSemanticQueryResult } from "../../../shared/schemas/static-intelligence-search.schema";
import type { SemanticRiskCommunityCandidate } from "./community-builder";

export type SemanticCommunityIntegrationOptions = {
  minVectorScore?: number;
  maxSemanticItems?: number;
  maxSemanticCommunities?: number;
};

export type SemanticCommunityIntegrationResult = {
  semanticCandidates: SemanticRiskCommunityCandidate[];
  semanticFindingIds: string[];
  degradedReasons: string[];
};

export function buildSemanticCommunityCandidates(params: {
  exportPayload: StaticIntelligenceExportV1;
  semantic: StaticIntelligenceSemanticQueryResult;
  options?: SemanticCommunityIntegrationOptions;
}): SemanticCommunityIntegrationResult;
```

### Candidate Construction Rules

Build two candidate shapes.

1. Query cluster
   - Take eligible semantic result items up to `maxSemanticItems`.
   - Union their `relatedFindingIds`.
   - If the union has at least 2 known finding ids, emit one candidate.
   - Stable key:

```text
semantic-query:<sha256(semantic.query + "\0" + sortedFindingIds.join("\0"))>
```

2. Source clusters
   - For each eligible semantic result item whose `relatedFindingIds` has at least 2 known finding ids, emit one candidate.
   - Stable key:

```text
semantic-source:<semanticItem.id>
```

After creating both shapes:

- de-duplicate by sorted finding id set.
- sort by largest finding count, then stable key.
- cap to `maxSemanticCommunities`.
- include `evidenceRefs`, `artifactRefs`, and `fileRefs` from semantic result metadata.
- include `degradedReasons` for unknown finding refs or threshold filtering.

### Known Finding Guard

Build a known finding id set from `exportPayload.graph.nodes`.

```ts
const knownFindingIds = new Set(
  exportPayload.graph.nodes
    .filter((node) => node.kind === "finding" && node.sourceId)
    .map((node) => node.sourceId as string),
);
```

If a semantic item references a finding id outside the export:

- do not include that unknown id.
- add degraded reason:

```text
semantic community candidate referenced unknown finding
```

If a candidate has fewer than 2 known finding ids after filtering:

- do not emit that candidate.

### File Refs

Use semantic item `filePath` when present.

Also infer file refs from `exportPayload.fileRiskIndex` for accepted finding ids.

```ts
for each fileRiskIndex entry:
  if entry.findingIds intersects candidate findingIds:
    include entry.path
```

### Source Refs

The `SemanticRiskCommunityCandidate` type does not have `sourceRefs`. Keep source trace through:

- `findingIds`
- `evidenceRefs`
- `artifactRefs`
- `fileRefs`
- `degradedReasons`

Do not add a new schema field unless tests show that existing refs are insufficient.

## Agent Query Integration

Modify `api/modules/static-intelligence/agent-query.ts`.

Current flow:

```text
build export
optionally run semantic query
buildRiskCommunities(exportPayload)
build landscape
route query
```

Target flow:

```text
build export
optionally run semantic query
if semantic exists:
  semanticIntegration = buildSemanticCommunityCandidates(exportPayload, semantic)
  degradedReasons += semanticIntegration.degradedReasons
buildRiskCommunities(exportPayload, {
  semanticCandidates: semanticIntegration.semanticCandidates
})
build landscape
route query
```

Only pass semantic candidates when semantic query succeeded.

If semantic query returns degraded empty result:

- pass no semantic candidates.
- preserve semantic degraded reasons.
- exact / graph communities still return if requested.

If semantic query throws:

- preserve current behavior:
  - add `semantic enrichment unavailable: <message>`
  - continue without semantic candidates

## Query Routing Changes

### `risk_context`

Current behavior already includes:

- exact file risk entries
- exact findings
- intersecting communities
- semantic candidate items

Add behavior:

- if `input.query` exists and semantic communities exist, include semantic community items even when there are no exact finding matches.
- source basis for these items should remain `community` item metadata with `basis` containing `semantic`.
- summary may say semantic community candidates were included, but must keep `candidateOnly: true`.

### `related_findings`

Add behavior:

- if `input.query` exists and semantic communities exist, include findings from semantic community `findingIds`.
- include the semantic community item itself.
- do not include duplicate finding items.
- do not include the requested seed finding as a related finding.

### `project_overview`

No special route change is required.

If `includeSemantic` and `includeCommunities` are both true, the community bundle can include semantic communities. Overview may list them through existing community item rendering.

## CLI Behavior

`intelligence:agent-query` already supports:

```text
--include-semantic true|false
--include-communities true|false
--query <text>
```

Expected semantic community CLI behavior:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind risk_context \
  --query "deserialization risk in upload path" \
  --include-semantic true \
  --include-communities true
```

Expected success:

- stdout is one JSON object.
- `ok: true`.
- `bundles.semantic` exists when semantic query succeeds.
- `bundles.communities` includes at least one community with `basis` containing `semantic` when eligible semantic results map to 2 or more known findings.
- every semantic community has `candidateOnly: true`.
- semantic-only community has `confidence: "low"`.
- no raw snippet or artifact body appears in stdout.

Expected degraded success:

- if index is empty, return exact / graph results and degraded reason from semantic query.
- if provider is missing while indexed rows exist, return exact / graph results and `semantic enrichment unavailable: ...`.
- if semantic results do not meet threshold, return exact / graph results and `semantic community candidates did not meet confidence threshold`.

No change:

```bash
bun run intelligence:communities -- --scan-run-id <scan-run-id>
```

This remains exact / graph only.

## Tests

### New Unit Tests

Add `api/modules/static-intelligence/semantic-community-integration.test.ts`.

Test cases:

1. query cluster from multiple semantic items
   - seed export with 2 findings.
   - build semantic result with two items referencing different findings.
   - expect one candidate with both finding ids.
   - expect file refs and evidence refs preserved.

2. source cluster from one semantic item with multiple findings
   - semantic item has `relatedFindingIds` with 2 known ids.
   - expect a source-level semantic candidate.

3. threshold filtering
   - semantic item has `vectorScore` below default threshold.
   - expect no candidate.
   - expect degraded reason.

4. unknown finding guard
   - semantic item references one known id and one unknown id.
   - unknown id is removed.
   - candidate is not emitted if fewer than 2 known ids remain.
   - degraded reason is present.

5. deterministic output
   - same input produces equal output.
   - candidates are sorted and de-duplicated.

6. no raw content
   - semantic item metadata contains no raw snippet in output.
   - candidate only carries refs.

### Agent Query Tests

Update `api/modules/static-intelligence/agent-query.test.ts`.

Add:

1. risk context includes semantic community
   - seed scan with two findings.
   - index fake embeddings or inject provider path used by existing tests.
   - call `runStaticIntelligenceAgentQuery` with:

```ts
{
  scanRunId,
  queryKind: "risk_context",
  query: "auth validation risk",
  includeSemantic: true,
  includeCommunities: true,
}
```

   - expect `bundles.semantic`.
   - expect `bundles.communities` includes `basis: ["semantic"]` or includes `semantic` among bases.
   - expect `results` includes a `community` item with semantic basis metadata.
   - expect `confidence` is `low` when semantic is the only basis.

2. related findings uses semantic community
   - query-only `related_findings`.
   - expect related finding items derived from semantic community.
   - expect no duplicate finding ids.

3. semantic unavailable preserves exact community
   - request `includeSemantic: true`, `includeCommunities: true`.
   - no index or no provider.
   - expect exact / graph communities still present.
   - expect degraded reason.

4. semantic does not alter risk band
   - semantic query returns high scoring results.
   - expect export risk band and landscape risk band remain unchanged.

5. semantic-only result remains candidate-only
   - all semantic community items and semantic candidate items have `candidateOnly: true`.

### CLI Tests

Update `api/modules/static-intelligence/intelligence-agent-query-cli.test.ts`.

Add:

1. `--include-semantic true --include-communities true` returns valid JSON when semantic index is empty.
   - expect degraded reason.
   - expect exit code `0`.

2. semantic community path with fake provider is covered at service level, not CLI, unless existing CLI test helpers can inject provider config safely.

Do not add a CLI test that requires live Azure/OpenAI credentials.

### Regression Tests

Keep existing tests passing:

```bash
bun test ./api/modules/static-intelligence/community-landscape.test.ts
bun test ./api/modules/static-intelligence/semantic-search.test.ts
bun test ./api/modules/static-intelligence/agent-query.test.ts
bun test ./api/modules/static-intelligence/intelligence-agent-query-cli.test.ts
```

## Implementation Steps

1. Add semantic integration module
   - create `semantic-community-integration.ts`.
   - implement threshold filtering, known finding guard, query cluster, source cluster, de-duplication.
   - completion: unit tests pass and no raw content is emitted.

2. Add semantic integration unit tests
   - create `semantic-community-integration.test.ts`.
   - use small hand-built export payload where possible.
   - completion: deterministic candidate output is covered.

3. Wire Agent Query community build
   - import `buildSemanticCommunityCandidates`.
   - after semantic query success, create semantic candidates.
   - pass them to `buildRiskCommunities`.
   - completion: `bundles.communities` includes semantic community when eligible.

4. Update Agent Query routing
   - include semantic communities for query-only `risk_context`.
   - include semantic community findings for query-only `related_findings`.
   - avoid duplicate result items.
   - completion: route tests cover both query kinds.

5. Preserve degraded behavior
   - missing index, missing provider, threshold filtering, unknown finding refs all become degraded output.
   - completion: exact / graph communities still return.

6. Update CLI tests
   - cover degraded semantic community request through `intelligence:agent-query`.
   - do not require live provider credentials.

7. Run verification commands
   - run focused tests.
   - run full repo verify.

## Verification Commands

Focused:

```bash
bun test ./api/modules/static-intelligence/semantic-community-integration.test.ts
bun test ./api/modules/static-intelligence/agent-query.test.ts
bun test ./api/modules/static-intelligence/intelligence-agent-query-cli.test.ts
```

Static Intelligence suite:

```bash
bun test ./api/modules/static-intelligence/*.test.ts
```

Full gate:

```bash
bun run verify
```

Manual degraded smoke:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <existing-scan-run-id> \
  --kind risk_context \
  --query "authentication bypass" \
  --include-semantic true \
  --include-communities true
```

Expected when semantic index/provider is unavailable:

- exit code `0`
- stdout is one JSON object
- exact / graph results still return when available
- `degradedReasons` explains missing semantic enrichment

Manual success smoke, only when embedding index and provider are configured:

```bash
bun run intelligence:index -- --scan-run-id <existing-scan-run-id>

bun run intelligence:agent-query -- \
  --scan-run-id <existing-scan-run-id> \
  --kind risk_context \
  --query "authentication bypass" \
  --include-semantic true \
  --include-communities true
```

Expected:

- `bundles.semantic.results` is present.
- `bundles.communities` includes semantic basis when semantic results map to at least 2 known findings.
- semantic-only communities have `confidence: "low"`.
- `summary.candidateOnly` is `true`.

## Failure Handling

Semantic index empty:

- semantic query returns completed empty result.
- Agent Query returns completed result.
- no semantic community candidates are emitted.
- degraded reason is preserved.

Embedding provider missing:

- if no indexed rows match, do not require provider.
- if indexed rows exist and provider creation/query fails, return completed Agent Query with degraded reason.
- exact / graph community results still return.

Semantic result below threshold:

- do not emit semantic community.
- add degraded reason.
- do not fail the request.

Unknown finding refs:

- drop unknown finding ids.
- add degraded reason.
- do not emit candidate if fewer than 2 known finding ids remain.

Malformed semantic result:

- schema validation should fail before integration.
- Agent Query catches semantic failure and returns degraded exact / graph output.

Community builder failure:

- fail Agent Query with exit code `1` in CLI path.
- do not silently omit communities if `includeCommunities` was requested and the builder itself failed.

## Security and Safety Guardrails

- Do not include raw scanner artifacts in community output.
- Do not include evidence snippets in semantic community candidates.
- Do not include embedding vectors in Agent Query output.
- Do not send additional source content to the embedding provider in Phase 33.
- Use Phase 30 stored embedding rows and semantic query output only.
- Preserve `candidateOnly: true` on every semantic-derived item.
- Do not use semantic result score to alter severity, risk band, review status, or finding status.

## Completion Criteria

Phase 33 is complete when:

- `buildSemanticCommunityCandidates(...)` exists and is tested.
- Agent Query passes semantic candidates into `buildRiskCommunities(...)`.
- `risk_context` can return semantic community items for query-only requests.
- `related_findings` can return semantic-related findings through semantic communities.
- missing semantic index/provider returns degraded completed output.
- semantic-only communities remain low confidence.
- exact / graph community and landscape behavior does not regress.
- all focused tests pass.
- `bun test ./api/modules/static-intelligence/*.test.ts` passes.
- `bun run verify` passes.

## Non-goals

- No new DB migration.
- No new queue or task behavior.
- No Nightworker integration.
- No MCP server.
- No UI.
- No automatic patch planning.
- No confirmed finding creation.
- No semantic-only severity or risk escalation.
