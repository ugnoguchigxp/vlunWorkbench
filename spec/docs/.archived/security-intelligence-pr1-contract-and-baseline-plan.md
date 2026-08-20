# PR 1: Security Intelligence Assessment Contract and Baseline

## Status

- Implementation: complete in working tree; pending PR creation and merge
- Last reviewed: 2026-08-15

## 1. 目的

3 repositoryが独立に実装しても意味がずれない、最小の`Security Intelligence Assessment v1`契約を固定する。runtime behavior、database、既存integration APIは変更しない。

このPRの主要成果はTypeScript型ではなく、実行時schema、positive/negative fixture、決定的なcanonical hashである。

## 2. Scope

### 含む

- Assessment envelopeとclaim/verification/evidence/coverageのschema
- DependencyとAuthorizationの最小payload
- positive fixtureとrejectすべきnegative fixture
- fixture検証とcanonical hash出力
- consumer repositoryが同一契約を確認する方法
- baseline evidence artifactのformat

### 含まない

- scan runからassessmentを生成する処理
- API route、DB table、UI、MCP tool
- 既存`nightworkers-security-scan-integration` contractの変更
- default activation

## 3. Proposed files

| 種別 | Path | 内容 |
| --- | --- | --- |
| New | `shared/schemas/security-intelligence-assessment.schema.ts` | v1 schemaとexport type |
| New | `shared/schemas/security-intelligence-assessment-components.schema.ts` | reusable leaf schemaとprivacy/path制約 |
| New | `shared/schemas/security-intelligence-assessment.schema.test.ts` | contract invariantとnegative case |
| New | `shared/security-intelligence-assessment-contract.ts` | canonical JSONとsemantic assessment identity |
| New | `shared/fixtures/security-intelligence-assessment-v1.ts` | canonical positive fixtures |
| New | `shared/fixtures/security-intelligence-assessment-v1-negative.ts` | reject必須のnegative fixtures |
| New | `scripts/verify-security-intelligence-contract.ts` | fixture parse、canonicalize、hash出力 |
| New | `scripts/verify-security-intelligence-contract.test.ts` | baseline driftと既存v1保全のtest |
| Change | `package.json` | `verify:security-intelligence-contract` script |
| New | `spec/evidence/security-intelligence-stage-0-baseline.json` | contract version、fixture hash、検証結果 |
| Change | `spec/security-intelligence-initial-implementation-roadmap.md` | 実装後の実ファイル・commandへ同期 |

既存の`shared/schemas/assessment.schema.ts`はWeb assessment engagementとRules of Engagementを表すため、再利用・改名しない。

## 4. Contract shape

最小top-level shapeは次を想定する。実装時にはすべてZodでruntime validationする。

```ts
type SecurityIntelligenceAssessmentV1 = {
  contractVersion: "1";
  assessmentRef: string;
  producer: {
    system: "vulnWorkbench";
    version: string;
  };
  projectRef: string;
  source: {
    scanRunRef: string;
    completedAt: string;
  };
  target: {
    kind: "commit" | "diff" | "snapshot";
    sourceRevision: string;
    targetDigest: string;
    baseRevision?: string;
    headRevision?: string;
    baseTargetDigest?: string;
  };
  scope: {
    profileRef: string;
    declaredInvariantRefs: string[];
    threatModelRefs: string[];
  };
  outcome:
    | "findings_observed"
    | "no_findings_observed"
    | "inconclusive"
    | "unavailable";
  claims: SecurityIntelligenceClaim[];
  verifications: SecurityIntelligenceVerification[];
  evidenceRefs: SecurityIntelligenceEvidenceRef[];
  findingRefs: string[];
  coverage: {
    covered: string[];
    gaps: string[];
    limitationCodes: string[];
  };
  unknowns: string[];
  residualRisk: string[];
  generatedAt: string;
};
```

Schema invariantは少なくとも次を強制する。

- `targetDigest`、`sourceRevision`、`assessmentRef`は空文字を許可しない。
- 各evidence referenceは`scanRunRef`、`targetDigest`、artifact/result digestを持ち、assessmentの`source`と`target`に一致する。
- before/after比較のevidenceは`targetRole = assessment_target | base_target`で区別し、base側は`baseTargetDigest`へ一致させる。
- producer claimのoriginは`observed | inferred`だけを許可する。`declared`は参照として受け取ってもproducer claimとして生成しない。
- `verification.status = tested`には1件以上のevidence referenceを必須とする。
- required verificationが`failed | unavailable`ならtop-level outcomeを`no_findings_observed`にできない。
- evidence referenceはopaque IDとdigestを持ち、local absolute pathやsource本文を持たない。
- `no_findings_observed`は少なくとも1件の完了verificationと明示的coverageを必要とする。
- unknownやcoverage gapを空にしたことだけではcompleteを意味しない。
- payload内のpathはproject-relative POSIX pathだけを許可する。
- version 1 parserはunknown top-level fieldをrejectするかstripするかを一意に定め、fixture testで固定する。推奨はstrict rejectである。

## 5. Canonicalizationとhash

Cross-repository比較ではJavaScript objectの挿入順へ依存しないcanonical JSONを使う。

- object keyは辞書順へsortする。
- 意味上setである配列はschema生成側で安定sortする。
- human-readable messageのlocale差をhash対象へ入れない。
- fixture hashはSHA-256を使用し、`contractVersion + fixtureName + canonicalPayload`を対象にする。
- runtime assessmentのsemantic digestは再生成時刻で変化しないよう`generatedAt`と`assessmentRef`を除外したcanonical payloadから作る。`assessmentRef`はこのsemantic digestから決定的に導出する。
- verifierはmachine-readable JSONをstdoutへ出し、失敗理由はstderrへ出す。

例:

```json
{
  "contractVersion": "1",
  "fixtures": [
    { "name": "dependency-findings-observed", "sha256": "..." }
  ],
  "verified": true
}
```

## 6. Fixture matrix

### Positive

| Fixture | 検証対象 |
| --- | --- |
| `dependency-findings-observed` | Dependency change、OSV/Trivy evidence、finding refs |
| `dependency-no-findings-observed` | 検査完了と明示coverageがあるzero finding |
| `dependency-inconclusive` | required tool failureまたはartifact欠落 |
| `dependency-unavailable` | verification自体を実行できない状態と明示的なgap |
| `authorization-shadow-observed` | guarded/unguarded/unknownとsource refs |
| `authorization-coverage-lost` | beforeは解析済み、afterは解析不能 |

### Negative

| Fixture | Reject理由 |
| --- | --- |
| `tested-without-evidence` | testedの根拠がない |
| `no-findings-with-required-failure` | failureを成功へ畳み込んでいる |
| `missing-target-revision` | revision bindingがない |
| `mismatched-evidence-target` | evidenceのtarget digestがassessmentと異なる |
| `absolute-path-evidence` | private filesystem情報を含む |
| `declared-producer-claim` | producerがproject宣言を捏造している |
| `finding-not-linked-to-verification-evidence` | verificationのfindingが自身のevidenceに含まれない |
| `unsafe-outcome-label` | `safe`等、契約外の表現 |
| `unknown-field` | contract driftを検出する |
| `semantic-assessment-ref-mismatch` | payloadとsemantic identityが一致しない |

## 7. 実装順序

1. outcome、claim origin、verification status、evidence refのleaf schemaを作る。
2. top-level schemaとcross-field `superRefine`を作る。
3. negative fixture testを先に追加し、すべてrejectすることを確認する。
4. positive fixtureを追加し、canonicalization規則を固定する。
5. verifierとpackage scriptを追加する。
6. baseline JSONを生成し、同一commandの再実行で差分が出ないことを確認する。
7. NightWorkers/contextStillへfixtureとhashを渡す。consumer implementationはこのPRへ含めない。

## 8. Acceptance criteria

- すべてのpositive fixtureがparseできる。
- すべてのnegative fixtureが指定されたschemaまたは完全contract parserで期待したreason codeを返してrejectされる。
- verifierを2回実行して同じSHA-256になる。
- schemaから生成した型だけを使い、並行するhand-written interfaceを作らない。
- 既存`NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION`とfixture hashに差分がない。
- payloadにsource本文、secret、絶対pathが存在しない。
- typecheckとfocused testが通る。

## 9. Verification commands

```bash
bun test shared/schemas/security-intelligence-assessment.schema.test.ts
bun test shared/schemas/nightworkers-security-scan-integration.schema.test.ts
bun run verify:security-intelligence-contract
bun run verify:security-intelligence-contract
bun run typecheck
git diff --check
```

2回のverifier出力はbyte-for-byteで比較する。

## 10. Failureとrollback

- cross-field invariantが実装できなければfixture配布を止め、単なるTypeScript型で代替しない。
- canonical hashが非決定的ならsort規則を修正し、timestampをhash対象から除外する。
- rollbackは新規schema、fixture、script、package script、baseline artifactのrevertだけで完了する。runtime behaviorには影響しない。

## 11. Merge gate

NightWorkersとcontextStillの担当者がpositive fixtureをparseし、negative fixtureをrejectできる見込みを確認する。少なくともNightWorkers側consumer testの作業issueまたはPRが作成されるまで、PR 2の公開interfaceを確定しない。
