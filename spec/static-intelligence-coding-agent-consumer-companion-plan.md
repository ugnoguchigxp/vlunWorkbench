# Static Intelligence Coding Agent Consumer Companion Plan

## Purpose

この計画は、vulnWorkbench Phase 40 が提供する persisted Static Intelligence generation を、NightWorkers の coding-agent Ontology / Task Compiler / runtime / closeout へ安全に接続する consumer-side companion plan である。

```text
vulnWorkbench persisted generation
  -> source discovery
  -> generation selection and pinning
  -> code/security evidence adapter
  -> existing module Ontology mapping
  -> task compilation
  -> runtime context snapshot
  -> boundary / verification closeout
  -> rescan and feedback
```

この文書の想定 implementation repository は NightWorkers である。ただし NightWorkers の現在の作業ツリーを変更せず、vulnWorkbench 側に cross-repository consumer contract として保存する。

## Position

この計画は次を置き換えない。

- NightWorkers の `.agent-ontology` module manifests
- `classify_goal`
- `compile_module_context`
- `check_boundary`
- `get_verification_plan`
- Task Generation Ontology Evidence Bridge
- runtime ontology context snapshot
- boundary closeout audit
- Review Mode の vulnWorkbench security diagnostic

追加するのは、vulnWorkbench Static Intelligence を既存 evidence layers へ接続する adapter、generation pinning、task/run provenance、closeout feedback である。

## Core Decisions

- Static Intelligence source discovery と generation selection は supervisor / orchestration layer の責務とし、worker coding agent が ad hoc に決めない。
- generation selection は routing decision であり、provider capacity、queue admission、runtime lane selection と分離する。
- selected generationId は planning 時に固定し、同じ task/run の途中で latest generation へ自動追従しない。
- vulnWorkbench module candidates は `codeEvidence` に入れ、`moduleManifest` source truth にしない。
- canonical module ownership、invariants、forbidden mutations は NightWorkers manifest が優先する。
- scanner-backed findings と code structure candidates を別 evidence layer に保つ。
- code structure、semantic similarity、risk community だけから security task を confirmed finding として生成しない。
- candidate verification commands はそのまま実行せず、repository verification plan と command policy で選別する。
- Review Mode security diagnostic と Ontology context ingestion は activation policy を分ける。
- end-to-end adoption validation は coding-agent platform / NightWorkers の責務であり、vulnWorkbench browser E2E suite には含めない。

## Responsibility Matrix

| Area | vulnWorkbench | NightWorkers supervisor | Worker coding agent |
| --- | --- | --- | --- |
| scanner / structure generation | owns | requests bounded build when configured | does not reimplement |
| source discovery | exposes manifest/MCP | discovers configured source | uses pinned reference only |
| generation selection | exposes generations/readiness | selects and pins | does not switch latest |
| canonical Ontology | does not own | owns manifests and mapping | follows runtime snapshot |
| task compilation | supplies candidates/evidence | adopts, groups, constrains | executes one compiled task |
| boundary decision | supplies affected paths/risk refs | applies `check_boundary` | reports touched files/crossings |
| verification selection | supplies candidates | merges with canonical plan/policy | runs only authorized commands |
| security rescan | owns diagnostic CLI | schedules/invokes integration | reports need/result, does not fake evidence |
| feedback | creates new generation after rescan | stores run/closeout provenance | returns structured outcome |

## Existing NightWorkers Evidence Model

既存 `compile_module_context` は、次の evidence layers を分離する。

```text
moduleManifest
codeEvidence
taskGenerationEvidence
memoryEvidence
llmSynthesis
```

Static Intelligence は新しい source-truth layer を増やさず、次のように接続する。

```text
moduleManifest
  <- unchanged canonical ownership

codeEvidence
  <- repository-local extractor facts
  <- vulnWorkbench code structure/module candidates

securityEvidence
  <- scanner-backed findings/evidence/verification candidates
  <- new separated section inside context/run snapshot

taskGenerationEvidence
  <- goal/mission/task candidate hints

memoryEvidence
  <- reusable lessons, only when not contradictory
```

`securityEvidence` は agent-facing contract 上で分離する。既存 core evidence pack の内部実装上は `codeEvidence.staticIntelligence` として保持してもよいが、scanner evidence と code facts を同じ配列へ平坦化しない。

## Activation Policy

### Ontology planning lane

- current NightWorkers policy に従い、Ontology MCP が large/huge project または explicit project config で有効な場合に使う。
- Static Intelligence availability だけを理由に small project の Ontology を自動有効化しない。
- explicit task / project setting で source を要求した場合は current file-scale policy の override rules に従う。
- Ontology disabled の場合、runtime は current disabled snapshot + fallback guidance を維持する。

### Security review lane

- `securityReview=true` の Review Run は Ontology enabled/disabled と独立して vulnWorkbench scanner evidence を利用できる。
- security diagnostic 完了後に scanRunId が得られた場合、supervisor は必要に応じて `intelligence:build` を呼び、同じ scan の persisted generation を作る。
- Ontology off を理由に scanner-backed security evidence を捨てない。
- Static Intelligence candidate material だけを理由に confirmed vulnerability finding を作らない。

### General implementation lane

- recent usable source がなければ、manifest + repository-local code evidence で継続する。
- source missing は run failure ではなく warning / unavailable evidence とする。
- security-sensitive task で source が stale の場合、current risk assertion として使わず、refresh/rescanを planning blocker または explicit prerequisite にする。

## Source Discovery Contract

Add a consumer service conceptually equivalent to:

```ts
type StaticIntelligenceSourceDiscovery = {
  available: boolean;
  sourceId: string | null;
  projectId: string | null;
  scanRunId: string | null;
  latestGenerationId: string | null;
  readiness: "available" | "stale" | "degraded" | "missing" | "failed";
  generatedAt: string | null;
  sourceTreeHash: string | null;
  exportHash: string | null;
  warnings: string[];
};
```

Discovery rules:

1. repository mapping は configured integration / manifest project identity から解決する。
2. NightWorkers は vulnWorkbench SQLite を直接読まない。
3. arbitrary filesystem path を MCP source discovery に渡さない。
4. `vuln_list_knowledge_sources` または CLI manifest を primary discovery surface とする。
5. repository と source project の identity mismatch を unavailable とする。
6. source discovery は candidate set を返すだけで generation adoption を決めない。
7. unavailable source は structured warning にし、empty success にしない。

## Generation Selection and Pinning

```ts
type StaticIntelligenceConsumerRef = {
  sourceId: string;
  projectId: string;
  scanRunId: string;
  generationId: string;
  snapshotRef: string;
  exportHash: string;
  sourceTreeHash: string;
  sourceStateHash: string;
  selectedAt: string;
  selectionReason:
    | "latest_available"
    | "explicit_generation"
    | "review_scan_generation";
};
```

Selection rules:

- planning 時点で source discovery result から一つの generation を選ぶ。
- explicit generationId がある場合は exact read を使う。
- latest selection の場合も、選択直後に resolved generationId を保存する。
- incomplete generation pair、schema failure、project mismatch、scan mismatch は採用しない。
- `degraded` は warning 付きで採用可能。
- `stale` は historical evidence としてのみ参照可能。current likely files / current risk assertion には使わない。
- security-sensitive task は stale generation を current gate evidence に使わない。
- run 開始後に latest generation が変わっても pinned generation を維持する。
- new generation を使うには task context recompile または new run を作る。
- generation selection は queue capacity や provider availability を変更しない。

## Consumer Adapter Contract

```ts
type StaticIntelligenceConsumerEvidence = {
  ref: StaticIntelligenceConsumerRef;
  readiness: "available" | "degraded" | "stale";
  codeEvidence: {
    modules: StaticIntelligenceModuleCandidate[];
    likelyFiles: string[];
    structureWarnings: string[];
  };
  securityEvidence: {
    findings: Array<{
      findingId: string;
      severity: string;
      fileRefs: string[];
      evidenceRefs: string[];
      artifactRefs: string[];
      scannerRefs: string[];
      candidateOnly: boolean;
    }>;
    verificationCandidates: Array<{
      command: string;
      sourceRefs: string[];
      findingIds: string[];
    }>;
    degradedReasons: string[];
  };
};
```

Adapter rules:

- all file refs must be repository-relative.
- received absolute path makes the source invalid/degraded; consumer must not silently trim it differently from producer.
- module candidates remain code evidence with confidence/reasons.
- scanner finding must keep finding/evidence/artifact/scanner provenance.
- candidate-only semantic/community results stay candidate-only.
- raw artifact bodies and source contents are not loaded into the runtime snapshot.
- large arrays are filtered after task scope is known.
- generationId / snapshotRef / exportHash are retained through every projection.

## Ontology Mapping Contract

Map module candidates to existing manifest ownership without mutating the manifest.

```ts
type StaticIntelligenceOntologyMapping = {
  candidateId: string;
  pathPrefix: string;
  outcome:
    | "matched"
    | "ambiguous"
    | "emerging"
    | "conflict"
    | "unmapped";
  matchedModules: string[];
  primaryModule: string | null;
  confidence: number;
  reasons: string[];
  warnings: string[];
};
```

Mapping priority:

1. `moduleManifest.ownedPaths`
2. `readMostlyPaths`
3. explicit `allowedCrossModule`
4. current `classify_goal` routing
5. Static Intelligence module candidate pathPrefix / edges / tags

Rules:

- manifest-owned path match is authoritative.
- Static Intelligence cannot create or rename a canonical module automatically.
- multiple manifest matches become `ambiguous` and require task-scoped warning.
- candidate outside all manifests becomes `emerging` or `unmapped`, not confirmed ownership.
- candidate contradicting manifest ownership becomes `conflict`; manifest wins and warning remains visible.
- `canonicalDomainSummary` does not include task-specific risk emphasis.
- `taskScopedSummary` may include selected risk/evidence relevant to the current goal.
- LLM synthesis cannot turn `emerging`/`ambiguous` into canonical ownership.

## Task Compilation Responsibilities

The coding-agent platform owns adoption, grouping, ordering, and task boundaries.

### Inputs allowed

- pinned consumer ref
- matched module routing
- scanner-backed findings/evidence
- risk communities as grouping candidates
- verification candidates
- handoff acceptance criteria / non-goals
- current Goal / Mission / TaskCandidate evidence

### Outputs

```ts
type StaticIntelligenceTaskProvenance = {
  sourceId: string;
  scanRunId: string;
  generationId: string;
  exportHash: string;
  findingIds: string[];
  evidenceRefs: string[];
  moduleCandidateIds: string[];
  mappingOutcomes: string[];
};
```

Task rules:

- one finding does not automatically become one task.
- group only when shared root cause / affected module / verification family is evidenced.
- security-fix task requires scanner-backed finding/evidence or explicit human decision.
- code structure facts may influence scope and likely files, but cannot establish vulnerability.
- task objective and acceptance criteria preserve finding/evidence provenance.
- verification candidates are not silently promoted to mandatory commands.
- project-wide constraints remain constraints; they do not become standalone module ownership.
- duplicate generation/exportHash must not create duplicate task candidates.
- stale generation cannot create a new current-security task without refresh/rescan prerequisite.
- task compilation does not decide provider capacity or queue admission.

## Runtime Context Snapshot

Extend the current ontology runtime snapshot with a concise separated section.

```ts
type StaticIntelligenceRuntimeSnapshot = {
  available: boolean;
  readiness: "available" | "degraded" | "stale" | "unavailable";
  sourceId: string | null;
  projectId: string | null;
  scanRunId: string | null;
  generationId: string | null;
  snapshotRef: string | null;
  exportHash: string | null;
  selectedModuleCandidateIds: string[];
  selectedFindingIds: string[];
  selectedEvidenceRefs: string[];
  mappingWarnings: string[];
  securityWarnings: string[];
  verificationCandidates: string[];
};
```

Integration shape:

```ts
type OntologyRuntimeContextSnapshotV2 = OntologyRuntimeContextSnapshot & {
  staticIntelligence: StaticIntelligenceRuntimeSnapshot;
};
```

Runtime rules:

- build snapshot before Codex/native runtime starts.
- Codex lane and native API lane receive the same pinned ref and concise evidence.
- prompt gets primary/secondary modules, selected risk scope, warnings, verification candidates, hashes; not full graph/snapshot.
- worker may use read-only MCP on demand only with pinned scanRunId + generationId.
- worker does not call refresh/build from inside the run.
- source unavailable does not fail the run; snapshot records unavailable + warning.
- source stale does not disappear; it remains visible as historical/untrusted-currentness evidence.
- prompt budget limits selected files/findings/refs and links back to read-only tools.

## Worker Coding Agent Responsibilities

The worker coding agent must:

- treat the runtime ontology snapshot as the boundary contract.
- treat Static Intelligence module candidates as evidence, not ownership truth.
- keep work within primary/secondary module paths or report crossing reason.
- inspect pinned evidence refs when a security task depends on them.
- avoid broad repository exploration when scoped structure/evidence is sufficient.
- not expand scope merely because related risk exists outside the task.
- run only verification commands authorized by task/runtime command policy.
- report verification performed and skipped reasons.
- return touched files and boundary crossing reasons for closeout audit.
- distinguish remediated, deferred, not-applicable, and unverified findings.

The worker coding agent must not:

- select another latest generation mid-run.
- call scanner/build/refresh through an unapproved path.
- treat semantic similarity as vulnerability proof.
- rewrite canonical module manifests automatically.
- suppress stale/degraded warnings.
- claim a security issue fixed without verification/rescan evidence.

## Boundary Enforcement

Existing `check_boundary` remains authoritative.

Static Intelligence affects boundary work only by:

- suggesting likely affected files/modules.
- exposing evidence-backed cross-module relationships.
- identifying risky files that may need declared secondary routing.
- adding warning context for read-mostly/unknown paths.

It does not:

- grant permission to edit a path.
- override forbidden mutations.
- convert a risk community into allowed cross-module scope.

Closeout must compare touched files against the pinned ontology snapshot and keep generation provenance alongside the boundary decision.

## Verification Selection

Verification selection order:

1. module manifest focused verification
2. repository-native verify/test contracts
3. task acceptance criteria
4. vulnWorkbench verification candidates
5. configured security rescan/oracle integration

Rules:

- candidate command must be parsed as structured tokens where possible.
- reject destructive, external-network, secret-bearing, or out-of-repository commands unless explicitly authorized by policy.
- dedupe equivalent commands.
- repository-native canonical verification is not removed because a vulnWorkbench command exists.
- security rescan is scheduled through supervisor integration, not invented in worker shell steps.
- skipped verification needs an explicit reason.
- scan result and repo test result remain separate evidence.

## Security Review Integration

Current Review Mode diagnostic remains scanner execution entrypoint.

Target flow:

```text
Review target
  -> oracle-security / configured vulnWorkbench diagnostic
  -> scanRunId
  -> intelligence:build for that scan when Static Intelligence context is needed
  -> pin generation
  -> map scanner-backed findings into Review findings
  -> implementation task / review decision
  -> repository verification
  -> configured vulnWorkbench rerun
  -> new scanRunId / generation
```

Rules:

- old and new scan/generation remain distinct.
- before/after comparison uses finding/rule/path fingerprints and provenance, not mutable replacement.
- Review Mode does not rerun vulnWorkbench inside the target repository worker context.
- scanner-backed result remains primary security evidence.
- Static Intelligence structure/communities improve routing and grouping only.

## Closeout and Feedback Contract

```ts
type StaticIntelligenceCloseoutEvidence = {
  pinned: StaticIntelligenceConsumerRef | null;
  usedFindingIds: string[];
  usedEvidenceRefs: string[];
  addressedFindingIds: string[];
  deferredFindingIds: string[];
  notApplicableFindingIds: string[];
  boundaryDecision: string | null;
  verification: Array<{
    command: string;
    source: "manifest" | "repo" | "static_intelligence" | "security_rescan";
    status: "passed" | "failed" | "skipped";
    reason?: string;
  }>;
  rescan: {
    requested: boolean;
    completed: boolean;
    scanRunId: string | null;
    generationId: string | null;
    status: "improved" | "unchanged" | "regressed" | "unavailable" | null;
  };
  warnings: string[];
};
```

Feedback rules:

- persist closeout evidence in run context/events, not in prompt prose only.
- never mutate the pinned generation.
- rescan creates a new scan/generation reference.
- boundary audit and security evidence outcomes remain separately inspectable.
- proposed ontology manifest change becomes reviewable candidate; no automatic manifest write.
- reusable remediation/false-positive lessons may be distilled for contextStill only through its candidate lifecycle.

## Debug and Observability

Extend the existing read-only ontology debug report with a summary only.

```ts
type StaticIntelligenceDebugSummary = {
  available: boolean;
  readiness: string;
  sourceId: string | null;
  scanRunId: string | null;
  generationId: string | null;
  snapshotRef: string | null;
  exportHash: string | null;
  mappingOutcomeCounts: Record<string, number>;
  selectedFindingCount: number;
  verificationCandidateCount: number;
  closeoutRescanStatus: string | null;
};
```

Debug report must not expose:

- raw source bodies
- raw artifact bodies
- full prompts/transcripts
- private absolute paths
- provider credentials
- full structure payload

Useful events:

```text
static_intelligence.source_discovered
static_intelligence.generation_pinned
static_intelligence.ontology_mapped
static_intelligence.runtime_snapshot
static_intelligence.closeout_feedback
```

## Failure and Degradation Policy

| Condition | Consumer behavior |
| --- | --- |
| source unavailable | continue with manifest/local evidence; warning |
| generation missing | do not guess; optional refresh prerequisite |
| generation incomplete/corrupt | reject generation; use previous valid if explicitly selected |
| project/scan mismatch | reject source |
| stale generation, general task | historical hints only; warning |
| stale generation, security-sensitive task | require refresh/rescan before current-risk claim |
| degraded code structure | use parsed subset; expose reasons |
| manifest mapping conflict | manifest wins; warning |
| ambiguous module mapping | task-scoped secondary/emerging warning; no ownership mutation |
| verification candidate unsafe | skip/reject with reason |
| rescan unavailable | do not claim security closure |

## Implementation Units

### CA.1: Consumer Contracts and Configuration

Target files in NightWorkers:

- add schemas/types under `api/services/static-intelligence/`
- update project/repository integration settings
- add focused contract tests

Tasks:

- define source discovery, consumer ref, evidence, mapping, runtime, closeout schemas.
- configure enablement and source endpoint/CLI without hard-coded user paths.
- keep Ontology and security-review activation separate.
- validate all inbound payloads.

Acceptance:

- config can represent disabled/unavailable without startup failure.
- no vulnWorkbench DB/schema dependency is imported.
- provider capacity/routing config is unchanged.

### CA.2: Source Discovery and Generation Selection

Target files:

- add `static-intelligence-source.service.ts`
- add `static-intelligence-generation-selector.ts`
- tests for discovery/selection

Tasks:

- call list/manifest surface.
- match source to current repository identity.
- select latest or explicit generation.
- persist exact consumer ref in planning/task metadata.
- implement stale/degraded/missing policy.

Acceptance:

- no source discovery result silently becomes adopted generation.
- selected generation never mixes artifacts.
- generation selection does not affect queue/capacity.

### CA.3: Evidence Adapter and Ontology Mapping

Target files:

- add `static-intelligence-evidence-adapter.ts`
- add `static-intelligence-ontology-mapper.ts`
- update `api/services/agent-ontology/agent-ontology.service.ts` minimally
- update agent ontology tests

Tasks:

- adapt module/risk/evidence/verification data into separated layers.
- map module candidates against existing manifests.
- keep contradictions/warnings.
- add optional Static Intelligence evidence input to `compile_module_context`.

Acceptance:

- manifest ownership is never overwritten.
- canonical summary excludes task-specific security emphasis.
- task-scoped summary preserves generation provenance.

### CA.4: Task Compilation Integration

Target files:

- task generation evidence adapter/service
- Goal/Mission/TaskCandidate metadata schemas
- task generation focused tests

Tasks:

- include pinned consumer ref in task metadata.
- group/dedupe scanner-backed findings into reviewable tasks.
- add acceptance/verification/non-goal candidates with provenance.
- prevent code-fact-only security tasks.
- keep routing and queue admission separate.

Acceptance:

- repeated source hash does not duplicate tasks.
- every adopted security task has scanner/evidence refs.
- stale generation cannot produce current-security task without prerequisite.

### CA.5: Runtime Snapshot and Prompt Projection

Target files:

- `api/services/agent-runtime/ontology-runtime-context.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
- Codex/native prompt projection files
- runtime focused tests

Tasks:

- extend ontology runtime snapshot with concise Static Intelligence section.
- resolve/pin before runtime starts.
- project same fields into Codex and native lanes.
- support exact generation MCP reads.
- preserve unavailable fallback.

Acceptance:

- both lanes see same generationId/hash/warnings.
- prompt does not contain full snapshot/graph.
- worker cannot silently switch generation.

### CA.6: Boundary, Verification, and Closeout

Target files:

- `api/modules/nightworkers/run-orchestration/runtime-execution.ts`
- boundary/verification selection services
- closeout/event schemas and tests

Tasks:

- include pinned provenance in boundary audit.
- validate/dedupe verification candidates.
- persist structured closeout evidence.
- connect configured security rescan result without mutating old generation.
- keep skipped reasons visible.

Acceptance:

- cross-module risk does not grant edit permission.
- security closure requires test/rescan evidence or explicit unavailable state.
- closeout compares before/after generations without overwriting history.

### CA.7: Read-only Debug Surface

Target files:

- `api/modules/nightworkers/nightworkers.run-query.service.ts`
- run schema / route response
- debug report tests

Tasks:

- add Static Intelligence debug summary.
- prefer non-empty run context snapshot, then fallback events.
- expose mapping/warning/verification/rescan summary only.

Acceptance:

- support can explain which source/generation was used or skipped.
- no raw payload/prompt/path leak.

### CA.8: Coding-Agent End-to-End Adoption Validation

This unit belongs to the coding-agent platform, not vulnWorkbench product/browser E2E.

Validate run-level scenarios:

1. available generation -> mapped module -> task-scoped context -> run -> boundary audit.
2. degraded structure -> usable subset + visible warning.
3. stale security generation -> refresh/rescan prerequisite.
4. manifest conflict -> manifest wins + warning.
5. cross-module finding -> declared secondary or unexplained crossing.
6. no Static Intelligence source -> normal manifest/local-evidence fallback.
7. Review security scan -> build generation -> fix -> repo verify -> rescan -> new generation.
8. Codex lane and native API lane pin the same consumer ref.

Evidence to record:

- source discovery outcome
- selected generationId/exportHash
- mapping outcomes
- task provenance
- runtime snapshot
- touched files/boundary decision
- verification results
- before/after scan/generation refs

This is rollout/pilot validation and can use NightWorkers runtime fixtures, run events, and ontology debug report. It is not a requirement to add Playwright/browser tests to vulnWorkbench.

## Consumer Verification Strategy

Focused tests should cover:

```text
source contract parsing
generation exact selection
manifest mapping precedence
candidate-only security semantics
task provenance/dedup
runtime lane parity
boundary/verification closeout
debug report fallback
```

Potential NightWorkers verification commands, adjusted to actual test locations at implementation time:

```bash
bunx vitest run tests/agent-ontology.test.ts
bunx vitest run tests/nightworkers-codex-mcp-integration.test.ts
bunx vitest run tests/services.codex-agent-runtime.test.ts
bunx vitest run tests/services.native-api-runner.test.ts
bunx vitest run tests/review-vulnworkbench.test.ts
bun run verify
```

The consumer implementation must use the NightWorkers repository-native verification gate as the final authority.

## Cross-Repository Completion Boundary

vulnWorkbench Phase 40 can complete when producer contracts, persisted generations, read surfaces, UI, and producer verification pass.

Coding-agent adoption can complete only when:

- source discovery and generation pinning are implemented.
- Static Intelligence is mapped into separated evidence layers.
- existing manifests remain canonical.
- task/run metadata preserves generation provenance.
- Codex/native lanes consume the same pinned snapshot.
- boundary and verification closeout include source provenance.
- Review security flow can create and compare before/after generations.
- coding-agent run-level adoption scenarios are validated.

Neither repository should claim end-to-end adoption complete based only on its local unit tests.

## Non-Goals

- copying vulnWorkbench scanner/graph/index implementation into NightWorkers
- NightWorkers direct reads of vulnWorkbench SQLite/artifact paths
- auto-generating canonical manifests from module candidates
- provider capacity or queue policy changes
- enabling Ontology for every small project
- letting worker agents refresh sources mid-run
- treating risk communities/semantic candidates as findings
- replacing Review Mode security diagnostic with Ontology context
- adding vulnWorkbench browser E2E tests
- storing raw source/artifact bodies in run context

## Review Checklist

- [ ] discovery and generation selection are separate.
- [ ] selection and capacity/queue routing are separate.
- [ ] generationId is pinned before runtime.
- [ ] exact generation reads are used during run.
- [ ] module candidates stay in code evidence.
- [ ] scanner evidence stays separate from code facts.
- [ ] manifest ownership wins conflicts.
- [ ] task compiler owns adoption/grouping/dedup.
- [ ] security task has scanner/evidence provenance.
- [ ] runtime snapshot is concise and lane-consistent.
- [ ] boundary checks remain authoritative.
- [ ] verification candidates are policy-validated.
- [ ] rescan creates a new generation.
- [ ] debug report is read-only and summary-shaped.
- [ ] Ontology-off does not disable Review security evidence.
- [ ] coding-agent end-to-end validation stays outside vulnWorkbench browser E2E.

## Stop Conditions

- consumer reads vulnWorkbench DB directly.
- worker selects or refreshes latest generation mid-run.
- Static Intelligence module candidate overrides canonical ownership.
- code structure fact becomes confirmed security finding.
- source mismatch is accepted to keep the run moving.
- stale generation is treated as current security truth.
- candidate command bypasses command policy.
- rescan overwrites pinned before-state provenance.
- Ontology enablement is broadened solely because Static Intelligence exists.
- implementation requires overwriting unrelated dirty-tree work in NightWorkers.

## Completion Definition

This companion plan is complete when the coding-agent platform can discover and pin a vulnWorkbench generation, map it into existing Ontology evidence without changing canonical ownership, compile provenance-backed tasks, expose the same context to both runtime lanes, audit boundaries, select safe verification, compare post-change rescan evidence, and report the full chain through a read-only debug surface.
