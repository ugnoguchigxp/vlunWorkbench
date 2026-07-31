# Phase 53: Python / Go Plugin Expansion Implementation Plan

Status: Implemented locally on 2026-07-31. Release closeout remains blocked on the
external offline vulnerability database, toolbox image digest, target execution
sandbox, and a same-commit clean-checkout run; these are preserved as gaps rather
than treated as successful verification.

Predecessor:
`spec/phase-52-plugin-oriented-language-framework-refactoring-plan.md`

Planning baseline commit:
`44db27a1a88fcdd2e3535d7ef358f2cc874b0c72`

Baseline date: 2026-07-31

Owner: vulnWorkbench maintainers

Target: Phase 52で導入したversioned built-in plugin contractを使い、coreへ
言語固有分岐を増やさず、PythonとGoのSAST、offline SCA、project structure、
framework detection、endpoint extractionを追加する。PythonのDAST start planは
安全に生成できる場合だけ追加し、sandbox未整備時はfail closedとする。
GoのDAST auto-startは初期正式対応に含めない。

## 1. 結論

Phase 53では、次のbuilt-in pluginを追加する。

| Kind | Plugin ID | 初期対象 |
| --- | --- | --- |
| language | `language.python` | `.py`、Python Semgrep、最小構造解析 |
| build system | `build.python-requirements` | 固定versionの`requirements*.txt` |
| framework | `framework.python.fastapi` | FastAPI endpoint、条件付きDAST start plan |
| framework | `framework.python.flask` | Flask endpoint、条件付きDAST start plan |
| framework | `framework.python.django` | Django endpoint、条件付きDAST start plan |
| language | `language.go` | `.go`、Go Semgrep、最小構造解析 |
| build system | `build.go-modules` | `go.mod` |
| framework | `framework.go.net-http` | `net/http` endpoint |
| framework | `framework.go.gin` | Gin endpoint |
| framework | `framework.go.echo` | Echo endpoint |

初期releaseでは、能力ごとのsupport tierを次のように固定する。

| 対象 | SAST | SCA | Structure | Endpoint | DAST auto-start |
| --- | --- | --- | --- | --- | --- |
| Python | `verified`候補 | `partial` | `partial` | framework別`partial` | planのみ。sandbox未整備時は`gap` |
| Go | `verified`候補 | `partial` | `partial` | framework別`partial` | `unsupported` |

`verified`は本計画のrelease gateを同一commitで通過して初めて付与する。
計画承認、plugin登録、scanner dataの存在だけでは対応済みと表示しない。

PythonとGoを一括で「対応」と宣言しない。SAST、SCA、構造解析、endpoint、
DASTを独立したcapabilityとして判定し、`partial`、`gap`、`unsupported`を
reportとUIへそのまま伝える。

## 2. Phase 52からの継承条件

### 2.1 Hard start gate

production codeへ着手する前に、次を満たす。

1. Phase 52のplugin registry、plugin detection、capability report、
   dependency provider、source analyzer、endpoint contributionが意図した
   integration branchへ統合されている。
2. 次がbaseline commitで成功する。

```bash
bun run verify:phase-52-capability
```

3. Phase 52で未完了の次の項目を、完了扱いにしない。
   - toolbox image digestを伴う実scanner gate
   - offline vulnerability databaseを使ったvulnerable/fixed gate
   - pre-scan capability UI
   - enforced rolloutとlegacy fallback removal
   - same-commit clean checkout release closeout
   - target project code execution sandbox
4. Phase 53と無関係な未commit変更を分離し、baseline evidenceへ
   dirty working treeであることを記録する。
5. Phase 53の追加によりPhase 52のregistry digestが変わることを許容するが、
   変更前後のdigestとplugin一覧をevidenceへ保存する。

静的能力の実装はtarget execution sandboxと独立して進めてよい。
Python DASTの実行をsupportedとするrelease gateだけはsandbox完了後まで閉じる。

### 2.2 Planning baselineの現状

2026-07-31のread-only確認では、`bun run verify:phase-52-capability`は成功した。
ただしworking treeにはPhase 53と無関係な変更が存在するため、これは
same-commit clean checkoutのrelease evidenceではない。

Phase 53の実装では既存変更を上書き、revert、commitへ混在させない。

## 3. 現行資産と不足している製品経路

### 3.1 再利用できる資産

現行repositoryには次が存在する。

- Pythonのowned Semgrep rule: 8 rules
- Goのowned Semgrep rule: 8 rules
- PyPIのOSV vulnerable/fixed fixture
- GoのOSV vulnerable/fixed fixture
- FastAPI、Flask、Djangoのlegacy endpoint extractor
- `net/http`、Gin、Echoのlegacy endpoint extractor
- 上記frameworkを含むendpoint discovery benchmark
- scanner-data manifest上のPyPI、Go offline database entry

planning baselineで採取したhashは次のとおりである。

| Evidence | Digest |
| --- | --- |
| Python Semgrep ruleset | `sha256:ff8574338dbec9bb4db5784738b79d69bd655911d5e8da9aa9eeaa08d246df84` |
| Go Semgrep ruleset | `sha256:a6caaa0a915664b4b6545d5bb3080e9b427034f1a932f30cd7f32eb85d1146a6` |
| Semgrep catalog | `sha256:8eebb13a1a23abc3ed158f76c4b13ff4d08050ff2b09f9365df3ff02935410a4` |
| scanner-data manifest | `sha256:1676af8e62e415443cd0ff1cb802d0bae31c28f1ddc48b215db2e108849a34cd` |

実装開始時に再計算し、差異があれば理由をbaseline evidenceへ記録する。

### 3.2 不足している経路

既存資産は次の理由でformal supportを意味しない。

- built-in registryにPython/Go pluginが登録されていない。
- `DependencyProvider.ecosystem`が`npm | Maven`に閉じている。
- dependency input、diff applicability、profile materializationが
  Python/Go pluginから導出されない。
- `.py`、`.go`のproject structure analyzerとimport resolverがない。
- module boundaryは`package.json`、`pom.xml`、Gradle file中心である。
- endpoint extractorはlegacy extension switchから直接呼ばれ、
  detected frameworkとの対応が保証されない。
- Python/GoのDAST start contractと安全境界が定義されていない。
- scanner fixtureがprofile、report、UIまで通る証跡がない。

## 4. Scope

### 4.1 In scope

- Python language plugin
- Go language plugin
- Python requirements dependency plugin
- Go Modules dependency plugin
- FastAPI、Flask、Django framework plugin
- `net/http`、Gin、Echo framework plugin
- active language pluginで選択するPython/Go Semgrep ruleset
- offline OSV inputのplugin-driven materialization
- Python/Go source inventoryとbounded lexical analyzer
- Python relative/absolute importの保守的resolver
- Go module/importの保守的resolver
- Python/Go package boundary推論
- framework evidenceに基づくendpoint contribution選択
- Python frameworkのvalidated DAST start plan
- capability、coverage、limitation、applicabilityの保存と表示
- diff scopeへのPython/Go manifest追加
- shadow comparison、legacy fallbackの段階撤去
- Phase 53専用fixture、benchmark、release evidence

### 4.2 Non-goals

- scan中の`pip install`、`poetry install`、`uv sync`
- Python resolverによるlockfile自動生成
- virtualenv、`site-packages`の既定scan
- `setup.py`またはtarget Python codeの実行
- Poetry、Pipenv、uv、PDMの正式SCA対応
- editable install、VCS dependency、private indexの解決
- scan中の`go get`、`go mod download`、`go list`
- Go module cacheまたは`vendor/`の既定scan
- Go toolchainの自動download
- OSV Go call analysis
- Go applicationの汎用auto-start
- Fiber、Tornado、Sanic、Starlette単体の正式対応
- Django REST Frameworkのserializer/routerを含む完全意味解析
- Django `include()`の完全展開
- gRPC、GraphQL、WebSocket routeの完全抽出
- auth/authz policyの意味推論
- native tree-sitter bindingの新規導入
- runtimeでの任意package plugin loading
- external plugin marketplace
- Python/Go以外の言語追加
- mobile applicationのDAST

## 5. 安全性と信頼境界

### 5.1 静的解析

language、build、framework detectorとsource analyzerは、inventoryと
size制限付きtextだけを読む。次を禁止する。

- target repositoryのcode import
- Python moduleのimportまたは実行
- Go packageのbuildまたはtest
- manifest hook、build script、generatorの実行
- dependency installまたはnetwork resolution
- target repositoryへのfile生成・更新

Python/Go analyzerは初期sliceではbounded lexical analysisとし、完全な
compiler frontend相当の精度を宣言しない。構文が複雑、生成済み、曖昧な場合は
推測でedgeを作らずdiagnosticを返す。

### 5.2 DAST

DAST start planはcommand candidateであり、実行権限ではない。

- `requiresProjectCodeConsent: true`
- `requestedNetwork: "none"`
- loopback bindのみ
- central target lifecycleがport、readiness、timeout、停止を管理
- 明示同意とsandboxがない場合は
  `project_code_execution_sandbox_required`でfail closed
- dependency不足を補うinstallは行わない
- shell stringを生成せず、固定executableとargs配列を返す

Python DAST start planの追加によって、sandbox未整備状態をsupportedへ
昇格させない。Goは汎用的なbind address/port contractを安全に決められないため、
初期releaseではstart plan自体を提供しない。

## 6. Plugin contractの追加設計

### 6.1 API version

次の変更はadditiveに行い、persisted manifest schemaを壊さない限り
`pluginApiVersion: "1"`を維持する。

- `DependencyProvider.ecosystem`へ`PyPI`と`Go`を追加
- unresolved reference hintへ`python_import`と`go_import`を追加
- Python/Go analyzerとresolver contributionを登録
- 既存capability enumで表現可能なcontributionだけを使う

既存pluginのsource互換が壊れる、またはplugin manifestの必須fieldを増やす場合は、
そのsliceを停止しplugin API v2の別計画へ切り出す。

### 6.2 Manifestとcontributionの整合性

registry validationへ次を追加する。

- Semgrep contributionがあれば`sast`宣言を要求する。
- dependency providerがあれば`dependency_detection`と
  `dependency_scan`宣言を要求する。
- source analyzerがあれば`project_structure`宣言を要求する。
- endpoint extractorがあれば`endpoint_extraction`宣言を要求する。
- start plannerがあれば`dast_start`宣言を要求する。
- contributionがないcapability宣言は、明示的なdelegation根拠がなければrejectする。
- plugin ID、detector ID、contribution IDの重複をrejectする。

このvalidationはPython/Go専用にせず、fixture pluginで拡張性を検証する。

### 6.3 Deterministic registry

`api/plugins/builtin/index.ts`へ明示importし、安定順序で登録する。
filesystem discoveryや任意JavaScriptのdynamic importは導入しない。

registry evidenceには次を含める。

- plugin ID、version、kind
- dependency edge
- declared capability
- contribution ID
- Semgrep digest
- registry digest

## 7. Python対応設計

### 7.1 `language.python`

検出条件は`.py` sourceの存在とする。`.pyi`はinventory対象に含めてもよいが、
初期analyzerの定義抽出対象からは分離し、stubをruntime entrypointと扱わない。

contributionは次を持つ。

- Python owned Semgrep ruleset
- `.py` source analyzer
- Python import reference hint
- source detection evidence

Semgrepはactiveな`language.python`のrulesetだけをmaterializeする。
rule fileがrepositoryに存在することだけでPython SAST executedとは表示しない。

### 7.2 Python source analyzer

初期analyzerは、file size/time budget内で次を抽出する。

- `import x`、`import x as y`
- `from x import y`
- `from .`、`from ..x`等のrelative import
- top-level class/function/async function
- decorator名
- `if __name__ == "__main__"` entrypoint evidence
- framework route extractionに必要なapp/router symbolの限定情報

次は明示的なlimitationとする。

- dynamic import
- `sys.path`変更
- namespace packageの完全解決
- import hook
- metaclass/decoratorの意味実行
- re-export graphの完全展開
- type inference

syntax error、encoding error、budget超過はfile単位diagnosticとし、scan全体を
成功扱いのまま黙って欠落させない。

### 7.3 Python import resolution

resolverは次の順序で候補を作る。

1. relative importの現在package基準
2. 同一package内の`module.py`
3. `package/__init__.py`
4. project root基準
5. 明示的に検出した`src/` layout基準

複数候補が一致する場合は`ambiguous`、root外は`blocked`、stdlibまたは
third-partyと判定できるabsolute importは`external`とする。

`PYTHONPATH`、virtualenv、runtime import結果を参照しない。namespace packageと
src layoutが曖昧な場合はconfidenceを下げ、diagnosticを残す。

### 7.4 `build.python-requirements`

初期のprimary inputは次に限定する。

- `requirements.txt`
- `requirements-*.txt`
- `requirements/*.txt`

OSVへ渡せる正式対象は、少なくともpackage名と`==`による固定versionを
安全に抽出できるfileとする。次を含むfileは全体を誤ってcoveredとせず、
entryまたはfile単位のlimitationを生成する。

- unpinned specifier
- range specifier
- environment marker
- `-r` / `--requirement` include
- `-c` / `--constraint`
- editable install
- URL、VCS、local path
- private index directive
- hashだけではversionを確定できないentry

coverageは初期releaseで常に`partial`とし、少なくとも次を返す。

```text
python_requirements_pinned_entries_only
dependency_resolution_not_performed
transitive_dependency_provenance_unverified
```

`pyproject.toml`、`setup.cfg`、`setup.py`、`Pipfile`、`poetry.lock`、
`uv.lock`はframework/build evidenceまたはcompanion inputとして検出してよい。
ただし、実OSV contract fixtureで入力形式と結果を検証するまで
`primaryGlobs`へ追加せず、SCA supported claimへ使わない。

`requirements*.txt`の追加・削除・内容変更はdependency diff applicabilityを
trueにする。commentや空白だけの変更を特別扱いする最適化は初期sliceでは行わない。

### 7.5 Python framework detection

単一decoratorやfile名だけでframeworkをdetectedにしない。

| Framework | 必須 evidence | confidenceを上げるevidence |
| --- | --- | --- |
| FastAPI | `fastapi` dependency/import | `FastAPI()`、`APIRouter()`、route decorator |
| Flask | `flask` dependency/import | `Flask()`、Blueprint、route decorator |
| Django | `django` dependency/import/config | `manage.py`、settings、`urlpatterns` |

dependency metadataとsource evidenceの両方があれば`high`候補、どちらか一方だけなら
`medium`以下とする。framework間で証跡が重なる場合は複数pluginをactiveにできるが、
各extractorは自分のframework resultだけを返す。

### 7.6 Python endpoint extraction

既存`extractPythonEndpoints`をframework contributionでwrapし、次を分離する。

- FastAPI contributionは`fastapi` resultだけ
- Flask contributionは`flask` resultだけ
- Django contributionは`django` resultだけ

legacy extension switchとのshadow comparisonを実施し、framework pluginが
activeでない`.py`を自動的にWeb endpoint sourceとして扱わない。

positive/negative fixtureに次を含める。

- literal pathとmethod
- multiple methods
- router/blueprint prefix
- class/module prefix
- decorator alias
- commented-out route
- string中の疑似decorator
- dynamic path/method
- Django nested `include()`の既知limitation

dynamicにしか決まらない値を推測で具体化しない。部分的にしか分からないendpointは
confidenceとlimitationを付与し、完全なrouteとして数えない。

### 7.7 Python DAST start plan

frameworkとentrypoint evidenceが十分な場合だけ、次の候補を生成する。

| Framework | Candidate |
| --- | --- |
| FastAPI | `python3 -m uvicorn <module>:<app> --host 127.0.0.1 --port <port>` |
| Flask | `python3 -m flask --app <module>:<app> run --host 127.0.0.1 --port <port>` |
| Django | `python3 manage.py runserver 127.0.0.1:<port>` |

`<module>`と`<app>`はinventory/source evidenceから単一候補に確定できる場合だけ使う。
複数候補、factoryの動的引数、独自launcherしかない場合はplanを返さない。

plannerはdependency install、virtualenv作成、migration、collectstatic、database
初期化を行わない。Djangoのstart planは`manage.py`がroot内に存在する場合だけ作る。

sandboxが未整備の期間は、plan generation testまでを合格対象とし、実行結果は
`gap`のままとする。実際のverified昇格には、sandbox内でのconsent、network deny、
loopback bind、timeout、process tree停止、target非変更の証跡が必要である。

## 8. Go対応設計

### 8.1 `language.go`

検出条件は`.go` sourceの存在とする。次を分類する。

- production source
- `_test.go`
- generated file markerを持つsource
- platform/build tag付きsource

generated fileとtest fileを黙って除外せず、inventoryへ分類を保存する。
entrypoint、endpoint、metricのどこで含めるかを明示する。

contributionは次を持つ。

- Go owned Semgrep ruleset
- `.go` source analyzer
- Go import reference hint
- source detection evidence

### 8.2 Go source analyzer

初期analyzerはbounded lexical analysisで次を抽出する。

- package名
- single/grouped import
- import alias、blank import、dot import
- type、function、method名
- `package main`と`func main()` entrypoint evidence
- `_test.go`、build tag、generated marker
- framework route抽出に必要なcallの限定情報

次はlimitationとする。

- build constraintの完全評価
- code generation
- type checking
- interface dispatch
- aliasを跨ぐ完全call graph
- cgo
- embedded filesystem内容の解析

### 8.3 Go import resolution

`go.mod`の`module` directiveをbounded parserで読み、同一module prefixのimportを
repository内pathへ解決する。

- standard library importは`runtime_builtin`相当のexternal
- module prefix外は`external_package`
- module prefix内で単一directoryに対応すれば`resolved`
- `replace`、workspace、複数moduleで曖昧なら`ambiguous`またはdiagnostic
- root外pathは`blocked`

`go list`やGo toolchainを呼ばない。nested `go.mod`は独立module boundaryとし、
親moduleからの解決を安易に横断しない。

### 8.4 `build.go-modules`

初期primary inputは`go.mod`、companion inputは`go.sum`とする。

`go.mod`にはdirect dependencyとindirect markerが存在しても、offline
`--no-resolve`で実際に証明できる範囲だけをcoverageへ反映する。初期releaseでは
次の理由で`partial`に固定する。

```text
go_mod_declared_dependencies_only
dependency_resolution_not_performed
transitive_dependency_provenance_unverified
```

`go.sum`はdownload contentのintegrity evidenceであり、完全なdependency lockではない。
したがって、次の扱いとする。

- `go.mod`変更: dependency applicability = true
- `go.sum`変更: dependency evidence changed = true
- `go.sum`変更だけで`lockStateChanged = true`にはしない
- `go.sum`だけのprojectをscannableとはしない

`replace`、`exclude`、local path、toolchain directive、workspaceをfixtureで検証し、
解決できない対象はlimitationへ残す。`go mod download`やnetwork resolutionで
不足を補わない。

### 8.5 Go framework detection

| Framework | 必須 evidence | confidenceを上げるevidence |
| --- | --- | --- |
| `net/http` | exact stdlib import | `Handle` / `HandleFunc` / `ServeMux` call |
| Gin | exact module/import evidence | `gin.Default/New`とroute method call |
| Echo | exact module/import evidence | `echo.New`とroute method call |

単なる`Get`、`Post`、`Handle`というmethod名だけではdetectedにしない。
import aliasを限定的に追跡し、同名user packageをframeworkと誤認しないnegative fixtureを
必須にする。

### 8.6 Go endpoint extraction

既存`extractGoEndpoints`をframework contributionでwrapし、framework fieldで
filterする。legacy extension switchとのshadow comparison後、active frameworkが
ない`.go`へのfallbackを削除する。

fixtureには次を含める。

- `http.HandleFunc`
- custom `ServeMux`
- Gin group prefix
- Echo group prefix
- import alias
- receiver経由router
- commented-out call
- string中の疑似route
- dynamic path/method
- unrelated同名method

### 8.7 Go DASTの扱い

初期正式対応では`startPlanners: []`とし、`dast_start`をdeclared capabilityへ
含めない。

理由は、`go run`だけではapplication固有のhost/port、configuration、database、
startup side effectを安全かつ汎用的に決定できず、module/toolchain downloadを
誘発する可能性があるためである。

後続phaseで検討する場合も、少なくとも次を別途証明する。

- `GOTOOLCHAIN=local`
- `GOPROXY=off`
- 必要に応じ`CGO_ENABLED=0`
- build/cacheのsandbox内隔離
- application固有port injection contract
- network denyとtarget非変更

これらはPhase 53のacceptance gateへ含めない。

## 9. Project structureとmodule boundary

### 9.1 Inventory classification

次をsourceとして分類する。

- `.py`
- 必要に応じ`.pyi`をstub sourceとして別分類
- `.go`

未対応、budget超過、parse failureをresourceへ落として`completed`と表示しない。
language pluginがactiveなのにanalyzer coverageがないfileはcoverage gapとする。

### 9.2 Package/module boundary

Pythonのboundary evidence候補:

- `pyproject.toml`
- `setup.cfg`
- `setup.py`
- `requirements*.txt`
- package markerの`__init__.py`
- 明示的に検出した`src/` layout

Goのboundary evidence候補:

- `go.mod`
- nested `go.mod`
- `go.work`はworkspace evidenceとして検出するが、初期resolverはpartial

manifestがroot直下にある場合もboundary metadataを失わないようにする。
既存TypeScript/Java boundary推論をregressionさせない。

### 9.3 Schema方針

project structure v2のlanguage fieldがstringで表現可能である限り、
Python/Go追加のためだけにschema versionを上げない。

legacy v1のenumがTypeScript/JavaScript中心であっても、Phase 53では大規模な
v1 migrationを行わない。v1 projectorがPython/Goを表現できない場合は、
互換projectionのlimitationを記録し、v2を正式なcapability evidenceとする。

## 10. SASTとscanner data

### 10.1 Ruleset selection

active language pluginのSemgrep contributionから、scanごとのrule manifestを
決定論的に組み立てる。

- Python projectへGo rulesを暗黙投入しない。
- Go projectへPython rulesを暗黙投入しない。
- polyglot projectでは両language pluginがactiveなら両方を使う。
- ruleset missing/digest mismatch時はstepをfailedまたはgapとし、0 finding成功にしない。

### 10.2 Fixture gate

各言語で次を用意する。

- ruleごとのvulnerable positive
- safe/fixed pair
- near-miss negative
- syntax variation
- multi-file profile fixture

既存8 ruleずつをcatalog validationへ含め、rule countとdigestをevidenceへ保存する。
findingの存在だけでなく、rule ID、file、line、severity normalization、deduplication、
report persistenceまで検証する。

## 11. Offline SCAとdependency profile

### 11.1 Input materialization

dependency providerが返すprimary/companion/exclude globだけをsandbox workspaceへcopyする。
元repositoryの相対pathを維持し、次を除外する。

- `.venv/**`、`venv/**`、`site-packages/**`
- Go module cache
- build output、temporary cache
- repository root外へのsymlink

copy対象とhash、除外理由、coverage limitationをstep evidenceへ保存する。

### 11.2 OSV実行

baselineはofflineかつno-resolveで実行する。

- vulnerability DBのnetwork updateをscan中に行わない。
- Python dependency resolverを起動しない。
- Go call analysisを有効にしない。
- OSV CLI version、database digest、input hash、command policyを記録する。

実databaseを提供できないlocal環境ではfixture schema validationまでに留め、
vulnerable/fixedを実scan済みと宣言しない。

### 11.3 Verdict

次を区別する。

- vulnerable dependency findingあり
- scan完了、検証範囲内でfindingなし
- inputなしでnot applicable
- unpinned/unsupported inputによりpartial
- databaseなし、toolなし、digest mismatchによるgap
- scanner failure

`partial`または`gap`をclean zero-findingへ変換しない。

## 12. Diff、profile、report、UI

### 12.1 Diff applicability

plugin dependency scopeから次を導出する。

- Python source変更はPython SAST/project structure applicabilityへ反映
- Go source変更はGo SAST/project structure applicabilityへ反映
- `requirements*.txt`変更はPyPI SCA applicabilityへ反映
- `go.mod`変更はGo SCA applicabilityへ反映
- `go.sum`変更はdependency evidence changeとして反映
- framework evidence file変更はendpoint/Application Model再計算へ反映

hard-coded global manifest listを追加するのではなく、active/detected pluginのscopeを
集約する。polyglot repositoryで一方の変更が他方のcoverageを誤って上書きしない。

### 12.2 Profile execution

各step resultへ少なくとも次を保存する。

- detected plugin IDsとconfidence
- applicable contribution IDs
- materialized input pathsとhash
- scanner/analyzer version
- execution status
- coverage effect
- reason/limitation codes
- registry/ruleset/database digest

### 12.3 Report/UI

pre-scan capabilityとpost-scan evidenceを分ける。

- pre-scan: detected、予測applicability、必要同意、既知limitation
- post-scan: executed、finding、coverage、failure/gap、使用digest

表示例:

```text
Python SAST: verified
Python dependency scan: partial (pinned requirements only; no resolution)
FastAPI endpoint discovery: partial
Python DAST auto-start: unavailable (sandbox required)

Go SAST: verified
Go dependency scan: partial (declared go.mod dependencies only)
Gin endpoint discovery: partial
Go DAST auto-start: unsupported
```

scanner dataがあるだけのcapabilityをpre-scanで`verified`と表示しない。

## 13. Legacy移行

### 13.1 Shadow mode

最初はlegacyとplugin経路を同一fixtureで実行し、次を比較する。

- endpoint countとnormalized endpoint identity
- dependency input set
- SAST selected rule set
- project structure file/reference/module count
- applicability reason

差分はartifactへ記録し、expected improvementとregressionを分類する。

### 13.2 Enforced mode

language/framework pluginの検出とbenchmarkがgateを満たした後、Python/Goについて
plugin経路をprimaryにする。rollback flagはPhase 52の仕組みを再利用し、
Python/Go専用の永久flagを増やさない。

### 13.3 Legacy removal

次をすべて満たした後に限り、`.py`、`.go`のlegacy extension switch fallbackを削除する。

- endpoint precision/recall gate
- mixed-language fixture
- framework未検出negative fixture
- report/profile E2E
- shadow mismatchの解消または承認済みlimitation化
- rollback手順の確認

extractor implementation自体は再利用してよい。削除対象はpluginを迂回するdispatchである。

## 14. 実装slice

各sliceを独立PR相当の大きさとし、前sliceのgateを通してから次へ進む。

### Slice 53.0: Baseline freezeとevidence

変更:

- baseline commitとworking tree状態を記録
- Phase 52 verificationを再実行
- scanner-data、catalog、Python/Go ruleset hashを再計算
- PyPI/Go fixtureとendpoint benchmarkの現状を記録
- Phase 52未完了gateをPhase 53 evidenceへ継承

成果物:

- `spec/evidence/phase-53-python-go-baseline.json`
- `.artifacts/benchmark/phase-53-capability.json`のschema

Gate:

- baseline evidenceがmachine-readable
- dirty treeまたは欠落external artifactを明記
- scanner単体能力をformal supportへ誤昇格していない

### Slice 53.1: Additive contractとfixture plugin

変更:

- ecosystemへ`PyPI`、`Go`を追加
- reference hintへ`python_import`、`go_import`を追加
- manifest/contribution consistency validation
- deterministic registry test拡張
- Python/Goを模したfixture pluginでcontractを検証

Gate:

- existing TypeScript/Java plugin testが無変更で成功
- invalid contribution/manifest pairをreject
- registry順序とdigestが複数runで一致
- plugin API v1互換をcontract testで証明

### Slice 53.2: Python language、requirements SCA、structure

変更:

- `language.python`
- `build.python-requirements`
- Python Semgrep contribution
- Python inventory/analyzer/resolver/module boundary
- dependency scope、materialization、diff applicability
- PyPI fixtureのprofile integration

Gate:

- Python Semgrep positive/fixed/negative
- pinned requirements vulnerable/fixed actual offline gate
- unpinned/include/URL/local path limitation gate
- no install、no network、no target mutation
- Python project structure golden fixture
- TypeScript/Java regression成功

### Slice 53.3: Go language、Go Modules SCA、structure

変更:

- `language.go`
- `build.go-modules`
- Go Semgrep contribution
- Go inventory/analyzer/resolver/module boundary
- `go.mod`/`go.sum` scopeとdiff semantics
- Go fixtureのprofile integration

Gate:

- Go Semgrep positive/fixed/negative
- go.mod vulnerable/fixed actual offline gate
- replace/local path/nested module limitation gate
- go.sum-only changeがlock stateを誤表示しない
- `go list`、download、call analysisを実行しない
- Go project structure golden fixture
- TypeScript/Java/Python regression成功

### Slice 53.4: Framework detectionとendpoint contribution

変更:

- FastAPI、Flask、Django plugin
- `net/http`、Gin、Echo plugin
- legacy extractorのframework contribution化
- endpoint benchmark/negative fixture拡張
- shadow comparison artifact

Gate:

- framework detection positive/negative
- Python/Go endpoint precision、recallともに0.90以上
- TypeScript/Java endpoint metricをregressionさせない
- framework未検出sourceをendpoint supportedと表示しない
- dynamic/ambiguous routeを誤ってliteral routeにしない

### Slice 53.5: Diff、profile、report、UI integration

変更:

- plugin-driven diff applicability
- profile execution evidence
- pre/post scan capability表示
- polyglot projectのaggregation
- partial/gap/unsupportedのUI表現

Gate:

- Python-only、Go-only、polyglot fixture
- source-only、manifest-only、companion-only diff fixture
- partial/gapがzero-findingへ変換されない
- API schema、persistence、UI round-trip
- Phase 52 capability display regression成功

### Slice 53.6: Python DAST start plan

変更:

- FastAPI/Flask/Django validated planner
- entrypoint/app ambiguity diagnostics
- consent、sandbox、readinessとの統合
- Go DAST unsupported claim

Gate:

- args配列とloopback bindのsnapshot
- install/network/build補完を行わない
- ambiguous projectではplanを返さない
- sandbox未整備時に
  `project_code_execution_sandbox_required`でfail closed
- target file hashが実行前後で一致
- Goにはstart plannerが登録されない

### Slice 53.7: Enforced rolloutとrelease closeout

変更:

- shadow差分の解消
- Python/Go plugin primary化
- legacy extension dispatch削除
- release evidence生成
- 計画書statusとsupport matrix更新

Gate:

- clean checkout、same commitで全gate成功
- toolbox image digest固定
- offline vulnerability DB digest固定
- registry/ruleset/catalog digest固定
- rollback rehearsal
- limitationsをrelease note/report/UIで一致させる

## 15. 主な変更file map

新規または主に変更するfileの想定は次のとおりである。実装時に責務が既存fileと
異なる場合は、無理にこのpathへ合わせずslice内で計画書を更新する。

```text
api/plugins/builtin/python/language.ts
api/plugins/builtin/python/requirements.ts
api/plugins/builtin/python/frameworks.ts
api/plugins/builtin/go/language.ts
api/plugins/builtin/go/modules.ts
api/plugins/builtin/go/frameworks.ts
api/plugins/builtin/index.ts

api/modules/project-capabilities/plugin-contract.ts
api/modules/project-capabilities/plugin-registry.ts

api/modules/static-intelligence/project-structure/analyzers/python.ts
api/modules/static-intelligence/project-structure/analyzers/go.ts
api/modules/static-intelligence/project-structure/analyzers/registry.ts
api/modules/static-intelligence/project-structure/resolution/resolver.ts
api/modules/static-intelligence/project-structure/modules/infer-modules.ts

api/modules/threat-models/endpoint-extractors/plugin-registry.ts
api/modules/threat-models/endpoint-extractors/index.ts
api/modules/threat-models/endpoint-extractors/python.ts
api/modules/threat-models/endpoint-extractors/go.ts

tests/security-capability/python/**
tests/security-capability/go/**
tests/security-capability/osv/PyPI/**
tests/security-capability/osv/Go/**
tests/security-capability/semgrep/python/**
tests/security-capability/semgrep/go/**

scripts/benchmark/endpoint-discovery.ts
scripts/verify-phase-53-capability.ts
spec/evidence/phase-53-python-go-baseline.json
```

package scriptsへ次を追加する。

```json
{
  "verify:phase-53-capability": "bun run scripts/verify-phase-53-capability.ts"
}
```

実際のscriptは内部で必要gateを順に呼び、各subcommand、digest、result、limitationを
`.artifacts/benchmark/phase-53-capability.json`へまとめる。単に既存testの終了codeを
集約するだけにしない。

## 16. Fixture matrix

### 16.1 Python

| Fixture | 必須検証 |
| --- | --- |
| minimal module | imports、function/class、module boundary |
| src layout | root/src package resolution |
| namespace/ambiguous | diagnosticとconfidence |
| pinned requirements | PyPI OSV vulnerable/fixed |
| unpinned/mixed requirements | partial coverage |
| recursive requirements | unsupported include limitation |
| FastAPI | detection、endpoint、start plan |
| Flask/Blueprint | detection、prefix、start plan |
| Django | urlpatterns、known limitation、start plan |
| non-web Python | framework false positiveなし |

### 16.2 Go

| Fixture | 必須検証 |
| --- | --- |
| single module | package/import/function/main |
| nested module | boundaryとambiguous防止 |
| go.mod vulnerable/fixed | Go OSV result |
| replace/local path | limitation、no root escape |
| go.sum-only diff | evidence change、not lock change |
| net/http | exact detectionとendpoint |
| Gin group | prefixとmethod |
| Echo group | prefixとmethod |
| unrelated router | false positiveなし |
| build tags/generated | classificationとlimitation |

### 16.3 Polyglot

少なくとも次を用意する。

- TypeScript + Python
- Java + Go
- Python + Go
- TypeScript + Java + Python + Go
- nested Python package + nested Go module

各fixtureでplugin detection、rule selection、dependency input、module boundary、
endpoint aggregation、report orderingが決定論的であることを確認する。

## 17. Acceptance criteria

Phase 53 implementation completeの条件:

1. `language.python`と`language.go`がdeterministic registryへ登録される。
2. Python/Go SASTがactive plugin rulesetを使い、positive/fixed/negative fixtureを通る。
3. pinned requirementsとgo.modのoffline OSV vulnerable/fixedを実databaseで区別する。
4. SCA coverageを`partial`として正しく保存・表示する。
5. Python/Go sourceがresource扱いではなくanalyzed sourceとして計上される。
6. import/reference/module graphがgolden fixtureと一致し、曖昧さをdiagnostic化する。
7. FastAPI、Flask、Django、`net/http`、Gin、Echoがframework plugin経由でのみ
   endpoint contributionを提供する。
8. Python/Go endpoint precision、recallが各0.90以上である。
9. Python DAST planは確実なentrypointでのみ生成し、sandboxなしでは実行しない。
10. Go DAST auto-startをunsupportedとして正直に表示する。
11. diff applicabilityがrequirements、go.mod、go.sumの意味を区別する。
12. partial、gap、unsupported、failureをclean successへ変換しない。
13. TypeScript/npm、Java/Maven/Gradle/Springの全gateがregressionなく成功する。
14. no network、no dependency install、no target mutationをtestで証明する。
15. clean checkoutの同一commitでPhase 52/53 verificationが成功する。
16. toolbox image、OSV database、registry、ruleset、catalogのdigestをrelease evidenceへ保存する。

推奨release command:

```bash
bun run verify:phase-52-capability
bun run verify:phase-53-capability
bun run scripts/benchmark/endpoint-discovery.ts
git diff --check
```

external scanner databaseまたはsandboxがない環境では、該当gateをskip成功にせず
`gap`としてartifactへ残す。

## 18. Rollback

問題が発生した場合はPhase 52のplugin rollout controlを使い、Python/Go pluginを
registryから無効化できるようにする。

- schema downgradeを必要としない。
- persisted evidenceはunknown plugin IDとして破棄せず表示可能にする。
- Python/Go plugin無効化時もTypeScript/Java scanは継続できる。
- legacy fallback削除前はshadow/legacyへ戻せる。
- legacy fallback削除後のrollbackは該当commitのrevertで行い、隠し分岐を残さない。

rollback時にも既存のPython/Go resultを0 findingへ書き換えない。plugin unavailableの
limitationを付与する。

## 19. 完了時のsupport claim

release gate通過後に許可するclaimは次に限定する。

- Python sourceに対するcurated SASTをverified fixture付きで実行できる。
- pinned `requirements*.txt`のdeclared dependencyをofflineで部分検査できる。
- Pythonの最小project structureとFastAPI/Flask/Django endpointを部分抽出できる。
- Python DASTはvalidated planとsandboxの両方を満たす場合だけ実行できる。
- Go sourceに対するcurated SASTをverified fixture付きで実行できる。
- `go.mod`のdeclared dependencyをofflineで部分検査できる。
- Goの最小project structureと`net/http`/Gin/Echo endpointを部分抽出できる。
- Go applicationの汎用DAST auto-startには対応していない。

次の表現は禁止する。

- 「Python/Go完全対応」
- 「全Python dependencyを検査」
- 「go.sumにより完全lock済み」
- 「全framework routeを検出」
- 「Go DAST対応」
- database、sandbox、digest gateなしの「verified」

Phase 53の目的は対応言語数を増やして見せることではない。追加pluginが既存coreへ
言語固有分岐を持ち込まず、実行可能範囲と未検証範囲を利用者へ正確に示すことを
完了条件とする。

## 20. 実装結果

2026-07-31にSlice 53.0から53.6のproduction path、fixture、report/UI表示、
verification artifact生成を実装した。Python/Go pluginはdeterministic registryへ
登録され、ruleset選択、dependency scope、diff applicability、project structure、
framework endpoint、Python start planがplugin contributionから導出される。

`bun run verify:phase-53-capability`はlocal gateに成功し、結果を
`.artifacts/benchmark/phase-53-capability.json`へ保存する。endpoint benchmarkは
precision/recallともに1.00、Semgrep fixtureは45 rules、offline OSV contractは
9 ecosystemでnetwork request 0を確認した。

ただしlocal環境には実offline vulnerability databaseと固定toolbox image digestが
なく、target project code execution sandboxも未整備である。このためSCA実database
gate、Python DAST実行、Slice 53.7のsame-commit clean checkoutは未達のままgapとして
artifactへ保存する。Go DAST auto-startは計画どおりunsupportedであり、plannerを
登録していない。
