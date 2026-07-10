# Static Intelligence Layer Concept

## Purpose

この文書は、vulnWorkbench をセキュリティ診断ワークベンチから、外部コーディングエージェントが利用できる Static Intelligence Provider へ拡張するための概念境界を定義する。

中心に置くのは、Ontology ではなく、低レイヤーのソースコード解析、診断証跡、類似検索、リスク傾向の read model である。

```text
Code structure facts
  -> scanner / diagnostic evidence
  -> Diagnostic Evidence Graph
  -> Risk Community
  -> Security Landscape
  -> Static Intelligence Export
```

NightWorkers は Project Ontology、Task Compiler、Execution Controller を持つ。vulnWorkbench はその下位入力として、コード構造、診断結果、証跡、検証コマンド、リスク候補を提供する。

## Core Position

vulnWorkbench は、脆弱性修正を実行する自律エージェントではない。責務は、セキュリティツールと静的解析ツールの結果を集め、正規化し、外部エージェントが判断に使える構造化文脈として返すことである。

```text
vulnWorkbench
  scanner execution
  source structure extraction
  artifact / evidence storage
  finding normalization
  semantic risk candidate search
  diagnostic graph / landscape export

NightWorkers
  project ontology
  goal interpretation
  task graph generation
  queue admission
  implementation execution
  diff review
  verification orchestration

contextStill
  generalized knowledge
  reusable procedures
  cross-project lessons
  distillation / retrieval
```

この分離により、vulnWorkbench は「何が検出され、どの証跡に支えられ、どこに影響し、何で検証できるか」を返す。NightWorkers はその情報を、プロジェクト固有の意味地図と実行計画に接続する。

## Layer Model

### Code Structure Layer

Code Structure Layer は、対象リポジトリの軽量な構造事実を作る。

担当すること:

- file graph
- import / export graph
- exported symbol index
- route / handler / schema / worker / test / config tags
- dependency edges
- change surface estimation
- redacted deterministic snapshot
- Static Intelligence Export への optional enrichment

担当しないこと:

- 脆弱性の有無を断定すること
- Project Ontology を管理すること
- task graph を生成すること
- patch を適用すること
- source code body を export すること
- raw string literal や secret を agent-facing payload に含めること

現在の MVP は LSP を前提にせず、TypeScript Compiler API を syntax parser として使う。出力は `CodeStructureSnapshot` であり、`project.rootRef`、relative file path、import/export facts、package dependency、content hash、surface tags、degraded reasons を持つ。

CLI 主経路:

```bash
bun run intelligence:code-structure -- \
  --project-path <project-path> \
  --project-id <project-id> \
  --output code-structure.json
```

`project.rootPath` は既定で出力しない。`Static Intelligence Export` に snapshot を付与する場合、export builder は snapshot の `project.id` / `rootRef` が scan project と一致することを検証する。

### Diagnostic Evidence Layer

Diagnostic Evidence Layer は、scanner と dynamic verification が生成した証跡を保存し、finding として正規化する。

担当すること:

- Semgrep / Gitleaks / OSV / Trivy / DAST / reproduction results の保存
- raw artifact と normalized finding の接続
- evidence strength の表現
- verification command の保持
- scanner coverage の記録

担当しないこと:

- LLM の推測だけで finding を作ること
- finding を自動で修正済みにすること
- 人間または NightWorkers の判断を肩代わりすること

一次証拠は scanner artifact、source location、scan log、reproduction result である。LLM review は補助的な二次証跡として扱う。

### Semantic Search Layer

Semantic Search Layer は、embedding model と SQLite vector search を使い、証跡や finding の意味的な近傍を探す。

担当すること:

- similar findings の検索
- risk candidate の候補抽出
- review / remediation / false positive history の再利用
- natural language query による evidence bundle selection
- scanner 結果の優先度付け補助

担当しないこと:

- 類似度だけで脆弱性を確定すること
- severity を vector distance だけで決めること
- exact match が必要な識別子検索を置き換えること

セキュリティ用途では、semantic search は候補検出器であり、確定検出器ではない。

```text
semantic search
  -> risk candidates
  -> scanner / graph / review / reproduction
  -> confirmed finding
```

検索は hybrid を前提にする。

```text
Exact:
  file path, symbol, ruleId, CVE, package, scanner, scanRunId

Graph:
  finding -> evidence -> artifact -> file -> verification

Vector:
  semantic similarity, related remediation, similar review notes
```

## Diagnostic Evidence Graph

vulnWorkbench に持たせる graph は、contextStill の Knowledge Graph ではなく Diagnostic Evidence Graph である。

目的は、証跡、finding、artifact、file、scanner、dependency、verification の関係を問い合わせ可能にすること。

代表的な関係:

```text
finding -> evidenced_by -> evidence
finding -> located_in -> file
finding -> detected_by -> scanner / rule
finding -> affects -> dependency / endpoint / module
finding -> verified_by -> verification_result
finding -> reproduced_by -> reproduction_result
finding -> similar_to -> past_finding
file -> imports / depends_on -> file / package
```

Graph は source of truth ではない。source of truth は source code、scanner artifact、scan log、verification result である。Graph は routing map として、必要な証跡を引くための read model にする。

各 node / edge には、少なくとも次の性質を持たせる。

- source kind
- source id
- confidence
- evidence refs
- last verified at
- metadata

## Risk Community

Risk Community は、finding や risk candidate のまとまりを表す。

これは contextStill の community をそのまま移植するものではない。vulnWorkbench では、セキュリティレビューや修正優先度付けに使える risk cluster として扱う。

初期の community 軸:

- same file / module / dependency
- same scanner / rule / CWE / CVE
- same route / endpoint / config surface
- similar remediation
- similar false positive reason
- semantic similarity
- same verification command family

Risk Community が提供する価値:

- 重複 finding の統合候補を出す
- 同じ修正で解消できる finding を束ねる
- scanner が異なるが同じ根本原因を持つ可能性を示す
- auth、input validation、secret handling などのリスク偏りを見せる
- NightWorkers に task candidate のまとまりを渡す

Risk Community は、個別 finding の真偽を決めるものではない。真偽は evidence と verification によって確認する。

## Security Landscape

Security Landscape は、プロジェクト全体のセキュリティ状態を俯瞰する read model である。

これは contextStill の landscape をそのまま持ち込むものではなく、vulnWorkbench の scanner / evidence / coverage に限定した overview として扱う。

代表的な landscape:

- Risk Landscape
  - severity、confidence、domain、module、dependency ごとの risk 分布
- Coverage Landscape
  - scan 済み / 未scan / evidence weak / reproduction missing の分布
- Evidence Landscape
  - strong evidence、weak evidence、LLM-only review、artifact missing の分布
- Remediation Landscape
  - acceptance criteria、verification commands、open handoff の分布
- Trend Landscape
  - 同種 finding の増減、再発、false positive 率

Security Landscape は UI と agent query の両方に使う。目的は、個別 finding を読む前に、どこにリスクと不確実性が集中しているかを把握できるようにすること。

## LSP Position

LSP は Static Intelligence の主エンジンにはしない。

LSP が効く領域:

- definition / references の取得
- symbol relationship の補助
- type-aware navigation
- affected references の探索
- finding location から周辺 symbol をたどる enrichment

LSP が主担当に向かない領域:

- scanner の代替
- multi-language 全体解析の必須基盤
- 常駐 process 前提の primary automation path
- 壊れた workspace でも必ず動く scan contract

導入する場合は optional enrichment として扱う。

```text
scanner evidence
  + lightweight code facts
  + optional LSP enrichment
  -> Static Intelligence Export
```

LSP が失敗しても scanner execution、artifact storage、finding normalization は成立する必要がある。

## Embedding Position

Embedding と SQLite vector search は、Static Intelligence の価値を上げる有力な補助層である。

優先して embedding する対象:

- normalized finding
- evidence summary
- artifact summary
- scan review output
- remediation suggestion
- acceptance criteria
- verification result
- file risk summary

初期段階では、生ソースコード全体を雑に chunk して embedding しない。コードを扱う場合は、file summary、function summary、module summary など、構造化済みの要約を対象にする。

Embedding row は stale 判定できる必要がある。

```text
sourceKind
sourceId
contentHash
embeddingModel
embeddingDim
indexedAt
```

model 変更、chunking 変更、scan rerun、review 更新、artifact 更新があった場合は、再index 対象を判定できるようにする。

## Static Intelligence Export

vulnWorkbench は、外部エージェントに対して Static Intelligence Export を提供する。

Export は、単なる scanner output ではなく、修正タスクを作るための構造化診断文脈である。

含める情報:

- project summary
- latest scan summary
- risk band
- evidence quality
- report readiness
- normalized findings
- evidence refs
- artifact refs
- file risk index
- risk candidates
- risk communities
- security landscape summaries
- acceptance criteria
- verification commands
- non-goals
- optional code structure summary / file tags

NightWorkers はこの export を Project Ontology と Task Compiler に接続する。

```text
StaticIntelligenceExport
  -> NightWorkers Project Graph
  -> domain / capability / invariant connection
  -> task candidates
  -> queue / run / review
  -> rescan / verification
```

vulnWorkbench は task の採用、削除、統合、順序付け、queue admission を担当しない。

## Agent Tool Surface

Phase 40 以降の primary generation path は `intelligence:build` である。scan の registered project path から bounded structure extraction を行い、structure / export を一つの `generationId` で `scan_artifacts` に永続化する。UI / CLI / manifest / MCP の read path は latest valid generation または明示的に pin された generation を読み、GET / MCP から暗黙 refresh しない。

Project Intelligence の Ontology Handoff は module candidate、structure fact、risk/evidence ref、freshness を公開する read model である。canonical domain / capability / invariant / task を生成せず、それらの採用と task compilation は NightWorkers が所有する。

外部エージェント向けには、低レベルすぎる table access ではなく、意味単位の query を提供する。

候補:

```text
intelligence:agent-query project_overview
intelligence:agent-query risk_context
intelligence:agent-query related_findings
intelligence:agent-query evidence_bundle
intelligence:agent-query verification_commands
intelligence:export
intelligence:code-structure
intelligence:build
intelligence:knowledge-source
intelligence:guardrail-material
```

read-only MCP tools:

```text
vuln_list_knowledge_sources
vuln_get_knowledge_source_manifest
vuln_get_guardrail_material
vuln_get_evidence_bundle
vuln_get_verification_commands
vuln_get_code_structure_snapshot
```

Primary automation path は CLI と stable JSON output にする。MCP は optional discovery / interactive access / thin wrapper として扱う。

MCP は scanner execution、verification command execution、NightWorkers task creation、contextStill registration を行わない。

## Non-Goals

この concept では次を目標にしない。

- vulnWorkbench が Project Ontology を持つこと
- vulnWorkbench が Task Compiler を持つこと
- vulnWorkbench が patch を自動適用すること
- scanner output なしの LLM 仮説を confirmed finding にすること
- contextStill の Knowledge Graph / Community / Landscape を一括移植すること
- NightWorkers が vulnWorkbench SQLite schema を直接読むこと
- LSP を必須 runtime dependency にすること
- vector similarity だけで脆弱性の有無や severity を決めること
- raw secret や private token を embedding / LLM review に渡すこと
- external target scan をこの layer の前提にすること
- code structure snapshot を scanner evidence の代替として扱うこと
- MCP を write path や mutation path として扱うこと

## Implementation Direction

実装計画に落とす場合は、次の順序を基準にする。

```text
1. Diagnostic Evidence Graph export
2. File Risk Index
3. Evidence / finding / review embedding
4. Hybrid semantic query
5. Risk Community snapshot
6. Security Landscape summary
7. Static Intelligence Export
8. Read-only MCP wrapper
9. Code Structure Layer MVP
10. Optional LSP enrichment
11. NightWorkers import adapter
```

各段階は、前段の scanner evidence と artifact storage を壊さずに追加する。

## Verification Principles

この concept に基づく計画や実装は、次を満たす必要がある。

- Scanner / CLI output が evidence generation の主導線として残っている。
- Graph / vector / landscape が source of truth ではなく read model として扱われている。
- Semantic search の結果が candidate として扱われ、confirmed finding には別の evidence が必要である。
- Exact search、graph traversal、vector search の役割が分かれている。
- LSP が optional enrichment として扱われ、失敗しても scan result は残る。
- NightWorkers の Ontology / Task Compiler / Execution Controller と責務が衝突していない。
- contextStill に渡す情報は、project-specific fact ではなく、汎用化可能な candidate に限定されている。
- secret redaction と artifact provenance が保たれている。
- `bun run fixture:static-intelligence-source` が `ok: true` を返し、CLI / MCP source contract、redaction、hash stability、candidate-only 保証を確認できる。
- code structure snapshot が scan project と照合され、別 project の snapshot が export に混入しない。

## Avoid

後続の設計や実装では、次を避ける。

- Static Intelligence を「LLM が repo を自由探索する RAG」として実装する。
- Knowledge Graph という名前で contextStill の責務を vulnWorkbench に重複させる。
- Risk Community を finding の真偽判定に使う。
- Security Landscape を実行制御や queue 管理に拡張する。
- LSP を導入しただけで scanner 精度が上がったとみなす。
- Embedding 類似度を security evidence と同等に扱う。
- NightWorkers に渡す export へ raw artifact や secret を無制限に詰め込む。
- 実装順序を飛ばして、MCP や ontology から作り始める。
- code structure facts を vulnerability proof として扱う。
- MCP tool に arbitrary filesystem path や write operation を持ち込む。
