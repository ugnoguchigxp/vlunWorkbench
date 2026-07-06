# Phase 36: Static Intelligence Read-only MCP Wrapper Plan

## Purpose

この計画は、Phase 34-35 で安定化した Static Intelligence CLI / service functions を、read-only MCP tools として公開する。

MCP は primary automation path ではない。CLI と stable JSON output が主導線であり、MCP は contextStill / Codex / NightWorkers が discovery や interactive access に使う thin wrapper として扱う。

```text
MCP tool call
  -> read-only tool handler
  -> existing Static Intelligence service function
  -> schema-validated JSON result
```

この phase の価値は、外部 agent が vulnWorkbench SQLite を直接読まずに、Phase 34 manifest と Phase 35 guardrail material を発見・取得できることにある。

## Dependencies

Phase 36 は Phase 34-35 の完了後に実装する。

Required Phase 34 APIs:

- `buildStaticIntelligenceKnowledgeSourceManifestForScan(db, scanRunId, options?)`
- `StaticIntelligenceKnowledgeSourceManifestResult`
- `StaticIntelligenceKnowledgeSourceManifestFailure`

Required Phase 35 APIs:

- `buildStaticIntelligenceGuardrailMaterialForScan(db, scanRunId, options?)`
- `StaticIntelligenceGuardrailMaterialResult`
- `StaticIntelligenceGuardrailMaterialFailure`

Required existing APIs:

- `runStaticIntelligenceAgentQuery(...)`
- `buildStaticIntelligenceExport(db, scanRunId)`
- `StaticIntelligenceScanRunNotFoundError`
- static-intelligence agent query schemas.

If Phase 35 is not implemented, do not implement a partial MCP server that omits `vuln_get_guardrail_material`. Finish Phase 35 first so Phase 36 can expose the stable read-only source surface as one coherent wrapper.

## Product Boundary

MCP wrapper が担当すること:

- Static Intelligence knowledge source の read-only discovery。
- manifest / guardrail material / evidence bundle / verification command の取得。
- CLI と同じ schema-compatible JSON を返す。
- tool descriptions に source-of-truth / candidate-only / read-only 境界を明記する。
- MCP transport concerns を CLI/service logic から分離する。

MCP wrapper が担当しないこと:

- scanner execution。
- DAST / dynamic check execution。
- DB schema direct access API。
- arbitrary SQL query。
- arbitrary file read。
- contextStill candidate registration。
- contextStill active knowledge 作成。
- NightWorkers task lifecycle。
- queue admission。
- patch application。
- raw artifact body download。
- evidence snippet download。
- CLI contract の変更。

## Current Baseline

現状:

- repo 内に MCP server 実装はない。
- `@modelcontextprotocol/sdk` 依存はまだない。
- Static Intelligence は CLI-first で進んでいる。
- Phase 34 の `intelligence:knowledge-source` は manifest discovery の primary path。
- Phase 35 の `intelligence:guardrail-material` は guardrail material の primary path。

既存の参考実装:

- `api/cli/intelligence-agent-query.ts`
  - argument parse / error JSON / DB close pattern。
- `api/modules/static-intelligence/agent-query.ts`
  - read-only evidence / verification command query。
- `api/modules/static-intelligence/knowledge-source-manifest.ts`
  - Phase 34 manifest service。
- `api/modules/static-intelligence/guardrail-material.ts`
  - Phase 35 guardrail material service after implementation。
- static-intelligence CLI tests:
  - temp SQLite。
  - migration application。
  - `spawnSync(process.execPath, [...])`。

## Architecture

Implement three layers.

```text
api/modules/static-intelligence/mcp-tool-schemas.ts
  shared zod input/output schemas for MCP handlers

api/modules/static-intelligence/mcp-tools.ts
  transport-independent handler functions
  accepts AppDatabase + input
  returns plain JSON result objects

api/cli/static-intelligence-mcp-server.ts
  MCP stdio server
  registers tools
  opens DB per tool call or through a scoped helper
  wraps handler results as MCP tool content
```

Rationale:

- handler tests do not need MCP transport.
- server smoke tests can stay small.
- CLI stdout behavior remains isolated in CLI files.
- MCP SDK API changes should affect only the server entrypoint, not Static Intelligence product logic.

## Tool Surface

Initial tools:

```text
vuln_list_knowledge_sources
vuln_get_knowledge_source_manifest
vuln_get_guardrail_material
vuln_get_evidence_bundle
vuln_get_verification_commands
```

Do not add mutation tools in this phase.

### Common Response Rule

Handler functions return plain JSON objects.

MCP server wraps handler output as JSON text content:

```ts
{
  content: [
    {
      type: "text",
      text: JSON.stringify(result)
    }
  ]
}
```

If the MCP SDK version supports structured content in a stable way at implementation time, the server may include it as an additional field, but JSON text remains the compatibility baseline.

Tool-level expected JSON failure:

```ts
type StaticIntelligenceMcpToolFailure = {
  ok: false;
  status: "failed";
  message: string;
};
```

Invalid input and missing scan/finding should return schema-compatible failure JSON rather than throwing protocol-level errors. Protocol-level errors are reserved for server startup and malformed MCP transport.

### `vuln_list_knowledge_sources`

Input:

```ts
{
  projectId?: string;
  limit?: number; // default 20, min 1, max 100
}
```

Output:

```ts
type StaticIntelligenceKnowledgeSourceListResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  sources: Array<{
    sourceId: string;
    projectId: string;
    projectName: string;
    scanRunId: string;
    scanProfile: string;
    scanStatus: string;
    findingCount: number;
    reviewStatus: "completed" | "failed" | "missing";
    riskBand: "none" | "low" | "medium" | "high" | "critical" | "unknown";
    evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
    contentHash: string;
    exportHash: string;
    generatedAt: string;
    command: string[];
  }>;
  degradedReasons: string[];
};
```

Implementation:

- Query recent `scanRuns` joined with `projects`.
- Sort newest first by `scanRuns.updatedAt`, then id.
- For each scan run, call `buildStaticIntelligenceKnowledgeSourceManifestForScan`.
- Use manifest fields for `sourceId`, `contentHash`, `exportHash`, risk, review status, project.
- `command` should match Phase 34 manifest fetch command:
  - `["bun", "run", "intelligence:knowledge-source", "--", "--scan-run-id", scanRunId]`
- If a scan run cannot build manifest because source data is missing, skip it and add a degraded reason.
- Do not return project root path.

This tool may query vulnWorkbench storage through server-side code because it runs inside vulnWorkbench. External consumers still access through MCP only.

### `vuln_get_knowledge_source_manifest`

Input:

```ts
{
  scanRunId: string;
}
```

Output:

- Same success shape as Phase 34 CLI:

```ts
StaticIntelligenceKnowledgeSourceManifestResult
```

Failure:

```ts
StaticIntelligenceKnowledgeSourceManifestFailure
```

Implementation:

- Call `buildStaticIntelligenceKnowledgeSourceManifestForScan(db, scanRunId)`.
- Wrap into:
  - `ok: true`
  - `status: "completed"`
  - `version: "v1"`
  - `generatedAt: manifest.generatedAt`
  - `manifest`

### `vuln_get_guardrail_material`

Input:

```ts
{
  scanRunId: string;
  type?:
    | "security_guardrail_material"
    | "verification_recipe_material"
    | "false_positive_lesson_material"
    | "agent_actionability_lesson_material"
    | "scanner_tuning_lesson_material";
  includeMarkdown?: boolean; // default false
}
```

Output:

- Same success shape as Phase 35 CLI:

```ts
StaticIntelligenceGuardrailMaterialResult
```

Failure:

```ts
StaticIntelligenceGuardrailMaterialFailure
```

Implementation:

- Call `buildStaticIntelligenceGuardrailMaterialForScan`.
- Do not call contextStill.
- Do not register candidates.
- Do not infer active/rejected/deprecated state.

### `vuln_get_evidence_bundle`

Input:

```ts
{
  scanRunId: string;
  findingId: string;
}
```

Output:

- Same success shape as:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scanRunId> \
  --kind evidence_bundle \
  --finding-id <findingId>
```

Implementation:

- Call `runStaticIntelligenceAgentQuery` with:
  - `queryKind: "evidence_bundle"`
  - `scanRunId`
  - `findingId`
  - `includeSemantic: false`
  - `includeCommunities: false`
  - `includeLandscape: false`
- Return the service result directly after schema validation.
- No raw snippets or artifact bodies.

### `vuln_get_verification_commands`

Input:

```ts
{
  scanRunId: string;
  findingId?: string;
}
```

Output:

- Same success shape as:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scanRunId> \
  --kind verification_commands
```

Implementation:

- Call `runStaticIntelligenceAgentQuery` with:
  - `queryKind: "verification_commands"`
  - `scanRunId`
  - optional `findingId`
  - `includeSemantic: false`
  - `includeCommunities: false`
  - `includeLandscape: false`
- Commands are not executed.
- Preserve Phase 33 provenance hardening:
  - verification commands are scan-level unless explicit mapping exists.
  - no over-attribution to finding/file/evidence refs.

## MCP Server Contract

Add package dependency:

```bash
bun add @modelcontextprotocol/sdk
```

Implementation should use the official MCP TypeScript SDK available at implementation time. Expected shape if the SDK exports remain compatible:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

If the SDK API differs, adapt only `api/cli/static-intelligence-mcp-server.ts`. Do not change handler contracts to match SDK transport details.

Server requirements:

- stdio transport only in Phase 36.
- no HTTP listener.
- no background daemon.
- no auto-registration into contextStill.
- no NightWorkers integration.
- tools are registered with explicit descriptions.
- each tool opens a DB connection through `readAppEnv()` / `createDbConnection()` and closes SQLite in `finally`, unless a safe server-scoped lifecycle is implemented and covered by tests.
- tool descriptions must say:
  - read-only.
  - candidate-only where applicable.
  - commands are not executed.
  - raw artifact body and evidence snippets are not returned.

Package script:

```json
"mcp:static-intelligence": "bun run api/cli/static-intelligence-mcp-server.ts"
```

Optional server flags:

```bash
bun run mcp:static-intelligence -- --help
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

Flag behavior:

- `--help` prints concise usage to stdout and exits 0.
- `--list-tools` prints one JSON object with tool names and input schemas, exits 0, and does not open DB.
- `--smoke` validates server construction and tool registration, exits 0, and does not require a real scan run.

Normal MCP mode must not print logs to stdout because stdout is the MCP protocol stream. Diagnostics go to stderr.

## Implementation Tasks

### Task 1: Add MCP Schemas

Files:

- add `api/modules/static-intelligence/mcp-tool-schemas.ts`
- optionally add `shared/schemas/static-intelligence-mcp.schema.ts` if schemas need to be consumed outside `api`.

Implementation:

- Define input schemas:
  - `listKnowledgeSourcesInputSchema`
  - `getKnowledgeSourceManifestInputSchema`
  - `getGuardrailMaterialInputSchema`
  - `getEvidenceBundleInputSchema`
  - `getVerificationCommandsInputSchema`
- Define output schema:
  - `staticIntelligenceKnowledgeSourceListResultSchema`
  - `staticIntelligenceMcpToolFailureSchema`
- Reuse Phase 34/35/agent-query schemas for existing output shapes.
- Keep `limit` defaulting in handler or schema, not in transport code.
- Keep all input objects strict enough to reject unknown or mistyped fields.

Verification:

```bash
bun run typecheck
```

Expected:

- schemas compile without importing CLI modules.
- no dependency on MCP SDK in schema file.

Failure handling:

- If schema imports create cycles, keep MCP schemas in `api/modules/static-intelligence` and import shared schemas one way only.

### Task 2: Add Transport-independent Tool Handlers

Files:

- add `api/modules/static-intelligence/mcp-tools.ts`
- add `api/modules/static-intelligence/mcp-tools.test.ts`

Implementation:

- Export handler functions:

```ts
export async function listStaticIntelligenceKnowledgeSources(
  params: { db: AppDatabase; input: unknown; generatedAt?: Date }
): Promise<StaticIntelligenceKnowledgeSourceListResult | StaticIntelligenceMcpToolFailure>;

export async function getStaticIntelligenceKnowledgeSourceManifestTool(
  params: { db: AppDatabase; input: unknown }
): Promise<StaticIntelligenceKnowledgeSourceManifestResult | StaticIntelligenceKnowledgeSourceManifestFailure>;

export async function getStaticIntelligenceGuardrailMaterialTool(
  params: { db: AppDatabase; input: unknown }
): Promise<StaticIntelligenceGuardrailMaterialResult | StaticIntelligenceGuardrailMaterialFailure>;

export async function getStaticIntelligenceEvidenceBundleTool(
  params: { db: AppDatabase; input: unknown }
): Promise<StaticIntelligenceAgentQueryResult | StaticIntelligenceAgentQueryFailure>;

export async function getStaticIntelligenceVerificationCommandsTool(
  params: { db: AppDatabase; input: unknown }
): Promise<StaticIntelligenceAgentQueryResult | StaticIntelligenceAgentQueryFailure>;
```

- Export a registry:

```ts
export const staticIntelligenceMcpToolRegistry = [
  {
    name: "vuln_list_knowledge_sources",
    description: "...",
    inputSchema: listKnowledgeSourcesInputSchema,
    handler: listStaticIntelligenceKnowledgeSources
  },
  ...
];
```

- Handlers must:
  - parse input with zod.
  - catch validation errors and return failure JSON.
  - catch `StaticIntelligenceScanRunNotFoundError` and return failure JSON.
  - never throw for normal user input.
  - call only read-only service functions.
  - not import CLI files.
  - not spawn subprocesses.

Tests:

- invalid input returns failure JSON.
- missing scan returns failure JSON.
- manifest handler matches Phase 34 result shape.
- guardrail handler matches Phase 35 result shape.
- evidence bundle handler returns agent query result with `queryKind: "evidence_bundle"`.
- verification commands handler returns candidate-only commands and does not execute them.

Verification:

```bash
bun test ./api/modules/static-intelligence/mcp-tools.test.ts
```

Expected:

- handler tests pass without starting MCP transport.

Failure handling:

- If a handler needs CLI behavior, move shared behavior into service modules rather than importing CLI code.

### Task 3: Implement `vuln_list_knowledge_sources`

Files:

- update `api/modules/static-intelligence/mcp-tools.ts`
- update `api/modules/static-intelligence/mcp-tools.test.ts`

Implementation:

- Add a small read-only query for recent scan runs.
- Use `scanRuns` and `projects` from `api/db/schema.ts`.
- Optional `projectId` filters scan runs.
- `limit` defaults to 20, max 100.
- For each candidate scan run:
  - build Phase 34 manifest.
  - return source summary from manifest.
- Do not return `project.repoPath`.
- Degraded behavior:
  - if one scan run cannot produce manifest, skip it and add `scan <id> skipped: <message>`.
  - if all scan runs fail, return `ok: true` with empty `sources` and degraded reasons.

Tests:

- lists recent sources newest first.
- filters by project id.
- applies limit.
- output includes manifest content hash and command.
- output excludes repo path.

Verification:

```bash
bun test ./api/modules/static-intelligence/mcp-tools.test.ts
```

Failure handling:

- If list query becomes heavy, keep max limit at 100 and avoid building exports for unbounded rows.

### Task 4: Add MCP Server Entrypoint

Files:

- add `api/cli/static-intelligence-mcp-server.ts`
- update `package.json`
- update lockfile through package manager when adding MCP SDK.

Implementation:

- Add script:

```json
"mcp:static-intelligence": "bun run api/cli/static-intelligence-mcp-server.ts"
```

- Add CLI flags:
  - `--help`
  - `--list-tools`
  - `--smoke`
- Normal mode:
  - create MCP server.
  - register all tools from `staticIntelligenceMcpToolRegistry`.
  - for each call:
    - open DB.
    - call handler.
    - close DB in `finally`.
    - return JSON text content.
  - connect `StdioServerTransport`.
- `--list-tools`:
  - prints one JSON object:

```ts
{
  ok: true;
  status: "completed";
  tools: Array<{
    name: string;
    description: string;
  }>;
}
```

- `--smoke`:
  - constructs server and registry.
  - verifies all expected tool names are present.
  - prints one JSON object and exits 0.

Verification:

```bash
bun run mcp:static-intelligence -- --help
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

Expected:

- each command exits 0.
- stdout is one parseable object for `--list-tools` and `--smoke`.
- no DB required for `--list-tools` or `--smoke`.

Failure handling:

- If SDK startup is noisy on stdout, move diagnostics to stderr or keep smoke/list modes outside SDK transport.

### Task 5: Add Server Smoke Tests

Files:

- add `api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts`

Implementation:

- Use `spawnSync(process.execPath, ["api/cli/static-intelligence-mcp-server.ts", "--list-tools"], ...)`.
- Use `spawnSync(process.execPath, ["api/cli/static-intelligence-mcp-server.ts", "--smoke"], ...)`.
- Assert:
  - status 0.
  - stdout parseable JSON.
  - expected tool names present.
  - stderr empty or only known SDK non-fatal diagnostics if unavoidable.
- Do not run an interactive stdio MCP session in unit tests unless the SDK provides stable test helpers.

Verification:

```bash
bun test ./api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
```

Expected:

- server entrypoint can be discovered and smoke-checked without DB mutation.

Failure handling:

- If transport testing becomes flaky, keep unit tests focused on handlers and smoke/list flags.

### Task 6: Add CLI-equivalence Tests for Tool Handlers

Files:

- update `api/modules/static-intelligence/mcp-tools.test.ts`

Implementation:

- Use temp SQLite fixture pattern from existing static-intelligence CLI tests.
- Seed:
  - project.
  - completed scan run.
  - high severity finding with evidence/artifact.
  - completed scan review with handoff and verification command.
- For manifest:
  - call Phase 34 service directly.
  - call MCP handler.
  - compare `manifest.source.contentHash`, `exportHash`, `availableBundles`.
- For guardrail material:
  - call Phase 35 service directly.
  - call MCP handler.
  - compare material ids and sourceManifest.
- For evidence bundle:
  - call `runStaticIntelligenceAgentQuery`.
  - call MCP handler.
  - compare queryKind, refs, result ids.
- For verification commands:
  - assert candidate-only.
  - assert commands are not executed.
  - assert no finding/file/evidence over-attribution.

Verification:

```bash
bun test ./api/modules/static-intelligence/mcp-tools.test.ts
```

Expected:

- MCP handlers are schema-compatible with service/CLI surfaces.

Failure handling:

- If outputs diverge because CLI adds envelopes, move envelope construction into shared service code and reuse it from CLI and MCP.

### Task 7: Add Read-only / No-mutation Tests

Files:

- update `api/modules/static-intelligence/mcp-tools.test.ts`

Implementation:

- Record row counts before and after each handler call for key tables:
  - `scanRuns`
  - `findings`
  - `findingEvidences`
  - `scanArtifacts`
  - `scanReviews`
  - `toolRuns`
- Call each handler.
- Assert row counts unchanged.
- Also assert no handler imports or invokes:
  - scan runners.
  - review writers.
  - contextStill registration.
  - NightWorkers integrations.

Verification:

```bash
bun test ./api/modules/static-intelligence/mcp-tools.test.ts
```

Expected:

- all handler calls preserve DB row counts.

Failure handling:

- If a service function mutates generated metadata, do not use it in Phase 36. Add a read-only service variant first.

### Task 8: Add Redaction Regression Tests

Files:

- update `api/modules/static-intelligence/mcp-tools.test.ts`

Implementation:

- Seed marker strings into:
  - evidence snippet.
  - artifact metadata `rawContent`.
  - project repo path temp dir.
- Call:
  - manifest tool.
  - guardrail material tool.
  - evidence bundle tool.
  - verification commands tool.
  - list tool.
- Serialize outputs.
- Assert output does not contain:
  - raw snippet marker.
  - raw artifact marker.
  - temp repo path.
  - `SECRET_` marker.

Verification:

```bash
bun test ./api/modules/static-intelligence/mcp-tools.test.ts
```

Expected:

- MCP wrapper preserves Phase 34/35 and agent-query redaction guarantees.

Failure handling:

- If wrapper reintroduces raw fields, remove them at source service output rather than adding MCP-only filtering.

### Task 9: Update Documentation and Cross-phase Fixture Plan

Files:

- update `spec/phase-37-static-intelligence-knowledge-source-e2e-fixture-plan.md` only if Phase 36 changes command/tool names or smoke behavior.
- optionally add a short `spec/static-intelligence-mcp-tool-contract.md` if implementation needs a stable external contract document.

Implementation:

- Ensure Phase 37 can use:
  - `bun run mcp:static-intelligence -- --smoke`
  - MCP tool names from this phase.
  - same schema names as Phase 34/35.
- Do not document direct DB access as a consumer path.
- Do not add contextStill registration steps.

Verification:

```bash
rg -n "mcp:static-intelligence|vuln_get_knowledge_source_manifest|vuln_get_guardrail_material|vuln_list_knowledge_sources" spec/phase-3*.md
```

Expected:

- later plans reference the same tool names and script.

Failure handling:

- If docs disagree with implementation, update docs before starting Phase 37.

### Task 10: Run Final Verification

Commands:

```bash
bun test ./api/modules/static-intelligence/mcp-tools.test.ts
bun test ./api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

Expected:

- handler tests pass.
- server smoke tests pass.
- existing static-intelligence tests pass.
- full repo verification passes.

Failure handling:

- If MCP SDK dependency causes type errors, isolate SDK usage to server entrypoint and keep handler tests green.
- If `bun run verify` fails due to formatting, run `bunx biome format --write` only for files touched by this phase, then rerun verify.
- If full verify fails on unrelated existing worktree changes, capture exact failure and run targeted static-intelligence gates before stopping.

## Implementation Order

Recommended order:

1. MCP input/output schemas.
2. transport-independent handlers.
3. `vuln_list_knowledge_sources`.
4. handler unit tests.
5. MCP SDK dependency + stdio server entrypoint.
6. server smoke/list flags.
7. server CLI tests.
8. CLI-equivalence, read-only, and redaction regression tests.
9. docs cross-check.
10. final verification.

Do not start with contextStill registration, NightWorkers adapter, HTTP server, daemon lifecycle, or scan execution.

## Review Checklist

- [ ] Phase 34 manifest service is reused for manifest output.
- [ ] Phase 35 guardrail material service is reused for material output.
- [ ] handler layer does not import CLI files.
- [ ] MCP server layer does not implement Static Intelligence product logic.
- [ ] all tools are read-only.
- [ ] no tool accepts SQL.
- [ ] no tool accepts arbitrary file path.
- [ ] no tool returns project root path.
- [ ] no tool returns raw artifact body.
- [ ] no tool returns evidence snippet.
- [ ] no tool executes verification commands.
- [ ] verification command refs remain scan-level unless explicit mapping exists.
- [ ] invalid input returns failure JSON.
- [ ] missing scan/finding returns failure JSON.
- [ ] `vuln_list_knowledge_sources` is bounded by max limit 100.
- [ ] `--list-tools` and `--smoke` do not require DB.
- [ ] normal MCP mode writes protocol messages only to stdout.
- [ ] diagnostics go to stderr.
- [ ] row-count tests prove no DB mutation.
- [ ] no code path calls contextStill MCP.
- [ ] no code path creates NightWorkers tasks.

## Stop Conditions

- MCP becomes the primary scanner or Static Intelligence execution path.
- MCP exposes DB table access.
- MCP accepts raw SQL.
- MCP accepts arbitrary file read paths.
- MCP performs contextStill registration.
- MCP creates NightWorkers tasks.
- MCP runs scanner / DAST / dynamic checks.
- MCP executes verification commands.
- MCP returns raw artifact content or raw evidence snippets.
- Tool output diverges from Phase 34/35/agent-query schemas without updating the shared service contract first.
- Handler implementation requires Phase 35 to be skipped or partially stubbed.

## Completion Definition

This phase is complete when an external agent can discover and fetch Static Intelligence knowledge sources through read-only MCP tools, with the same safety and provenance guarantees as the CLI surface.

Concrete completion evidence:

- `bun run mcp:static-intelligence -- --list-tools` returns one JSON object listing:
  - `vuln_list_knowledge_sources`
  - `vuln_get_knowledge_source_manifest`
  - `vuln_get_guardrail_material`
  - `vuln_get_evidence_bundle`
  - `vuln_get_verification_commands`
- `bun run mcp:static-intelligence -- --smoke` exits 0.
- MCP handler output for manifest matches Phase 34 service output.
- MCP handler output for guardrail material matches Phase 35 service output.
- MCP handler output for evidence bundle and verification commands matches agent-query service output.
- all handler calls preserve DB row counts.
- serialized outputs do not include raw snippet, raw artifact body, secret marker, or project root path.
- no contextStill mutation occurs.
- no NightWorkers task is created.
- `bun run verify` passes.
