# Phase 31: Risk Community and Security Landscape Plan

## Purpose

この計画は、Phase 29 の Evidence Graph と Phase 30 の Semantic Search を使い、Risk Community と Security Landscape を作る。

目的は、個別 finding を読む前に、どこにリスクが集中しているか、どの finding が同じ原因や同じ修正で扱えそうか、どの領域の evidence が弱いかを見えるようにすることである。

## Product Boundary

担当すること:

- finding / risk candidate の cluster 化
- duplicate / related finding の候補化
- risk concentration の summary
- evidence quality / coverage gap の summary
- remediation / verification gap の overview

担当しないこと:

- community 結果だけで finding を confirm / dismiss すること
- Project Ontology を作ること
- task graph を生成すること
- queue admission を行うこと
- automatic patch planning

## Risk Community

Risk Community は、finding や risk candidate のまとまりである。

初期 grouping axes:

- same file
- same scanner / rule
- same CWE / CVE
- same dependency
- same route / endpoint if available
- similar remediation
- similar false positive reason
- semantic similarity

初期 output:

```ts
type RiskCommunity = {
  id: string;
  title: string;
  basis: Array<"exact" | "graph" | "semantic">;
  confidence: "low" | "medium" | "high";
  findingIds: string[];
  evidenceRefs: string[];
  fileRefs: string[];
  summary: string;
  suggestedReviewFocus: string[];
};
```

## Security Landscape

Security Landscape は、project-level overview の read model である。

初期 landscape:

- Risk Landscape
  - severity / confidence / scanner / file ごとの risk 分布
- Coverage Landscape
  - scan 済み、未scan、coverage unknown、evidence missing
- Evidence Landscape
  - strong / mixed / weak / missing evidence
- Remediation Landscape
  - verification command の有無、acceptance criteria の有無、open handoff
- Trend Landscape
  - similar finding の増減、再発、false positive 傾向

## Inputs

Phase 29:

- File Risk Index
- Diagnostic Evidence Graph
- Static Intelligence Export v1

Phase 30:

- semantic matches
- risk candidates
- related finding refs

既存 scan data:

- scan run status
- finding status
- review status
- artifact availability
- verification / reproduction result

## Output Direction

最初は UI 前提にしない。JSON summary として返せればよい。

候補 CLI:

```bash
bun run intelligence:landscape -- --project-id <project-id> --format json
bun run intelligence:communities -- --project-id <project-id> --format json
```

出力には、必ず元 finding / evidence / file へ戻る refs を含める。

## Verification

最小確認:

- same file / same rule の finding が同じ community に入る。
- semantic similarity だけの cluster は low confidence candidate として扱われる。
- landscape の risk band が latest scan summary と矛盾しない。
- zero finding の場合でも coverage unknown と evidence gap を表現できる。
- community / landscape から元 finding / evidence に戻れる。

## Stop Conditions

この phase で止めるべき兆候:

- Risk Community が finding の真偽判定に使われ始める。
- Security Landscape が実行制御や queue 管理に拡張され始める。
- source refs のない aggregate が増え始める。
- zero finding を安全判定として表現し始める。
- semantic cluster が high confidence に昇格する条件が曖昧なまま進む。

## Completion Definition

この phase は、risk community と security landscape が JSON で出力でき、各 summary から元 finding / evidence / file に戻れる状態で完了とする。

UI 化や外部 orchestration 連携は、この phase の完了条件に含めない。
