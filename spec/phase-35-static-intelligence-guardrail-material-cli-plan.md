# Phase 35: Static Intelligence Guardrail Material CLI Plan

## Purpose

この計画は、contextStill が vulnWorkbench を knowledge source として pull し、汎用 knowledge へ蒸留するための中間素材 `GuardrailMaterial` を CLI から取得できるようにする。

中心に置く成果物は contextStill candidate そのものではなく、candidate 化の前段にある evidence-backed material である。

```text
StaticIntelligenceKnowledgeSourceManifest
  -> StaticIntelligenceExportV1
  -> RiskCommunity / SecurityLandscape / Handoff
  -> StaticIntelligenceGuardrailMaterial[]
  -> contextStill distillation decision
```

この phase では `register_candidates` を呼ばない。active / rejected / deprecated の判断は contextStill 側に残す。

## Dependency

Phase 35 は Phase 34 の完了後に実装する。

Required Phase 34 API:

- `buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, options?)`
- `buildStaticIntelligenceKnowledgeSourceManifestForScan(db, scanRunId, options?)`
- `canonicalJson(value)`
- `sha256Hex(value)`
- `StaticIntelligenceKnowledgeSourceManifest`

Phase 34 が未実装の場合は、先に Phase 34 を実装する。Phase 35 内で manifest / canonical JSON / hash helper を別実装しない。

## Product Boundary

vulnWorkbench が担当すること:

- Static Intelligence export から reusable material を抽出する。
- material に evidence refs / artifact refs / file refs / applicability / source hash を付ける。
- raw finding や raw artifact ではなく、汎用化しやすい中間表現を返す。
- CLI `intelligence:guardrail-material` を追加する。
- stdout は JSON object 1 件だけにする。
- Phase 34 manifest の `sourceId` / `contentHash` / `exportHash` を provenance として返す。

vulnWorkbench が担当しないこと:

- contextStill candidate registration。
- contextStill active knowledge 作成。
- NightWorkers task 作成。
- queue admission。
- patch planning。
- raw source exploration。
- LLM による repository 自由探索。
- scanner tuning config の自動変更。
- false positive allowlist の自動生成。

## Current Baseline

既存の関連実装:

- `api/modules/static-intelligence/export-builder.ts`
  - `buildStaticIntelligenceExport(db, scanRunId)`
  - `StaticIntelligenceExportV1`
- `api/modules/static-intelligence/community-builder.ts`
  - `buildRiskCommunities(exportPayload)`
  - `RiskCommunity` with refs, basis, confidence, maxSeverity, evidenceQuality。
- `api/modules/static-intelligence/landscape-builder.ts`
  - `buildSecurityLandscape(exportPayload, communities)`
  - remediation / evidence / coverage focus。
- `api/modules/static-intelligence/agent-query.ts`
  - `verification_commands` query surface。
  - verification commands are scan-level candidate commands and are not executed。
- `api/cli/intelligence-agent-query.ts`
  - strict CLI JSON / exit code pattern。
- `api/modules/static-intelligence/intelligence-agent-query-cli.test.ts`
  - temp SQLite CLI test pattern。
- Phase 34 plan / implementation:
  - knowledge source manifest and stable content hash。

現状の不足:

- contextStill が蒸留できる reusable material がない。
- guardrail 候補の provenance が manifest と結びついていない。
- verification command を procedure-shaped material に変換する contract がない。
- weak evidence / missing handoff を reusable actionability lesson として返す surface がない。
- material の安定 ID / content hash / redaction guarantee がない。

## Material Types

Initial allowlist:

```text
security_guardrail_material
verification_recipe_material
false_positive_lesson_material
agent_actionability_lesson_material
scanner_tuning_lesson_material
```

Phase 35 initial implementation must generate only evidence-backed material. If a type lacks reliable input, return zero items for that type and add a degraded reason only when useful for consumers.

Candidate にしないもの:

- evidence refs / artifact refs / file refs / scan-level source refs のいずれもない LLM 推測。
- scanner stdout / stderr 全文。
- raw evidence snippet。
- raw artifact body。
- secret / token value。
- absolute path や user home を主語にした一回限りの事象。
- contextStill の active 化判断。
- severity や vulnerability truth を semantic similarity だけで断定するもの。

## Output Contract

Add `shared/schemas/static-intelligence-guardrail-material.schema.ts`.

```ts
type StaticIntelligenceGuardrailMaterialResult = {
  ok: true;
  status: "completed";
  version: "v1";
  generatedAt: string;
  scanRunId: string;
  sourceManifest: {
    sourceId: string;
    contentHash: string;
    exportHash: string;
  };
  filters: {
    type?: StaticIntelligenceGuardrailMaterialType;
    includeMarkdown: boolean;
  };
  materials: StaticIntelligenceGuardrailMaterial[];
  markdown?: string;
  degradedReasons: string[];
};

type StaticIntelligenceGuardrailMaterialFailure = {
  ok: false;
  status: "failed";
  message: string;
  degradedReasons?: string[];
};

type StaticIntelligenceGuardrailMaterialType =
  | "security_guardrail_material"
  | "verification_recipe_material"
  | "false_positive_lesson_material"
  | "agent_actionability_lesson_material"
  | "scanner_tuning_lesson_material";

type StaticIntelligenceGuardrailMaterial = {
  id: string;
  type: StaticIntelligenceGuardrailMaterialType;
  title: string;
  summary: string;
  candidateOnly: true;
  source: {
    kind: "vulnWorkbench.static_intelligence";
    sourceId: string;
    scanRunId: string;
    sourceRefs: string[];
    contentHash: string;
  };
  applicability: {
    domains: string[];
    technologies: string[];
    changeTypes: string[];
  };
  refs: {
    findingIds: string[];
    evidenceRefs: string[];
    artifactRefs: string[];
    fileRefs: string[];
    ruleIds: string[];
    scanners: string[];
  };
  suggestedDistillation: {
    contextStillType: "rule" | "procedure";
    polarity: "positive" | "negative" | "neutral";
    avoid?: string;
    prefer?: string;
    procedureSections?: {
      useWhen: string[];
      workflow: string[];
      verification: string[];
      avoid: string[];
    };
  };
  metadata: {
    confidence: "low" | "medium" | "high";
    evidenceQuality: "none" | "weak" | "mixed" | "strong" | "unknown";
    riskBand: "none" | "low" | "medium" | "high" | "critical" | "unknown";
    materialHash: string;
    generatedFrom: Array<
      | "finding"
      | "file_risk"
      | "risk_community"
      | "security_landscape"
      | "handoff"
      | "scan_summary"
    >;
    degradedReasons: string[];
  };
};
```

Required field rules:

- `source.kind` is always `"vulnWorkbench.static_intelligence"`.
- `source.sourceId` is copied from Phase 34 manifest.
- `source.contentHash` is copied from Phase 34 manifest `source.contentHash`.
- `source.sourceRefs` must include at least one stable ref:
  - `manifest:${sourceId}`
  - `scan:${scanRunId}`
  - `finding:${findingId}`
  - `community:${communityId}`
  - `landscape:${section}`
  - `handoff:${scanRunId}`
- `candidateOnly` is always `true`.
- `metadata.materialHash` is a 64-char SHA-256 hex.
- `materials` are sorted by:
  1. type order
  2. highest severity/risk first where applicable
  3. title
  4. id

Failure shape:

```json
{
  "ok": false,
  "status": "failed",
  "message": "..."
}
```

## Hash and ID Contract

Reuse Phase 34 helpers:

- `canonicalJson`
- `sha256Hex`

Material hash:

- `materialHash = sha256(canonicalJson(materialHashInput))`
- `materialHashInput` excludes:
  - result `generatedAt`
  - material `id`
  - material `metadata.materialHash`
- `materialHashInput` includes:
  - type
  - title
  - summary
  - source sourceId / scanRunId / sourceRefs / contentHash
  - applicability
  - refs
  - suggestedDistillation
  - confidence / evidenceQuality / riskBand / generatedFrom / degradedReasons

Material ID:

```text
guardrail_material:<type>:<first-16-chars-of-materialHash>
```

Stability expectation:

- same export + same Phase 34 manifest contentHash => same material ids.
- changed refs / summary / suggested distillation => changed materialHash and id.
- changed result `generatedAt` only => no material id or materialHash change.

## Redaction Contract

Material may include:

- generalized title / summary.
- ids and refs.
- scanner names.
- rule ids.
- relative file paths from Static Intelligence file risk index.
- verification command strings from handoff, because these are explicit command candidates.
- acceptance criteria text from handoff only when phrased as general verification/actionability and not raw code.

Material must never include:

- artifact body.
- evidence snippet.
- source code snippet.
- scanner stdout/stderr body.
- secret value.
- token value.
- private key material.
- `project.rootPath`.
- absolute user home path.
- raw semantic metadata fields such as `snippet`, `rawContent`, or `content`.

If a source field cannot be proven redacted, do not copy it into material. Prefer a degraded reason or skip the material.

## Applicability Rules

Initial deterministic mapping:

- domains:
  - always include `"security"`.
  - include `"application_security"` for first-party source findings.
  - include `"dependency_security"` when rule/scanner/file indicates dependency or package manifest.
  - include `"secret_handling"` when scanner/rule/title suggests secret/token/key leakage.
  - include `"input_validation"` when scanner/rule/title suggests injection, XSS, SQLi, command injection, path traversal, or validation.
- technologies:
  - infer from relative file extension:
    - `.ts`, `.tsx` => `"typescript"`
    - `.js`, `.jsx`, `.mjs`, `.cjs` => `"javascript"`
    - `.py` => `"python"`
    - `.rb` => `"ruby"`
    - `.go` => `"go"`
    - `.rs` => `"rust"`
    - `.java`, `.kt` => `"jvm"`
    - `package.json`, lockfiles => `"node"`
    - `Dockerfile`, `*.yaml`, `*.yml`, `*.tf` => `"infrastructure"`
  - if unknown, use `[]` rather than guessing.
- changeTypes:
  - security material => `["security_fix"]`
  - verification recipe => `["verification"]`
  - actionability lesson => `["planning", "review"]`
  - scanner tuning => `["scanner_tuning"]`
  - false positive lesson => `["review"]`

All arrays must be sorted unique.

## Material Generation Rules

### Security Guardrail Material

Input:

- `RiskCommunity` with:
  - max severity high / critical, or
  - basis `same_scanner_rule`, or
  - basis `same_file` with more than one finding, or
  - basis `semantic` with evidence refs from known findings.
- `FileRiskIndexEntry` with:
  - max severity high / critical and at least one finding.

Output:

- `type: "security_guardrail_material"`
- `contextStillType: "rule"`
- polarity:
  - `"negative"` when phrased as an avoid-pattern.
  - `"positive"` when phrased as a prefer/safe-default.
- `summary` must be generalized and must not name local absolute paths.
- refs must include finding ids and at least one evidence/artifact/file ref where available.
- material without any refs is skipped.

Suggested text shape:

- title: `Avoid recurring <rule/scanner/domain> risk in <relative-surface>`
- summary: `Scanner-backed findings indicate recurring <risk> around <relative-surface>. Prefer validating inputs and preserving evidence-backed verification before considering the issue resolved.`
- avoid: `Treat scanner-backed <risk> as resolved without checking the referenced evidence and verification surface.`
- prefer: `Use the referenced findings, evidence, and verification commands to drive a focused security fix.`

### Verification Recipe Material

Input:

- `exportPayload.handoff.verificationCommands`.
- `exportPayload.handoff.acceptanceCriteria`.

Output:

- `type: "verification_recipe_material"`
- `contextStillType: "procedure"`
- `polarity: "positive"`
- source refs include:
  - `manifest:${sourceId}`
  - `scan:${scanRunId}`
  - `handoff:${scanRunId}`
  - `verification_command:<ordinal>`
- refs:
  - finding/evidence/artifact/file refs remain empty unless explicit mapping exists.
- procedure sections:
  - useWhen: mention scan-level security handoff verification.
  - workflow: list commands as candidate commands, not executed proof.
  - verification: include acceptance criteria and command candidates.
  - avoid: include `Do not claim verification commands passed unless they were executed.`
- metadata confidence:
  - `medium` when at least one command exists.
  - `low` if only acceptance criteria exist.

Important:

- Do not attach verification commands to a finding unless the current export has explicit finding/file mapping. Phase 35 should preserve the Phase 33 provenance hardening.
- Do not execute commands.

### False Positive Lesson Material

Initial implementation:

- Return zero material unless there is a reliable structured signal in existing Static Intelligence data.
- Do not parse free-form review prose for false-positive claims in Phase 35.

Allowed future input:

- structured review output that marks finding as false positive.
- accepted-risk / false-positive decision record with evidence refs.

If not generated:

- Do not add a degraded reason just because no false-positive signal exists.

### Agent Actionability Lesson Material

Input:

- `SecurityLandscape.remediation.openFocus`.
- `exportPayload.scanSummary.degradedReasons`.
- missing handoff.
- missing verification commands.
- missing acceptance criteria.
- weak or missing evidence.
- unknown file path.

Output:

- `type: "agent_actionability_lesson_material"`
- `contextStillType: "procedure"`
- polarity: `"positive"`
- source refs include:
  - `manifest:${sourceId}`
  - `scan:${scanRunId}`
  - `landscape:remediation`
- refs include weak/missing evidence finding ids where available.
- procedure sections should describe what a useful agent handoff should include:
  - useWhen: security scan output is incomplete or weak.
  - workflow: collect evidence refs, add acceptance criteria, add verification candidates.
  - verification: rerun scan / targeted test / review artifact-backed evidence.
  - avoid: do not ask an implementation agent to fix vague findings without evidence refs or verification criteria.

Generate one consolidated actionability material per scan if any open focus exists.

### Scanner Tuning Lesson Material

Input:

- `RiskCommunity` with basis `same_scanner_rule` or `same_scanner`.
- evidence quality `weak`, `none`, or `unknown`.
- at least two findings.

Output:

- `type: "scanner_tuning_lesson_material"`
- `contextStillType: "procedure"`
- polarity: `"neutral"`
- summary must be a tuning hint, not an allowlist.
- avoid generating rules that suppress scanner output automatically.
- procedure sections:
  - useWhen: repeated weak scanner findings appear.
  - workflow: inspect scanner rule, compare artifact-backed evidence, tune profile only after review.
  - verification: rerun scanner and compare finding count/evidence quality.
  - avoid: do not blanket-ignore the scanner rule without evidence.

## CLI Contract

Add:

```bash
bun run intelligence:guardrail-material -- \
  --scan-run-id <scan-run-id>
```

Options:

```bash
--type security_guardrail_material
--include-markdown true
--pretty true
```

Allowed `--type` values:

- `security_guardrail_material`
- `verification_recipe_material`
- `false_positive_lesson_material`
- `agent_actionability_lesson_material`
- `scanner_tuning_lesson_material`

stdout:

- JSON object 1 件のみ。
- success shape is `StaticIntelligenceGuardrailMaterialResult`.
- failure shape is `StaticIntelligenceGuardrailMaterialFailure`.
- progress / warning / stack trace を混ぜない。

stderr:

- unexpected runtime diagnostics only。
- invalid argument / missing scan は stderr に出さない。
- normal degraded reasons are returned in JSON `degradedReasons`.

Exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | material generation completed, including empty material set |
| 1 | runtime / DB / unexpected failure |
| 2 | invalid argument or scan run not found |

CLI implementation should follow `api/cli/intelligence-agent-query.ts`:

- use `parseArgs`.
- validate `--scan-run-id`.
- validate boolean options as only `true` or `false`.
- validate `--type` through zod enum.
- create DB connection after argument validation.
- close SQLite in `finally`.
- catch `StaticIntelligenceScanRunNotFoundError` and return exit code 2.
- return stdout JSON through a single `writeResult()`.

## Implementation Tasks

### Task 1: Add Shared Guardrail Material Schema

Files:

- add `shared/schemas/static-intelligence-guardrail-material.schema.ts`

Implementation:

- Define:
  - `staticIntelligenceGuardrailMaterialTypeSchema`
  - `staticIntelligenceGuardrailMaterialSchema`
  - `staticIntelligenceGuardrailMaterialResultSchema`
  - `staticIntelligenceGuardrailMaterialFailureSchema`
  - `staticIntelligenceGuardrailMaterialCliTypeSchema` if a separate CLI parser helper is cleaner.
- Reuse:
  - risk band enum from `static-intelligence.schema.ts`
  - evidence quality enum from `static-intelligence.schema.ts`
  - risk community confidence enum from `static-intelligence-landscape.schema.ts`
- Export inferred types.
- Make `candidateOnly` literal `true`.
- Make `source.kind` literal `"vulnWorkbench.static_intelligence"`.
- Require `source.sourceRefs` `.min(1)`.
- Require all ref arrays even if empty.
- Require `metadata.materialHash` as string; tests will enforce 64-char hex.

Verification:

```bash
bun run typecheck
```

Expected:

- New schema compiles.
- No import cycle with Phase 34 schema.

Failure handling:

- If import cycles appear, keep schemas in `shared` leaf modules and move helper functions to `api/modules`.

### Task 2: Add Builder Skeleton and Stable Helpers

Files:

- add `api/modules/static-intelligence/guardrail-material.ts`
- add `api/modules/static-intelligence/guardrail-material.test.ts`

Implementation:

- Add exported functions:

```ts
export function buildStaticIntelligenceGuardrailMaterial(
  input: {
    exportPayload: StaticIntelligenceExportV1;
    sourceManifest: StaticIntelligenceKnowledgeSourceManifest;
    communities?: RiskCommunity[];
    landscape?: SecurityLandscape;
    type?: StaticIntelligenceGuardrailMaterialType;
    includeMarkdown?: boolean;
    generatedAt?: Date;
  }
): StaticIntelligenceGuardrailMaterialResult;

export async function buildStaticIntelligenceGuardrailMaterialForScan(
  db: AppDatabase,
  scanRunId: string,
  options?: {
    type?: StaticIntelligenceGuardrailMaterialType;
    includeMarkdown?: boolean;
    generatedAt?: Date;
  }
): Promise<StaticIntelligenceGuardrailMaterialResult>;
```

- `buildStaticIntelligenceGuardrailMaterialForScan` must:
  - call `buildStaticIntelligenceExport(db, scanRunId)`.
  - call `buildStaticIntelligenceKnowledgeSourceManifest(exportPayload, options)`.
  - call `buildRiskCommunities(exportPayload)`.
  - call `buildSecurityLandscape(exportPayload, communities)`.
  - then call pure builder.
- Pure builder must not query DB.
- Use Phase 34 `canonicalJson` and `sha256Hex` for hashes.
- Add helpers:
  - `sortedUnique`
  - `inferApplicability`
  - `makeMaterial`
  - `materialHashInput`
  - `sortMaterials`
  - `filterMaterialsByType`

Initial tests:

- returns schema-valid empty result for zero-finding export.
- sourceManifest fields are copied into result and material source.
- generatedAt changes do not change material ids.

Verification:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
```

Expected:

- Builder skeleton can return valid result before all material generators are filled in.

Failure handling:

- If builder needs fields unavailable in export/community/landscape/manifest, revise material contract instead of adding DB queries.

### Task 3: Implement Security Guardrail Material

Files:

- update `api/modules/static-intelligence/guardrail-material.ts`
- update `api/modules/static-intelligence/guardrail-material.test.ts`

Implementation:

- Generate from eligible risk communities and high/critical file risk entries.
- Deduplicate by normalized refs:
  - same type + same findingIds + same ruleIds + same scanners + same fileRefs.
- Skip material if all refs arrays and source refs would be empty.
- Use generalized text; no absolute path.
- Include source refs:
  - `manifest:${sourceManifest.source.sourceId}`
  - `scan:${scanRunId}`
  - `community:${community.id}` when community-based.
  - `file_risk:${entry.path}` when file-risk-based.
- Set metadata:
  - confidence from community when available, otherwise `medium` for high/critical file risk.
  - evidenceQuality from community/entry.
  - riskBand from export scan summary.
  - generatedFrom includes `risk_community` or `file_risk`.

Tests:

- high severity finding produces security material.
- repeated same scanner rule community produces security material.
- material includes finding/evidence/artifact/file/rule/scanner refs when available.
- material summary does not include project root path.
- duplicate community/file-risk input does not produce duplicate material.

Verification:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
```

Failure handling:

- If generated text becomes too project-specific, move details into refs and keep summary generalized.

### Task 4: Implement Verification Recipe Material

Files:

- update `api/modules/static-intelligence/guardrail-material.ts`
- update `api/modules/static-intelligence/guardrail-material.test.ts`

Implementation:

- If handoff has verification commands or acceptance criteria, generate one verification recipe material.
- Include commands as candidate commands in `procedureSections.workflow` or `procedureSections.verification`.
- Include acceptance criteria in `procedureSections.verification`.
- Use refs:
  - source refs include `handoff:${scanRunId}` and `verification_command:<ordinal>`.
  - finding/evidence/artifact/file refs remain empty unless explicit mapping exists.
- Add avoid section:
  - `Do not claim verification commands passed unless they were executed.`
- If no handoff or no commands/criteria, return no verification recipe; actionability material will cover the gap.

Tests:

- verification commands produce procedure-shaped material.
- command strings are present as candidates.
- material does not claim commands were executed.
- material does not attach finding ids when no explicit mapping exists.
- no verification recipe is emitted when handoff is missing.

Verification:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
```

Failure handling:

- If verification command provenance becomes finding-scoped without explicit refs, revert to scan-level source refs.

### Task 5: Implement Agent Actionability Material

Files:

- update `api/modules/static-intelligence/guardrail-material.ts`
- update `api/modules/static-intelligence/guardrail-material.test.ts`

Implementation:

- Generate one consolidated material when any of these exists:
  - landscape remediation open focus.
  - scan degraded reasons.
  - missing handoff.
  - missing verification commands.
  - missing acceptance criteria.
  - weak/missing evidence.
  - unknown file path.
- Use source refs:
  - `manifest:${sourceId}`
  - `scan:${scanRunId}`
  - `landscape:remediation`
- Include weak/missing evidence finding ids from landscape evidence section.
- Summarize the actionable gap without exposing raw output.
- Set:
  - `contextStillType: "procedure"`
  - `polarity: "positive"`
  - generatedFrom includes `security_landscape` and/or `scan_summary`.

Tests:

- missing handoff produces actionability material.
- weak evidence produces actionability material with finding ids.
- completed handoff with no open focus does not produce actionability material.
- degraded reasons are sorted unique.

Verification:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
```

Failure handling:

- If the material reads like a project-specific task, rewrite as a reusable handoff-quality procedure.

### Task 6: Implement Scanner Tuning and False-positive Boundaries

Files:

- update `api/modules/static-intelligence/guardrail-material.ts`
- update `api/modules/static-intelligence/guardrail-material.test.ts`

Implementation:

- Scanner tuning:
  - generate for repeated weak/unknown/none evidence communities with same scanner or same scanner rule.
  - do not generate allowlist/suppression instructions.
  - use neutral polarity.
- False-positive:
  - return zero material in Phase 35 unless a reliable structured signal already exists.
  - do not parse free-form prose.
  - add tests confirming no false-positive material is fabricated from generic review text.

Tests:

- repeated weak scanner community produces scanner tuning material.
- scanner tuning material uses neutral polarity.
- scanner tuning material does not include blanket-ignore wording.
- false positive material is not emitted without structured signal.

Verification:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
```

Failure handling:

- If scanner tuning output suggests suppression/allowlist by default, rewrite as review-and-rerun procedure.

### Task 7: Add Markdown Rendering

Files:

- update `api/modules/static-intelligence/guardrail-material.ts`
- update `api/modules/static-intelligence/guardrail-material.test.ts`

Implementation:

- Add `renderGuardrailMaterialMarkdown(result)` or an internal renderer.
- Only include markdown when `includeMarkdown === true`.
- Markdown must summarize:
  - source manifest source id / content hash.
  - material count by type.
  - each material title, type, summary, refs, suggested distillation.
- Markdown must not include raw snippets or artifact bodies.
- Markdown is convenience output; JSON remains primary contract.

Tests:

- `includeMarkdown false` omits markdown.
- `includeMarkdown true` includes markdown string.
- markdown excludes raw markers and project root path.

Verification:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
```

Failure handling:

- If markdown duplicates too much JSON, keep it compact and preserve JSON as source of truth.

### Task 8: Add CLI Entrypoint

Files:

- add `api/cli/intelligence-guardrail-material.ts`
- update `package.json`

Package script:

```json
"intelligence:guardrail-material": "bun run api/cli/intelligence-guardrail-material.ts"
```

Implementation:

- Parse:
  - `--scan-run-id <id>` required.
  - `--type <material-type>` optional.
  - `--include-markdown true|false` optional, default false.
  - `--pretty true|false` optional, default false.
- Validate arguments before DB connection.
- Call `buildStaticIntelligenceGuardrailMaterialForScan`.
- Write result JSON to stdout.
- On invalid args / missing scan:
  - stdout failure JSON.
  - exit code 2.
  - stderr empty.
- On unexpected runtime failure:
  - stdout failure JSON.
  - exit code 1.
  - stderr may contain diagnostic message.
- Always close SQLite if opened.

Verification:

```bash
bun run typecheck
```

Expected:

- CLI compiles.
- package script exists.

Failure handling:

- If CLI must print diagnostics, route them to stderr and keep stdout JSON-only.

### Task 9: Add CLI Tests

Files:

- add `api/modules/static-intelligence/intelligence-guardrail-material-cli.test.ts`

Fixture pattern:

- Copy temp SQLite + migration setup from `intelligence-agent-query-cli.test.ts`.
- Seed:
  - user
  - project with temp `repoPath`
  - completed scan run
  - at least one high severity finding with evidence/artifact for success case
  - scan review with handoff for verification recipe case
- Close setup connection before spawning CLI.
- Use `spawnSync(process.execPath, ["api/cli/intelligence-guardrail-material.ts", ...args], ...)`.

Required tests:

1. `returns guardrail material JSON with exit code 0`
   - status 0.
   - stderr empty.
   - stdout parses as JSON.
   - `ok: true`.
   - `status: "completed"`.
   - `version: "v1"`.
   - `sourceManifest.contentHash` is 64-char hex.
   - every material has `candidateOnly: true`.

2. `filters by type`
   - pass `--type verification_recipe_material`.
   - every material type equals requested type.
   - `filters.type` equals requested type.

3. `include markdown emits markdown in JSON only`
   - pass `--include-markdown true`.
   - stdout is still one JSON object.
   - parsed result has `markdown`.

4. `returns exit code 2 when scan run is missing`
   - status 2.
   - stderr empty.
   - stdout failure JSON.

5. `returns exit code 2 for invalid type`
   - status 2.
   - stderr empty.
   - message mentions invalid type or schema issue.

6. `does not leak repo path or raw markers`
   - stdout does not contain temp dir.
   - stdout does not contain seeded snippet/artifact raw markers.

7. `material ids are stable across repeated CLI runs`
   - run twice.
   - compare sorted material ids.
   - allow result `generatedAt` to differ.

Verification:

```bash
bun test ./api/modules/static-intelligence/intelligence-guardrail-material-cli.test.ts
```

Expected:

- CLI stdout is always parseable JSON.
- invalid user input exits 2.
- repeated run is stable.

Failure handling:

- If IDs drift, inspect material hash input for generated timestamps or unstable ordering.

### Task 10: Add Cross-phase Contract Checks

Files:

- update `spec/phase-36-static-intelligence-readonly-mcp-wrapper-plan.md` only if final Phase 35 output shape differs.
- update `spec/phase-37-static-intelligence-knowledge-source-e2e-fixture-plan.md` only if final CLI contract differs.

Implementation:

- Ensure Phase 36 can call service function rather than shelling out.
- Ensure Phase 37 can verify:
  - manifest content hash stability.
  - guardrail material id stability.
  - raw marker redaction.
  - source refs presence.

Verification:

```bash
rg -n "guardrail-material|GuardrailMaterial|sourceManifest|material ids|raw marker" spec/phase-3*.md
```

Expected:

- Later plans reference Phase 35 using the same command and field names.

Failure handling:

- If downstream docs disagree, update docs before implementing Phase 36/37.

### Task 11: Run Final Verification

Commands:

```bash
bun test ./api/modules/static-intelligence/guardrail-material.test.ts
bun test ./api/modules/static-intelligence/intelligence-guardrail-material-cli.test.ts
bun test ./api/modules/static-intelligence/*.test.ts
bun run typecheck
bun run verify
```

Expected:

- Guardrail material builder and CLI tests pass.
- Existing static-intelligence tests pass.
- Full repo verification passes.

Failure handling:

- If only unrelated pre-existing failures appear, capture exact failing command and error before deciding whether to scope verification.
- If static-intelligence tests fail, fix before proceeding to Phase 36.
- If formatting fails, run `bunx biome format --write` only for files touched by this phase, then rerun verify.

## Implementation Order

Recommended commit-sized order:

1. schema + builder skeleton + stable hash/id helpers.
2. security guardrail material.
3. verification recipe material.
4. actionability material.
5. scanner tuning and false-positive boundary.
6. markdown renderer.
7. CLI + package script.
8. CLI tests + final verification.

Do not start with contextStill registration, MCP, NightWorkers adapter, or scanner config mutation.

## Review Checklist

- [ ] Phase 34 manifest is the provenance anchor.
- [ ] No Phase 35 helper reimplements Phase 34 canonical JSON or manifest hashing.
- [ ] every material has `candidateOnly: true`.
- [ ] every material has at least one `source.sourceRefs` entry.
- [ ] every material has stable `metadata.materialHash`.
- [ ] material ids are stable across repeated runs.
- [ ] generatedAt is excluded from material hash inputs.
- [ ] verification commands are not marked as executed.
- [ ] verification commands remain scan-level unless explicit mapping exists.
- [ ] false-positive material is not fabricated from free-form text.
- [ ] scanner tuning material does not create allowlist/suppression instructions.
- [ ] output excludes project root path and absolute user home paths.
- [ ] output excludes raw snippets, raw artifact bodies, scanner stdout/stderr bodies, secret values, and token values.
- [ ] CLI stdout is exactly one JSON object on success and failure.
- [ ] invalid argument and missing scan run return exit code 2.
- [ ] runtime failure returns exit code 1.
- [ ] SQLite connection is closed in `finally`.
- [ ] no code path calls contextStill MCP.
- [ ] no code path creates NightWorkers tasks.

## Stop Conditions

- Phase 34 manifest / hash helpers are unavailable.
- Implementation tries to call `register_candidates`.
- Material is treated as active contextStill knowledge.
- Material generation uses LLM repository exploration instead of saved Static Intelligence.
- Material includes raw secret, raw artifact body, raw evidence snippet, raw source snippet, scanner stdout/stderr body, or `project.rootPath`.
- NightWorkers or contextStill DB direct access is introduced.
- Verification commands are attributed to findings/files without explicit evidence.
- False-positive lessons require parsing free-form prose as fact.
- Scanner tuning output auto-generates suppression/allowlist config.

## Completion Definition

This phase is complete when contextStill can pull guardrail material through CLI, inspect stable refs and hashes, and decide whether to distill it into contextStill knowledge without vulnWorkbench performing that mutation.

Concrete completion evidence:

- `bun run intelligence:guardrail-material -- --scan-run-id <scan-run-id>` returns:
  - `ok: true`
  - `status: "completed"`
  - `version: "v1"`
  - `sourceManifest.sourceId`
  - 64-char hex `sourceManifest.contentHash`
  - material list with stable ids and source refs
- `--type` filters materials deterministically.
- `--include-markdown true` keeps stdout JSON-only and adds a markdown field.
- repeated runs over unchanged scan keep material ids stable.
- invalid type and missing scan return parseable JSON with exit code 2.
- no contextStill mutation occurs.
- no NightWorkers task is created.
- `bun run verify` passes.
