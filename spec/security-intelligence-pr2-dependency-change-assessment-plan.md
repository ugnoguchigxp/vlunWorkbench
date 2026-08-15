# PR 2: Dependency Change Assessment Vertical Slice

## 1. 目的

保存済みscan runとartifactから、Dependency changeに限定したrevision-bound assessmentを生成する。これはSecurity Intelligence構想で最初にend-to-endで動く縦切りである。

新しいdependency scannerは追加しない。既存のdiff planning、immutable snapshot、OSV/Trivy tool resultを再利用する。

## 2. 入出力

### Input

- projectとownerで認可済みのscan run
- scan runに保存されたresolved target
- `diff_manifest` artifact
- tool applicabilityとtool run status
- OSV/Trivy等のfinding、report、evidence metadata

### Output

- PR 1の`SecurityIntelligenceAssessmentV1`
- Dependency claimとverificationだけを含む
- CLIではJSONをstdoutへ出力する
- runtime stateやfindingを新規作成しないread model

## 3. Trust boundary

assessment生成時に現在のworking treeを再scan・再解析しない。scan実行時に保存されたtargetとartifactだけを使う。

次の一致を確認できない場合はassessmentを生成せず、typed failureまたは`inconclusive`にする。

- requested project/ownerとscan runのproject/owner
- scan runの`targetDigest`とdiff manifestのtarget digest
- scan run metadataのsource revisionとassessment target
- evidence/tool runが属するscan run
- artifact content digestと保存metadata

## 4. Proposed files

| 種別 | Path | 内容 |
| --- | --- | --- |
| New | `api/modules/security-intelligence/security-assessment-builder.ts` | generic assessment組み立てとinvariant適用 |
| New | `api/modules/security-intelligence/security-assessment-builder.test.ts` | outcome、evidence、sort、redaction test |
| New | `api/modules/security-intelligence/dependency-change-observer.ts` | diff manifestからDependency観測を作るpure function |
| New | `api/modules/security-intelligence/dependency-change-observer.test.ts` | ecosystem別、limitation別test |
| New | `api/modules/security-intelligence/security-assessment-service.ts` | persisted scan/artifactのloadとbinding validation |
| New | `api/modules/security-intelligence/security-assessment-service.test.ts` | wrong project/revision、artifact欠落test |
| New | `api/cli/security-assessment.ts` | `--scan-run-id`からassessment JSONを生成 |
| Change | `package.json` | `security-intelligence:assess` script |
| New | `spec/evidence/security-intelligence-dependency-baseline.json` | fixture runの評価用output |

DB migrationは行わない。assessmentは既存recordから決定的に再生成できるread modelとする。生成costまたはaudit要件から永続化が必要と分かった場合は、別PRで判断する。

## 5. 再利用する既存実装

- `api/modules/scans/diff-scan-plan.ts`
  - `dependencyChanged`
  - `pluginContext.dependencyStateChanged`
  - `pluginContext.lockStateChanged`
  - `limitationCodes`
  - tool applicability
- `api/modules/scans/diff-snapshot.ts`
  - scan時のimmutable targetとdependency companion files
- `api/modules/scans/profile-orchestrator.ts`
  - `diff_manifest` artifactとscan run metadata
- `api/modules/scans/profile-runner.ts`
  - findingとdiff relation
- existing OSV/Trivy findings and reports

observerが同じdependency manifest解析を再実装することは禁止する。observerは既存artifactをSecurity Intelligence contractへ変換するadapterに留める。

## 6. Dependency observation rules

### Observedとして出せるもの

- dependency manifestまたはlock stateが変更された
- どのecosystemがscan scopeに含まれたか
- OSV/Trivy verificationが実行・skip・failureのどれだったか
- toolがどのfinding/evidenceを生成したか
- diff planningが報告したlimitation code

### Inferredとしてのみ出せるもの

- dependency changeによってsupply-chain reviewが必要になった
- lock file欠落等によりresolution completenessが低下した可能性

### 出してはいけないもの

- dependency changeだけを根拠にした特定CVEの存在
- zero findingを根拠にした「依存関係は安全」
- toolが対象外/失敗した範囲の`tested`
- 現在のworking treeから推測したrevision情報

## 7. Outcome decision table

| 状態 | Outcome | 説明 |
| --- | --- | --- |
| required tool完了、1件以上finding | `findings_observed` | finding/evidence refs必須 |
| required tool完了、0 finding、coverage明示 | `no_findings_observed` | residual riskとgapを保持 |
| required tool失敗/timeout、artifact欠落 | `inconclusive` | failure reasonをlimitationへ残す |
| 対象ecosystemをsupportできない | `unavailable`または`inconclusive` | applicabilityと理由で一意に決める |
| dependency changeなし | 対象外のverification | 「検査済み」にはしない |
| target/evidence mismatch | hard failure | assessment payloadを返さない |

`inconclusive`とhard failureの境界は、正しいtargetについて検査が失敗した場合を前者、target identity自体を信頼できない場合を後者とする。

## 8. Fixture/test matrix

- npm: `package.json`変更、lock変更あり/なし
- Maven: `pom.xml`変更
- Gradle: Groovy/Kotlin build file変更
- Python: requirements/lockの既知pattern
- Go: `go.mod`/`go.sum`
- dependency file変更なし
- OSV完了 + findingあり
- OSV完了 + findingなし
- OSV skip/not applicable
- OSV failure/timeout
- Trivy evidenceあり
- diff manifest欠落・digest mismatch
- scan targetとevidence targetのmismatch
- private absolute pathとcredential-shaped stringのredaction
- 入力配列順が異なっても同じcanonical assessmentになること

既存`api/modules/scans/diff-scan-plan.test.ts`のfixtureを可能な範囲で再利用し、同じecosystem fixtureを重複作成しない。

## 9. CLI behavior

想定command:

```bash
bun run security-intelligence:assess --scan-run-id <scan-run-id> --format json
```

- stdout: contract-validなassessment JSONだけ
- stderr: progress、warning、typed failure
- exit 0: assessment生成成功。outcomeが`inconclusive`でもpayloadが正しければ0
- exit non-zero: 認可、not found、target mismatch、schema violation
- `--write`は初期PRでは提供しない

## 10. 実装順序

1. `dependency-change-observer`をpure functionとして実装する。
2. PR 1 fixtureへ同じobserver出力を流すbuilder testを作る。
3. persisted scan/artifact readerとbinding validationをserviceへ追加する。
4. outcome decision tableをtable-driven testにする。
5. CLIを薄いadapterとして追加する。
6. real-like fixture scanでbaseline JSONを生成する。
7. 同じscan runから2回生成し、canonical payloadが一致することを確認する。

## 11. Acceptance criteria

- npm/Maven/Gradle/Python/Goの既存Dependency差分caseをassessmentへ変換できる。
- zero findingとtool failureを区別する。
- wrong project、wrong revision、wrong digestをrejectする。
- assessment内のすべてのevidence refを元scan runへ解決できる。
- source本文、secret、絶対pathを出力しない。
- 同じpersisted inputから同じsemantic digestと`assessmentRef`を生成する。`generatedAt`だけは実生成時刻として差分を許す。
- scan execution、finding、report、DB schemaへ副作用を与えない。

## 12. Verification commands

```bash
bun test api/modules/security-intelligence/dependency-change-observer.test.ts
bun test api/modules/security-intelligence/security-assessment-builder.test.ts
bun test api/modules/security-intelligence/security-assessment-service.test.ts
bun test api/modules/scans/diff-scan-plan.test.ts
bun test api/modules/scans/nightworkers-profile-contract.test.ts
bun run security-intelligence:assess --scan-run-id <fixture-scan-run-id> --format json
bun run typecheck
git diff --check
```

fixture scan runを作る既存test helperがCLIから利用できない場合は、test専用importではなく明示的なfixture commandを追加する。

## 13. Observability

初期CLIとserviceで次をstructured logへ出す。source content、raw path、credentialは出さない。

- assessment contract version
- project/scan/assessmentのopaque ref
- target digestの短縮表示
- outcome
- verification countとstatus別count
- coverage gap/limitation code
- build duration
- schema validation success/failure

## 14. Failure、rollback、stop condition

- persisted artifactだけでrevision bindingできない場合、現在のtreeへfallbackしない。必要なmetadata追加を小さな先行commitとして同じPRに含めるか、PRを止める。
- OSV/Trivyのraw result形式が安定していない場合、raw parserを増やさず既存finding/report projectionを使う。
- rollbackは新規module、CLI、script、baseline artifactのrevertで完了する。既存scan pathは変更しない。
- wrong-revision assessmentが1件でも生成された場合、PR 4へ進まない。

## 15. Merge gate

保存済みfixture scan runに対し、evidence refがすべて解決可能で、2回の生成結果が決定的であること。NightWorkersへの公開route追加はPR 4まで行わない。
