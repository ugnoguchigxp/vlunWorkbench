# Specification Index

このディレクトリの文書は、役割ごとに次の優先順位で扱う。

## Active execution plan

- `phase-56-capability-product-completion-plan.html`

Phase 56が、security capability、professional claim、product completion、
release closeoutに関する唯一のactive implementation planである。

## Product and integration concepts

以下は長期的な境界・設計・pilotを扱う。Phase 56の完了条件を自動的に増やさない。

- `vuln-workbench-concept.html`
- `static-intelligence-layer-concept.html`
- `contextstill-static-intelligence-bridge-concept.html`
- `project-scan-exploration-reduction-mcp-concept.html`
- `project-intelligence-ontology-evolution-roadmap.html`
- `security-intelligence-integration-concept.html`
- `security-intelligence-initial-implementation-roadmap.html`
- `security-intelligence-pr4-nightworkers-pilot-plan.html`
- `security-intelligence-pilot-decision-template.html`
- `static-intelligence-coding-agent-consumer-companion-plan.html`

## Decisions and operational contracts

- `project-intelligence-rollout-decision-2026-08-09.html`
- `nightworkers-cli-diagnostic-contract-instructions.html`

## Machine-readable policy and evidence

- `security-capability/`: current policy、scope、corpus、ground truth
- `evidence/`: immutable historical evidenceとtracked diagnostic baseline
- authoritative current release evidence: clean CIから生成するout-of-tree artifact

判断の優先順位は、authoritative current artifact、versioned policy、production
implementation/test、active plan、generated docs、historical docsの順とする。

## Archived plans

`spec/.archived/`は完了、置換、またはactive backlogを後続計画へ移管した歴史的計画を
保持する。archiveは「全ての構想を実装した」という意味ではない。未完了項目が後続計画へ
明示的に移管された文書も含む。

通常の実装判断ではarchiveを参照せず、履歴監査またはevidence provenance確認時だけ読む。
