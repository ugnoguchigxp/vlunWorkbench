# contextStill Static Intelligence Bridge Concept

## Purpose

この文書は、vulnWorkbench の Static Intelligence Layer を、contextStill の Episode / knowledge distillation と NightWorkers の計画生成へ接続するための概念境界を定義する。

中心に置く成果物は、raw finding でも NightWorkers task でもなく、`Static Intelligence Export` から作る agent-facing context と reusable guardrail candidate である。

```text
vulnWorkbench Static Intelligence Export
  -> evidence-backed security context
  -> NightWorkers planning / Review Mode input
  -> contextStill reusable guardrail candidates
  -> future compile / decision retrieval
```

この bridge は、vulnWorkbench が Project Ontology や Task Compiler を持つためのものではない。vulnWorkbench は低レイヤーの source structure、scanner evidence、diagnostic graph、risk landscape を返し、NightWorkers と contextStill がそれぞれの責務で利用できるようにする。

## Product Position

三者の責務は分ける。

```text
vulnWorkbench
  Code Structure Layer
  Diagnostic Evidence Layer
  Semantic Search Layer
  Diagnostic Evidence Graph
  Risk Community
  Security Landscape
  Static Intelligence Export

NightWorkers
  Project Ontology
  goal interpretation
  Task Compiler
  queue admission
  implementation execution
  Review Mode
  verification orchestration

contextStill
  generalized knowledge
  reusable procedures
  negative / positive guardrails
  cross-project lessons
  compile / decision retrieval
```

vulnWorkbench は「何が検出され、どの証跡に支えられ、どこに影響し、何で検証できるか」を構造化して返す。NightWorkers はそれをプロジェクト固有の意味地図と実行計画に接続する。contextStill は、その中からプロジェクトを越えて再利用できる rule / procedure / negative knowledge を蒸留する。

## Inputs

この bridge の primary input は `Static Intelligence Export` である。

最低限参照する情報:

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
- optional code structure summary / file tags / snapshot refs

補助 input:

- scan review の `improvementRequest`
- prior false-positive / remediation history
- rerun verification result
- agent handoff result
- contextStill 側で過去に active 化された guardrail knowledge

ただし、補助 input は source truth ではない。confirmed finding の根拠は scanner artifact、source location、scan log、reproduction result、verification result に置く。

## Outputs

この bridge は 2 種類の output を想定する。

### Agent Planning Context

NightWorkers や coding agent が実装計画を作るための context。

含めるもの:

- affected files / modules / endpoints
- code structure tags and import/package context when available
- risk community summary
- evidence strength
- scanner coverage / coverage gap
- verification command family
- acceptance criteria
- non-goals
- expected rescan / rerun conditions
- blocking or degraded reasons

含めないもの:

- raw secret
- raw artifact body
- scanner stdout / stderr 全文
- source code 全文
- vulnWorkbench SQLite schema detail
- task adoption / queue ordering decision

### Guardrail Knowledge Candidate

contextStill に登録できる再利用可能 candidate。

候補にしてよいもの:

- scanner evidence に裏付けられた safe-default rule
- false-positive の見分け方
- verification recipe
- remediation pattern
- scanner tuning lesson
- agent actionability lesson
- policy broadening を避ける negative knowledge

候補にしないもの:

- 特定 repo / absolute path / user home を主語にした事象
- evidence refs のない LLM 推測
- vector similarity だけに基づく severity 判断
- 一時的な network failure / timeout だけの事象
- raw token / secret / credential 断片
- NightWorkers の queue admission 判断

## Bridge Workflow

通常 flow:

```text
scan / review / static intelligence export completed
  -> optionally extract and verify code structure snapshot
  -> select security context needed by agent
  -> build Agent Planning Context
  -> NightWorkers connects it to Project Ontology / Task Compiler
  -> implementation or Review Mode produces outcome
  -> rerun / verification result is attached
  -> reusable lessons are distilled into Guardrail Knowledge Candidates
  -> contextStill register_candidates
```

candidate distillation flow:

```text
Static Intelligence Export
  -> remove project-specific identifiers from body
  -> retain applicability and provenance in metadata
  -> classify as rule / procedure
  -> classify polarity as positive / negative / neutral
  -> compute deterministic / semantic fingerprint
  -> dedupe locally
  -> register only new or materially updated candidate
```

feedback flow:

```text
contextStill active knowledge
  -> context_compile / context_decision retrieval
  -> NightWorkers planning guardrails
  -> vulnWorkbench verification command selection
  -> rerun result
  -> candidate confidence / frequency update
```

MCP access flow:

```text
vuln_list_knowledge_sources
  -> vuln_get_knowledge_source_manifest
  -> vuln_get_evidence_bundle / vuln_get_verification_commands / vuln_get_code_structure_snapshot
  -> consumer builds planning context or candidate material
```

MCP は read-only discovery / fetch surface であり、contextStill への登録、NightWorkers task 作成、scanner 実行、verification command 実行は行わない。

## Distillation Rules

### Generalize the body

Raw evidence:

```text
/Users/example/app/src/auth/session.ts で cookie secure=false が検出された。
```

Candidate body:

```text
Web アプリで session cookie を発行する場合、本番相当の設定では Secure, HttpOnly, SameSite を明示し、環境分岐がある場合も安全側のデフォルトにする。
```

保持する provenance:

```json
{
  "source": "vulnWorkbench.static_intelligence",
  "sourceExportId": "...",
  "scanRunId": "...",
  "findingIds": ["..."],
  "evidenceRefs": ["finding_evidence:..."],
  "artifactRefs": ["scan_artifact:..."],
  "ruleIds": ["..."],
  "examplePath": "src/auth/session.ts"
}
```

本文から除く:

- absolute path
- user home
- repo name
- branch name
- generated temp path
- secret value
- one-off command output

本文に残してよい:

- technology category
- vulnerability pattern
- scanner rule family
- safe default
- verification command pattern
- applicability constraints

### Preserve applicability

candidate は広げすぎない。

推奨 metadata:

```text
domains:
  web-auth
  dependency-security
  secret-handling
  input-validation
  api-security
  agent-workflow

technologies:
  TypeScript
  React
  Hono
  Node.js
  Docker
  DAST
  Semgrep
  Gitleaks
  OSV

changeTypes:
  implementation
  configuration
  dependency-update
  verification
  security-review
  static-analysis
  agent-handoff
```

### Keep evidence and knowledge separate

`Diagnostic Evidence Graph` は finding、evidence、artifact、file、scanner、dependency、verification の read model である。contextStill の Knowledge Graph ではない。

contextStill に渡すのは、graph そのものではなく、graph から裏取りできる reusable candidate だけにする。

## NightWorkers Connection

NightWorkers は `Static Intelligence Export` を次の位置で使う。

### Planning

Task Compiler に渡す前に、risk context を task candidate の制約として反映する。

反映するもの:

- impacted files / modules / endpoints
- acceptance criteria
- verification commands
- security non-goals
- scanner coverage gaps
- evidence quality
- related risk communities

反映しないもの:

- vulnWorkbench 内部 table id に依存した task design
- raw artifact content
- queue ordering の決定
- patch strategy の自動決定

### Queue Admission

Security action が必要な task では、次を admission guard として使う。

- evidence refs が存在する
- verification command が存在する、または missing reason がある
- non-goals が task objective に保持される
- degraded output がある場合、plan に residual risk として残る

### Review Mode

Review Mode では、完了済み execution を巻き戻さず、security review overlay として扱う。

表示 / 判定に使うもの:

- `review_required`
- `blocking_findings`
- `knowledge_candidate_pending`
- evidence bundle
- rerun result
- unresolved verification command

Review Mode は finding の真偽を vector similarity や LLM comment だけで確定しない。confirmed / false positive / accepted risk の判断には evidence と verification result を要求する。

## contextStill Connection

contextStill の主な役割は、Static Intelligence から抽出された繰り返し可能な教訓を、他の coding agent run でも使える形にすることである。

### Candidate Types

初期対象:

| Bridge candidate | contextStill type | polarity | Notes |
| --- | --- | --- | --- |
| `security_guardrail` | `rule` | `positive` or `negative` | safe default / avoid pattern |
| `verification_recipe` | `procedure` | `positive` | `Use when` / `Workflow` / `Verification` / `Avoid` を持つ |
| `false_positive_lesson` | `rule` | `negative` or `positive` | 誤検知扱いの条件を限定する |
| `agent_actionability_lesson` | `rule` | `positive` | agent が修正しやすい evidence / command 条件 |
| `scanner_tuning_lesson` | `procedure` | `positive` | allowlist / ignore の扱いを限定する |

### Registration Policy

contextStill へ登録する前に満たす条件:

- project-specific body ではない。
- raw secret を含まない。
- evidence refs がある。
- applicability がある。
- fingerprint で重複を抑制できる。
- downstream `register_candidates` の成功 / 失敗を追跡できる。

登録後の active / rejected / deprecated 判断は contextStill 側の責務とする。vulnWorkbench は active knowledge を直接作らない。

### Retrieval Policy

contextStill が返す knowledge は、次の場面で使う。

- NightWorkers の plan / task objective 生成前
- Review Mode の recommendation 生成前
- vulnWorkbench の handoff / improvement request 生成時
- coding agent が verification command を選ぶ時
- security finding の false-positive 判定を補助する時

ただし、contextStill knowledge は scanner evidence の代替ではない。security finding の確定には、vulnWorkbench 側の evidence bundle または rerun result を参照する。

## Agent Tool Surface

将来的な tool surface は、低レベル table access ではなく意味単位にする。

vulnWorkbench 側:

```text
intelligence:export
intelligence:agent-query project_overview
intelligence:agent-query risk_context
intelligence:agent-query related_findings
intelligence:agent-query evidence_bundle
intelligence:agent-query verification_commands
intelligence:code-structure
intelligence:knowledge-source
intelligence:guardrail-material
```

vulnWorkbench read-only MCP:

```text
vuln_list_knowledge_sources
vuln_get_knowledge_source_manifest
vuln_get_guardrail_material
vuln_get_evidence_bundle
vuln_get_verification_commands
vuln_get_code_structure_snapshot
```

contextStill 側:

```text
context_compile
context_decision
register_candidates
search_memory
fetch_memory
```

primary automation path は CLI と stable JSON output に置く。MCP は optional discovery / interactive access / thin wrapper として扱う。

## Future Phase Hooks

この concept から後続 phase に分ける場合の候補。

### Phase A: Export-to-Planning Context

目的:

- `Static Intelligence Export` から NightWorkers 向け Agent Planning Context を生成する。

到達条件:

- affected surface、risk summary、acceptance criteria、verification commands、non-goals が JSON と Markdown で取得できる。
- raw artifact と secret は含まれない。
- degraded output reason が残る。
- code structure snapshot は scan project と照合済みである。

### Phase B: Guardrail Candidate Distillation

目的:

- Static Intelligence Export から contextStill 向け reusable candidate を生成する。

到達条件:

- `security_guardrail`、`verification_recipe`、`false_positive_lesson`、`agent_actionability_lesson` を生成できる。
- deterministic fingerprint と semantic fingerprint で重複を抑制できる。
- `register_candidates` payload を作れる。

### Phase C: Registration Outbox

目的:

- contextStill への candidate registration を監査可能にする。

到達条件:

- pending / sent / failed / duplicate / skipped を保存できる。
- downstream mutation 成功前に完了扱いしない。
- retry は payload hash を保ったまま行う。

### Phase D: Retrieval Feedback Loop

目的:

- contextStill active knowledge を NightWorkers planning と vulnWorkbench handoff に戻す。

到達条件:

- plan / review / handoff の前に relevant guardrail を取得できる。
- retrieved knowledge が scanner evidence と混同されない。
- knowledge が使われた結果を compile / decision feedback として記録できる。

### Phase E: Review Mode Integration

目的:

- Security review overlay と knowledge candidate pending state をつなぐ。

到達条件:

- blocking findings、accepted risks、false-positive lessons、verification recipes を Review Mode に表示できる。
- downstream artifact 作成前に finding disposition を converted 扱いしない。
- rerun result が review status に反映される。

## Verification Principles

この bridge に基づく計画や実装は、次を満たす必要がある。

- Scanner / CLI output が evidence generation の主導線として残っている。
- Static Intelligence の graph / vector / landscape は source of truth ではなく read model として扱われている。
- Semantic search の結果は candidate であり、confirmed finding には別の evidence が必要である。
- NightWorkers は vulnWorkbench SQLite schema を直接読まない。
- contextStill に渡す情報は、project-specific fact ではなく汎用化可能な candidate に限定されている。
- raw secret と private token は embedding / LLM review / candidate body に入らない。
- LSP は optional enrichment であり、失敗しても scan result と export は残る。
- code structure facts は source code body ではなく redacted read model として扱われる。
- MCP tools は read-only であり、arbitrary filesystem path や write operation を受け付けない。
- downstream mutation が確認されるまで、candidate registration や finding conversion を完了扱いしない。
- verification commands、expected result、failure handling が計画本文に含まれている。

## Non-Goals

- vulnWorkbench に Project Ontology を持たせない。
- vulnWorkbench に Task Compiler を持たせない。
- vulnWorkbench に patch application を持たせない。
- contextStill の Knowledge Graph / Community / Landscape を vulnWorkbench に移植しない。
- NightWorkers が vulnWorkbench SQLite schema を直接読む adapter を作らない。
- scanner output なしの LLM 仮説を confirmed finding にしない。
- vector similarity だけで脆弱性の有無や severity を決めない。
- code structure facts だけで finding の真偽を決めない。
- raw artifact や secret を NightWorkers / contextStill に無制限に渡さない。
- MCP を primary scanner execution path にしない。
- MCP を contextStill registration や NightWorkers task creation の write path にしない。
- 実装順序を飛ばして ontology や queue admission から作り始めない。

## Completion Definition

この concept は、次を後続実装計画へ落とせる状態で完了とする。

- `Static Intelligence Export` を入力にした Agent Planning Context の境界が明確である。
- contextStill 向け Guardrail Knowledge Candidate の生成条件が明確である。
- NightWorkers が計画生成 / Review Mode で使う情報と使わない情報が分離されている。
- vulnWorkbench / NightWorkers / contextStill の責務が衝突していない。
- 後続 phase が export、candidate distillation、registration outbox、retrieval feedback、Review Mode integration に分割できる。
