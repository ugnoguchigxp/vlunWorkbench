# Project Intelligence and Ontology Evolution Roadmap

- Status: Directional roadmap
- Date: 2026-08-09
- Entry gate: Project Intelligence Foundation Hardening（完了）
- Scope: Persistent Project Structure Index -> Project Intelligence -> independent Ontology Core

## 1. Purpose

この文書は、Project Exploration MVPの先で、vulnWorkbenchとNightWorkersをどの順序で深化させるかを定義する。

最終目標は、単に大きなgraphを作ることではない。coding agent、人間、CI、security toolingが、同じprojectについて次を区別して参照できる状態を作ることである。

- sourceから観測された事実
- repository ownerが宣言した意味・責務・制約
- evidenceから導出された推論
- task/runで選択された一時的projection

この区別を保持できない段階では「Ontology製品」と呼ばない。

### Document precedence

- 本書は将来のproduct boundaryと分離条件を定義し、目下の実装順序はFoundation Hardening Planに従う。
- `static-intelligence-layer-concept.md`のうち「NightWorkersがProject Ontologyを所有する」という記述は、NightWorkersがtask/run projectionを所有し、canonical lifecycleは将来のOntology Coreが所有する境界へ更新する。
- current `.agent-ontology`は削除対象ではなく、Stage 3へ移行可能なrepository-owned declaration seedとして扱う。
- 各Stageのentry gateを満たさない場合、後続Stageへ進まない。

## 2. Long-Term Position

```text
vulnWorkbench
  = source/security/CI observations producer

Target repository
  = declared semantic source

Ontology Core
  = canonical identity, revision, validation, conflict, projection

NightWorkers
  = task/run-scoped consumer, execution controller, feedback producer

Codex / Claude Code / other agents
  = bounded query consumers
```

不変の責務境界:

| Layer | Owns | Must not own |
| --- | --- | --- |
| vulnWorkbench | observed structure/security facts、provenance、coverage | task、worker policy、canonical meaning |
| target repository | declared domain、owner、invariant、policy | observed scanner factの改ざん |
| Ontology Core | canonical IDs、claim revision、validation、conflict、projection | scanner execution、task execution |
| NightWorkers | task/run/worktree、activation、execution、verification、feedback | canonical ontology lifecycle、raw structure graph copy |

## 3. Product Naming by Stage

能力に対して過大な名称を使わない。

| Stage | Product name | What it can truthfully claim |
| --- | --- | --- |
| 0 | Project Exploration Catalog | bounded候補で探索を減らす |
| 1 | Persistent Project Structure Index | revision付きの構造factをqueryできる |
| 2 | Project Intelligence | 構造・security・CI・ownershipの観測を結合できる |
| 3 | Declarative Project Model | repo-owned semantic declarationsを検証・投影できる |
| 4 | Project Ontology Core | canonical claim、revision、conflict、approvalを管理できる |
| 5 | Project Intelligence Ecosystem | 複数producer / consumer / repositoryを扱える |

## 4. Stage 0: Foundation and Value Proof

Completed entry gate: Project Intelligence Foundation Hardening

Outcome:

- V2-backed catalog
- exact run revision guard
- dedicated consumer boundary
- typed readiness
- paired value evidence

Exit gate:

- Project Explorationが広い探索を測定可能に置き換える。
- completion / verificationが非劣化。
- wrong revision / wrong project incidentが0件。

Stop / rollback:

- 探索が減らずtokenが純増する場合、graph・LSP・embedding投資へ進まない。
- feature flagをOFFにし、rankingとactivationを再評価する。

## 5. Stage 1: Persistent Project Structure Index

### 5.1 Goal

revisionごとに構造解析を一度行い、複数agent / taskが小さなqueryで再利用できるtask-neutral indexにする。

### 5.2 Capabilities

- revision + extractor version keyed cache
- incremental inventory / analysis
- language capability readiness
- exact symbol lookup
- direct dependencies / importers
- module membership
- entrypoint lookup
- related test candidates
- bounded impact candidates
- explainable relation reason
- snapshot diff
- CI precompute

Candidate query surface:

```text
get_project_status
find_symbol
find_dependencies
find_importers
find_entrypoints
find_related_tests
get_impact_candidates
explain_relation
diff_structure_snapshots
```

すべてtask-neutral、read-only、bounded responseとする。

### 5.3 Client Strategy

- NightWorkersはruntime adapter経由で使う。
- Codex / Claude Codeは安全なread-only MCP queryを直接使える。
- direct clientへprepare権限を既定付与しない。
- clientごとに構造graphをコピーしない。

### 5.4 Entry Gate

- Stage 0がGO。
- catalog missの原因がactivationではなくfact/query不足と示される。
- same revisionで複数taskがindexを再利用している。

### 5.5 Exit Gate

- incremental updateがfull rebuildより安定して速い。
- supported languageごとのcoverageとdegraded reasonが測定される。
- query追加がexploration call削減に寄与する。
- API response budgetが維持される。

### 5.6 Do Not Add Yet

- canonical domain meaning
- LLMによる自動ontology確定
- human approval workflow
- cross-repository semantic inference
- graph database（既存storageで限界が測定されるまで）

## 6. Stage 2: Project Intelligence

### 6.1 Goal

構造factだけでなく、project運用上の観測をprovenance付きで結合する。

### 6.2 Observation Sources

- source structure
- security findings / evidence
- CI status
- test inventory / test results
- coverage
- CODEOWNERS / ownership files
- package / deployment manifests
- runtime entrypoints
- configuration surfaces
- historical change / verification outcomes

### 6.3 Observation Model

最低限、すべての観測は次を持つ。

```ts
type ObservedClaim = {
  claimId: string;
  subjectId: string;
  predicate: string;
  object: unknown;
  claimKind: "observed";
  source: {
    producer: string;
    artifactRef: string;
    sourceRevision: string;
    observedAt: string;
  };
  confidence: number;
  coverage?: unknown;
  validForRevision: string;
};
```

Examples:

- `api/modules/billing/routes.ts imports shared/payment/client.ts`
- `billing module has failing test X at CI run Y`
- `file Z is covered by CODEOWNERS entry A`
- `finding F is supported by scanner artifact E`

### 6.4 Boundary

Project Intelligenceは観測を結合するが、次をcanonical truthとして確定しない。

- 「このmoduleはBilling Domainである」
- 「このownerだけが変更を承認できる」
- 「このinvariantは必ず守るべき」

これらはdeclared claimとして別扱いにする。

### 6.5 Entry Gate

- Stage 1のindexが安定している。
- 構造factだけでは説明できない実際のconsumer use caseが複数ある。
- security / CI / ownershipを結合する価値が測定できる。

### 6.6 Exit Gate

- observation sourceごとのprovenanceとfreshnessを保持できる。
- contradictory observationsを消さずに併存できる。
- security candidateとconfirmed findingを区別できる。
- NightWorkersがtask-scoped projectionだけを取得できる。

## 7. Stage 3: Declarative Project Model

### 7.1 Goal

現在の`.agent-ontology`を、NightWorkers固有の内部機能から、repository-owned declaration contractとして一般化する。

### 7.2 Existing Assets to Reuse

- module ID / aliases
- responsibilities
- owned paths / read-mostly paths
- owned data
- invariants
- allowed / forbidden mutations
- allowed cross-module relations
- verification plans
- schema validation
- deterministic goal classification
- boundary audit

### 7.3 Required Evolution

manifest schemaを次のclaim種別へ分ける。

```text
declared
  repository ownerが明示した意味・責務・制約

observed
  vulnWorkbench / CI / scannerが検出した事実

inferred
  declared + observedから導出した候補

task_projection
  一つのtask/runのために選択した一時的context
```

Rules:

- observed relationをdeclared relationへ自動昇格しない。
- inferred claimにはrule / input claim refs / confidenceを付ける。
- task成功を理由にcanonical declarationを自動変更しない。
- repository manifestが不正な場合はlast-known-goodまたはunavailableへfail-safeする。

### 7.4 Ownership

この段階ではdataはtarget repositoryに残す。compiler / validatorは共有packageへ抽出してよいが、独立serviceはまだ必須ではない。

Recommended package boundary:

```text
project-ontology-contracts
  schemas
  canonicalization
  validation
  diff
  deterministic projection
```

NightWorkersはこのpackageのconsumerであり、manifest正本のownerではない。

### 7.5 Entry Gate

- 複数repositoryがdeclaration manifestを採用する。
- path ownership / invariant / verificationのruntime価値が測定される。
- current `.agent-ontology` のNightWorkers固有部分と一般部分を分離できる。

### 7.6 Exit Gate

- stable entity IDがrepository revisionをまたいで維持される。
- manifest diffとmigrationが可能。
- declared / observed / inferredがAPIとUIで区別される。
- conflict / ambiguityがsilent overwriteされない。
- NightWorkers以外のconsumerが同じcontractを利用する。

## 8. Stage 4: Independent Ontology Core

### 8.1 Extraction Decision

次のいずれかを本格導入する時点で、Ontology Coreを`vulnWorkbench`または`NightWorkers`内に置かず、独立project / serviceへ分離する。

Mandatory triggers:

- canonical declarationをrepository外でも編集・保存する。
- human approve / reject / review workflowを持つ。
- 複数producerのclaimを一つのcanonical revisionへ統合する。
- conflict resolutionまたはontology migrationを行う。
- 複数consumerへ独立release cycleで提供する。

Supporting triggers:

- cross-repository entity identityが必要。
- ontology専用UIが必要。
- access control / audit retentionがNightWorkers run lifecycleと異なる。
- graph query負荷がproducer / orchestratorのstorageを圧迫する。

単にdirectory名に`ontology`がある、graphを保存したい、将来使いそう、という理由だけでは分離しない。

### 8.2 Core Responsibilities

- canonical entity IDs
- typed relation / claim schema
- declared / observed / inferred claim separation
- ontology revision / immutable commit
- branch / draft / publish lifecycle
- diff / migration
- provenance / confidence / validity interval
- constraint validation
- conflict / ambiguity representation
- human review / approval
- task-neutral query
- consumer-specific bounded projection
- access control / audit

### 8.3 Non-Responsibilities

- repository scan execution
- security scanner orchestration
- task generation
- queue admission
- worker tool execution
- patch application
- test command execution
- automatic truth creation from LLM output

### 8.4 Minimum Domain Model

```ts
type OntologyEntity = {
  id: string;
  type: string;
  labels: Record<string, string>;
  lifecycle: "active" | "deprecated" | "replaced";
};

type OntologyClaim = {
  id: string;
  subjectId: string;
  predicate: string;
  object: unknown;
  kind: "declared" | "observed" | "inferred";
  provenance: ClaimProvenance[];
  confidence?: number;
  validFromRevision?: string;
  validToRevision?: string;
  status: "draft" | "accepted" | "rejected" | "superseded";
};

type OntologyRevision = {
  id: string;
  parentIds: string[];
  schemaVersion: string;
  createdAt: string;
  createdBy: string;
  digest: string;
};
```

### 8.5 API Direction

Producer APIs:

```text
publish_observation_batch
supersede_observation_batch
get_publish_status
```

Declaration APIs:

```text
validate_declaration
create_draft_revision
diff_revision
submit_revision
approve_revision
reject_revision
```

Consumer APIs:

```text
get_project_projection
get_task_projection
query_entities
query_claims
explain_claim
get_conflicts
```

NightWorkersは`get_task_projection`を使うが、canonical revisionをrun中に変更しない。

### 8.6 Sufficient Ontology Product Gate

次をすべて満たした時点で「Ontology製品」と呼べる。

1. canonical entity identityがある。
2. schemaとvalidationがversionedである。
3. declared / observed / inferredを区別する。
4. すべてのclaimにprovenanceがある。
5. ontology revisionとdiffがある。
6. conflict / ambiguityを表現できる。
7. human review / approvalがある。
8. constraint / invariant validationがある。
9. task-neutral queryとbounded projectionがある。
10. 複数producer / consumerを扱える。
11. access controlとauditがある。
12. unsupported claimをsilentにcanonical化しない。

## 9. Stage 5: Feedback and Ecosystem

### 9.1 NightWorkers Feedback

NightWorkersは次をexecution observationとして返す。

- catalog candidateが読まれたか
- 実際に変更されたfile
- boundary crossing
- verification commandと結果
- fallback / replan
- completion / failure
- human correction

Feedbackはrankingとprojection評価に使う。canonical declarationへの自動mutationには使わない。

### 9.2 Multiple Consumers

- NightWorkers
- Codex
- Claude Code
- CI policy checker
- security review tool
- architecture review UI

consumerごとにraw full graphを配布せず、purpose-bound projectionを返す。

### 9.3 Cross-Repository Intelligence

次の条件を満たすまで導入しない。

- repository-local IDsが安定している。
- package/service identityの明示mappingがある。
- access policyがrepository境界を扱える。
- stale relationの失効規則がある。

導入候補:

- service dependency
- shared schema / package usage
- ownership across repositories
- deployment topology
- coordinated change impact

## 10. Migration from Current Implementation

### 10.1 vulnWorkbench

```text
current Static Intelligence generation
  -> V2 Structure Index
  -> versioned observation batches
  -> Ontology Core producer adapter
```

維持するもの:

- scanners
- Project Structure analyzers
- artifact / evidence storage
- source revision / coverage
- bounded MCP query

移さないもの:

- scan execution
- raw artifacts
- finding review workflow

### 10.2 NightWorkers

```text
current .agent-ontology + runtime compiler
  -> repository declaration contract
  -> shared validator / projector
  -> Ontology Core client
```

維持するもの:

- task/run/worktree authority
- tool exposure
- execution boundary application
- verification orchestration
- run feedback

最終的に移すもの:

- generic ontology canonicalization
- canonical revision storage
- conflict / approval workflow

### 10.3 Existing Data

- `.agent-ontology`はrepository declaration sourceとしてimportできるようにする。
- Git historyをinitial revision provenanceとして使う。
- current V1 manifestを破壊的に一括migrationしない。
- schema versionごとのreaderを保持し、明示migration commandを用意する。
- inferred relationをdeclared relationとしてmigrationしない。

## 11. Stage Gates Summary

| From | To | Required evidence | If not met |
| --- | --- | --- | --- |
| Exploration Catalog | Structure Index | paired exploration value、multi-task reuse | catalog範囲に留める |
| Structure Index | Project Intelligence | 複数observation sourceのconsumer価値 | structure queryだけを継続 |
| Project Intelligence | Declarative Model | repo-owned semanticsのruntime価値 | declarationsをAGENTS/docsに維持 |
| Declarative Model | Ontology Core | canonical lifecycle / multi-consumer need | shared packageに留める |
| Ontology Core | Ecosystem | stable IDs、ACL、cross-repo demand | repository-local運用を維持 |

## 12. Risks and Controls

| Risk | Control |
| --- | --- |
| observedをcanonical truthへ昇格 | claim kindとapprovalを必須化 |
| NightWorkersの責務肥大化 | canonical lifecycleをCoreへ抽出 |
| vulnWorkbenchの責務肥大化 | observation producer境界を維持 |
| graph / payload肥大化 | bounded projection、cursor、purpose query |
| stale ontology | revision binding、validity、source freshness |
| LLM hallucinated relation | inferred claim、provenance、review |
| feedbackによる自己強化誤り | canonical auto-mutation禁止 |
| schema migration失敗 | immutable revision、versioned reader、rollback |
| vendor-specific consumer contract | JSON Schema中心、MCPはadapter |
| premature service split | mandatory extraction triggerまでpackage運用 |

## 13. Non-Goals

- source code全文をknowledge graphへ保存すること
- LLMにrepositoryの正本を自動生成させること
- Ontologyを理由にworkerへ無制限な探索・変更権限を与えること
- scanner findingを自動でconfirmed vulnerabilityにすること
- 一つの巨大promptへ全project contextを埋め込むこと
- すべてのqueryをsemantic searchへ置き換えること
- graph database導入自体をproduct milestoneにすること
- NightWorkersをcanonical knowledge platformにすること

## 14. Immediate Next Decision

当面はStage 0だけを実施する。

```text
V2 catalog correctness
  -> revision-safe consumer
  -> dedicated MCP boundary
  -> readiness transport
  -> controlled paired pilot
  -> GO / NO-GO
```

GOが確認されるまで、Stage 1以降の新機能、独立Ontology repository、graph database、semantic enrichmentへ着手しない。
