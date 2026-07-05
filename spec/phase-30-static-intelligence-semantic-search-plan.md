# Phase 30: Static Intelligence Semantic Search Plan

## Purpose

この計画は、Phase 29 の Static Intelligence Export を土台に、embedding model と SQLite vector search を使った semantic search を追加する。

目的は、脆弱性を確定する検出器を作ることではない。finding、evidence、review、remediation、file risk summary を意味検索できるようにし、risk candidate と related context を見つけやすくすることである。

## Product Boundary

担当すること:

- finding / evidence / review / file risk summary の embedding 化
- SQLite vector search による semantic query
- exact filter と vector search の hybrid retrieval
- risk candidate の候補出力
- source refs と provenance の保持

担当しないこと:

- vector similarity だけで confirmed finding を作ること
- severity や true positive を distance だけで決めること
- raw source code 全文の RAG 化
- raw scanner artifact 全文の embedding 化
- secret value の embedding 化

## Inputs

Phase 29 から使うもの:

- normalized findings
- evidence summaries
- scan review output
- improvement request
- File Risk Index
- Static Intelligence Export v1 refs

最初に embedding する対象:

- normalized finding summary
- evidence summary
- scan review output
- remediation suggestion
- acceptance criteria
- verification command summary
- file risk summary

最初に embedding しない対象:

- raw source code 全文
- raw logs
- raw artifact 全文
- secret value
- large binary artifacts

## Data Model Direction

embedding row は、stale 判定と再index を前提にする。

```text
id
source_kind
source_id
content_hash
embedding_model
embedding_dim
indexed_at
metadata_json
```

source kind の初期候補:

```text
finding
evidence
scan_review
improvement_request
file_risk_summary
```

## Query Direction

最初の query は、自然言語の goal や finding summary を入力として受ける。

例:

```bash
bun run intelligence:query -- \
  --project-id <project-id> \
  --query "auth 周りの入力検証と認可境界のリスク"
```

返すもの:

- matched source refs
- similarity score
- source kind
- short summary
- related finding ids
- evidence refs
- whether result is candidate-only

## Hybrid Retrieval

semantic search は exact search と組み合わせる。

Exact search:

- file path
- rule id
- scanner
- CVE / CWE
- package name
- scan run id
- finding id

Vector search:

- similar remediation
- related review notes
- similar false positive reason
- natural language query
- broad risk tendency

Graph context:

- finding -> evidence -> artifact -> file
- finding -> scanner / rule
- finding -> verification command

## Verification

最小確認:

- `sqlite-vec` が利用可能であることを確認できる。
- embedding row が生成され、content hash で stale 判定できる。
- representative query で期待する source refs が上位に出る。
- query result に evidence refs と source ids が含まれる。
- raw secret が embedding input と query output に混入しない。
- model 変更時に再index 対象を識別できる。

## Stop Conditions

この phase で止めるべき兆候:

- semantic similarity を confirmed finding の根拠として扱い始める。
- exact match が必要な identifier search を vector search で置き換え始める。
- raw source code 全文を無制限に embedding し始める。
- secret redaction が embedding 前に保証できない。
- vector index の stale 判定ができない。

## Completion Definition

この phase は、Phase 29 の export 対象に対して semantic query ができ、結果が source refs / evidence refs 付きの candidate として返せれば完了とする。

confirmed finding 化は、この phase の責務ではない。
