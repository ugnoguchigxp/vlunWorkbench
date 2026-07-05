# Phase 29: Static Intelligence Foundation Plan

## Purpose

この計画は、`spec/static-intelligence-layer-concept.md` の最初の実装段階として、既存の scan / finding / evidence / artifact / review から Static Intelligence の最小 read model を作る。

到達点は次の 1 本に絞る。

```text
saved scan result
  -> File Risk Index
  -> Diagnostic Evidence Graph
  -> Static Intelligence Export v1
  -> machine-readable JSON
```

この phase は、すぐ実装へ移せる粒度を優先する。Embedding、Risk Community、Security Landscape、LSP、外部 agent 側 adapter は含めない。

## Product Boundary

vulnWorkbench が担当すること:

- 保存済み scan run を読み取る。
- finding / evidence / artifact / review を read-only に集約する。
- file path 単位の risk index を作る。
- finding / evidence / artifact / file / scanner の graph JSON を作る。
- Static Intelligence Export v1 を CLI から JSON 出力する。

vulnWorkbench が担当しないこと:

- Project Ontology
- task graph generation
- queue admission
- patch application
- semantic search
- community detection
- landscape UI
- LSP enrichment
- MCP server 実装

この phase の主語は、既存の scanner evidence を read model 化することである。新しい検出器を増やさない。

## Current Code Anchors

実装時に読む/触る候補。

既存 input:

- `shared/schemas/scan.schema.ts`
  - `Project`, `ScanRun`, `ToolRun`, `ScanArtifact`, `Finding`, `FindingEvidence`, `ScanReview`
  - `scanReviewOutputSchema` と `improvementRequest`
- `api/modules/scans/repositories.ts`
  - `ProjectRepository`
  - `ScanRepository`
  - `ArtifactRepository`
  - `FindingRepository`
- `api/modules/scans/scan-review-repository.ts`
  - `ScanReviewRepository`
- `api/db/schema.ts`
  - `projects`, `scanRuns`, `toolRuns`, `scanArtifacts`, `findings`, `findingEvidences`, `scanReviews`
- `api/cli/report-scan.ts`
  - CLI JSON 出力、DB 接続、error handling の既存パターン
- `api/cli/scan-profile.ts`
  - stdout JSON / optional output file の既存パターン

新設候補:

- `shared/schemas/static-intelligence.schema.ts`
- `api/modules/static-intelligence/types.ts`
- `api/modules/static-intelligence/repository.ts`
- `api/modules/static-intelligence/file-risk-index.ts`
- `api/modules/static-intelligence/evidence-graph.ts`
- `api/modules/static-intelligence/export-builder.ts`
- `api/modules/static-intelligence/export-builder.test.ts`
- `api/cli/intelligence-export.ts`

既存ファイルへの最小変更候補:

- `package.json`
  - `intelligence:export`: `bun run api/cli/intelligence-export.ts`
- 必要なら `api/modules/scans/repositories.ts`
  - 足りない list method を追加する。ただし Static Intelligence 専用 query は `api/modules/static-intelligence/repository.ts` に寄せる。

## CLI Contract

最初に作る CLI:

```bash
bun run intelligence:export -- --scan-run-id <scan-run-id>
```

任意で追加してよい option:

```bash
--output <path>
--pretty true
```

この phase では `--project-id` latest scan 解決は必須にしない。最初は `--scan-run-id` を primary input にして、scope を固定する。

stdout:

- JSON object 1 件のみ。
- progress、warning、stack trace、人間向け説明を混ぜない。

stderr:

- diagnostics
- degraded output reason
- unexpected error details

exit code:

| Code | Meaning |
| ---: | --- |
| 0 | export completed, including degraded-but-usable output |
| 1 | runtime / DB / unexpected failure |
| 2 | invalid argument or scan run not found |

`--output` 指定時も stdout は result JSON を返す。JSON 本体を file に保存した場合、stdout には path と checksum 相当を含めてもよい。

## Output Contract

最初の schema は `shared/schemas/static-intelligence.schema.ts` に置く。

```ts
type StaticIntelligenceExportV1 = {
  version: "v1";
  generatedAt: string;
  project: {
    id: string;
    name: string;
    rootPath?: string;
  };
  scan: {
    id: string;
    profile: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    findingCount: number;
    toolRunCount: number;
    artifactCount: number;
    reviewStatus: "completed" | "failed" | "missing";
  };
  scanSummary: {
    riskBand: "none" | "low" | "medium" | "high" | "critical" | "unknown";
    evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
    degradedReasons: string[];
  };
  fileRiskIndex: FileRiskIndexEntry[];
  graph: DiagnosticEvidenceGraph;
  handoff?: StaticIntelligenceHandoff;
};
```

### File Risk Index

```ts
type FileRiskIndexEntry = {
  path: string;
  findingCount: number;
  maxSeverity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
  evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
  scanners: string[];
  ruleIds: string[];
  findingIds: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
  latestScanRunId: string;
  latestSeenAt?: string;
};
```

Path extraction rules:

- Prefer `finding.primaryLocation.path` when it is a string.
- Else use `finding.primaryLocation.file` when it is a string.
- Else use `finding.metadata.path` / `finding.metadata.file` only if string.
- Else use evidence location path/file.
- Else group under `unknown`.

Severity rules:

- `critical > high > medium > low > info > unknown`
- empty finding set produces an empty `fileRiskIndex`.

Evidence quality rules for Phase 29:

- `none`: no evidence refs.
- `weak`: evidence exists but no artifact refs.
- `mixed`: some findings for the file have artifact-backed evidence and some do not.
- `strong`: all findings for the file have at least one artifact-backed evidence.
- `unknown`: missing location or malformed evidence prevents classification.

Secret handling:

- Do not include `FindingEvidence.snippet`.
- Do not include raw artifact content.
- Only include ids, paths, titles, tool names, rule ids, severity, confidence, and short summaries already stored as finding/review metadata.

### Diagnostic Evidence Graph

```ts
type DiagnosticEvidenceGraph = {
  nodes: DiagnosticEvidenceNode[];
  edges: DiagnosticEvidenceEdge[];
};

type DiagnosticEvidenceNode = {
  id: string;
  kind:
    | "project"
    | "scan_run"
    | "scanner"
    | "finding"
    | "evidence"
    | "artifact"
    | "file"
    | "review";
  label: string;
  sourceId?: string;
  severity?: string;
  confidence?: string;
  metadata?: Record<string, unknown>;
};

type DiagnosticEvidenceEdge = {
  id: string;
  from: string;
  to: string;
  kind:
    | "has_scan"
    | "detected_by"
    | "evidenced_by"
    | "located_in"
    | "stored_as"
    | "reviewed_by"
    | "related_to";
  confidence: number;
  evidenceRefs: string[];
};
```

Node id rules:

- `project:<projectId>`
- `scan_run:<scanRunId>`
- `scanner:<scanRunId>:<toolName>`
- `finding:<findingId>`
- `evidence:<evidenceId>`
- `artifact:<artifactId>`
- `file:<normalizedPath>`
- `review:<scanReviewId>`

Edge id rules:

- Deterministic string from `kind:from:to`.
- If multiple evidence refs support the same edge, merge refs and keep one edge.

Required edges:

- project -> scan_run: `has_scan`
- finding -> scanner: `detected_by`
- finding -> evidence: `evidenced_by`
- finding -> file: `located_in`
- evidence -> artifact: `stored_as`
- scan_run -> review: `reviewed_by` when scan review exists

## Handoff Extraction

Use latest completed scan review when available.

Source:

- `ScanReviewRepository.findLatestReview(scanRunId)`
- `scanReview.output.improvementRequest`

Implementation note:

- `findLatestReview` が completed 限定でない場合は、repository 側で completed review を filter するか、この phase 用 repository で latest completed review を取得する。
- failed / running review は handoff source にしない。

Export only:

- `title`
- `objective`
- `acceptanceCriteria`
- `verificationCommands`
- `constraints`
- `nonGoals`

Do not export:

- full raw prompt unless already intended as handoff and needed by downstream.
- raw repository text.
- raw artifact content.

If review is missing or failed:

- `handoff` is omitted.
- `scan.reviewStatus` is `missing` or `failed`.
- `scanSummary.degradedReasons` includes the reason.

## Implementation Steps

### Step 1: Shared schema

Add `shared/schemas/static-intelligence.schema.ts`.

Include:

- severity enum reuse or local matching enum.
- `fileRiskIndexEntrySchema`.
- `diagnosticEvidenceNodeSchema`.
- `diagnosticEvidenceEdgeSchema`.
- `diagnosticEvidenceGraphSchema`.
- `staticIntelligenceExportV1Schema`.

Acceptance:

- schema parses a minimal zero-finding export.
- schema parses a finding-backed export.

### Step 2: Read repository

Add `api/modules/static-intelligence/repository.ts`.

Responsibilities:

- load project by scan run id.
- load scan run.
- load tool runs for scan run.
- load artifacts for scan run.
- load findings for scan run.
- load evidence for all findings.
- load latest scan review.

Implementation note:

- Prefer existing repositories where practical.
- If bulk evidence query is easier with Drizzle directly, keep it inside this repository.
- This repository must be read-only.

Acceptance:

- one call returns a `StaticIntelligenceSourceBundle`.
- missing review is represented as `null`, not an exception.

### Step 3: File Risk Index builder

Add `api/modules/static-intelligence/file-risk-index.ts`.

Responsibilities:

- normalize file path from finding/evidence.
- group findings by file.
- calculate max severity.
- calculate evidence quality.
- collect scanner, rule, finding, evidence, artifact refs.

Acceptance:

- deterministic sort by path.
- arrays sorted deterministically.
- zero findings returns `[]`.
- no snippets or raw artifact content in output.

### Step 4: Evidence Graph builder

Add `api/modules/static-intelligence/evidence-graph.ts`.

Responsibilities:

- build nodes and edges from source bundle.
- use deterministic node ids and edge ids.
- merge duplicate edges.
- represent missing file location as `file:unknown`.

Acceptance:

- graph includes project and scan_run nodes.
- finding-backed scan includes scanner, finding, evidence, artifact, file nodes.
- missing artifact does not fail graph build.
- graph output is deterministic.

### Step 5: Export builder

Add `api/modules/static-intelligence/export-builder.ts`.

Responsibilities:

- orchestrate repository output, file risk index, graph builder, handoff extraction.
- compute scan summary.
- attach degraded reasons.
- validate final export with `staticIntelligenceExportV1Schema`.

Risk band rules:

- no findings: `none`.
- else highest severity among findings.
- malformed severity: `unknown`.

Scan evidence quality:

- derive from file risk entries.
- if no findings: `none`.
- if any `unknown`: `unknown`.
- if all `strong`: `strong`.
- if mix of strong/weak/none: `mixed`.
- if all weak/none: `weak`.

Acceptance:

- valid export for finding scan.
- valid degraded export for missing review.
- valid export for zero-finding scan.

### Step 6: CLI

Add `api/cli/intelligence-export.ts`.

Arguments:

```text
--scan-run-id <uuid> required
--output <path> optional
--pretty true|false optional, default false
```

Behavior:

- parse args with `node:util.parseArgs`.
- connect with `readAppEnv()` and `createDbConnection()`.
- call export builder.
- write JSON object to stdout.
- write optional file when `--output` is set.
- close SQLite connection in `finally`.

Add package script:

```json
"intelligence:export": "bun run api/cli/intelligence-export.ts"
```

Output on success:

```json
{
  "ok": true,
  "status": "completed",
  "scanRunId": "...",
  "export": { "...": "..." }
}
```

Output on invalid input:

```json
{
  "ok": false,
  "status": "failed",
  "message": "..."
}
```

## Tests

Add `api/modules/static-intelligence/export-builder.test.ts`.

Minimum test cases:

1. zero-finding scan
   - export parses.
   - `fileRiskIndex` is empty.
   - graph contains project and scan_run.
   - riskBand is `none`.

2. finding with source-location evidence and artifact
   - file risk entry is created.
   - maxSeverity matches finding.
   - evidenceQuality is `strong`.
   - graph has finding -> evidence -> artifact and finding -> file.

3. missing review
   - export still succeeds.
   - handoff is omitted.
   - degraded reason includes missing review.

4. secret/snippet exclusion
   - evidence snippet seeded with secret-like text does not appear in JSON output.
   - artifact path/id may appear, raw artifact content does not.

5. deterministic output
   - repeated builder calls produce same sorted ids and arrays.

Optional CLI smoke test:

- Use a temp SQLite DB fixture if existing CLI test utilities make it cheap.
- Otherwise leave CLI covered by builder tests plus a manual command in verification.

## Verification Commands

Focused checks after implementation:

```bash
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

Manual CLI smoke:

```bash
bun run intelligence:export -- --scan-run-id <existing-scan-run-id> --pretty true
```

Expected smoke result:

- stdout is JSON.
- `ok` is `true`.
- `export.version` is `v1`.
- `export.fileRiskIndex` exists.
- `export.graph.nodes` and `export.graph.edges` exist.

Failure handling:

- If scan run is missing, return exit code 2 and JSON failure.
- If export validation fails, return exit code 1 and JSON failure.
- If secret-like fixture appears in output, stop and fix redaction/exclusion before continuing.

## Stop Conditions

Stop and revise the plan if any of these happen:

- implementation needs embedding, LSP, or semantic search to complete Phase 29.
- graph output starts carrying raw artifact content.
- graph output is treated as source of truth instead of derived read model.
- CLI stdout includes progress logs.
- builder mutates scan/finding/evidence rows.
- task graph, queue admission, or patch planning enters the implementation.

## Completion Definition

Phase 29 is complete when:

```text
bun run intelligence:export -- --scan-run-id <scan-run-id>
```

returns a valid `StaticIntelligenceExportV1` JSON object that includes:

- scan summary
- file risk index
- diagnostic evidence graph
- optional handoff from latest completed scan review
- degraded reasons for missing data

and the focused tests plus repo verification pass.
