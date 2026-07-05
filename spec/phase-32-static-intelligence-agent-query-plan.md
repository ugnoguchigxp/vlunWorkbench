# Phase 32: Static Intelligence Agent Query Plan

## Purpose

この計画は、Phase 29-31 で作った Static Intelligence read model を、外部 agent が DB を直接読まずに参照できる query surface として整える。

到達点は次の 1 本に絞る。

```text
agent request
  -> stable CLI / module service API
  -> Static Intelligence export / semantic search / communities / landscape
  -> source refs 付き JSON answer
```

この phase は scanner execution、task lifecycle、queue admission を作らない。vulnWorkbench 側が、既存の security evidence を安全に参照するための安定した JSON contract を提供することだけを担当する。

## Product Boundary

vulnWorkbench が担当すること:

- Agent Query 用の共通 input / output schema を定義する。
- Agent Query service function を作る。
- Agent Query CLI を作る。
- project overview / risk context / related findings / evidence bundle / verification commands / export の query kind を実装する。
- Phase 30 semantic search が使える場合だけ semantic result を含める。
- Phase 31 community / landscape が使える場合は overview と risk context に含める。
- すべての answer に source refs / finding ids / evidence refs / artifact refs / file refs を含める。
- JSON stdout contract を守る。

vulnWorkbench が担当しないこと:

- 外部実行基盤側の adapter 実装。
- MCP server の実装。
- scanner execution の primary path。
- task graph generation。
- queue admission。
- patch application。
- external agent の DB 直読み。
- LSP enrichment の実装。
- Project Ontology の実装。
- answer-only の自然文 RAG。

## Prerequisites

Required:

- Phase 29 が完了していること。
- `shared/schemas/static-intelligence.schema.ts`
  - `StaticIntelligenceExportV1`
  - `FileRiskIndexEntry`
  - `DiagnosticEvidenceGraph`
- `api/modules/static-intelligence/export-builder.ts`
  - `buildStaticIntelligenceExport(db, scanRunId)`
- `api/cli/intelligence-export.ts`
  - `bun run intelligence:export -- --scan-run-id <scan-run-id>`

Implementation mode:

- Phase 32 MVP must run with Phase 29 only.
- Phase 30 semantic search is optional enrichment.
- Phase 31 community / landscape is optional enrichment unless those modules have already landed before Phase 32 starts.
- Do not create fake Phase 31 outputs or stub communities to satisfy the Phase 32 schema.
- If Phase 31 is not present, omit `bundles.communities` / `bundles.landscape` and add a degraded reason when the user requested them.
- If Phase 31 is present, import and call the real builders instead of shelling out to the CLI.

Expected if Phase 31 has landed:

- `shared/schemas/static-intelligence-landscape.schema.ts`
  - `RiskCommunity`
  - `SecurityLandscape`
  - `StaticIntelligenceCommunitiesResult`
  - `StaticIntelligenceLandscapeResult`
- `api/modules/static-intelligence/community-builder.ts`
- `api/modules/static-intelligence/landscape-builder.ts`
- `api/cli/intelligence-communities.ts`
- `api/cli/intelligence-landscape.ts`

Optional enrichment if Phase 30 has landed:

- `shared/schemas/static-intelligence-search.schema.ts`
  - `StaticIntelligenceSemanticQueryResult`
- `api/modules/static-intelligence/semantic-query.ts`
- `api/modules/static-intelligence/embedding-repository.ts`
- `api/cli/intelligence-query.ts`
- `intelligence:query` package script.

Phase 32 must still return useful exact/graph results when semantic index is missing. Missing semantic search is a degraded condition, not a fatal error. None of the initial Phase 32 query kinds require semantic-only behavior.

## Current Code Anchors

Existing implementation patterns:

- `api/cli/intelligence-export.ts`
  - `parseArgs`, DB connection, stdout JSON, exit code pattern.
- `api/modules/static-intelligence/export-builder.ts`
  - scan run to `StaticIntelligenceExportV1`.
- `api/modules/static-intelligence/file-risk-index.ts`
  - path normalization and severity comparison.
- `api/modules/static-intelligence/evidence-graph.ts`
  - graph node / edge refs.
- `api/modules/static-intelligence/export-builder.test.ts`
  - in-memory DB and seed helper pattern.
- `api/modules/static-intelligence/intelligence-export-cli.test.ts`
  - CLI smoke pattern with temp SQLite DB.
- `api/cli/intelligence-query.ts`
  - Phase 30 semantic query CLI pattern, if present.

New files:

- `shared/schemas/static-intelligence-agent-query.schema.ts`
- `api/modules/static-intelligence/agent-query.ts`
- `api/modules/static-intelligence/agent-query.test.ts`
- `api/modules/static-intelligence/intelligence-agent-query-cli.test.ts`
- `api/cli/intelligence-agent-query.ts`

Existing file changes:

- `package.json`
  - add `intelligence:agent-query`.

No DB migration is required in this phase.

## Query Kinds

Initial supported query kinds:

```text
project_overview
risk_context
related_findings
evidence_bundle
verification_commands
export_static_intelligence
```

Not implemented in this phase:

```text
run_scan
confirm_finding
dismiss_finding
create_task
apply_patch
write_queue
```

## Input Schema

Add `shared/schemas/static-intelligence-agent-query.schema.ts`.

```ts
type StaticIntelligenceAgentQueryKind =
  | "project_overview"
  | "risk_context"
  | "related_findings"
  | "evidence_bundle"
  | "verification_commands"
  | "export_static_intelligence";

type StaticIntelligenceAgentQueryInput = {
  scanRunId: string;
  queryKind: StaticIntelligenceAgentQueryKind;
  query?: string;
  findingId?: string;
  file?: string;
  ruleId?: string;
  scanner?: string;
  includeSemantic?: boolean;
  includeCommunities?: boolean;
  includeLandscape?: boolean;
  includeMarkdown?: boolean;
  topK?: number;
};
```

Validation rules:

- `scanRunId` is always required.
- `queryKind` is always required.
- CLI `--kind` maps directly to input `queryKind`.
- `risk_context` requires at least one of `query`, `findingId`, `file`, `ruleId`, or `scanner`.
- `related_findings` requires at least one of `findingId`, `file`, `ruleId`, `scanner`, or `query`.
- `evidence_bundle` requires `findingId`.
- `verification_commands` accepts `findingId`, but can also return scan-level handoff commands when no finding id is provided.
- `export_static_intelligence` ignores filters and returns Phase 29 export payload.
- `topK` default is `10`, min `1`, max `50`.
- `includeSemantic` default is `false`.
- `includeCommunities` default is `true` when Phase 31 is available.
- `includeLandscape` default is `true` for `project_overview` and `risk_context`.
- `includeMarkdown` default is `false`.
- Boolean CLI flags only accept `true` or `false`.
- Unknown query kind is invalid input.

Invalid combinations must return JSON failure with exit code `2` from CLI.

## Output Schema

```ts
type StaticIntelligenceAgentQueryResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  scanRunId: string;
  queryKind: StaticIntelligenceAgentQueryKind;
  summary: {
    title: string;
    body: string;
    candidateOnly: true;
  };
  refs: {
    findingIds: string[];
    evidenceRefs: string[];
    artifactRefs: string[];
    fileRefs: string[];
    sourceRefs: string[];
  };
  results: StaticIntelligenceAgentQueryItem[];
  bundles: {
    export?: StaticIntelligenceExportV1;
    semantic?: StaticIntelligenceSemanticQueryResult;
    communities?: RiskCommunity[];
    landscape?: SecurityLandscape;
    markdown?: string;
  };
  degradedReasons: string[];
};

type StaticIntelligenceAgentQueryItem = {
  id: string;
  kind:
    | "finding"
    | "file_risk"
    | "evidence"
    | "artifact"
    | "community"
    | "landscape"
    | "verification_command"
    | "semantic_candidate";
  title: string;
  score?: number;
  candidateOnly: true;
  findingIds: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
  fileRefs: string[];
  sourceRefs: string[];
  metadata: Record<string, unknown>;
};
```

Failure output:

```ts
type StaticIntelligenceAgentQueryFailure = {
  ok: false;
  status: "failed";
  message: string;
  degradedReasons?: string[];
};
```

Output rules:

- Success output must validate before being written to stdout.
- `summary.body` must be deterministic and concise.
- `summary.body` must not claim confirmed vulnerability based on aggregation or semantic similarity.
- `candidateOnly` is always `true` for generated summaries and result items.
- Every result item must include at least one provenance ref.
- Project-level overview items use `sourceRefs` such as `scan:<scanRunId>` and `project:<projectId>`.
- Verification command items use `sourceRefs` such as `handoff:<scanRunId>` plus related finding/file refs when available.
- `bundles.markdown` is only included when `includeMarkdown` is true.
- raw evidence snippets and raw artifact contents are never included.

## Service API

Add `api/modules/static-intelligence/agent-query.ts`.

Public function:

```ts
async function runStaticIntelligenceAgentQuery(params: {
  db: AppDatabase;
  input: StaticIntelligenceAgentQueryInput;
  semanticProvider?: EmbeddingProvider;
  generatedAt?: Date;
}): Promise<StaticIntelligenceAgentQueryResult>;
```

Responsibilities:

- validate input schema.
- build Phase 29 export.
- route by query kind.
- call Phase 31 builders when available and requested.
- call Phase 30 semantic query only when `includeSemantic` is true and index/provider are available.
- merge refs deterministically.
- validate output schema.

Non-responsibilities:

- DB writes.
- scanner execution.
- task creation.
- MCP protocol handling.
- LSP calls.

Degraded behavior:

- missing semantic index -> completed result with degraded reason.
- missing Phase 31 landscape/community modules -> completed result without those bundles when Phase 31 is not part of the current implementation baseline.
- missing Phase 31 landscape/community modules -> stop condition if the implementation branch claims Phase 31 has landed and imports are expected to resolve.
- missing scan review -> completed result with degraded reason from Phase 29 export.
- no matching related findings -> completed result with empty `results` and degraded reason.

## Query Behavior

### project_overview

Purpose:

- Return scan-level security context for an agent before it starts work.

Input:

- `scanRunId`
- optional `includeCommunities`
- optional `includeLandscape`
- optional `includeMarkdown`

Output:

- summary from scan risk band, evidence quality, review status, and handoff availability.
- file risk rows as `file_risk` items.
- Phase 31 landscape bundle when available/requested.
- Phase 31 communities when available/requested.
- refs across all file risk entries.

Must not:

- call semantic search by default.
- say zero findings means safe.

### risk_context

Purpose:

- Return focused context around a natural-language question, file, rule, scanner, or finding.

Input:

- `query` and/or exact filters.
- `includeSemantic` optional.
- `topK` optional.

Behavior:

1. exact match file/rule/scanner/finding against Phase 29 export.
2. include matching file risk entries and graph neighbors.
3. include Phase 31 communities intersecting the refs when available.
4. include Phase 30 semantic candidates only when requested.
5. if only `query` is provided and semantic enrichment is unavailable, return an empty exact result with degraded reason instead of failing.

Output:

- mixed `finding`, `file_risk`, `community`, and `semantic_candidate` items.
- candidate-only summary explaining which basis matched.

### related_findings

Purpose:

- Find findings related by same file, same scanner/rule, graph adjacency, community membership, or optional semantic similarity.

Input:

- `findingId`, `file`, `ruleId`, `scanner`, or `query`.

Behavior:

- same file and same rule are exact signals.
- same community is graph/community signal.
- semantic result is candidate signal only.
- exclude the seed `findingId` from related items unless it is needed as context metadata.
- if only `query` is provided and semantic enrichment is unavailable, return an empty result with degraded reason.

Output:

- `finding` and `community` items.
- each related finding item includes basis metadata.

### evidence_bundle

Purpose:

- Return the minimal evidence context for one finding.

Input:

- `findingId`
- optional `includeMarkdown`

Behavior:

- locate finding graph node.
- collect `evidenced_by` edges.
- collect `stored_as` artifact refs.
- collect located file ref.
- include scan review handoff only as high-level remediation context.

Output:

- `finding`, `evidence`, `artifact`, and `file_risk` items.
- no raw snippet.
- no raw artifact body.

### verification_commands

Purpose:

- Return commands an external agent can run to verify a fix or confirm current behavior.

Input:

- optional `findingId`.

Behavior:

- if handoff exists, return `handoff.verificationCommands`.
- if finding id is provided, include related finding/file refs.
- if no handoff commands exist, return empty results with degraded reason.
- if finding id is provided and the finding does not exist in the export, return exit code `2` from CLI and JSON failure.

Output:

- `verification_command` items.
- command strings appear in metadata as stored handoff commands.
- commands are not executed.

### export_static_intelligence

Purpose:

- Return Phase 29 export through the same agent query envelope.

Input:

- `scanRunId`

Output:

- `bundles.export`.
- summary refs from export.
- no additional analysis.

## CLI

Add:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind risk_context \
  --query "auth 周りの入力検証と認可境界のリスク"
```

Options:

```text
--scan-run-id <uuid> required
--kind <query-kind> required
--query <text> optional
--finding-id <uuid> optional
--file <path> optional
--rule-id <ruleId> optional
--scanner <scanner> optional
--include-semantic true|false optional, default false
--include-communities true|false optional
--include-landscape true|false optional
--include-markdown true|false optional, default false
--top-k <number> optional, default 10
--pretty true|false optional, default false
```

CLI parsing rules:

- `--kind` is copied into `queryKind`.
- `--top-k` is parsed as integer and validated by the input schema.
- boolean options must be omitted, `true`, or `false`; any other value exits `2`.
- unknown options are rejected by `parseArgs`.
- missing required options exit `2`.

Package script:

```json
"intelligence:agent-query": "bun run api/cli/intelligence-agent-query.ts"
```

stdout:

- JSON object 1 件のみ。

stderr:

- diagnostics only.
- no progress logs.

Exit code:

| Code | Meaning |
| ---: | --- |
| 0 | query completed, including degraded-but-usable output |
| 1 | runtime / DB / provider failure |
| 2 | invalid argument, scan run not found, invalid query kind |

Examples:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind project_overview \
  --pretty true
```

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind evidence_bundle \
  --finding-id <finding-id> \
  --include-markdown true
```

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind related_findings \
  --file api/routes/auth.ts \
  --include-semantic false
```

## MCP Wrapper Design

This phase does not implement MCP. It only defines a wrapper-safe contract.

Future thin wrapper tools should map directly to `runStaticIntelligenceAgentQuery`:

```text
vuln_project_overview -> project_overview
vuln_find_risk_context -> risk_context
vuln_find_related_findings -> related_findings
vuln_get_evidence_bundle -> evidence_bundle
vuln_get_verification_commands -> verification_commands
vuln_export_static_intelligence -> export_static_intelligence
```

Wrapper rules:

- wrapper must not read SQLite directly.
- wrapper must not execute scanners.
- wrapper must not mutate queue/task state.
- wrapper must return the same result schema as CLI/service.
- wrapper may add transport metadata outside the result object, but must not rewrite result semantics.

## Optional Markdown Bundle

Markdown is useful for external coding agents, but JSON remains the contract.

When `includeMarkdown` is true:

- add `bundles.markdown`.
- markdown is generated from the same result object.
- markdown must include source refs inline.
- markdown must not include raw snippets or raw artifacts.
- markdown must not be written to stdout outside the JSON object.

Suggested sections:

```text
# Static Intelligence Context
## Summary
## Findings
## Evidence
## Files
## Verification Commands
## Degraded Reasons
```

## Implementation Steps

1. Shared schema
   - add `shared/schemas/static-intelligence-agent-query.schema.ts`.
   - define input, result, item, failure, query kind schemas.
   - completion: schemas parse representative success and failure payloads.

2. Service function
   - add `api/modules/static-intelligence/agent-query.ts`.
   - implement query routing over Phase 29 export.
   - add optional hooks for Phase 30 semantic and Phase 31 landscape/community.
   - completion: service returns valid result for every query kind.

3. Ref collection helpers
   - implement helpers to collect finding/evidence/artifact/file/source refs from export graph and file risk index.
   - keep helpers local unless reused by Phase 31 implementation.
   - completion: every non-overview result has provenance refs.

4. Markdown bundle helper
   - implement deterministic markdown rendering from result object.
   - only include when requested.
   - completion: markdown contains refs and excludes snippets/artifact content.

5. CLI
   - add `api/cli/intelligence-agent-query.ts`.
   - parse args with `node:util.parseArgs`.
   - map CLI args to input schema.
   - close SQLite connection in `finally`.
   - completion: stdout is one JSON object, exit codes match the contract.

6. Tests
   - add service tests and CLI tests.
   - reuse Phase 29 in-memory DB pattern.
   - completion: focused tests and repo verification pass.

## Tests

Add `api/modules/static-intelligence/agent-query.test.ts`.

Minimum service tests:

1. project overview
   - seed scan with findings, evidence, artifact, completed review.
   - expect summary, file risk items, refs, and candidateOnly.

2. zero finding overview
   - seed completed scan with no findings.
   - expect completed result, empty risk items, degraded or neutral wording, no safe/secure claim.

3. risk context by file
   - seed multiple files.
   - query with `file`.
   - expect only matching file/finding refs.

4. related findings by rule
   - seed two findings with same scanner/rule.
   - expect both related by exact rule basis.

5. evidence bundle
   - seed finding with evidence and artifact.
   - expect evidence refs and artifact refs.
   - serialized output does not contain evidence snippet or artifact raw metadata.

6. verification commands
   - seed scan review handoff with verification commands.
   - expect `verification_command` items.
   - no commands are executed.

7. export wrapper
   - `export_static_intelligence` includes Phase 29 export in `bundles.export`.

8. semantic degraded path
   - request `includeSemantic: true` without an index/provider.
   - expect completed exact/graph result with degraded reason.
   - if only natural-language `query` is provided, expect empty results plus degraded reason.

9. invalid input
   - missing required `findingId` for `evidence_bundle`.
   - invalid `topK`.
   - unknown query kind.
   - invalid boolean flag.

10. Phase 31 unavailable path
   - request `includeCommunities: true` or `includeLandscape: true` while no Phase 31 builders are wired.
   - expect completed result with the corresponding bundle omitted and degraded reason.

Add `api/modules/static-intelligence/intelligence-agent-query-cli.test.ts`.

Minimum CLI tests:

- `project_overview` returns exit code `0` and valid JSON.
- `evidence_bundle` missing finding id returns exit code `2` and JSON failure.
- missing scan run returns exit code `2`.
- `--pretty true` still writes one JSON object.

## Verification Commands

After implementation:

```bash
bun test ./api/modules/static-intelligence/agent-query.test.ts
bun test ./api/modules/static-intelligence/intelligence-agent-query-cli.test.ts
bun run typecheck
bun run verify
```

Manual overview smoke:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <existing-scan-run-id> \
  --kind project_overview \
  --pretty true
```

Expected:

- stdout is one JSON object.
- `ok` is `true`.
- `summary.candidateOnly` is `true`.
- output contains source refs.

Manual evidence smoke:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <existing-scan-run-id> \
  --kind evidence_bundle \
  --finding-id <existing-finding-id> \
  --include-markdown true
```

Expected:

- stdout is one JSON object.
- evidence refs and artifact refs are present when available.
- `bundles.markdown` exists.
- raw snippets and raw artifact contents are absent.

Manual semantic degraded smoke:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <existing-scan-run-id> \
  --kind risk_context \
  --query "auth 周りの入力検証と認可境界のリスク" \
  --include-semantic true
```

Expected:

- if semantic index/provider exists, semantic candidates are included.
- if not, exact/graph results still return and `degradedReasons` explains missing semantic enrichment.

## Failure Handling

Invalid arguments:

- exit code `2`
- JSON failure

Scan run not found:

- exit code `2`
- JSON failure

Missing requested finding:

- exit code `2` for `evidence_bundle`.
- completed empty result with degraded reason for broad context query, if finding id is optional.

Semantic provider failure:

- if `includeSemantic` is true, return completed exact/graph result with degraded reason.
- if no exact/graph basis exists, return completed empty result with degraded reason.
- do not silently label text-only results as semantic.

Phase 31 builder failure:

- if Phase 31 modules are not part of the current implementation baseline, omit communities/landscape and add degraded reason when requested.
- if Phase 31 modules are part of the current implementation baseline but runtime fails, exit code `1`.
- completed result with degraded reason is allowed only when the selected query kind can still return meaningful Phase 29 export refs.

Malformed output:

- fail before stdout success.
- exit code `1`.

## Stop Conditions

Stop and revise the plan if any of these happen:

- Agent Query starts executing scanners.
- Agent Query writes DB rows.
- MCP implementation enters the phase.
- CLI stdout includes progress logs.
- result items lack provenance refs.
- semantic similarity is treated as confirmed vulnerability evidence.
- zero finding is described as safe or secure.
- LSP becomes a required runtime dependency.
- raw evidence snippets or raw artifact contents enter output.
- external agent lifecycle, task compile, or queue admission enters implementation.

## Completion Definition

Phase 32 is complete when:

```bash
bun run intelligence:agent-query -- --scan-run-id <scan-run-id> --kind project_overview
bun run intelligence:agent-query -- --scan-run-id <scan-run-id> --kind evidence_bundle --finding-id <finding-id>
bun run intelligence:agent-query -- --scan-run-id <scan-run-id> --kind verification_commands
```

all return valid JSON, results are candidate-only and provenance-backed, missing semantic/landscape data is represented as degraded output, and the verification command set passes.

External adapter implementation, MCP server implementation, LSP enrichment, task graph generation, queue admission, scanner execution, and patch application are not part of this phase.
