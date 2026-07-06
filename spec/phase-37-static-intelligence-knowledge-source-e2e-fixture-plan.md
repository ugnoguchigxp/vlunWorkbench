# Phase 37: Static Intelligence Knowledge Source E2E Fixture Plan

## Purpose

この計画は、Static Intelligence knowledge source の CLI / MCP contract を、fixture workflow で end-to-end に検証できるようにする。

中心に置くのは、個別 unit test ではなく、contextStill や NightWorkers が実際に読む順番に近い確認である。

```text
fixture SQLite DB under /tmp
  -> deterministic scan/review/evidence rows
  -> intelligence:export
  -> intelligence:agent-query
  -> intelligence:knowledge-source
  -> intelligence:guardrail-material
  -> mcp:static-intelligence smoke/list-tools
  -> final fixture JSON report
```

この phase は scanner 精度を上げるものではない。CLI / MCP source contract の安定性、redaction、hash、provenance、candidate-only 保証を確認する。

## Dependencies

Phase 37 は Phase 34-36 の完了後に実装する。

Required Phase 34:

- `intelligence:knowledge-source`
- stable manifest `source.contentHash`
- manifest redaction flags
- manifest available bundle commands

Required Phase 35:

- `intelligence:guardrail-material`
- stable material ids / `metadata.materialHash`
- `sourceManifest` provenance
- guardrail material redaction

Required Phase 36:

- `mcp:static-intelligence`
- `--list-tools`
- `--smoke`
- read-only MCP handlers
- tool names:
  - `vuln_list_knowledge_sources`
  - `vuln_get_knowledge_source_manifest`
  - `vuln_get_guardrail_material`
  - `vuln_get_evidence_bundle`
  - `vuln_get_verification_commands`

If Phase 36 is not complete, do not mark Phase 37 complete. A CLI-only fixture mode may exist for debugging, but completion evidence must include MCP smoke/list-tools.

## Product Boundary

担当すること:

- deterministic fixture workflow を追加する。
- temporary DB と artifact root を `/tmp` 配下に隔離する。
- stdout JSON contract を検証する。
- redaction / provenance / hash stability を検証する。
- CLI outputs を contextStill / NightWorkers が読む順番に近い形で連鎖検証する。
- MCP wrapper の smoke / list-tools / optional read-only handler checks を検証する。
- failure case の exit code と JSON failure を検証する。

担当しないこと:

- live repository の広範 scan。
- external target scan。
- network provider / embedding provider 呼び出し。
- NightWorkers task creation。
- contextStill registration。
- MCP mutation。
- UI automation。
- scanner rule tuning。
- scanner 実行品質の評価。
- fixture output を contextStill knowledge として登録すること。

## Current Baseline

既存の参考実装:

- `scripts/phase12-fixture-workflow.ts`
  - `/tmp` DB / artifact root。
  - progress logs to stderr。
  - final stdout JSON。
- `api/modules/static-intelligence/intelligence-*-cli.test.ts`
  - temp SQLite。
  - migration application from `drizzle/*.sql`。
  - `spawnSync(process.execPath, [...])`。
- `api/cli/intelligence-export.ts`
- `api/cli/intelligence-agent-query.ts`
- `api/cli/intelligence-knowledge-source.ts`
- `api/cli/intelligence-guardrail-material.ts`
- `api/cli/static-intelligence-mcp-server.ts` after Phase 36。

Known fixture rules from prior hardening:

- logs must go to stderr.
- stdout must be one machine-readable JSON object.
- generated DB/artifacts must live under `/tmp`.
- cleanup must not delete repo files.
- fixture must not require external network.

## Fixture Shape

The fixture must seed one complete local dataset.

Required rows:

- one user.
- one project.
- one completed scan run.
- at least one completed tool run.
- at least one raw-result artifact row with unsafe marker in metadata.
- at least two findings.
- at least one high or critical finding.
- at least one weak-evidence finding.
- at least one artifact-backed evidence row.
- at least one evidence row with unsafe snippet marker.
- one completed scan review with valid improvement request.
- one verification command.
- one acceptance criterion.

Recommended fixture content:

```text
project:
  name: Static Intelligence Fixture Project
  repoPath: /tmp/<fixture-root>/repo

scan:
  profile: baseline
  status: completed

finding A:
  severity: high
  path: src/app.ts
  scanner: semgrep
  ruleId: typescript.express.xss
  evidence: artifact-backed

finding B:
  severity: medium
  path: src/auth.ts
  scanner: semgrep
  ruleId: typescript.auth.validation
  evidence: weak or no artifact

review:
  improvementRequest.title: Fix scanner-backed input validation risks
  verificationCommands: ["bun test ./api/modules/static-intelligence/*.test.ts"]
```

Unsafe marker constants:

```ts
const RAW_SNIPPET_MARKER = "SECRET_FIXTURE_SNIPPET_SHOULD_NOT_LEAK";
const RAW_ARTIFACT_MARKER = "SECRET_FIXTURE_ARTIFACT_BODY_SHOULD_NOT_LEAK";
const RAW_REVIEW_MARKER = "SECRET_FIXTURE_REVIEW_BODY_SHOULD_NOT_LEAK";
const RAW_TOKEN_MARKER = "SECRET_FIXTURE_TOKEN_SHOULD_NOT_LEAK";
```

The fixture should place these markers only in source DB fields that must be redacted:

- evidence snippet.
- artifact metadata raw content.
- review fields that should not be copied into manifest/material.
- optional fake repo file under `/tmp` only if needed for path redaction checks.

Expected safe outputs may include:

- relative file paths such as `src/app.ts`.
- scanner names.
- rule ids.
- finding ids.
- evidence refs.
- artifact refs.
- verification command strings from handoff.

Expected unsafe outputs must never include:

- marker constants.
- temp repo absolute path.
- artifact body.
- evidence snippet.
- scanner stdout/stderr body.

## Workflow Script

Add:

```text
scripts/static-intelligence-knowledge-source-fixture.ts
```

Package script:

```json
"fixture:static-intelligence-source": "bun run scripts/static-intelligence-knowledge-source-fixture.ts"
```

The script should:

1. create a unique temp root with `fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-static-intel-"))`.
2. create:
   - `dbPath`
   - `artifactRoot`
   - `repoPath`
3. create temp SQLite DB.
4. apply migrations from `drizzle/*.sql` directly, following existing test helper pattern.
5. seed deterministic fixture rows.
6. close DB before running CLI subprocesses.
7. run CLI commands through argv arrays.
8. parse each stdout as exactly one JSON object.
9. assert contract invariants.
10. run MCP smoke/list-tools commands.
11. optionally leave temp files when `--keep-temp true`.
12. otherwise remove temp root in `finally`.
13. print one final JSON object to stdout.

Progress logs must go to stderr.

Do not use shell strings. Use argv arrays with `spawnSync` or `Bun.spawnSync`.

## Script Options

Add options:

```bash
bun run fixture:static-intelligence-source
bun run fixture:static-intelligence-source -- --keep-temp true
bun run fixture:static-intelligence-source -- --skip-mcp true
```

Option rules:

- `--keep-temp true|false`
  - default false.
  - if true, do not delete temp root and include paths in final JSON.
- `--skip-mcp true|false`
  - default false.
  - allowed only for local debugging.
  - final result must include `mcpSkipped: true`.
  - completion evidence for Phase 37 must not use skip mode.
- invalid boolean options return final JSON failure and exit code 2.

## Final Output Contract

Final stdout shape:

```ts
type StaticIntelligenceKnowledgeSourceFixtureResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  tempRoot?: string;
  dbPath?: string;
  artifactRoot?: string;
  repoPath?: string;
  scanRunId: string;
  findingIds: string[];
  checks: Array<{
    name: string;
    status: "passed";
    detail?: Record<string, unknown>;
  }>;
  outputs: {
    exportHash: string;
    manifestContentHash: string;
    manifestExportHash: string;
    guardrailMaterialCount: number;
    guardrailMaterialIds: string[];
    agentQueryKinds: string[];
    mcpToolNames: string[];
    mcpSkipped: boolean;
  };
};
```

Failure stdout shape:

```ts
type StaticIntelligenceKnowledgeSourceFixtureFailure = {
  ok: false;
  status: "failed";
  version: "v1";
  message: string;
  failedCheck?: string;
  tempRoot?: string;
};
```

Exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | all checks passed |
| 1 | fixture setup / CLI / MCP / assertion failure |
| 2 | invalid fixture arguments |

Failure handling:

- expected contract failures should return failure JSON and exit 1.
- unexpected script errors should return failure JSON and exit 1.
- invalid script args should return failure JSON and exit 2.
- logs and stack traces go to stderr.

## CLI Command Chain

The fixture must run these commands against the temp DB:

```bash
bun run intelligence:export -- --scan-run-id <scanRunId>
bun run intelligence:agent-query -- --scan-run-id <scanRunId> --kind project_overview
bun run intelligence:agent-query -- --scan-run-id <scanRunId> --kind evidence_bundle --finding-id <findingId>
bun run intelligence:agent-query -- --scan-run-id <scanRunId> --kind verification_commands --finding-id <findingId>
bun run intelligence:knowledge-source -- --scan-run-id <scanRunId>
bun run intelligence:knowledge-source -- --scan-run-id <scanRunId>
bun run intelligence:guardrail-material -- --scan-run-id <scanRunId> --include-markdown true
bun run intelligence:guardrail-material -- --scan-run-id <scanRunId> --include-markdown true
```

The repeated manifest/material calls are required for hash/id stability checks.

Also run failure checks:

```bash
bun run intelligence:knowledge-source -- --scan-run-id 00000000-0000-4000-8000-000000000001
bun run intelligence:guardrail-material -- --scan-run-id 00000000-0000-4000-8000-000000000001
```

Expected:

- missing scan exits 2.
- stdout is parseable JSON failure.
- stderr is empty for expected missing scan cases.

## MCP Command Chain

Required when `--skip-mcp` is false:

```bash
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

Expected:

- each exits 0.
- stdout is one parseable JSON object.
- tool list includes:
  - `vuln_list_knowledge_sources`
  - `vuln_get_knowledge_source_manifest`
  - `vuln_get_guardrail_material`
  - `vuln_get_evidence_bundle`
  - `vuln_get_verification_commands`

If Phase 36 adds a stable non-interactive handler smoke command for a real scan run, add it here:

```bash
bun run mcp:static-intelligence -- --smoke-scan-run-id <scanRunId>
```

Do not implement a bespoke MCP client in Phase 37 unless Phase 36 provides a stable test helper. The primary E2E goal is CLI chain plus MCP discovery/smoke.

## Contract Checks

### JSON Stdout Checks

Required checks:

- every command stdout parses as one JSON object.
- stdout trim starts with `{` and ends with `}`.
- no command stdout contains progress log prefixes.
- fixture final stdout is one JSON object.
- expected failures also use JSON stdout.

Failure handling:

- If stdout contains logs, move logs to stderr in the offending CLI/script before continuing.

### Hash Stability Checks

Required checks:

- manifest `source.contentHash` is stable across two runs.
- manifest `source.exportHash` is stable across two runs.
- guardrail material ids are stable across two runs.
- guardrail material `metadata.materialHash` values are stable across two runs.
- export hash from manifest matches the fixture-recorded export hash.

Failure handling:

- If manifest hash is unstable, inspect Phase 34 canonicalization / generatedAt exclusion.
- If material ids are unstable, inspect Phase 35 material hash input / ordering.

### Redaction Checks

Serialize and inspect outputs from:

- export.
- project overview.
- evidence bundle.
- verification commands.
- manifest.
- guardrail material.
- MCP list-tools / smoke output.
- final fixture result.

Required absence:

- `RAW_SNIPPET_MARKER`
- `RAW_ARTIFACT_MARKER`
- `RAW_REVIEW_MARKER`
- `RAW_TOKEN_MARKER`
- temp `repoPath`
- temp `artifactRoot`
- raw scanner stdout/stderr body marker if seeded.

Failure handling:

- Fix the source builder that leaked raw data.
- Do not add fixture-only redaction filters.

### Candidate-only Checks

Required checks:

- every `intelligence:agent-query` result item has `candidateOnly: true`.
- every semantic result, if included later, has `candidateOnly: true`.
- every guardrail material has `candidateOnly: true`.
- verification command query summary has `candidateOnly: true`.
- verification command result items do not claim command execution.

Failure handling:

- Fix service output schema/implementation, not the fixture assertion.

### Provenance Checks

Required checks:

- manifest has:
  - `source.sourceId`
  - `source.scanRunId`
  - `source.contentHash`
  - `source.exportHash`
- manifest available bundle commands are argv arrays.
- guardrail material result has `sourceManifest`.
- every guardrail material has non-empty `source.sourceRefs`.
- evidence bundle has non-empty refs for the selected finding.
- verification commands have `sourceRefs` containing `handoff:<scanRunId>` or equivalent scan-level source ref.
- verification commands do not over-attribute finding/evidence/file refs unless explicit mapping exists.

Failure handling:

- Fix provenance in Phase 34/35/agent-query service, not the fixture.

### Isolation Checks

Required checks:

- temp root is under `os.tmpdir()`.
- DB path is under temp root.
- artifact root is under temp root.
- repo path is under temp root.
- no generated file is written under `process.cwd()` except intentional source edits.
- cleanup removes temp root unless `--keep-temp true`.

Failure handling:

- If fixture writes into repo, stop and move generated output under temp root.

### No Mutation Checks

Required checks:

- fixture does not call contextStill MCP.
- fixture does not call `register_candidates`.
- fixture does not create NightWorkers tasks.
- fixture does not run scanner/DAST/dynamic tools.
- MCP smoke/list-tools does not mutate DB.

Implementation note:

- For DB row-count checks, capture counts before and after MCP handler smoke only if Phase 36 exposes a real scan-run smoke. Otherwise rely on Phase 36 unit tests for row-count proof and Phase 37 for end-to-end command proof.

## Implementation Tasks

### Task 1: Add Fixture Result Types and Helpers

Files:

- add `scripts/static-intelligence-knowledge-source-fixture.ts`

Implementation:

- Add constants for unsafe markers.
- Add final success/failure result builders.
- Add `log(message)` that writes to stderr.
- Add `writeFinalResult(result)` that writes one JSON object to stdout.
- Add `parseBooleanOption`.
- Add `parseJsonObject(label, stdout)`.
- Add `runCommand(label, args, env, expectedStatus?)`.
- Add `assertCheck(name, fn)` that records passed checks and throws with `failedCheck` on failure.
- Add `assertNoUnsafeMarkers(label, payloadText, markers)`.
- Add `sha256Json` only if needed for fixture-local comparison; prefer hashes emitted by Phase 34/35 outputs.

Verification:

```bash
bun run typecheck
```

Expected:

- script compiles.
- no CLI commands are executed yet unless main is invoked.

Failure handling:

- If typecheck imports create side effects, keep helper functions local and avoid importing CLI modules.

### Task 2: Implement Temp Isolation and Migration Setup

Files:

- update `scripts/static-intelligence-knowledge-source-fixture.ts`

Implementation:

- Use `fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-static-intel-"))`.
- Create `dbPath`, `artifactRoot`, `repoPath`.
- Create minimal fake repo files under `repoPath` if needed.
- Create DB with `createDbConnection`.
- Apply migrations from `drizzle/*.sql` directly.
- Set env:
  - `DATABASE_URL=file:<dbPath>`
  - `SCAN_ARTIFACT_ROOT=<artifactRoot>/scans`
  - `REPRODUCTION_ARTIFACT_ROOT=<artifactRoot>/reproductions`
  - `DYNAMIC_ARTIFACT_ROOT=<artifactRoot>/dynamic`
  - `DAST_ARTIFACT_ROOT=<artifactRoot>/dast`
- Close DB before CLI command chain.
- Cleanup temp root in `finally` unless `--keep-temp true`.

Verification:

```bash
bun run fixture:static-intelligence-source -- --keep-temp true --skip-mcp true
```

Expected at this intermediate point:

- if seeding/commands are not implemented yet, script may return a planned failure.
- temp paths are under `/tmp`.
- no generated files appear in repo.

Failure handling:

- If cleanup removes unrelated files, stop and make cleanup target the unique temp root only.

### Task 3: Seed Deterministic Static Intelligence Fixture

Files:

- update `scripts/static-intelligence-knowledge-source-fixture.ts`

Implementation:

- Insert user/project/scan/toolRun/artifact/findings/evidence/review rows directly.
- Use deterministic timestamps.
- Let DB generate UUIDs unless stable IDs are required for assertions.
- Keep fixture values stable enough for repeated command output comparison.
- Seed:
  - high severity artifact-backed finding.
  - medium weak-evidence finding.
  - completed review with improvement request and verification command.
- Store unsafe markers only in fields expected to be redacted.

Verification:

```bash
bun run fixture:static-intelligence-source -- --keep-temp true --skip-mcp true
```

Expected:

- script reaches CLI command phase.
- seeded scanRunId and findingIds are present in final or failure JSON.

Failure handling:

- If export builder cannot read seeded rows, align seed shape with existing static-intelligence tests.

### Task 4: Add CLI Chain Execution

Files:

- update `scripts/static-intelligence-knowledge-source-fixture.ts`

Implementation:

- Run required CLI command chain with argv arrays.
- Parse each stdout.
- Store parsed outputs in local variables.
- For expected missing scan checks, assert exit code 2 and JSON failure.
- Do not pass `--pretty true`; fixture should verify compact machine JSON by default.

Verification:

```bash
bun run fixture:static-intelligence-source -- --skip-mcp true
```

Expected:

- export, agent-query, manifest, and material commands complete.
- missing scan checks return exit code 2.
- final stdout is JSON if all checks implemented so far pass.

Failure handling:

- If a CLI writes logs to stdout, fix that CLI before continuing.

### Task 5: Add Contract Assertions

Files:

- update `scripts/static-intelligence-knowledge-source-fixture.ts`

Implementation:

- Implement all checks from:
  - JSON stdout checks.
  - hash stability checks.
  - redaction checks.
  - candidate-only checks.
  - provenance checks.
  - isolation checks.
  - no mutation checks.
- Each check appends:

```ts
{ name: "manifest contentHash is stable", status: "passed" }
```

- Check names must be stable so future regressions are easy to identify.

Verification:

```bash
bun run fixture:static-intelligence-source -- --skip-mcp true
```

Expected:

- all CLI-only checks pass.
- final result includes check list and output hash/material summaries.

Failure handling:

- If a check fails, fix the producing module. Do not weaken the fixture unless the contract is intentionally changed in the relevant phase doc.

### Task 6: Add MCP Smoke/List Checks

Files:

- update `scripts/static-intelligence-knowledge-source-fixture.ts`

Implementation:

- Unless `--skip-mcp true`, run:
  - `bun run mcp:static-intelligence -- --list-tools`
  - `bun run mcp:static-intelligence -- --smoke`
- Parse stdout JSON.
- Assert tool names.
- Assert outputs do not contain unsafe markers or temp paths.
- Record `mcpToolNames`.
- Set `outputs.mcpSkipped` false.
- In skip mode, set `outputs.mcpSkipped` true and add a passed check named `mcp checks skipped by option`.

Verification:

```bash
bun run fixture:static-intelligence-source
```

Expected:

- full fixture passes after Phase 36.
- if Phase 36 is not present, fixture fails clearly with failure JSON.

Failure handling:

- If MCP command is unavailable, do not mark Phase 37 complete. Finish Phase 36 first.

### Task 7: Add Package Script

Files:

- update `package.json`

Implementation:

Add:

```json
"fixture:static-intelligence-source": "bun run scripts/static-intelligence-knowledge-source-fixture.ts"
```

Verification:

```bash
bun run fixture:static-intelligence-source -- --skip-mcp true
```

Expected:

- package script resolves.
- stdout is final fixture JSON.

Failure handling:

- If script path changes, update Phase 37 docs and all tests together.

### Task 8: Add Fixture Script Tests

Files:

- add `api/modules/static-intelligence/static-intelligence-knowledge-source-fixture.test.ts`

Implementation:

- Use `spawnSync(process.execPath, ["scripts/static-intelligence-knowledge-source-fixture.ts", "--skip-mcp", "true"], ...)`.
- Assert:
  - status 0.
  - stdout parseable JSON.
  - `ok: true`.
  - `outputs.mcpSkipped === true`.
  - checks all passed.
  - stdout does not contain unsafe marker constants.
- Add invalid arg test:
  - `--keep-temp maybe`
  - status 2.
  - stdout JSON failure.
- Do not run full MCP mode in unit test unless Phase 36 server smoke is fast and stable in the test environment.

Verification:

```bash
bun test ./api/modules/static-intelligence/static-intelligence-knowledge-source-fixture.test.ts
```

Expected:

- fixture script can be executed by test runner without external services.

Failure handling:

- If fixture is too slow, keep test on `--skip-mcp true` and rely on package script for full local verification.

### Task 9: Add Documentation Cross-check

Files:

- update this document only if implementation changes command names.
- optionally update `spec/phase-36-static-intelligence-readonly-mcp-wrapper-plan.md` if MCP smoke flags differ.

Implementation:

- Ensure command names match:
  - `fixture:static-intelligence-source`
  - `mcp:static-intelligence`
  - `intelligence:knowledge-source`
  - `intelligence:guardrail-material`
- Ensure tool names match Phase 36.

Verification:

```bash
rg -n "fixture:static-intelligence-source|mcp:static-intelligence|vuln_get_knowledge_source_manifest|vuln_get_guardrail_material" spec/phase-3*.md
```

Expected:

- docs use consistent command/tool names.

Failure handling:

- If docs drift, update docs before starting Phase 38.

### Task 10: Run Final Verification

Commands:

```bash
bun test ./api/modules/static-intelligence/static-intelligence-knowledge-source-fixture.test.ts
bun run fixture:static-intelligence-source
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

Expected:

- fixture script test passes.
- full fixture command passes without `--skip-mcp`.
- existing static-intelligence tests pass.
- full repo verification passes.

Failure handling:

- If full fixture fails only because Phase 36 MCP is unavailable, Phase 37 is blocked until Phase 36 is complete.
- If redaction fails, fix source service.
- If hash stability fails, fix Phase 34/35 hash input.
- If stdout JSON fails, fix offending CLI/script.
- If full verify fails due to formatting, run `bunx biome format --write` only for files touched by this phase, then rerun verify.

## Implementation Order

Recommended order:

1. fixture script helpers and result/failure shapes.
2. temp isolation and migrations.
3. deterministic DB seeding.
4. CLI command chain.
5. CLI-only contract assertions.
6. MCP smoke/list assertions.
7. package script.
8. fixture script tests.
9. docs cross-check.
10. final verification.

Do not start with live scans, network providers, contextStill registration, NightWorkers integration, or MCP mutation tooling.

## Review Checklist

- [ ] fixture DB is under `/tmp`.
- [ ] fixture artifact root is under `/tmp`.
- [ ] fixture repo path is under `/tmp`.
- [ ] cleanup only removes the unique temp root.
- [ ] stdout is exactly one JSON object.
- [ ] progress logs go to stderr.
- [ ] CLI commands are run with argv arrays.
- [ ] manifest contentHash is stable across repeated runs.
- [ ] guardrail material ids are stable across repeated runs.
- [ ] all agent query result items are candidate-only.
- [ ] all guardrail materials are candidate-only.
- [ ] every guardrail material has source refs.
- [ ] evidence bundle returns refs, not raw artifact body.
- [ ] verification commands are not marked as executed.
- [ ] verification commands are not over-attributed to finding/file refs.
- [ ] unsafe markers do not appear in any serialized output.
- [ ] temp repo path does not appear in any serialized output.
- [ ] missing scan cases exit 2 with JSON failure.
- [ ] MCP list-tools includes all Phase 36 tools.
- [ ] MCP smoke exits 0.
- [ ] fixture does not call contextStill.
- [ ] fixture does not create NightWorkers tasks.
- [ ] fixture does not run scanner/DAST/dynamic tools.

## Stop Conditions

- fixture depends on live user DB.
- fixture writes generated artifacts into repo.
- fixture requires external network or live provider.
- fixture calls contextStill or NightWorkers mutation paths.
- fixture calls `register_candidates`.
- fixture treats semantic candidate as confirmed finding.
- fixture executes verification commands.
- fixture runs scanner / DAST / dynamic tools.
- fixture hides redaction failures with fixture-only filtering.
- fixture completion requires `--skip-mcp true`.
- stdout contains logs or multiple JSON objects.

## Completion Definition

This phase is complete when one local command can prove the Static Intelligence knowledge source contract end-to-end without external services, without DB direct access by consumers, and without leaking raw snippets or artifact bodies.

Concrete completion evidence:

- `bun run fixture:static-intelligence-source` exits 0.
- final stdout is one JSON object with:
  - `ok: true`
  - `status: "completed"`
  - `outputs.manifestContentHash`
  - `outputs.manifestExportHash`
  - `outputs.guardrailMaterialIds`
  - `outputs.mcpToolNames`
  - `outputs.mcpSkipped: false`
- all checks are `passed`.
- temp files are cleaned up by default.
- `bun test ./api/modules/static-intelligence/static-intelligence-knowledge-source-fixture.test.ts` passes.
- `bun run verify` passes.
