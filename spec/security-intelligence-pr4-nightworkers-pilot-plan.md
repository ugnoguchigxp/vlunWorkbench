# PR 4: NightWorkers Security Intelligence Paired Pilot

Status: vulnWorkbench producer/endpoint implemented; NightWorkers consumer、smoke、10-pair pilotは未実施

Implementation baseline: PR 1 `538866f`、PR 2 `ca0205e`、PR 3 `5a4df84`

## 1. 目的

NightWorkersがtask/runに紐付くrevision-bound assessmentを取得し、既存security scanと比較できるpaired pilotをdefault OFFで実行可能にする。

このPRはdefault activationの判断を行わない。pilot evidenceを収集し、別のdecision recordでGO / ITERATE / STOPを判断できる状態を作る。

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
| New | `shared/schemas/nightworkers-security-intelligence-pilot.schema.ts` | versioned pilot evidence contract |
| Change | integration route registration file | 新route groupをmount |
| New | `spec/evidence/security-intelligence-nightworkers-pilot-template.json` | paired observation template |
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

## 7. Pilot design

### Phase A: Smoke

- 1 repository、1 revision pair
- Dependency changeあり
- assessment ref/evidence refを人手で解決確認
- wrong project/revision、redaction、rollbackを確認

### Phase B: Paired sample

- 少なくとも10件のvalid pair
- 同一task、同一revision、同一scan profileでbaselineとassessment-enabledを比較
- tool failureやzero findingを除外せずsampleへ含める
- Authorization shadowは利用できるcaseだけ測定し、Dependency結果と別集計する

### Pair unit

```text
taskRef
  baselineRunRef
  assessmentRunRef
  projectRef
  sourceRevision
  targetDigest
  selectedVerifications
  evidenceResolution
  outcome
  operatorAction
  timeToEvidence
  limitations
```

baselineとassessmentでrevision/digestが一致しないpairは無効とし、performance比較へ含めない。ただしmismatch自体は安全性incidentとして記録する。

## 8. Metrics

### Safety / integrity

- wrong project/revision binding count
- unresolved evidence ref count
- secret/absolute-path leakage count
- required verification failureをsuccess表示したcount
- contract parse failure count

### Usefulness

- Dependency change taskで適切なverificationが選択された率
- assessmentからfinding evidenceへ到達できた率
- operatorが追加調査または修正へ移った率
- time-to-evidenceのbaseline差
- inconclusive/unknownの理由が説明可能だった率

### Cost / reliability

- assessment build latency p50/p95
- endpoint error/timeout rate
- scan completion latencyへの影響
- payload size
- Authorization shadowのunknown/coverage-lost/false-worsened count

telemetryにはsource本文、secret、raw filesystem pathを保存しない。

## 9. Decision gates

### GO候補

- wrong project/revision、secret/path leakが0件
- assessmentのevidence refが100%解決可能
- required failureのsuccess誤表示が0件
- 既存scan completionへの重大regressionがない
- Dependency sliceでactionabilityまたはtime-to-evidenceに改善が観測される
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

GO条件を満たしても、このPR内でdefault ONにしない。別のdated decision recordとactivation PRを必要とする。

## 10. Rollout control

- vulnWorkbench server flag: default OFF
- NightWorkers consumer flag: default OFF
- project allowlist: empty by default
- dependency assessmentとauthorization shadowを別flagにする
- kill switchは再deployなし、または最小のconfig rollbackで発動できること
- flag OFF後も既存scan routeは影響を受けないこと

flag keyの具体名は既存configuration conventionを確認して決め、plan内の仮名をそのまま増やさない。

## 11. Implementation order

1. PR 1 fixtureを使うroute response contract testを追加する。
2. existing integration auth/binding middlewareで新routeを保護する。
3. PR 2 serviceをread-onlyで接続する。
4. not-ready/unavailable/mismatchのfailure mappingを実装する。
5. redactionとexisting v1 regression testを追加する。
6. server/consumer flagとallowlistを追加する。
7. NightWorkers consumer fixture testをgreenにする。
8. 1-pair smokeとrollback drillを行う。
9. 10件以上のpaired pilotを実施し、versioned evidenceを保存する。
10. decision templateから別decision recordを作る。

## 12. Acceptance criteria

- enabled projectのterminal scanについてcontract-valid assessmentを取得できる。
- running scanは成功payloadを返さない。
- wrong owner/project/bindingは既存integrationと同等に拒否される。
- existing NightWorkers v1 fixtureとroute testが不変で通る。
- flag OFFで既存workflowへobservableな差分がない。
- assessmentからすべてのevidence refを解決できる。
- 1-pair smokeとrollback drillが成功する。
- paired pilot artifactがsource本文/secret/raw pathなしで作成される。

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
- smoke pair evidence validation

## 14. Failureとrollback

- integrity/safetyのSTOP条件が1件でも発生したら両repositoryのflagをOFFにし、pilotを停止する。
- endpoint failure時に既存scan resultへfallbackして「assessment成功」と表示しない。明示的unavailableとする。
- rollbackはNightWorkers consumer flag OFF、vulnWorkbench route flag OFFの順で行う。既存scan APIは残る。
- pilot dataは削除せず、機密情報を除いたfailure evidenceとしてdecision recordへ残す。

## 15. Merge gate

routeとconsumer codeはflag OFFでmerge可能だが、allowlist追加はsmokeのintegrity checks完了後に行う。default activation、contextStill candidate emission、task blockingはすべて後続PRとする。
