# PR 4: NightWorkers Security Intelligence Integration — Legacy Plan

Status: SUPERSEDED — producer、consumer、post-assessment、shadow plumbingは実装済み

この文書はPR 4当時の設計記録であり、paired Runや10-pair pilotを実行してはならない。
現在の実行契約は`security-intelligence-integrity-smoke-template.json`（v2）、現在の残作業は
NightWorkersの`security-intelligence-pilot-rollout-todo.md`を正とする。

Implementation baseline: PR 1 `538866f`、PR 2 `ca0205e`、PR 3 `5a4df84`

## 1. 目的

NightWorkersがtask/runに紐付くrevision-bound assessmentを取得できるようにする。

このPRはdefault activationの判断を行わない。integrity evidenceを収集し、別のdecision recordでGO / ITERATE / STOPを判断できる状態を作る。

## 2. Integration boundary

既存`/api/integrations/nightworkers/v1`のscan contract version 1を変更しない。Security Intelligence用に独立したversion空間を追加する。

想定route:

```text
GET /api/integrations/nightworkers/security-intelligence/v1/scans/:scanRunRef/assessment
```

routeは既存NightWorkers integration authentication、binding、owner/project authorizationを再利用する。response bodyはPR 1のstrict assessment自体を変更せず、Dependency assessmentとoptional Authorization stateを格納する独立versionのbundleである。

この分離により、既存consumerのstrict parserやcapability responseを壊さずpilot consumerだけを追加できる。

## 3. Proposed vulnWorkbench files

| 種別 | Path | 内容 |
| --- | --- | --- |
| New | `api/modules/integrations/nightworkers/nightworkers-security-intelligence.routes.ts` | 独立version route |
| New | `api/modules/integrations/nightworkers/nightworkers-security-intelligence.service.ts` | auth後のassessment取得 |
| New | `api/modules/integrations/nightworkers/nightworkers-security-intelligence-projection.ts` | contract validation、redaction、stable response |
| New | `api/modules/integrations/nightworkers/nightworkers-security-intelligence-telemetry.ts` | aggregate-only latency/payload metric |
| New | `api/modules/integrations/nightworkers/nightworkers-security-intelligence.{service,routes,telemetry}.test.ts` | auth、binding、state、redaction、metric |
| New | `shared/schemas/nightworkers-security-intelligence.schema.ts` | strict outer bundle / response contract |
| New | `shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema.ts` | single-Run integrity evidence v2 contract |
| Change | integration route registration file | 新route groupをmount |
| New | `spec/evidence/security-intelligence-integrity-smoke-template.json` | single-Run integrity evidence template |
| New | `spec/security-intelligence-pilot-decision-template.md` | GO / ITERATE / STOP decision format |

実装時は既存route registrationの実pathを確認し、同じ役割のfileがある場合は重複route rootを作らない。

## 4. NightWorkers側の並行PR

NightWorkersでは別PRとして次を実装する。

- PR 1 fixtureをparseするconsumer contract test
- task/runが`assessmentRef`、contract version、target digestを保持するadapter
- explicit opt-in時だけassessment endpointを呼ぶclient
- Dependency assessmentのsummary表示
- Authorization observationのshadow表示またはtelemetry-only処理
- evidence referenceのopaque link表示
- unavailable/inconclusiveをsuccessへ畳み込まないUI/CLI表現
- feature flagとinstant rollback

NightWorkersはassessmentを再判定しない。表示上のtask-specific projectionを作る場合はoriginを`task_projection`として区別する。

contextStillはこのpilotのcritical dependencyにしない。pilot後にvalidation済みcandidateの受け入れを試す。

## 5. Request/response behavior

### Preconditions

- integration clientが既存read scopeを持つ
- scan bindingがclientに属する
- owner/project authorizationが一致する
- scan runがassessment生成可能なterminal stateである
- target identityとartifact bindingが検証できる

### Success

- HTTP 200
- bodyはversioned success envelope内の`NightworkersSecurityIntelligenceBundle`
- Dependency payloadと利用可能なAuthorization payloadは、それぞれstrictな`SecurityIntelligenceAssessmentV1`
- `projectRef`、`scanRunRef`、target digestがrequested bindingと一致
- Dependency sectionはPR 2の結果
- Authorization sectionは常に`disabled / unavailable / available`を明示し、flag ONかつ利用可能な場合だけassessmentを含む
- success/error responseは`Cache-Control: private, no-store`、`Pragma: no-cache`、`Vary: Authorization`を返す
- bundle payloadは`NIGHTWORKERS_SECURITY_INTELLIGENCE_MAX_RESPONSE_BYTES`（既定2 MiB）を超えた場合にfail closedする

### Not ready / unavailable

既存scan integration error enumを拡張しない。新routeのresponse schema内で、未完了はHTTP 409の`assessment_not_ready`、生成不能はHTTP 422の`assessment_unavailable`として独立にversion管理する。

target mismatch、owner mismatch、binding mismatchはassessment payloadを返さない。認可情報を漏らさない既存not-found behaviorへ揃える。

## 6. Backward compatibility test

PR merge前に次を固定する。

- 既存NightWorkers scan contract fixture hashが変わらない。
- existing capabilities、presets、scan create/status/findings/report responseが変わらない。
- 新feature flag OFFで新routeはadvertiseされず、または明示的not enabledを返す。
- 新routeの追加が既存scopeの意味を拡張しすぎない。必要なら新scopeは別migration/PRに分ける。
- strict old consumerが新fieldを受け取る経路を作らない。

## 7. Historical pilot design and replacement

以下のpaired baseline designは採用しない。assessmentはpersisted scan artifactのprojectionであり、
実装Runを複製するとモデル揺れ、費用、時間が増え、integrity検証の精度は上がらない。

現在は1 Task / 1 implementation Run / 1 canonical Evidence Subjectで、pre assessment →
Security Contract → implementation → post assessment → structured judgmentを確認する。
もう一方のruntime laneはadapter / tool contract smokeだけを行う。

### Adopted Phase A: single-Run integrity smoke

- 1 repository、1 implementation Run
- Dependency changeあり
- assessment ref/evidence refを人手で解決確認
- wrong project/revision、redaction、rollbackを確認

### Rejected Phase B: Paired sample

baseline / assessment-enabledの二重Runと10件sampleは実行しない。typed unavailable、
tool failure、zero findingはfocused unit / contract scenarioでfail-closedを固定する。

### Evidence unit

```text
taskRef
  taskRevisionSnapshotId / taskRevisionSnapshotDigest
  runRef
  evidenceSubjectRef
  preBundleRef / preAssessmentRef
  securityContractRef
  postBundleRef / postAssessmentRef
  finalJudgmentRef
  projectRef
  sourceRevision
  targetDigest
  selectedVerifications
  selectedEvidenceRefs
  unresolvedEvidenceRefs
  evidenceResolution
  outcome
  primaryLane / secondaryLaneContractCheck
  limitations
```

pre/postのtask、run、Evidence Subject、project、revision role、digestが一致しない場合は
安全性incidentとして停止する。

## 8. Metrics

### Safety / integrity

- wrong project/revision binding count
- unresolved evidence ref count
- secret/absolute-path leakage count
- required verification failureをsuccess表示したcount
- contract parse failure count

### Cost / reliability

- assessment build latency
- endpoint request/error count
- scan completion latencyへの影響
- payload size

telemetryにはsource本文、secret、raw filesystem pathを保存しない。

## 9. Decision gates

### Capability-level GO候補

- wrong project/revision、secret/path leakが0件
- assessmentのevidence refが100%解決可能
- required failureのsuccess誤表示が0件
- 既存scan completionへの重大regressionがない
- rollback drillが成功する

### ITERATE

- integrity incidentはないが、unknown/inconclusiveが多い
- useful signalはあるがlatencyまたはpayload costが高い
- Authorization shadowの精度が不足している

### STOP

- wrong revision/projectへassessmentを紐付ける
- evidenceを再確認できない
- secret/source/path leakが発生する
- required failureを成功扱いする
- 既存scan contractまたは主要workflowを不安定化する

assessment consumer、post-assessment grant、candidate export、feedback export、shadow retrievalを
別々に判断する。GO条件を満たしてもdefault ONにせず、別のdated activation decisionを必要とする。

## 10. Rollout control

- vulnWorkbench server flag: default OFF
- NightWorkers consumer flag: default OFF
- project allowlist: empty by default
- dependency assessmentとauthorization shadowを別flagにする
- kill switchは再deployなし、または最小のconfig rollbackで発動できること
- flag OFF後も既存scan routeは影響を受けないこと

producer側は`NIGHTWORKERS_INTEGRATION_ENABLED`、`NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED`、`NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED`、`NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS`で制御する。payload上限は`NIGHTWORKERS_SECURITY_INTELLIGENCE_MAX_RESPONSE_BYTES`で制御する。

## 11. Implementation order

1. PR 1 fixtureを使うroute response contract testを追加する。
2. existing integration auth/binding middlewareで新routeを保護する。
3. PR 2 serviceをread-onlyで接続する。
4. not-ready/unavailable/mismatchのfailure mappingを実装する。
5. redactionとexisting v1 regression testを追加する。
6. server/consumer flagとallowlistを追加する。
7. NightWorkers consumer fixture testをgreenにする。
8. cross-repository fixture checkerを通す。
9. single-Run integrity smokeと1回のrollback drillを行う。
10. Stage 2 integrity PASS後に1-batch shadow smokeを行う。
11. decision templateからcapability別decision recordを作る。

## 12. Acceptance criteria

- enabled projectのterminal scanについてcontract-valid assessmentを取得できる。
- running scanは成功payloadを返さない。
- wrong owner/project/bindingは既存integrationと同等に拒否される。
- existing NightWorkers v1 fixtureとroute testが不変で通る。
- Security Intelligence v1のschemaと静的response fixtureがhash baselineで固定される。
- flag OFFで既存workflowへobservableな差分がない。
- responseはprivate/no-storeで、設定されたpayload上限を超えない。
- assessmentからすべてのevidence refを解決できる。
- single-Run integrity smokeとrollback drillが成功する。
- integrity evidence artifactがsource本文/secret/raw pathなしで作成される。

## 13. Verification commands

vulnWorkbench:

```bash
bun test api/modules/integrations/nightworkers api/modules/security-intelligence api/app/env.test.ts
bunx vitest run shared/schemas/nightworkers-security-intelligence.schema.test.ts shared/schemas/nightworkers-security-intelligence-pilot.schema.test.ts
bunx vitest run shared/schemas/nightworkers-security-scan-integration.schema.test.ts shared/schemas/security-intelligence-assessment.schema.test.ts
bun run verify:security-intelligence-contract
bun run typecheck
git diff --check
```

NightWorkersでは、repository固有commandに加えて次の結果を必須にする。

- consumer fixture test
- flag OFF regression test
- wrong revision/project rejection test
- inconclusive/unavailable rendering test
- single-Run integrity evidence validation

## 14. Failureとrollback

- integrity/safetyのSTOP条件が1件でも発生したら両repositoryのflagをOFFにし、pilotを停止する。
- endpoint failure時に既存scan resultへfallbackして「assessment成功」と表示しない。明示的unavailableとする。
- rollbackはNightWorkers consumer flag OFF、vulnWorkbench route flag OFFの順で行う。既存scan APIは残る。
- pilot dataは削除せず、機密情報を除いたfailure evidenceとしてdecision recordへ残す。

## 15. Merge gate

routeとconsumer codeはflag OFFでmerge可能だが、allowlist追加はsmokeのintegrity checks完了後に行う。default activation、contextStill candidate emission、task blockingはすべて後続PRとする。
