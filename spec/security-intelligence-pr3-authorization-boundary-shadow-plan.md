# PR 3: Authorization Boundary Shadow Observer

Status: Implemented; PR 3 targeted verification passed

## 1. 目的

route/entrypointとAuthorization guardの変化をrevision-boundに比較し、Security Intelligence Assessmentへshadow observationとして追加する。

このPRはvulnerability verdict、finding生成、task blocking、merge gateを行わない。解析精度とcoverage lossを計測するための観測器である。

## 2. Shadowから始める理由

既存`ApplicationModel`にはentrypoint、`authorizationGuards`、evidence reference、snapshot hashがある。一方で、現在のsnapshot rowだけでは比較対象revisionとのbindingが十分ではなく、guard抽出には広いidentifier heuristicが含まれる。

その状態で「guard removed」をFindingへ直結すると、次を誤検知する。

- route自体が削除された
- frameworkやmiddlewareの書き方が変わった
- analyzerがafter revisionをparseできなかった
- guard名に似た無関係identifierが存在した
- route rename/moveでstable identityが失われた

したがって、まずexplicit target identityと解析状態を持つprojectionを作り、unknownとcoverage lossを第一級状態として扱う。

## 3. 初期support範囲

- Language: TypeScript / JavaScript
- Framework: 既存extractorが明示的に認識できるHono、Express、Fastifyの範囲
- Boundary: HTTP route/handlerと、そのrouteへ適用される明示middleware/guard
- Comparison: explicit before/after immutable snapshot

support外のlanguage/framework、動的route構築、runtime policy engineは`unknown`またはcoverage gapとする。文字列やLLMによる推測で補完しない。

## 4. Proposed files

| 種別 | Path | 内容 |
| --- | --- | --- |
| New | `shared/schemas/security-intelligence-authorization.schema.ts` | revision-bound boundary snapshot/diff schema |
| New | `shared/schemas/security-intelligence-authorization.schema.test.ts` | strict validation、target binding test |
| New | `api/modules/security-intelligence/authorization-boundary-projector.ts` | ApplicationModel/source evidenceからsnapshot生成 |
| New | `api/modules/security-intelligence/authorization-boundary-source-analysis.ts` | TypeScript AST解析とcheckout root非依存のsource正規化 |
| New | `api/modules/security-intelligence/authorization-boundary-projector.test.ts` | framework fixtureとconfidence test |
| New | `api/modules/security-intelligence/authorization-boundary-diff.ts` | before/after比較pure function |
| New | `api/modules/security-intelligence/authorization-boundary-diff.test.ts` | classification table test |
| New | `api/modules/security-intelligence/authorization-shadow-service.ts` | immutable target load、assessmentへのshadow追加 |
| New | `api/modules/security-intelligence/authorization-shadow-service.test.ts` | flag OFF、target binding、no finding test |
| New | `api/cli/authorization-shadow-assessment.ts` | flag既定OFFのread-only explicit CLI |
| New | colocated test fixture builders | small before/after sourceと明示guard association |
| New | `spec/evidence/security-intelligence-authorization-shadow-baseline.json` | fixture精度とcoverage結果 |

既存`ApplicationModel` schemaを破壊的に変更しない。revision identityが必要なため、Security Intelligence専用wrapper/projected snapshotへ明示的に追加する。

## 5. Snapshot shape

`AuthorizationBoundarySnapshot`は少なくとも次を持つ。

- `projectRef`
- `target.sourceRevision`
- `target.targetDigest`
- `analyzer.name/version`
- `analyzer.status = ready | degraded | unavailable`
- `framework`とsupport level
- stable endpoint identity
- methodとnormalized route pattern
- guard state: `guarded | unguarded | unknown`
- guard evidence: project-relative path、line/columnまたはopaque evidence ref
- limitation codes
- snapshot digest

stable endpoint identityは単純なline numberではなく、framework、HTTP method、normalized route pattern、handler identityから決定的に作る。identityが曖昧なら無理に対応付けず`unknown`にする。

## 6. Extraction policy

- ASTまたは既存extractorの明示構造を優先する。
- `authorize`、`guard`等のidentifier名だけを根拠にhigh-confidence guardedとしない。
- app/router level middlewareは適用順序を考慮する。
- source refはproject-relativeに正規化する。
- parse failureを空のroute一覧として扱わない。
- before/afterでanalyzer versionまたはsupport levelが変わった場合、その影響をlimitationに残す。
- LLM補助を将来追加してもoriginは`inferred`とし、deterministic observationと混ぜない。

## 7. Diff classification

各boundaryは次のいずれかへ分類する。

| Classification | 条件 | 初期挙動 |
| --- | --- | --- |
| `introduced` | afterに新しいendpointがありguard stateを観測可能 | shadow observation |
| `worsened` | 同一endpointが`guarded -> unguarded` | high-signal candidate、findingにはしない |
| `unchanged` | endpointとguard stateが安定 | metricのみ |
| `resolved` | `unguarded -> guarded` | positive observation |
| `removed` | endpoint自体がafterにない | guard removalとは扱わない |
| `coverage_lost` | before解析済み、after degraded/unavailable | failure signal。worsenedにしない |
| `unknown` | identity、middleware適用、解析結果が曖昧 | decisionへ使わない |

`worsened`は、before/after双方が同じanalyzer contractで`ready`、stable identityが一致し、両方にsource evidenceがある場合だけ生成する。

## 8. Required fixtures

| Fixture | Expected |
| --- | --- |
| route-level guard removed | `worsened` |
| route-level guard added | `resolved` |
| guarded route unchanged | `unchanged` |
| new unguarded route | `introduced` + `unguarded` |
| route deleted | `removed`。guard removalではない |
| route renamed/moved | stable identity不成立なら`unknown` |
| router-level middleware reordered | 実際の適用関係に従う |
| unrelated `authorize` variable | guardedと判定しない |
| after parse failure | `coverage_lost` |
| unsupported framework | `unknown` + limitation |
| same source with different absolute root | 同じsnapshot digest |
| before/after target digest mismatch | hard failure |

fixtureは1件ごとに小さなprojectとし、実repo snapshotを保存しない。

## 9. Runtime behavior

- feature flag既定値: OFF
- explicit CLI/test invocation時だけ実行
- finding tableへ書き込まない
- scan outcomeを変更しない
- NightWorkersへの既存responseへ追加しない
- task/runをblockしない
- candidateをcontextStillへ送信しない

PR 4のpilotではshadow observationをoptional sectionとして返せるが、Dependency assessmentのoutcomeへ影響させない。

実装では既存Dependency assessment builderを変更せず、独立した`runAuthorizationShadow`を追加した。これによりflag OFF時の既存scan/assessment出力は構造上も不変である。CLIは次のように明示的に有効化した場合だけinput JSONを読み、結果をstdoutへ返す。

```bash
bun run security-intelligence:authorization-shadow -- --enable --input authorization-shadow-input.json
```

## 10. Evaluation metrics

fixture以外に、許可されたpilot repositoryでmanual labelと比較する。

- supported route coverage
- stable identity match rate
- guarded/unguarded precision
- false `worsened` count
- `unknown` rate
- `coverage_lost` rate
- analyzer duration
- path/source leakage count

初期目標はcoverage最大化ではない。false `worsened`を抑え、解析不能を正直に表現できることを優先する。

## 11. 実装順序

1. revision-bound snapshot schemaとnegative testを作る。
2. fixtureごとのexpected endpoint/guard stateを手動labelする。
3. projectorをframework 1つから実装する。
4. stable identityとpure diffを実装する。
5. parse failure/unsupported caseを`coverage_lost`/`unknown`へ通す。
6. 独立したshadow assessment serviceへ接続する。
7. feature flag OFFとno-side-effect testを追加する。
8. baseline metric artifactを生成する。

## 12. Acceptance criteria

- before/after両方がexplicit revision/digestを持つ。
- route deletionをguard removalと誤認しない。
- after解析失敗を`coverage_lost`として表現する。
- identifier名だけのguard誤認fixtureが通る。
- `worsened`の全件がbefore/after evidence refを持つ。
- feature flag OFFで既存scan outputがbyte-levelまたはschema-levelで不変である。
- finding、task、knowledge storeへのwriteがない。
- absolute rootが異なっても同じsourceから同じsnapshot digestを生成する。

## 13. Verification commands

```bash
bunx vitest run shared/schemas/security-intelligence-authorization.schema.test.ts
bun test api/modules/security-intelligence/authorization-boundary-projector.test.ts
bun test api/modules/security-intelligence/authorization-boundary-diff.test.ts
bun test api/modules/security-intelligence/authorization-shadow-service.test.ts
bun test api/modules/threat-models/application-model-builder.test.ts
bun run typecheck
git diff --check
```

## 14. Failure、rollback、stop condition

- revision-bound snapshotを作れない場合、既存ApplicationModelのlatest row比較へfallbackしない。
- framework固有middleware orderingを説明できない場合、そのframeworkをsupport対象から外し`unknown`にする。
- false `worsened`がfixtureまたはmanual labelで1件でも出た場合、NightWorkers上で警告表示しない。metric-onlyを維持する。
- rollbackはfeature flagと新規observer filesのrevertで完了する。既存ApplicationModel persistenceをmigrationしない設計にする。

## 15. Merge gate

すべてのrequired fixtureが通り、feature flag OFF時に既存scan/integration contractへ差分がないこと。精度が未達でも、`unknown`/`coverage_lost`として安全にdegradeしmetric収集だけ可能ならmergeできる。
