# Phase 34: Static Intelligence Knowledge Source Manifest Plan

## Purpose

この計画は、contextStill や NightWorkers が vulnWorkbench の Static Intelligence を安全に読みに来るための `KnowledgeSourceManifest` を CLI から取得できるようにする。

中心に置く成果物は raw export 本体ではなく、外部 agent が「読むべき source が何か」「前回から変わったか」「どの bundle を取得できるか」を判断するための manifest である。

```text
scan run
  -> StaticIntelligenceExportV1
  -> StaticIntelligenceKnowledgeSourceManifest
  -> contextStill / NightWorkers pull decision
```

この phase は contextStill への登録や NightWorkers task 生成を行わない。vulnWorkbench は CLI で read-only source identity を返すだけにする。

## Product Boundary

vulnWorkbench が担当すること:

- Static Intelligence export から manifest を作る。
- manifest に source identity / freshness / redaction / available bundles を含める。
- CLI `intelligence:knowledge-source` を追加する。
- stdout は JSON object 1 件だけにする。
- contextStill / NightWorkers が次に呼ぶべき CLI command を machine-readable に返す。
- `contentHash` によって前回取得分との差分判定を可能にする。

vulnWorkbench が担当しないこと:

- contextStill active knowledge の作成。
- contextStill `register_candidates` の実行。
- NightWorkers task graph / queue admission の実装。
- DB 直読み用 adapter の提供。
- MCP 実装。
- raw artifact body、evidence snippet、secret value、private token の公開。
- manifest をもとにした修正優先度や queue 採用判断。

## Current Baseline

既存の関連実装:

- `api/modules/static-intelligence/export-builder.ts`
  - `buildStaticIntelligenceExport(db, scanRunId)`
  - `StaticIntelligenceScanRunNotFoundError`
- `api/cli/intelligence-export.ts`
  - Static Intelligence export CLI pattern。
  - `--scan-run-id`、`--pretty`、stdout JSON、exit code 2 for missing scan。
- `api/cli/intelligence-agent-query.ts`
  - stricter parse / fail / DB close pattern。
  - `fail(exitCode, message, pretty)` が stdout JSON failure を返す。
- `api/modules/static-intelligence/intelligence-agent-query-cli.test.ts`
  - temp SQLite、migration 適用、`spawnSync(process.execPath, [...])` の CLI test pattern。
- `shared/schemas/static-intelligence.schema.ts`
  - `StaticIntelligenceExportV1`
  - risk band / evidence quality enum。
- `package.json`
  - `intelligence:export`
  - `intelligence:agent-query`

現状の不足:

- contextStill が pull 対象を列挙・比較するための manifest がない。
- export の `generatedAt` 以外に、source identity / content hash / redaction status がない。
- available bundle と推奨 CLI command が機械判定できない。
- 同じ scan run を再読込すべきか判断する contract がない。
- export の raw payload を読ませずに、後続 CLI を発見する discovery surface がない。

## Output Contract

Add `shared/schemas/static-intelligence-knowledge-source.schema.ts`.

```ts
type StaticIntelligenceKnowledgeSourceManifestResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  manifest: StaticIntelligenceKnowledgeSourceManifest;
};

type StaticIntelligenceKnowledgeSourceManifestFailure = {
  ok: false;
  status: "failed";
  message: string;
};

type StaticIntelligenceKnowledgeSourceManifest = {
  version: "v1";
  generatedAt: string;
  source: {
    kind: "vulnWorkbench.static_intelligence";
    sourceId: string;
    projectId: string;
    scanRunId: string;
    exportHash: string;
    contentHash: string;
    schemaVersion: "static-intelligence-export-v1";
  };
  project: {
    id: string;
    name: string;
  };
  scan: {
    id: string;
    profile: string;
    status: string;
    findingCount: number;
    reviewStatus: "completed" | "failed" | "missing";
  };
  risk: {
    band: "none" | "low" | "medium" | "high" | "critical" | "unknown";
    evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
    degradedReasons: string[];
  };
  redaction: {
    status: "redacted";
    rawArtifactBodyIncluded: false;
    rawEvidenceSnippetIncluded: false;
    rawSecretIncluded: false;
  };
  availableBundles: Array<{
    kind:
      | "static_intelligence_export"
      | "agent_query"
      | "evidence_bundle"
      | "verification_commands"
      | "guardrail_material";
    command: string[];
    description: string;
    requires?: {
      findingId?: boolean;
      query?: boolean;
    };
  }>;
};
```

### Required Field Rules

- `source.kind` is always `"vulnWorkbench.static_intelligence"`.
- `source.sourceId` is stable and must be `vulnWorkbench.static_intelligence:${scanRunId}`.
- `source.projectId` comes from `exportPayload.project.id`.
- `source.scanRunId` comes from `exportPayload.scan.id`.
- `source.schemaVersion` is always `"static-intelligence-export-v1"`.
- `project.id` / `project.name` come from export project fields.
- `scan.id` / `profile` / `status` / `findingCount` / `reviewStatus` come from export scan fields.
- `risk.band` comes from `exportPayload.scanSummary.riskBand`.
- `risk.evidenceQuality` comes from `exportPayload.scanSummary.evidenceQuality`.
- `risk.degradedReasons` is a sorted unique copy of `exportPayload.scanSummary.degradedReasons`.
- `redaction.status` is always `"redacted"` because manifest never carries raw bodies.
- all `raw*Included` flags are literal `false`.
- `availableBundles` must be deterministic in order.

### Available Bundle Rules

Initial `availableBundles` order:

1. `static_intelligence_export`
2. `agent_query`
3. `evidence_bundle`
4. `verification_commands`
5. `guardrail_material`

Commands must be argv arrays, not shell strings.

```ts
[
  {
    kind: "static_intelligence_export",
    command: [
      "bun",
      "run",
      "intelligence:export",
      "--",
      "--scan-run-id",
      scanRunId
    ],
    description: "Fetch the full Static Intelligence export payload."
  },
  {
    kind: "agent_query",
    command: [
      "bun",
      "run",
      "intelligence:agent-query",
      "--",
      "--scan-run-id",
      scanRunId,
      "--kind",
      "project_overview"
    ],
    description: "Fetch a focused agent-facing overview bundle."
  },
  {
    kind: "evidence_bundle",
    command: [
      "bun",
      "run",
      "intelligence:agent-query",
      "--",
      "--scan-run-id",
      scanRunId,
      "--kind",
      "evidence_bundle",
      "--finding-id",
      "<finding-id>"
    ],
    description: "Fetch evidence for one finding.",
    requires: { findingId: true }
  },
  {
    kind: "verification_commands",
    command: [
      "bun",
      "run",
      "intelligence:agent-query",
      "--",
      "--scan-run-id",
      scanRunId,
      "--kind",
      "verification_commands"
    ],
    description: "Fetch scan-level verification command candidates."
  },
  {
    kind: "guardrail_material",
    command: [
      "bun",
      "run",
      "intelligence:guardrail-material",
      "--",
      "--scan-run-id",
      scanRunId
    ],
    description: "Fetch reusable guardrail material when Phase 35 is available."
  }
]
```

`guardrail_material` is allowed in the manifest before Phase 35 implementation because it is a discoverability contract for the next phase. It must not be executed by Phase 34 tests unless the command exists.

## Hash Contract

Add deterministic helpers in `api/modules/static-intelligence/knowledge-source-manifest.ts`.

```ts
function canonicalJson(value: unknown): string;
function sha256Hex(value: string): string;
function buildStaticIntelligenceKnowledgeSourceManifest(
  exportPayload: StaticIntelligenceExportV1,
  options?: { generatedAt?: Date }
): StaticIntelligenceKnowledgeSourceManifest;
```

Hash rules:

- `exportHash` is `sha256(canonicalJson(exportPayloadWithoutGeneratedAt))`.
- `contentHash` is `sha256(canonicalJson(manifestWithoutGeneratedAtAndContentHash))`.
- JSON canonicalization must sort object keys recursively.
- Array order must be preserved.
- `Date` instances should not be accepted by canonicalization input except through already serialized schema fields.
- `undefined` fields should be omitted by object traversal.
- `null`, boolean, number, string, arrays, and plain objects are supported.
- unsupported values throw an explicit error.

Implementation note:

- `StaticIntelligenceExportV1.generatedAt` is excluded from `exportHash` because the CLI rebuilds the export payload on each invocation. Including that volatile timestamp would make `manifest.source.contentHash` change across repeated reads of an unchanged scan, defeating the manifest's freshness contract.

`contentHash` exclusion details:

- exclude top-level `generatedAt`.
- exclude `source.contentHash`.
- do not exclude `source.exportHash`.
- do not exclude risk fields, scan fields, project fields, redaction fields, or available bundle commands.

Stability expectation:

- same export payload content + different export or manifest `generatedAt` => same `contentHash`.
- changed export payload => different `exportHash`.
- changed scan/risk/project/bundle contract => different `contentHash`.

## Redaction Contract

Manifest may include:

- ids
- counts
- risk band
- evidence quality
- degraded reasons
- review status
- scan profile/status
- CLI command argv

Manifest must never include:

- artifact body
- evidence snippet
- source code snippet
- scanner stdout/stderr body
- secret value
- token value
- private key material
- `project.rootPath`
- absolute user home path

Implementation must not copy `exportPayload.project.rootPath` into the manifest. Consumers do not need local filesystem paths for discovery.

## CLI Contract

Add:

```bash
bun run intelligence:knowledge-source -- \
  --scan-run-id <scan-run-id>
```

Optional:

```bash
--pretty true
```

stdout:

- JSON object 1 件のみ。
- success shape is `StaticIntelligenceKnowledgeSourceManifestResult`.
- failure shape is `StaticIntelligenceKnowledgeSourceManifestFailure`.
- progress / warning / stack trace を混ぜない。

stderr:

- unexpected runtime diagnostics only。
- normal degraded output reason は JSON の `risk.degradedReasons` に入れる。
- invalid argument / missing scan は stderr に出さない。

Exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | manifest completed |
| 1 | runtime / DB / unexpected failure |
| 2 | invalid argument or scan run not found |

Failure JSON:

```json
{
  "ok": false,
  "status": "failed",
  "message": "..."
}
```

CLI implementation should follow `api/cli/intelligence-agent-query.ts` more than `intelligence-export.ts`:

- use `parseArgs`.
- validate `--scan-run-id`.
- validate `--pretty` as only `true` or `false`.
- create DB connection after argument validation.
- close SQLite in `finally`.
- catch `StaticIntelligenceScanRunNotFoundError` and return exit code 2.
- return stdout JSON through a single `writeResult()` function.

## Implementation Tasks

### Task 1: Add Shared Manifest Schema

Files:

- add `shared/schemas/static-intelligence-knowledge-source.schema.ts`

Implementation:

- Define `staticIntelligenceKnowledgeSourceBundleKindSchema`.
- Define `staticIntelligenceKnowledgeSourceManifestSchema`.
- Define `staticIntelligenceKnowledgeSourceManifestResultSchema`.
- Define `staticIntelligenceKnowledgeSourceManifestFailureSchema`.
- Export inferred types:
  - `StaticIntelligenceKnowledgeSourceBundleKind`
  - `StaticIntelligenceKnowledgeSourceManifest`
  - `StaticIntelligenceKnowledgeSourceManifestResult`
  - `StaticIntelligenceKnowledgeSourceManifestFailure`
- Reuse `staticIntelligenceRiskBandSchema` and `staticIntelligenceEvidenceQualitySchema` from `shared/schemas/static-intelligence.schema.ts`.
- Keep `redaction.rawArtifactBodyIncluded`, `redaction.rawEvidenceSnippetIncluded`, and `redaction.rawSecretIncluded` as `z.literal(false)`.
- Keep `source.kind` and `source.schemaVersion` as `z.literal(...)`.

Tests:

- Covered indirectly by builder tests parsing output.
- No standalone schema-only test required unless builder test failures are hard to diagnose.

Verification:

```bash
bun run typecheck
```

Expected:

- New schema compiles.
- No import cycle with `static-intelligence.schema.ts`.

Failure handling:

- If import cycle appears, keep the knowledge-source schema dependent on the export schema enums, not the reverse.

### Task 2: Add Canonical JSON and Hash Helpers

Files:

- add `api/modules/static-intelligence/knowledge-source-manifest.ts`
- add `api/modules/static-intelligence/knowledge-source-manifest.test.ts`

Implementation:

- Implement `canonicalJson(value)`.
- Implement `sha256Hex(input)`.
- Implement internal `canonicalize(value)` if needed.
- Sort object keys with `Object.keys(value).sort()`.
- Preserve array order.
- Omit object entries whose value is `undefined`.
- Throw for:
  - function
  - symbol
  - bigint
  - non-finite number
  - class instance / non-plain object
- Do not mutate input objects.

Test cases:

- object key order does not change output.
- nested object key order is stable.
- array order is preserved.
- `undefined` object fields are omitted.
- unsupported values throw.
- `sha256Hex("abc")` returns the known SHA-256 hex:
  - `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`

Verification:

```bash
bun test ./api/modules/static-intelligence/knowledge-source-manifest.test.ts
```

Expected:

- deterministic canonicalization tests pass.

Failure handling:

- If arrays are sorted accidentally, fix before implementing manifest hashes.
- If `undefined` becomes `null`, fix canonicalization before continuing.

### Task 3: Add Manifest Builder

Files:

- update `api/modules/static-intelligence/knowledge-source-manifest.ts`
- update `api/modules/static-intelligence/knowledge-source-manifest.test.ts`

Implementation:

- Add `buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, options)`.
- Build manifest only from `StaticIntelligenceExportV1`.
- Parse output with `staticIntelligenceKnowledgeSourceManifestSchema`.
- Use `options.generatedAt ?? new Date()`.
- Set `source.sourceId` to `vulnWorkbench.static_intelligence:${exportPayload.scan.id}`.
- Set `source.exportHash` before computing manifest `contentHash`.
- Build a temporary manifest with `source.contentHash` set to `""`, compute `contentHash` from the exclusion rules, then return the final manifest.
- Use sorted unique degraded reasons.
- Do not include `exportPayload.project.rootPath`.
- Keep available bundle command order stable.

Recommended structure:

```ts
export function buildStaticIntelligenceKnowledgeSourceManifest(
  exportPayload: StaticIntelligenceExportV1,
  options: StaticIntelligenceKnowledgeSourceManifestOptions = {}
): StaticIntelligenceKnowledgeSourceManifest {
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const exportHash = sha256Hex(canonicalJson(exportHashInput(exportPayload)));
  const manifestWithoutContentHash = { ... };
  const contentHash = sha256Hex(
    canonicalJson(contentHashInput(manifestWithoutContentHash))
  );
  return staticIntelligenceKnowledgeSourceManifestSchema.parse({
    ...manifestWithoutContentHash,
    source: { ...manifestWithoutContentHash.source, contentHash }
  });
}
```

Test cases:

- `builds manifest from export payload`.
- `does not include project root path`.
- `uses deterministic source id`.
- `keeps contentHash stable when generatedAt changes`.
- `changes exportHash when export payload changes`.
- `changes contentHash when risk summary changes`.
- `deduplicates and sorts degraded reasons`.
- `includes expected available bundle commands`.
- `marks redaction flags as false`.
- `serialized manifest does not contain raw snippet/body markers` using a fixture export with marker strings in fields that must not be copied.

Verification:

```bash
bun test ./api/modules/static-intelligence/knowledge-source-manifest.test.ts
```

Expected:

- manifest builder tests pass.
- repeated runs with the same export content and different export or manifest `generatedAt` keep `source.contentHash` unchanged.

Failure handling:

- If `contentHash` changes with only `generatedAt`, inspect exclusion helper.
- If marker strings appear in serialized manifest, remove the copied source field before continuing.

### Task 4: Add Service Wrapper for DB-backed Build

Files:

- update `api/modules/static-intelligence/knowledge-source-manifest.ts`

Implementation:

- Add:

```ts
export async function buildStaticIntelligenceKnowledgeSourceManifestForScan(
  db: AppDatabase,
  scanRunId: string,
  options?: StaticIntelligenceKnowledgeSourceManifestOptions
): Promise<StaticIntelligenceKnowledgeSourceManifest>
```

- Inside it, call `buildStaticIntelligenceExport(db, scanRunId)`.
- Then call `buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, options)`.
- Do not query DB directly in the manifest builder.
- Let `StaticIntelligenceScanRunNotFoundError` propagate.

Tests:

- Existing CLI test can cover this path.
- Add one module test only if CLI fixture setup becomes too broad.

Verification:

```bash
bun run typecheck
```

Expected:

- service wrapper compiles without duplicating export-builder logic.

Failure handling:

- If wrapper needs DB-specific fields not present in export, first reconsider whether the manifest contract is too broad.

### Task 5: Add CLI Entrypoint

Files:

- add `api/cli/intelligence-knowledge-source.ts`
- update `package.json`

Package script:

```json
"intelligence:knowledge-source": "bun run api/cli/intelligence-knowledge-source.ts"
```

Implementation:

- Parse:
  - `--scan-run-id <id>` required.
  - `--pretty true|false` optional.
- Build DB connection from `readAppEnv()`.
- Call `buildStaticIntelligenceKnowledgeSourceManifestForScan`.
- Write:

```ts
{
  ok: true,
  status: "completed",
  version: "v1",
  generatedAt: manifest.generatedAt,
  manifest
}
```

- On invalid args, missing `--scan-run-id`, invalid `--pretty`, missing scan:
  - stdout failure JSON.
  - exit code 2.
  - stderr empty.
- On DB/runtime unexpected error:
  - stdout failure JSON.
  - exit code 1.
  - stderr may include diagnostic message.
- Always close SQLite if connection was opened.

Implementation notes:

- Keep `writeResult(payload, pretty)` local to the CLI.
- Reuse the `message(error)` helper pattern from `intelligence-agent-query.ts`.
- Do not add `--output` in Phase 34. The manifest is small and discovery-oriented.
- Do not instantiate embedding providers.
- Do not call contextStill or NightWorkers.

Verification:

```bash
bun run typecheck
```

Expected:

- CLI compiles.
- package script is available.

Failure handling:

- If package script conflicts with an existing name, stop and rename only after updating all tests and docs.

### Task 6: Add CLI Tests

Files:

- add `api/modules/static-intelligence/intelligence-knowledge-source-cli.test.ts`

Fixture pattern:

- Copy the temp SQLite setup from `intelligence-agent-query-cli.test.ts`.
- Apply migrations from `drizzle/*.sql`.
- Insert:
  - user
  - project with `repoPath` under temp dir
  - completed scan run
- Close setup connection before spawning CLI.
- Use:

```ts
spawnSync(process.execPath, ["api/cli/intelligence-knowledge-source.ts", ...args], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: dbUrl },
  encoding: "utf8"
})
```

Required tests:

1. `returns manifest JSON with exit code 0`
   - status 0.
   - stderr empty.
   - stdout parses as JSON.
   - `ok: true`.
   - `status: "completed"`.
   - `version: "v1"`.
   - `manifest.source.scanRunId === scanRunId`.
   - `manifest.source.contentHash` matches `/^[a-f0-9]{64}$/`.

2. `pretty true still writes one JSON object`
   - status 0.
   - stdout trim starts with `{` and ends with `}`.
   - parsed JSON `ok === true`.

3. `returns exit code 2 when scan run is missing`
   - status 2.
   - stderr empty.
   - stdout failure JSON.
   - message contains `Scan run not found`.

4. `returns exit code 2 for invalid pretty`
   - status 2.
   - stderr empty.
   - stdout failure JSON.
   - message contains `--pretty must be true or false`.

5. `does not leak repo path or raw markers`
   - project `repoPath` is temp dir.
   - stdout does not contain temp dir.
   - stdout does not contain any marker strings added to scan review/handoff fixture if the test seeds review output.

6. `content hash is stable across repeated CLI runs`
   - run CLI twice.
   - parse both outputs.
   - compare `manifest.source.contentHash`.
   - allow `generatedAt` to differ.

Verification:

```bash
bun test ./api/modules/static-intelligence/intelligence-knowledge-source-cli.test.ts
```

Expected:

- CLI stdout is always one parseable JSON object.
- invalid user input exits 2.
- no normal diagnostics appear on stderr.

Failure handling:

- If stdout contains non-JSON text, route diagnostics to stderr or remove progress output.
- If content hash changes across repeated runs, inspect hash exclusion rules.

### Task 7: Wire Documentation and Cross-phase Notes

Files:

- update `spec/phase-35-static-intelligence-guardrail-material-cli-plan.md` only if implementation discovers a command contract mismatch.
- do not edit Phase 36/37 unless the implemented Phase 34 command shape differs from this plan.

Implementation:

- After CLI shape is final, ensure Phase 35 can reference:
  - `manifest.source.sourceId`
  - `manifest.source.contentHash`
  - `manifest.source.exportHash`
- Do not implement Phase 35 in this phase.

Verification:

```bash
rg -n "intelligence:knowledge-source|contentHash|exportHash|sourceId" spec/phase-3*.md
```

Expected:

- Later plans can point to Phase 34 terms without needing DB access.

Failure handling:

- If later plans assume a different envelope, update the docs before starting Phase 35.

### Task 8: Run Final Verification

Commands:

```bash
bun test ./api/modules/static-intelligence/knowledge-source-manifest.test.ts
bun test ./api/modules/static-intelligence/intelligence-knowledge-source-cli.test.ts
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

Expected:

- All targeted manifest and CLI tests pass.
- Existing static-intelligence tests pass.
- Full repo verification passes.

Failure handling:

- If only unrelated pre-existing failures appear, capture exact failing command and error before deciding whether to scope verification.
- If static-intelligence tests fail, fix before proceeding to Phase 35.
- If `bun run verify` fails on formatting, run `bunx biome format --write` only for files touched by this phase, then rerun verify.

## Implementation Order

Recommended commit-sized order:

1. schema + canonical JSON helper + helper tests.
2. manifest builder + builder tests.
3. DB-backed wrapper + CLI entrypoint + package script.
4. CLI tests.
5. final verification and documentation touch-ups.

Do not start with MCP, contextStill registration, or NightWorkers import adapter. Phase 34 is the source manifest foundation for those later phases.

## Review Checklist

- [ ] `source.sourceId` is stable and scan-run scoped.
- [ ] `exportHash` is based on canonical `StaticIntelligenceExportV1` content, excluding volatile `generatedAt`.
- [ ] `contentHash` excludes only manifest timestamps and itself.
- [ ] `contentHash` is stable across repeated CLI runs.
- [ ] `availableBundles.command` values are argv arrays.
- [ ] `guardrail_material` is discoverable but not executed by Phase 34 tests.
- [ ] manifest excludes `project.rootPath`.
- [ ] manifest excludes raw artifact body, evidence snippet, source snippet, scanner output body, secret values, and token values.
- [ ] CLI stdout is exactly one JSON object on success and failure.
- [ ] invalid argument and missing scan run return exit code 2.
- [ ] runtime failure returns exit code 1.
- [ ] SQLite connection is closed in `finally`.
- [ ] no code path reads contextStill / NightWorkers DB directly.
- [ ] no code path calls contextStill MCP or creates NightWorkers tasks.

## Stop Conditions

- Any implementation path requires contextStill or NightWorkers to read vulnWorkbench SQLite directly.
- Manifest starts making active knowledge or task decisions.
- Manifest includes raw artifact body, evidence snippet, source snippet, secret value, private token, or `project.rootPath`.
- Hashes are time-dependent because `generatedAt` is included in `contentHash`.
- CLI stdout contains logs, progress text, warnings, or stack traces.
- `availableBundles.command` is represented as a shell string instead of argv.
- Implementing Phase 34 requires implementing Phase 35 material generation first.

## Completion Definition

This phase is complete when contextStill or NightWorkers can call one CLI command, receive a stable manifest, compare `contentHash`, and decide which follow-up CLI command to call without reading vulnWorkbench DB directly.

Concrete completion evidence:

- `bun run intelligence:knowledge-source -- --scan-run-id <scan-run-id>` returns:
  - `ok: true`
  - `status: "completed"`
  - `version: "v1"`
  - `manifest.source.kind: "vulnWorkbench.static_intelligence"`
  - 64-char hex `manifest.source.exportHash`
  - 64-char hex `manifest.source.contentHash`
  - deterministic `availableBundles`
- Running the command twice for an unchanged scan keeps `manifest.source.contentHash` stable.
- Failure cases return parseable JSON with exit code 2 for invalid input or missing scan.
- `bun run verify` passes.
