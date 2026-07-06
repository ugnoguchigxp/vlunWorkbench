# Phase 38: Static Intelligence Code Structure Layer MVP Plan

## Purpose

この計画は、`spec/static-intelligence-layer-concept.md` の Code Structure Layer を最小実装し、Static Intelligence が scanner evidence だけでなく lightweight code facts も参照できるようにする。

中心に置く成果物は、脆弱性検出ではなく、file graph / import graph / exported symbols / surface tags / change surface hints の read model である。

```text
project path
  -> Code Structure Extractor CLI
  -> CodeStructureSnapshot
  -> optional Static Intelligence Export enrichment
  -> CLI / MCP consumers read structured code facts
```

この phase は LSP を必須にしない。TypeScript Compiler API は syntax parser として使うが、project typecheck、tsconfig 解決、language server、call graph、dataflow は MVP に含めない。

## Product Boundary

vulnWorkbench が担当すること:

- target project の軽量 code facts を CLI で抽出する。
- file graph / import graph / exported symbols / surface tags を deterministic snapshot として JSON 出力する。
- extraction failure を file-level / snapshot-level degraded output として扱う。
- Static Intelligence Export に optional code structure summary / refs を含められるようにする。
- Phase 34 knowledge source manifest から code structure CLI を発見できるようにする。
- Phase 37 fixture に code structure snapshot の redaction / determinism check を追加できる形にする。

vulnWorkbench が担当しないこと:

- 脆弱性の有無の断定。
- Project Ontology。
- task graph generation。
- queue admission。
- patch application。
- LSP 必須化。
- scanner の代替。
- typecheck の成功要求。
- call graph / dataflow / taint analysis。
- raw source code の export。
- contextStill / NightWorkers DB 直読み連携。

## Dependencies

Required existing baseline:

- `typescript` is already available as a dev dependency.
- `zod` schemas are already used under `shared/schemas`.
- Static Intelligence export builder already has optional schema evolution pattern through `StaticIntelligenceExportV1`.
- Phase 34 manifest has `availableBundles`.
- Phase 37 fixture verifies CLI source contracts.

No new parser dependency is required for MVP. Use the TypeScript Compiler API:

```ts
import ts from "typescript";
ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
```

Do not add Tree-sitter, ts-morph, dependency-cruiser, or LSP in Phase 38 unless TypeScript Compiler API proves insufficient for the MVP tests.

## MVP Scope

Supported first:

- TypeScript / JavaScript projects.
- extensions:
  - `.ts`
  - `.tsx`
  - `.js`
  - `.jsx`
  - `.mts`
  - `.cts`
  - `.mjs`
  - `.cjs`
- deterministic file list under project root.
- import / export graph for supported files.
- package dependency names from import specifiers.
- simple route / handler / schema / worker / test / config / source tags from path and syntax heuristics.
- content hash per scanned file.
- JSON CLI output.
- optional output file write.
- optional Static Intelligence Export enrichment from a provided snapshot file.

Not required:

- multi-language full support.
- type-aware references.
- LSP.
- tsconfig program creation.
- project typecheck.
- call graph.
- dataflow.
- vulnerability detection.
- UI.
- DB table for code structure snapshots.
- live scanner execution.

## Output Contract

Add `shared/schemas/static-intelligence-code-structure.schema.ts`.

```ts
type CodeStructureSnapshotResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  snapshot: CodeStructureSnapshot;
  output?: {
    path: string;
    sha256: string;
  };
};

type CodeStructureSnapshotFailure = {
  ok: false;
  status: "failed";
  message: string;
};

type CodeStructureSnapshot = {
  version: "v1";
  generatedAt: string;
  project: {
    id?: string;
    rootRef: string;
    rootPath?: string;
    rootPathIncluded: boolean;
  };
  status: "completed" | "partial";
  degradedReasons: string[];
  files: CodeStructureFile[];
  edges: CodeStructureEdge[];
  packages: CodeStructurePackage[];
  summary: CodeStructureSummary;
};

type CodeStructureFile = {
  path: string;
  language: "typescript" | "javascript" | "unknown";
  moduleKind: "esm" | "commonjs" | "mixed" | "unknown";
  tags: Array<
    | "route"
    | "handler"
    | "schema"
    | "worker"
    | "test"
    | "config"
    | "source"
  >;
  exportedSymbols: string[];
  imports: string[];
  packageImports: string[];
  contentHash: string;
  parseStatus: "parsed" | "degraded" | "skipped";
  degradedReasons: string[];
};

type CodeStructureEdge = {
  from: string;
  to: string;
  kind: "imports" | "depends_on_package";
  confidence: number;
};

type CodeStructurePackage = {
  name: string;
  importedBy: string[];
};

type CodeStructureSummary = {
  fileCount: number;
  parsedFileCount: number;
  skippedFileCount: number;
  importEdgeCount: number;
  packageDependencyCount: number;
  exportedSymbolCount: number;
  routeFileCount: number;
  handlerFileCount: number;
  schemaFileCount: number;
  workerFileCount: number;
  testFileCount: number;
  configFileCount: number;
};
```

Field rules:

- `project.rootRef` is `sha256(canonical realpath root)`.
- `project.rootPath` is omitted by default.
- `project.rootPathIncluded` is `false` by default.
- `project.rootPath` may be included only when `--include-root-path true` is explicitly passed.
- file `path` is always project-root-relative POSIX style.
- `contentHash` is SHA-256 of file bytes.
- `imports` includes only import specifiers, not imported file contents.
- `packageImports` includes normalized package names only.
- `edges` are sorted by `from`, `kind`, `to`.
- `files` are sorted by `path`.
- `packages` are sorted by `name`.
- arrays inside files are sorted unique.

Secret handling:

- Do not include file contents.
- Do not include string literal values except import specifiers.
- Do not include comments.
- Do not include `.env` contents.
- Do not include project root path by default.
- Do not include absolute user home paths by default.
- Do not scan ignored directories such as `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.cache`, `vendor`.

## CLI Contract

Add:

```bash
bun run intelligence:code-structure -- \
  --project-path <path>
```

Options:

```bash
--project-id <project-id>
--output <path>
--pretty true
--include-root-path true
--max-files 5000
```

stdout:

- JSON object 1 件のみ。
- success shape is `CodeStructureSnapshotResult`.
- failure shape is `CodeStructureSnapshotFailure`.
- progress / warning / stack trace を混ぜない。

stderr:

- diagnostics / skipped file warnings only。
- normal degraded reasons are returned in JSON。

Exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | completed or partial-but-usable snapshot |
| 1 | runtime / unexpected failure |
| 2 | invalid argument or project path not found |

Failure JSON:

```json
{
  "ok": false,
  "status": "failed",
  "message": "..."
}
```

CLI rules:

- validate args before scanning.
- `--project-path` must resolve to an existing directory.
- `--output` must stay outside neither required nor forbidden, but parent directory must exist.
- if `--output` is passed, write the snapshot payload only, not the result envelope.
- `--pretty` accepts only `true` or `false`.
- `--include-root-path` accepts only `true` or `false`.
- `--max-files` must be integer `1..20000`; default 5000.
- stdout remains JSON-only even when `--output` is used.

## Extraction Strategy

Use a two-stage extractor.

### Stage 1: File Discovery

Rules:

- recursively walk from project root.
- convert paths to project-root-relative POSIX style.
- skip ignored directories:
  - `.git`
  - `node_modules`
  - `dist`
  - `build`
  - `coverage`
  - `.next`
  - `.turbo`
  - `.cache`
  - `.vite`
  - `vendor`
- skip unsupported file extensions.
- skip likely secret/config data files:
  - `.env`
  - `.env.*`
  - `*.pem`
  - `*.key`
  - `*.crt`
  - `*.p12`
  - `*.sqlite`
  - `*.db`
- include supported config source files such as:
  - `vite.config.ts`
  - `vitest.config.ts`
  - `eslint.config.js`
  - `biome.json` is not a JS/TS source file and is skipped in MVP, but path heuristics can tag JS/TS config files.
- stop at `maxFiles` and return partial snapshot with degraded reason.
- enforce path containment after resolving each file realpath.

### Stage 2: Syntax Extraction

Use `ts.createSourceFile` per file. Do not create a project/program. Do not require typecheck.

Extract:

- static import declarations.
- export declarations.
- exported function/class/interface/type/const/let/var/enum names.
- `require("...")` calls with string literal specifiers.
- dynamic `import("...")` calls with string literal specifiers.
- module kind:
  - `esm` if ESM imports/exports exist.
  - `commonjs` if `require` or `module.exports` exists.
  - `mixed` if both.
  - `unknown` otherwise.

Do not extract:

- arbitrary string literals.
- function bodies.
- comments.
- source snippets.
- inferred vulnerabilities.

Parser errors:

- if TypeScript parser can still produce a SourceFile, extract what is safe.
- if file read fails, add a skipped file entry only if a relative path is known, with `parseStatus: "skipped"`.
- snapshot status becomes `partial`.
- degraded reason includes file path and failure class, not raw file contents.

## Tagging Rules

Initial deterministic path/syntax heuristics:

- `test`
  - path includes `__tests__`
  - filename includes `.test.` or `.spec.`
- `config`
  - filename includes `config`
  - filename starts with `vite.`, `vitest.`, `eslint.`, `biome.`, `tailwind.`, `postcss.`
  - path includes `/config/`
- `schema`
  - path includes `schema` or `schemas`
  - exported symbols or imports include `zod`
  - file imports from `drizzle-orm/sqlite-core`
- `route`
  - path includes `routes`
  - filename includes `.route.`
  - path matches app router files such as `route.ts`, `page.tsx`, `layout.tsx`
- `handler`
  - exported symbol name includes `handler`
  - file imports from `hono`
  - file path includes `handlers`
- `worker`
  - path or filename includes `worker`, `queue`, `job`, `runner`
- `source`
  - default tag for supported source files that are not only config/test.

Tags are sorted in this order:

```text
route, handler, schema, worker, test, config, source
```

## Import Resolution Rules

For each import specifier:

- relative import:
  - resolve against importing file directory.
  - support extensionless resolution for `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`.
  - support `index.ts` / `index.tsx` / `index.js` / `index.jsx`.
  - if resolved target is inside scanned file set, add edge:
    - `kind: "imports"`
    - `from: importer relative path`
    - `to: target relative path`
    - `confidence: 0.9`
  - if unresolved, add degraded reason on the file but do not fail snapshot.
- package import:
  - normalize package name:
    - `react/jsx-runtime` => `react`
    - `@scope/pkg/subpath` => `@scope/pkg`
  - add package import to file.
  - add edge:
    - `kind: "depends_on_package"`
    - `to: package name`
    - `confidence: 0.8`

Do not read files outside project root to resolve imports.

## Static Intelligence Export Enrichment

After CLI and snapshot builder are stable, add optional enrichment.

Schema addition in `shared/schemas/static-intelligence.schema.ts`:

```ts
codeStructure: z
  .object({
    status: z.enum(["available", "missing", "degraded"]),
    snapshotRef: z.string().optional(),
    summary: codeStructureSummarySchema.optional(),
    fileTagsByPath: z.record(z.string(), z.array(codeStructureFileTagSchema)).optional(),
    degradedReasons: z.array(z.string()),
  })
  .optional()
```

Builder direction:

- Add a helper:

```ts
buildCodeStructureExportEnrichment(
  snapshot: CodeStructureSnapshot | null
): StaticIntelligenceExportV1["codeStructure"]
```

- Add `codeStructureSnapshot?: CodeStructureSnapshot` to `StaticIntelligenceExportOptions`.
- `buildStaticIntelligenceExportFromBundle` includes `codeStructure` only when option is provided.
- Do not run extraction inside `buildStaticIntelligenceExport`.
- Export still succeeds when no snapshot is provided.

CLI enrichment:

- Add optional to `intelligence:export`:

```bash
--code-structure-snapshot <path>
```

- The option reads a snapshot JSON file, validates it, and passes it to export builder.
- Invalid snapshot:
  - exit code 2 for malformed user input.
  - failure JSON.
- Do not make export CLI run the extractor directly in Phase 38.

Knowledge source manifest update:

- Add `code_structure_snapshot` to `availableBundles` after `static_intelligence_export`.
- Command:

```ts
[
  "bun",
  "run",
  "intelligence:code-structure",
  "--",
  "--project-path",
  "<project-path>"
]
```

Because manifest must not leak root path, use placeholder `<project-path>` rather than the actual project root.

Phase 34 manifest `contentHash` will change because available bundle contract changes. This is acceptable in Phase 38 and must be reflected in tests.

## Files

New:

```text
shared/schemas/static-intelligence-code-structure.schema.ts
api/modules/static-intelligence/code-structure/extractor.ts
api/modules/static-intelligence/code-structure/extractor.test.ts
api/modules/static-intelligence/code-structure/export-enrichment.ts
api/modules/static-intelligence/code-structure/export-enrichment.test.ts
api/cli/intelligence-code-structure.ts
api/modules/static-intelligence/intelligence-code-structure-cli.test.ts
```

Modified:

```text
shared/schemas/static-intelligence.schema.ts
api/modules/static-intelligence/export-builder.ts
api/cli/intelligence-export.ts
api/modules/static-intelligence/export-builder.test.ts
api/modules/static-intelligence/intelligence-export-cli.test.ts
api/modules/static-intelligence/knowledge-source-manifest.ts
api/modules/static-intelligence/knowledge-source-manifest.test.ts
package.json
spec/phase-37-static-intelligence-knowledge-source-e2e-fixture-plan.md
```

Package script:

```json
"intelligence:code-structure": "bun run api/cli/intelligence-code-structure.ts"
```

## Implementation Tasks

### Task 1: Add Code Structure Schemas

Files:

- add `shared/schemas/static-intelligence-code-structure.schema.ts`

Implementation:

- Define:
  - `codeStructureFileTagSchema`
  - `codeStructureLanguageSchema`
  - `codeStructureModuleKindSchema`
  - `codeStructureFileSchema`
  - `codeStructureEdgeSchema`
  - `codeStructurePackageSchema`
  - `codeStructureSummarySchema`
  - `codeStructureSnapshotSchema`
  - `codeStructureSnapshotResultSchema`
  - `codeStructureSnapshotFailureSchema`
- Export inferred types.
- Keep root path optional.
- Enforce literal `version: "v1"`.
- Keep all arrays explicit.

Verification:

```bash
bun run typecheck
```

Expected:

- schemas compile.
- no import cycle with Static Intelligence export schema.

Failure handling:

- If schema import cycles appear, keep code structure schemas independent and import them into Static Intelligence schema only in the optional enrichment step.

### Task 2: Implement File Discovery and Path Guards

Files:

- add `api/modules/static-intelligence/code-structure/extractor.ts`
- add `api/modules/static-intelligence/code-structure/extractor.test.ts`

Implementation:

- Add:

```ts
export async function buildCodeStructureSnapshot(
  input: {
    projectPath: string;
    projectId?: string;
    generatedAt?: Date;
    includeRootPath?: boolean;
    maxFiles?: number;
  }
): Promise<CodeStructureSnapshot>;
```

- Resolve project root with `fs.realpath`.
- Reject missing/non-directory project path.
- Walk recursively.
- Apply ignored directory and file rules.
- Enforce realpath containment before reading files.
- Convert output paths to POSIX relative paths.
- Sort discovered files deterministically.
- Stop at max files with partial status and degraded reason.

Tests:

- discovers supported JS/TS files.
- excludes `node_modules`, `.git`, `dist`, `coverage`.
- skips `.env` and key/cert files.
- rejects project path not found.
- does not follow symlink outside project root.
- root path omitted by default.
- root path included only with `includeRootPath`.
- max files returns partial snapshot.

Verification:

```bash
bun test ./api/modules/static-intelligence/code-structure/extractor.test.ts
```

Expected:

- discovery tests pass without parsing syntax yet.

Failure handling:

- If path traversal is possible, stop and fix containment before adding parser extraction.

### Task 3: Implement Syntax Extraction

Files:

- update `api/modules/static-intelligence/code-structure/extractor.ts`
- update `api/modules/static-intelligence/code-structure/extractor.test.ts`

Implementation:

- Use TypeScript Compiler API `createSourceFile`.
- Extract:
  - static imports.
  - export declarations.
  - exported declarations.
  - CommonJS `require("...")`.
  - dynamic `import("...")` with string literal.
  - `module.exports` presence for module kind.
- Compute:
  - language.
  - moduleKind.
  - exportedSymbols.
  - imports.
  - packageImports.
  - contentHash.
  - parseStatus.
- Do not emit source snippets or comments.

Tests:

- extracts ESM imports and exports.
- extracts CommonJS require package import.
- extracts dynamic import string specifier.
- does not include arbitrary string literals.
- broken TS file degrades without aborting whole snapshot.
- content hash changes when file bytes change.

Verification:

```bash
bun test ./api/modules/static-intelligence/code-structure/extractor.test.ts
```

Expected:

- syntax tests pass.

Failure handling:

- If parser failure aborts the whole run, convert it to file-level degraded output.

### Task 4: Implement Tagging and Edge Building

Files:

- update `api/modules/static-intelligence/code-structure/extractor.ts`
- update `api/modules/static-intelligence/code-structure/extractor.test.ts`

Implementation:

- Apply tag heuristics.
- Resolve relative imports to scanned files.
- Normalize package names.
- Build edges.
- Build package summaries.
- Build summary counts.
- Sort all output collections.
- Parse final snapshot with `codeStructureSnapshotSchema`.

Tests:

- route files are tagged.
- Hono handler files are tagged.
- Zod/schema files are tagged.
- worker/runner files are tagged.
- test/config files are tagged.
- relative import edge resolves extensionless import.
- index file resolution works.
- package dependency edge normalizes scoped and unscoped package names.
- summary counts are correct.
- repeated runs produce equal snapshots when `generatedAt` is fixed.

Verification:

```bash
bun test ./api/modules/static-intelligence/code-structure/extractor.test.ts
```

Expected:

- deterministic snapshot tests pass.

Failure handling:

- If output ordering is unstable, sort at the builder boundary before schema parse.

### Task 5: Add Code Structure CLI

Files:

- add `api/cli/intelligence-code-structure.ts`
- add `api/modules/static-intelligence/intelligence-code-structure-cli.test.ts`
- update `package.json`

Implementation:

- Parse:
  - `--project-path` required.
  - `--project-id` optional.
  - `--output` optional.
  - `--pretty true|false` optional.
  - `--include-root-path true|false` optional.
  - `--max-files` optional.
- Call `buildCodeStructureSnapshot`.
- Write success result JSON to stdout.
- If `--output` is set:
  - write `snapshot` object only.
  - return `output.path` and `output.sha256`.
- Expected user errors return exit code 2 and JSON failure.
- Runtime errors return exit code 1 and JSON failure.
- Diagnostics go to stderr.

Tests:

- returns snapshot JSON with exit code 0.
- pretty true still writes one JSON object.
- output file contains snapshot only.
- missing project path returns exit code 2.
- invalid boolean returns exit code 2.
- root path omitted by default.
- stdout does not include fixture secret markers.
- repeated CLI runs with fixed fixture and no root path produce stable snapshot except generatedAt.

Verification:

```bash
bun test ./api/modules/static-intelligence/intelligence-code-structure-cli.test.ts
bun run intelligence:code-structure -- --project-path /path/to/fixture
```

Expected:

- CLI stdout is parseable JSON.
- no file contents are emitted.

Failure handling:

- If CLI stdout contains logs, route diagnostics to stderr.

### Task 6: Add Export Enrichment Helper

Files:

- add `api/modules/static-intelligence/code-structure/export-enrichment.ts`
- add `api/modules/static-intelligence/code-structure/export-enrichment.test.ts`
- update `shared/schemas/static-intelligence.schema.ts`

Implementation:

- Add optional `codeStructure` field to `StaticIntelligenceExportV1`.
- Implement:

```ts
export function buildCodeStructureExportEnrichment(
  snapshot: CodeStructureSnapshot | null
): StaticIntelligenceExportV1["codeStructure"];
```

- Enrichment includes:
  - `status`
  - `snapshotRef`
  - `summary`
  - `fileTagsByPath`
  - `degradedReasons`
- `snapshotRef` should be `code_structure:<rootRef>:<summary-hash-prefix>`.
- `fileTagsByPath` includes paths and tags only, not imports or symbols.
- If snapshot is `partial`, status is `degraded`.
- If null, return `undefined` or `{ status: "missing", degradedReasons: [...] }` only if explicitly requested by caller.

Tests:

- completed snapshot maps to available enrichment.
- partial snapshot maps to degraded enrichment.
- file tags are included without imports/symbols/content.
- schema validates export with codeStructure.

Verification:

```bash
bun test ./api/modules/static-intelligence/code-structure/export-enrichment.test.ts
```

Expected:

- enrichment is compact and redacted.

Failure handling:

- If enrichment starts duplicating full snapshot, trim to summary/tags only.

### Task 7: Wire Optional Export CLI Enrichment

Files:

- update `api/modules/static-intelligence/export-builder.ts`
- update `api/cli/intelligence-export.ts`
- update tests:
  - `api/modules/static-intelligence/export-builder.test.ts`
  - `api/modules/static-intelligence/intelligence-export-cli.test.ts`

Implementation:

- Add `codeStructureSnapshot?: CodeStructureSnapshot` to export options.
- Export builder includes code structure enrichment only if option provided.
- Add `--code-structure-snapshot <path>` to `intelligence:export`.
- CLI reads and validates snapshot file.
- Invalid file/path/schema returns exit code 2 with JSON failure.
- Do not make export CLI run extractor.
- Do not make export fail when no snapshot is provided.

Tests:

- export without snapshot is unchanged except schema optional support.
- export with valid snapshot includes `codeStructure`.
- invalid snapshot file returns exit code 2.
- output does not include root path or raw file content.

Verification:

```bash
bun test ./api/modules/static-intelligence/export-builder.test.ts
bun test ./api/modules/static-intelligence/intelligence-export-cli.test.ts
```

Expected:

- existing export behavior remains compatible.

Failure handling:

- If export starts requiring code structure, revert; enrichment must stay optional.

### Task 8: Update Knowledge Source Manifest Bundle Discovery

Files:

- update `api/modules/static-intelligence/knowledge-source-manifest.ts`
- update `shared/schemas/static-intelligence-knowledge-source.schema.ts`
- update `api/modules/static-intelligence/knowledge-source-manifest.test.ts`
- update `api/modules/static-intelligence/intelligence-knowledge-source-cli.test.ts`

Implementation:

- Add bundle kind:
  - `code_structure_snapshot`
- Add available bundle command after `static_intelligence_export`:

```ts
{
  kind: "code_structure_snapshot",
  command: [
    "bun",
    "run",
    "intelligence:code-structure",
    "--",
    "--project-path",
    "<project-path>"
  ],
  description: "Extract a redacted lightweight code structure snapshot for the project.",
  requires: { projectPath: true }
}
```

- Do not place actual project root path into manifest.
- Accept that manifest `contentHash` changes because available bundle contract changed.

Tests:

- manifest includes code structure bundle.
- command uses placeholder `<project-path>`.
- manifest does not include actual repo path.
- contentHash remains stable across repeated runs.

Verification:

```bash
bun test ./api/modules/static-intelligence/knowledge-source-manifest.test.ts
bun test ./api/modules/static-intelligence/intelligence-knowledge-source-cli.test.ts
```

Expected:

- discovery contract includes code structure without leaking root path.

Failure handling:

- If manifest leaks project path, replace with placeholder before continuing.

### Task 9: Update Phase 37 Fixture Contract

Files:

- update `spec/phase-37-static-intelligence-knowledge-source-e2e-fixture-plan.md`
- after implementation, update `scripts/static-intelligence-knowledge-source-fixture.ts` if already present.

Implementation:

- Add code structure CLI to fixture command chain:

```bash
bun run intelligence:code-structure -- --project-path <repoPath>
```

- Add checks:
  - snapshot stdout JSON.
  - no raw file content / secret marker.
  - root path omitted by default.
  - repeated snapshot stable except generatedAt.
  - export can consume snapshot through `--code-structure-snapshot`.
  - manifest advertises `code_structure_snapshot` with placeholder project path.

Verification:

```bash
rg -n "intelligence:code-structure|code_structure_snapshot|codeStructure" spec/phase-37-static-intelligence-knowledge-source-e2e-fixture-plan.md
```

Expected:

- fixture plan includes Phase 38 code structure checks.

Failure handling:

- If Phase 37 fixture is already implemented, update test expectations and rerun fixture.

### Task 10: Run Final Verification

Commands:

```bash
bun test ./api/modules/static-intelligence/code-structure/extractor.test.ts
bun test ./api/modules/static-intelligence/code-structure/export-enrichment.test.ts
bun test ./api/modules/static-intelligence/intelligence-code-structure-cli.test.ts
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

If Phase 37 fixture has been implemented:

```bash
bun run fixture:static-intelligence-source
```

Expected:

- targeted code structure tests pass.
- existing static-intelligence tests pass.
- full repo verification passes.
- fixture passes if present.

Failure handling:

- If extractor emits raw content, remove field and add redaction regression.
- If output is non-deterministic, sort at snapshot boundary.
- If broken TS aborts snapshot, convert to partial degraded output.
- If full verify fails due to formatting, run `bunx biome format --write` only for files touched by this phase, then rerun verify.

## Implementation Order

Recommended order:

1. schemas.
2. file discovery and path guards.
3. syntax extraction.
4. tagging / import resolution / package summary.
5. CLI.
6. export enrichment helper.
7. optional export CLI enrichment.
8. knowledge source manifest bundle discovery.
9. Phase 37 fixture doc/script update.
10. final verification.

Do not start with LSP, Tree-sitter, DB persistence, MCP tools, UI, ontology integration, or vulnerability inference.

## Review Checklist

- [ ] extractor does not require LSP.
- [ ] extractor does not require project typecheck.
- [ ] extractor does not claim vulnerability detection.
- [ ] only supported JS/TS-like files are read.
- [ ] ignored directories are skipped.
- [ ] `.env` and key/cert files are skipped.
- [ ] path containment prevents reading outside project root.
- [ ] root path is omitted by default.
- [ ] file contents are never emitted.
- [ ] arbitrary string literals are never emitted.
- [ ] import specifiers are the only string literals extracted from source.
- [ ] output paths are project-relative POSIX paths.
- [ ] output is deterministic with fixed `generatedAt`.
- [ ] broken files produce partial/degraded output, not total failure.
- [ ] export enrichment is optional.
- [ ] export enrichment includes summary/tags only, not full source structure.
- [ ] manifest advertises code structure extraction without leaking project path.
- [ ] Static Intelligence findings remain scanner-evidence-backed.
- [ ] no contextStill / NightWorkers DB direct access is introduced.

## Stop Conditions

- LSP becomes required.
- extractor claims vulnerability detection.
- CLI needs project typecheck to pass.
- file contents are emitted.
- arbitrary string literal values are emitted.
- `.env` or secret-bearing files are read into output.
- actual project root path is emitted by default.
- path traversal can leave project root.
- Static Intelligence Export requires code structure to succeed.
- scanner evidence is replaced by code structure facts as finding source of truth.
- NightWorkers or contextStill read vulnWorkbench DB directly.

## Completion Definition

This phase is complete when a CLI command can produce a deterministic, redacted Code Structure snapshot for a TypeScript/JavaScript project, Static Intelligence can optionally reference that snapshot, and scanner evidence remains the source of truth for findings.

Concrete completion evidence:

- `bun run intelligence:code-structure -- --project-path <fixture-project>` exits 0.
- CLI stdout is one JSON object.
- repeated extraction over unchanged fixture is stable except `generatedAt`.
- output excludes raw file contents, secret markers, `.env` contents, and root path by default.
- snapshot includes files, import/package edges, exported symbols, tags, and summary.
- `intelligence:export -- --code-structure-snapshot <snapshot>` includes optional `codeStructure` summary/tags.
- `intelligence:knowledge-source` advertises `code_structure_snapshot` with placeholder project path.
- targeted tests and `bun run verify` pass.
