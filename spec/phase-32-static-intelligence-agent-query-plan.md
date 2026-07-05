# Phase 32: Static Intelligence Agent Query Plan

## Purpose

この計画は、Phase 29-31 で作った Static Intelligence の read model を、外部 agent が CLI または MCP wrapper から参照できる query surface として整える。

ここでは、特定の外部実行基盤に依存した import adapter は計画しない。vulnWorkbench 側が安定した JSON / Markdown / evidence bundle を返せることに集中する。

## Product Boundary

担当すること:

- Static Intelligence Export の CLI surface
- evidence bundle query
- related findings query
- file risk query
- verification command query
- optional MCP wrapper 向けの意味単位 tool design

担当しないこと:

- 外部実行基盤側の adapter 実装
- task graph generation
- queue admission
- patch application
- external agent の DB 直読み

## CLI Surface

候補:

```bash
bun run intelligence:export -- \
  --project-id <project-id> \
  --format json

bun run intelligence:query -- \
  --project-id <project-id> \
  --query "auth 周りの security risk"

bun run intelligence:related -- \
  --project-id <project-id> \
  --file api/routes/auth.ts

bun run intelligence:evidence -- \
  --project-id <project-id> \
  --finding-id <finding-id>

bun run intelligence:verification -- \
  --project-id <project-id> \
  --finding-id <finding-id>
```

stdout:

- JSON object 1 件のみ。
- Markdown が必要な場合も JSON field に入れるか、明示的な output file を使う。

stderr:

- progress
- warnings
- degraded output reason
- diagnostics

## MCP Wrapper Direction

MCP は primary scanner execution path ではなく、CLI / service function を呼ぶ thin wrapper として扱う。

候補 tool:

```text
vuln_project_overview
vuln_find_risk_context
vuln_find_related_findings
vuln_get_evidence_bundle
vuln_get_verification_commands
vuln_export_static_intelligence
```

MCP が持たない責務:

- scanner execution の primary path
- queue worker
- external agent の task lifecycle
- SQLite schema 直読み API

## Optional LSP Enrichment

この phase の後半で、必要なら LSP enrichment を検討する。

導入条件:

- LSP なしで CLI / MCP query が動く。
- LSP failure が degraded output で扱える。
- enrichment source が `source: "lsp"` として区別される。

使う可能性がある情報:

- definition
- references
- related symbols
- affected files
- test candidates

使わない情報:

- LSP diagnostics をそのまま confirmed finding にすること
- LSP を scanner の代替にすること
- LSP を必須 runtime dependency にすること

## Verification

最小確認:

- CLI stdout が JSON parse できる。
- diagnostics が stderr に出る。
- missing data が degraded output として返る。
- query result が source refs / evidence refs / verification commands を持つ。
- MCP wrapper を作る場合、CLI と同じ contract を返す。
- LSP disabled でも query が成立する。

## Stop Conditions

この phase で止めるべき兆候:

- CLI stdout に progress log が混ざる。
- MCP が scanner execution の primary path になり始める。
- 外部実行基盤側の lifecycle 設計が混入する。
- LSP が query の必須依存になり始める。
- provenance refs のない answer-only output が増える。

## Completion Definition

この phase は、外部 agent が DB を直接読まずに、CLI または MCP wrapper 経由で project overview、risk context、evidence bundle、verification commands を取得できる状態で完了とする。

外部実行基盤側の import / task compile / queue admission は、この phase の対象外とする。
