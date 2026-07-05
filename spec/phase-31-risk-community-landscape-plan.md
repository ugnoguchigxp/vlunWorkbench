# Phase 31: Risk Community and Security Landscape Plan

## Purpose

この計画は、Phase 29 の Static Intelligence Export を使い、scan run 単位の Risk Community と Security Landscape を JSON で出力する。

到達点は次の 2 本に絞る。

```text
StaticIntelligenceExportV1
  -> exact / graph based risk communities
  -> provenance-backed community JSON

StaticIntelligenceExportV1
  -> risk / coverage / evidence / remediation overview
  -> provenance-backed landscape JSON
```

Phase 30 の semantic search が実装済みであれば、community の追加 basis として `semantic` を使ってよい。ただし Phase 31 の MVP は Phase 29 だけで動くことを必須にする。

この phase は、個別 finding の真偽を判定するものではない。Risk Community と Security Landscape は review focus を決めるための read model であり、confirmed / dismissed finding を作らない。

## Product Boundary

vulnWorkbench が担当すること:

- Phase 29 export から Risk Community を生成する。
- Phase 29 export から Security Landscape を生成する。
- same file / same scanner rule / evidence graph / optional semantic result を basis として明示する。
- community / landscape から元 finding / evidence / artifact / file へ戻れる refs を保持する。
- zero finding や missing review を安全判定ではなく coverage / evidence gap として表現する。
- CLI から JSON を 1 object だけ stdout に出す。

vulnWorkbench が担当しないこと:

- community 結果だけで finding を confirm / dismiss する。
- severity や risk band を semantic similarity だけで上げる。
- Project Ontology を作る。
- task graph を生成する。
- queue admission を行う。
- automatic patch planning を行う。
- UI を作る。
- MCP server を作る。
- cross scan trend を永続化する。

## Prerequisites

Required:

- Phase 29 が完了していること。
- `shared/schemas/static-intelligence.schema.ts`
  - `StaticIntelligenceExportV1`
  - `FileRiskIndexEntry`
  - `DiagnosticEvidenceGraph`
  - `staticIntelligenceExportV1Schema`
- `api/modules/static-intelligence/export-builder.ts`
  - `buildStaticIntelligenceExport(db, scanRunId)`
- `api/modules/static-intelligence/repository.ts`
  - `StaticIntelligenceRepository.loadSourceBundle(scanRunId)`
- `api/cli/intelligence-export.ts`
  - `bun run intelligence:export -- --scan-run-id <scan-run-id>`

Optional enrichment:

- Phase 30 semantic search/index が実装済みの場合だけ、semantic basis を追加する。
- Phase 30 が未実装でも Phase 31 CLI は失敗させない。
- semantic enrichment が使えない場合は `degradedReasons` に理由を入れ、exact / graph basis だけで結果を返す。
- Phase 31 CLI では semantic query text / embedding provider を受け取らないため、`--include-semantic` は公開しない。semantic basis は builder-level の injectable input または Phase 32 agent query 側で扱う。

## Current Code Anchors

既存で参考にする実装:

- `shared/schemas/static-intelligence.schema.ts`
  - Phase 31 の入力 schema。
- `api/modules/static-intelligence/export-builder.ts`
  - scan run から export を作る入口。
- `api/modules/static-intelligence/file-risk-index.ts`
  - path 正規化、severity 比較、evidence quality の既存ルール。
- `api/modules/static-intelligence/evidence-graph.ts`
  - graph node / edge id ルール。
- `api/modules/static-intelligence/export-builder.test.ts`
  - in-memory DB、migration 適用、seed helper の既存 pattern。
- `api/cli/intelligence-export.ts`
  - CLI argument parse、stdout JSON、exit code、DB close pattern。

新設候補:

- `shared/schemas/static-intelligence-landscape.schema.ts`
- `api/modules/static-intelligence/community-builder.ts`
- `api/modules/static-intelligence/landscape-builder.ts`
- `api/modules/static-intelligence/community-landscape.test.ts`
- `api/cli/intelligence-communities.ts`
- `api/cli/intelligence-landscape.ts`

既存ファイルへの変更候補:

- `package.json`
  - `intelligence:communities`
  - `intelligence:landscape`

DB migration はこの phase では追加しない。最初は read-only aggregate の JSON 出力に限定する。

## Output Schemas

Add `shared/schemas/static-intelligence-landscape.schema.ts`.

### Shared Types

```ts
type RiskCommunityBasis =
  | "same_file"
  | "same_scanner_rule"
  | "same_scanner"
  | "same_cwe"
  | "same_cve"
  | "same_dependency"
  | "graph_connected"
  | "semantic";

type RiskCommunityConfidence = "low" | "medium" | "high";

type LandscapeBand = "none" | "low" | "medium" | "high" | "critical" | "unknown";

type LandscapeSeverity = "info" | "low" | "medium" | "high" | "critical" | "unknown";
```

### Risk Community

```ts
type RiskCommunity = {
  id: string;
  title: string;
  basis: RiskCommunityBasis[];
  confidence: RiskCommunityConfidence;
  candidateOnly: true;
  summary: string;
  suggestedReviewFocus: string[];
  findingIds: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
  fileRefs: string[];
  scannerRefs: string[];
  ruleIds: string[];
  maxSeverity: LandscapeSeverity;
  evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
  degradedReasons: string[];
};
```

### Communities Output

```ts
type StaticIntelligenceCommunitiesResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  projectId: string;
  scanRunId: string;
  communities: RiskCommunity[];
  degradedReasons: string[];
};
```

### Security Landscape

```ts
type SecurityLandscape = {
  risk: {
    band: LandscapeBand;
    findingCount: number;
    bySeverity: Record<string, number>;
    byScanner: Record<string, number>;
    byFile: Array<{
      path: string;
      findingCount: number;
      maxSeverity: LandscapeSeverity;
      evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
      findingIds: string[];
      evidenceRefs: string[];
    }>;
  };
  coverage: {
    status: "covered" | "partial" | "unknown";
    scannedToolCount: number;
    artifactCount: number;
    unknownFileCount: number;
    degradedReasons: string[];
  };
  evidence: {
    quality: "none" | "weak" | "mixed" | "strong" | "unknown";
    missingEvidenceFindingIds: string[];
    weakEvidenceFindingIds: string[];
    artifactBackedEvidenceRefs: string[];
  };
  remediation: {
    reviewStatus: "completed" | "failed" | "missing";
    hasImprovementRequest: boolean;
    acceptanceCriteriaCount: number;
    verificationCommandCount: number;
    openFocus: string[];
  };
};
```

### Landscape Output

```ts
type StaticIntelligenceLandscapeResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  projectId: string;
  scanRunId: string;
  landscape: SecurityLandscape;
  communities?: RiskCommunity[];
  degradedReasons: string[];
};
```

CLI outputs must validate against these schemas before writing success JSON.

## Community Builder

Add `api/modules/static-intelligence/community-builder.ts`.

Input:

- `StaticIntelligenceExportV1`
- optional semantic related candidates from Phase 30, only if available later.

Output:

- `RiskCommunity[]`

Initial grouping rules:

1. Same file
   - group findings that share one `FileRiskIndexEntry.path`.
   - basis: `same_file`.
   - confidence: `high` when finding count is greater than 1 and path is not `unknown`.
   - confidence: `low` when path is `unknown`.

2. Same scanner rule
   - group finding graph nodes with the same `metadata.sourceTool` + `metadata.ruleId` pair when recoverable.
   - basis: `same_scanner_rule`.
   - confidence: `high` when at least 2 findings share the pair.

3. Same scanner
   - group findings by scanner only when rule id is missing or too broad.
   - basis: `same_scanner`.
   - confidence: `medium` at most.

4. Graph connected
   - group findings connected to the same file node, evidence node, artifact node, or scanner node in `DiagnosticEvidenceGraph`.
   - basis: `graph_connected`.
   - confidence: use edge confidence, capped at `medium` unless same file or same rule also applies.

5. Semantic
   - only if Phase 30 result is provided by a later integration.
   - basis: `semantic`.
   - confidence: `low` unless combined with exact or graph basis.
   - semantic basis alone must never produce `high`.

Deduplication rules:

- The same set of `findingIds` should not appear as duplicate communities.
- If two candidate communities have identical `findingIds`, merge basis arrays and refs.
- Sort communities by max severity desc, then finding count desc, then id asc.
- Sort all refs deterministically.

Community id rules:

```text
community:file:<normalizedPath>
community:scanner-rule:<scanner>:<ruleId>
community:scanner:<scanner>
community:graph:<nodeId>
community:semantic:<stableHash>
```

Use stable ids only. Do not use random ids.

Title rules:

- same file: `Risk cluster in <path>`
- same scanner rule: `<scanner> / <ruleId> cluster`
- same scanner: `<scanner> finding cluster`
- graph connected: `Graph-connected risk around <label>`
- semantic: `Semantically related risk candidates`

Summary rules:

- short deterministic sentence.
- include basis, finding count, max severity, evidence quality.
- do not claim root cause.
- do not claim confirmed exploitability.

Suggested review focus rules:

- Include at most 5 strings.
- Prefer concrete review focus:
  - weak or missing evidence
  - same file with multiple findings
  - same rule repeated
  - missing review / missing improvement request
  - unknown path

## Landscape Builder

Add `api/modules/static-intelligence/landscape-builder.ts`.

Input:

- `StaticIntelligenceExportV1`
- optional `RiskCommunity[]`

Output:

- `SecurityLandscape`

Risk landscape rules:

- `band` starts from `export.scanSummary.riskBand`.
- `findingCount` comes from `export.scan.findingCount`.
- `bySeverity` is derived from graph finding nodes or file risk index max severity.
- `byScanner` is derived from file risk index scanners and graph scanner nodes.
- `byFile` comes from `export.fileRiskIndex`.
- zero finding means risk band `none`, not safe / secure.

Coverage landscape rules:

- `covered` when scan status is completed, toolRunCount > 0, artifactCount > 0, and no unknown file entries.
- `partial` when scan status is completed but artifacts or file locations are incomplete.
- `unknown` when scan status is not completed or source evidence is insufficient.
- include degraded reasons from `export.scanSummary.degradedReasons`.
- unknown file path entries increase `unknownFileCount`.

Evidence landscape rules:

- `quality` starts from `export.scanSummary.evidenceQuality`.
- `missingEvidenceFindingIds` are findings without `evidenced_by` graph edges.
- `weakEvidenceFindingIds` are findings with evidence but no artifact-backed `stored_as` edge.
- `artifactBackedEvidenceRefs` come from `stored_as` edges.

Remediation landscape rules:

- `reviewStatus` comes from `export.scan.reviewStatus`.
- `hasImprovementRequest` is true when `export.handoff` exists.
- counts come from `handoff.acceptanceCriteria` and `handoff.verificationCommands`.
- `openFocus` includes missing review, failed review, no acceptance criteria, no verification commands, weak evidence, unknown file path.

## CLI: Communities

Add CLI:

```bash
bun run intelligence:communities -- --scan-run-id <scan-run-id>
```

Options:

```text
--scan-run-id <uuid> required
--pretty true|false optional, default false
```

Behavior:

1. validate args.
2. build Phase 29 export with `buildStaticIntelligenceExport(db, scanRunId)`.
3. build communities from export.
4. validate output schema.
5. print one JSON object to stdout.

Semantic basis is intentionally not exposed through this CLI until there is a query/provider-backed integration path. Use the builder-level injected semantic candidates in tests or the Phase 32 agent query path when semantic query context is available.

stdout:

- JSON object 1 件のみ。

stderr:

- diagnostics only.
- no progress logs in stdout.

Exit code:

| Code | Meaning |
| ---: | --- |
| 0 | communities completed |
| 1 | runtime / DB failure |
| 2 | invalid argument or scan run not found |

Package script:

```json
"intelligence:communities": "bun run api/cli/intelligence-communities.ts"
```

## CLI: Landscape

Add CLI:

```bash
bun run intelligence:landscape -- --scan-run-id <scan-run-id>
```

Options:

```text
--scan-run-id <uuid> required
--include-communities true|false optional, default true
--pretty true|false optional, default false
```

Behavior:

1. validate args.
2. build Phase 29 export.
3. build communities when `--include-communities true`.
4. build landscape from export and optional communities.
5. validate output schema.
6. print one JSON object to stdout.

Success output shape:

```json
{
  "ok": true,
  "status": "completed",
  "version": "v1",
  "generatedAt": "2026-07-05T00:00:00.000Z",
  "projectId": "...",
  "scanRunId": "...",
  "landscape": {},
  "communities": [],
  "degradedReasons": []
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

Exit code:

| Code | Meaning |
| ---: | --- |
| 0 | landscape completed |
| 1 | runtime / DB failure |
| 2 | invalid argument or scan run not found |

Package script:

```json
"intelligence:landscape": "bun run api/cli/intelligence-landscape.ts"
```

## Implementation Steps

1. Shared schema
   - add `shared/schemas/static-intelligence-landscape.schema.ts`.
   - export zod schemas and TypeScript types.
   - completion: schemas parse representative community and landscape output.

2. Community builder
   - add `community-builder.ts`.
   - implement same file, scanner rule, scanner, and graph-connected grouping.
   - keep semantic hook as optional no-op unless Phase 30 types are present.
   - completion: deterministic communities with stable ids.

3. Landscape builder
   - add `landscape-builder.ts`.
   - implement risk / coverage / evidence / remediation sections.
   - completion: zero finding and missing review are represented without safe claims.

4. CLI commands
   - add `intelligence-communities.ts`.
   - add `intelligence-landscape.ts`.
   - add package scripts.
   - completion: both commands return one JSON object on stdout and close DB.

5. Tests
   - add `community-landscape.test.ts`.
   - reuse Phase 29 in-memory DB and seed helper pattern.
   - completion: tests cover grouping, landscape, degraded states, and deterministic ordering.

## Tests

Add `api/modules/static-intelligence/community-landscape.test.ts`.

Minimum test cases:

1. same file community
   - seed two findings in the same file.
   - expect one community with `same_file`, both finding ids, file ref, and `candidateOnly: true`.

2. same scanner rule community
   - seed two findings with same scanner and rule id.
   - expect `same_scanner_rule` basis and high confidence.

3. semantic-only confidence guard
   - if a semantic candidate helper is added, verify semantic-only community is low confidence.
   - if semantic integration is not implemented, keep this as a builder-level unit test with injected semantic input.

4. graph connected refs
   - seed evidence and artifact-backed findings.
   - expect evidence refs and artifact refs are preserved.

5. zero finding landscape
   - seed completed scan with no findings.
   - expect risk band `none`, finding count `0`, and no safe / secure wording.

6. missing review landscape
   - seed scan without completed review.
   - expect remediation review status `missing`, `hasImprovementRequest: false`, and degraded/open focus entry.

7. weak evidence landscape
   - seed finding evidence without artifact id.
   - expect weak evidence finding ids.

8. unknown file coverage
   - seed finding without recoverable path.
   - expect coverage status not `covered` and `unknownFileCount > 0`.

9. deterministic ordering
   - repeated builds with same generated date produce equal output.
   - communities and refs are sorted.

Optional CLI tests:

- invalid args return JSON failure and exit code `2`.
- scan run not found returns JSON failure and exit code `2`.

## Verification Commands

After implementation:

```bash
bun test ./api/modules/static-intelligence/community-landscape.test.ts
bun run typecheck
bun run verify
```

Manual communities smoke:

```bash
bun run intelligence:communities -- --scan-run-id <existing-scan-run-id> --pretty true
```

Expected:

- stdout is one valid JSON object.
- `ok` is `true`.
- every community has `candidateOnly: true`.
- every community has at least one provenance ref among finding / evidence / file.
- semantic-only community, if present, is not high confidence.

Manual landscape smoke:

```bash
bun run intelligence:landscape -- --scan-run-id <existing-scan-run-id> --pretty true
```

Expected:

- stdout is one valid JSON object.
- `ok` is `true`.
- `landscape.risk.findingCount` matches Phase 29 export `scan.findingCount`.
- zero finding is represented as risk band `none`, not safe / secure.
- missing review appears in remediation/open focus.

Comparison smoke:

```bash
bun run intelligence:export -- --scan-run-id <existing-scan-run-id> --pretty true
bun run intelligence:landscape -- --scan-run-id <existing-scan-run-id> --pretty true
```

Expected:

- landscape project id and scan run id match export.
- landscape risk band does not exceed export risk band unless exact evidence in export justifies it.
- all landscape refs are recoverable from export fileRiskIndex or graph.

## Failure Handling

Invalid scan run:

- exit code `2`
- JSON failure

Missing Phase 30 semantic index:

- no failure when semantic enrichment is not requested.
- if requested but unavailable, return completed exact/graph result with degraded reason.

Malformed export:

- builder should fail before success output.
- CLI exits `1` with JSON failure.

No findings:

- return completed result.
- communities array is empty.
- landscape risk band is `none`.
- do not emit safe / secure language.

Missing refs:

- stop implementation if a community cannot point back to finding / evidence / file refs.
- do not create aggregate-only communities without provenance.

## Stop Conditions

Stop and revise the plan if any of these happen:

- Risk Community is used to confirm or dismiss findings.
- Security Landscape starts controlling queues or task execution.
- source refs are missing from communities or landscape rows.
- zero finding is described as safe or secure.
- semantic cluster can become high confidence without exact or graph basis.
- project-wide trend requires cross scan persistence.
- raw artifact content or evidence snippets are added to summaries.
- CLI stdout contains progress logs.

## Completion Definition

Phase 31 is complete when:

```bash
bun run intelligence:communities -- --scan-run-id <scan-run-id>
bun run intelligence:landscape -- --scan-run-id <scan-run-id>
```

both return valid JSON, every community is candidate-only and provenance-backed, the landscape can represent zero finding / missing review / weak evidence states, and the verification command set passes.

UI, Project Ontology, task graph generation, queue admission, automatic patch planning, MCP integration, and cross scan persistence are not part of this phase.
