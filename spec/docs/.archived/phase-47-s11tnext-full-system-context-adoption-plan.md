# Phase 47: S11tnext Full SystemContext Adoption Plan

## 1. Status

2026-07-24時点:

```text
planning: complete
implementation: complete
verification: bun run verify passed
vulnWorkbench baseline: 40a7676 feat: complete phase 46 release readiness
s11tnext initial baseline: 0.1.0 / f2cfc11
s11tnext current: 0.1.2
```

実装では7 system contextと3 user prompt context、生成Catalog pair、
role付きbinding、共通provider境界、manifestの保存/返却、
client `system` role拒否、runtime size gate、CI stale-artifact gateまでを導入した。

このPhaseは、vulnWorkbenchからLLM向けの固定SystemContextをすべて除去し、
`s11tnext`でauthoring、型生成、locale解決、安全なruntime値補間、内容識別、
監査manifestを一貫して扱うための全面移行計画である。

「全面採用」は、TOMLへ文章を移すだけでは完了としない。
すべての本番LLM callが型付き`SystemContextInvocation`から作られ、
providerへ送った内容とmanifestを同じapplication operationで扱い、
監査可能な保存先またはresponse/logへ到達することを完了条件とする。

## 2. Goals

- 本番TypeScriptからLLM向け固定SystemContextの自然言語本文を除去する。
- すべてのSystemContext keyとruntime variableを生成型で検査する。
- repository-authored指示とruntime由来データの信頼境界を明示する。
- providerへ送るSystemContextと、その`renderedHash`、locale、release identityを
  分離させない。
- prompt変更を通常のcode reviewと同じ精度でレビュー、検証、追跡できるようにする。
- Agentic Search、Chat、Finding Review、Scan Review、Report Summaryを
  1つのCatalog運用へ統合する。
- vulnWorkbenchでの実採用から見つかったs11tnextの問題を、
  package改善backlogへ具体的に還元する。

## 3. Non-goals

- dynamicなfinding bundle、scan bundle、conversation historyのTOML化。
- user message serializerの全面置換。
- UI文言の国際化。
- provider SDKそのものの置換。
- LLM出力schema、認可、tool execution policyをpromptだけで強制すること。
- s11tnextのlocal checkoutをvulnWorkbenchの恒久dependencyにすること。
- SystemContext移行と無関係なChat UIやReview UIの再設計。

## 4. Current Inventory

本番でLLMへ送られる固定SystemContextは7種類ある。

| ID | Current definition | Current call site | Runtime data | Current locale |
|---|---|---|---|---|
| agentic-search | `api/modules/agentic-search/system-context.ts` | `api/modules/agentic-search/agentic-search.service.ts`, `api/modules/agentic-search/runner.ts` | `topK`, `category`, user SystemContext | ja-JP |
| chat-search-decision | `api/modules/chat/chat.service.ts` | `api/modules/chat/chat.service.ts` | none | en-US |
| chat-direct-answer | `api/modules/chat/chat.service.ts` | `api/modules/chat/chat.service.ts` | none | en-US |
| chat-grounded-answer | `api/modules/chat/chat.service.ts` | `api/modules/chat/chat.service.ts` | retrieved local context | en-US |
| finding-review | `api/modules/reviews/finding-review-prompt.ts` | `api/modules/reviews/finding-review-runner.ts` | none in system message | ja-JP |
| scan-review | `api/modules/scans/scan-review-prompt.ts` | `api/modules/scans/scan-review-runner.ts` | none in system message | ja-JP |
| report-summary | `api/modules/scans/report-summary-prompt.ts` | `api/modules/scans/report-summary-runner.ts` | none in system message | ja-JP |

SystemContext以外のdynamic prompt assembly:

- finding evidence bundleは`buildUserMessage()`が組み立てる。
- scan bundleは`buildScanReviewUserMessage()`がJSON化する。
- report summary bundleは`buildReportSummaryUserMessage()`がJSON化する。
- conversation historyはChat request messageとして渡される。
- Agentic SearchのquestionはResponses APIのuser inputとして渡される。

これらは今回のTOML移行対象外だが、SystemContextの後段から
`system` roleを注入できないことは移行完了条件に含める。

## 5. Security and Correctness Findings

### 5.1 Client-controlled system role

`shared/schemas/rag.schema.ts`のChat requestは
`system | user | assistant`を受け入れる。
ChatServiceはapplication-owned system messageの後ろにclient messagesを連結するため、
API clientは追加の`system` roleをproviderへ渡せる。

S11tnextで先頭SystemContextを保護しても、この経路を残すと境界は閉じない。

固定方針:

- external Chat APIは`user | assistant`だけを受理する。
- provider内部型とclient request型を分離する。
- ChatServiceでもdefense in depthとして`system` roleを拒否する。
- 既存DBに`role = 'system'`が存在する場合、削除せずprovider inputから除外し、
  件数をmigration evidenceへ記録する。

### 5.2 Unbounded runtime SystemContext

`UpdateSystemContextSchema`は長さ制限のない`z.string()`である。
`category`にも実用上の長さ上限がなく、Chatのretrieved local contextにも
全体文字数上限がない。

S11tnext 0.1.0はruntime variableのtypeだけを検査し、
文字数、byte数、数値範囲、JSON depth、最終render長を制限しない。

移行時のhost-side固定値:

```text
user SystemContext: max 16,000 UTF-16 code units
category: max 128 UTF-16 code units
chat local context: max 50,000 UTF-16 code units
rendered SystemContext: max 64,000 UTF-16 code units
```

上限超過は切り詰めず、保存時またはprovider call前にfail closedとする。
retrieval contextだけは、fragment boundaryを保ったbudget-aware selectionへ変更し、
文字列の途中切断を避ける。

### 5.3 Provider abstraction discards identity

現在の`LlmProvider.chatCompletion(messages, options)`はraw string messageだけを受け取る。
S11tnext invocationをcall siteで作っても、manifestをprovider executionと
同じ型境界で運べない。

固定方針:

- 既存provider interfaceのwire-format責務は維持する。
- その上にapplication-owned `executeLlmCompletion()`を追加する。
- executorは`SystemContextInvocation`と`user | assistant` messagesを受け取り、
  rendered hashを検証してからsystem messageを先頭に1件だけ生成する。
- executorはprovider responseとmanifestを同時に返す。
- 本番moduleからの`LlmProvider.chatCompletion()`直接呼び出しを禁止する。

Codex SDK providerはrole別APIを持たずmessageを1本のMarkdownへ変換している。
このlaneではS11tnext textが`### SYSTEM`の先頭blockに入ることをtestで固定する。
Azure/OpenAI-compatible laneではnative `system` roleの先頭messageとして送る。

## 6. Fixed Adoption Decisions

### 6.1 Package and versioning

- 初期実装は`"s11tnext": "0.1.0"`をexact dependencyにする。
- CLIは`"s11tnext-cli": "0.1.0"`をexact devDependencyにする。
- RuntimeとCLIは常に同じexact versionへ更新する。
- `workspace:`, `file:`, absolute path dependencyはmain branchで使用しない。
- package側修正が必要ならnpmへpatch/minorを公開し、公開tarball consumerとして検証する。

### 6.2 Catalog ownership

```toml
[keyspaces.agenticSearch]
owner = "knowledge-workspace"

[keyspaces.chat]
owner = "knowledge-workspace"

[keyspaces.reviews]
owner = "security-review"

[keyspaces.scans]
owner = "security-review"
```

source localeは`ja-JP`とする。
既存Chatの英語挙動を維持するためChat contextだけ`en-US` translationを持たせ、
Chat callは`en-US`をfallbackなしでbindする。
その他は`ja-JP`をfallbackなしでbindする。

s11tnext 0.1.0ではrelease profileのrequired localeをkeyspace別に指定できないため、
production profileは`["$source"]`とし、
Chatの`en-US`必須性はconsumer testで補完する。

### 6.3 Runtime trust classification

| Value | Classification | Encoding | Reason |
|---|---|---|---|
| `topK` | untrusted number | delimited + `json-value` | request由来。数値型を維持する |
| `category` | untrusted string | delimited + `json-string` | request由来 |
| user SystemContext | untrusted string | delimited + `json-string` | user-authoredだがSystemContext権限を持つoverlay |
| retrieved local context | untrusted string | delimited + `json-string` | repository/document/tool由来 |
| repository-authored fixed text | authored literal | no runtime variable | review済みsource |

user SystemContextはinstructionとして意図的に権限を持つが、
raw interpolationしてよいという意味ではない。
`untrusted`分類はauthorizationではなく、補間時の構造安全性を表すものとして扱う。

### 6.4 Catalog loading

- `.s11tnext/catalog.json`と`.s11tnext/catalog.generated.ts`を両方commitする。
- serverではstatic JSON importを使用し、filesystem相対pathへ依存しない。
- `tsconfig.json`へ`resolveJsonModule`を追加する。
- application startup時に`createAppCatalog()`を1回だけ実行し、
  digest不整合は起動失敗とする。
- runtimeでTOMLやsource contextを読まない。

### 6.5 Invocation API

provider pathでは`catalog.bind()`だけを使用する。
`bindText()`と`createTextRenderer()`はmanifestを失うため使用禁止とする。

0.1.0の`bindRequest()`はrender traceを作れるが、
rendered fragmentがfinal promptに含まれたことを証明しない。
今回の7 contextは1 provider callにつき1 final contextへ平坦化し、
prompt composition用途には使用しない。

## 7. Target Files

```text
s11tnext.config.toml
contexts/
  agenticSearch/
    system.context.toml
  chat/
    searchDecision.context.toml
    directAnswer.context.toml
    groundedAnswer.context.toml
  reviews/
    findingReview.context.toml
  scans/
    scanReview.context.toml
    reportSummary.context.toml
.s11tnext/
  catalog.json
  catalog.generated.ts
api/system-context/
  catalog.ts
  bindings.ts
  llm-execution.ts
  audit.ts
  catalog.test.ts
  llm-execution.test.ts
```

削除対象:

```text
api/modules/agentic-search/system-context.ts
api/modules/agentic-search/system-context.test.ts
```

次のprompt fileはuser message serializerだけを残す。

```text
api/modules/reviews/finding-review-prompt.ts
api/modules/scans/scan-review-prompt.ts
api/modules/scans/report-summary-prompt.ts
```

`api/modules/chat/chat.service.ts`内の3つのsystem prompt builderは削除する。

## 8. Catalog Design

### 8.1 `agenticSearch.system`

Sections:

```text
role.identity             instruction / must / prompt
retrieval.default-policy  tool-contract / must / prompt
retrieval.evidence-policy tool-contract / must / prompt
answer.language-policy    instruction / must / prompt
answer.citation-policy    instruction / must / prompt
answer.style-policy       instruction / should / prompt
retrieval.runtime-facts   runtime-fact / should / prompt
user.system-overlay       overlay / should / prompt
```

Variables:

```text
topK: number
category: string
userSystemContext: string
```

0.1.0にはoptional variable/conditional sectionがないため、
空のuser SystemContextでも空文字を持つdelimited blockを出力する。
この差分はgolden testとcanaryで明示的に承認する。

### 8.2 `chat.searchDecision`

Sections:

```text
decision.role
decision.default
decision.search-required-cases
decision.query-contract
decision.output-contract
```

既存英語文を`en-US` translationとして保持する。
source textとして意味等価な日本語を持つ。

### 8.3 `chat.directAnswer`

Sections:

```text
answer.role
answer.no-retrieval
answer.uncertainty-policy
answer.artifact-contract
answer.style-policy
```

既存英語文を`en-US` translationとして保持する。

### 8.4 `chat.groundedAnswer`

Sections:

```text
answer.role
answer.evidence-policy
answer.citation-policy
answer.artifact-contract
answer.style-policy
evidence.local-context
```

Variable:

```text
localContext: untrusted string
```

retrieved Markdownはinstruction本文と同じtrust levelにしない。
S11tnext delimiterとJSON encodingによる表現変更を意図したsecurity差分として扱う。

### 8.5 `reviews.findingReview`

Sections:

```text
review.role
review.evidence-boundary
review.language-policy
review.output-envelope
review.output-contract
review.enum-contract
```

system context内のJSON exampleは初回移行では保持し、挙動を変えない。
provider `outputSchema`とZod schemaとの重複は別sliceで解消可否を判断する。

### 8.6 `scans.scanReview`

Sections:

```text
review.role
review.language-policy
review.evidence-boundary
review.decision-boundary
review.grouping-policy
review.handoff-policy
review.filtered-scope-policy
review.zero-finding-policy
review.output-envelope
review.output-contract
review.enum-contract
```

既存の長いJSON exampleを1 sectionへ押し込まず、
意味単位に分割してreview diffを読みやすくする。

### 8.7 `scans.reportSummary`

Sections:

```text
summary.role
summary.language-policy
summary.evidence-boundary
summary.output-envelope
summary.output-contract
```

## 9. Application Integration

### 9.1 Catalog module

`api/system-context/catalog.ts`は次だけを担当する。

- generated artifactのstatic import。
- `createAppCatalog()`によるstartup validation。
- typed catalog singletonのexport。
- production binding keyの定数化。

自然言語本文、fallback判断、provider callは持たない。

### 9.2 LLM executor

概念interface:

```ts
type ApplicationChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ExecutedLlmCompletion = {
  response: LlmResponse;
  systemContextManifest: SystemContextInvocation["manifest"];
};

executeLlmCompletion({
  provider,
  systemContext,
  messages,
  options,
}): Promise<ExecutedLlmCompletion>;
```

executorの責務:

1. `verifyRenderedHash()`でtextとmanifestの対応を検証する。
2. rendered textの64,000文字上限を検査する。
3. client/application messagesに`system` roleがないことを検査する。
4. provider wire messageの先頭にsystem messageを1件だけ追加する。
5. provider responseとmanifestを同時に返す。

### 9.3 Agentic Search

Responses API laneは既存の`instructions` fieldを維持する。
`AgenticSearchRequest.systemContext: string`は
`systemContext: SystemContextInvocation`へ変更するか、
Runnerの引数を`instructions`とmanifestのpair型へ変更する。

Runnerはprovider call直前にrendered hashを検証する。
Agentic resultにはcontentを含まないmanifestを追加し、
route completion logへ`key`, `catalogDigest`, `renderedHash`,
`resolvedLocale`を記録する。

### 9.4 Audit persistence

| Flow | Persistence |
|---|---|
| Chat | assistant message `metadata.systemContexts[]` |
| Chat retrieval | `retrievalLogs.context.systemContexts[]` |
| Finding Review | `finding_reviews.output.systemContext` |
| Scan Review | `scan_reviews.output.systemContext` |
| Report Summary | returned build metadata and report artifact metadata |
| Agentic Search | API result manifest + structured completion log |

manifestにはruntime値とrendered textを追加しない。
user SystemContext、retrieved context、bundle本文を新しい監査fieldへ複製しない。

## 10. Implementation Slices

### Slice 0: Baseline and Golden Fixtures

Priority: P0

Changes:

- 7つの現行SystemContext outputをtest fixtureとして保存する。
- runtime値を持つ2 contextは通常値、空値、境界攻撃文字列を保存する。
- current test、typecheck、build結果をPhase 47 evidenceへ保存する。
- DB内`messages.role = 'system'`件数をread-onlyで記録する。

Acceptance:

- すべての本番SystemContext call siteがinventoryに対応する。
- fixtureにsecret、absolute path、実データを含めない。
- baseline failureがある場合、移行failureと混同しない。

Verification:

```bash
git status --short
git rev-parse HEAD
bun run typecheck
bun run test
bun run build
rg -n 'role: "system"|instructions:|SystemPrompt|SystemContext' api shared web
```

### Slice 1: Package and Authoring Foundation

Priority: P0

Changes:

- exact Runtime/CLI dependenciesを追加する。
- `s11tnext.config.toml`、7つのcontext source、生成物を追加する。
- package scriptsを追加する。

```json
{
  "s11tnext:lint": "s11tnext lint --release-profile production",
  "s11tnext:build": "s11tnext build --release-profile production",
  "s11tnext:check": "s11tnext build --check --release-profile production"
}
```

- `scripts/verify.ts`でtypecheckより前に`bun run s11tnext:check`を実行する。

Acceptance:

- 7 keyが生成型へ現れる。
- Runtime/CLI versionが一致する。
- generated pairの片方だけを変更するとcheckが失敗する。
- clean checkoutから生成結果が一致する。

Verification:

```bash
bun run s11tnext:lint
bun run s11tnext:build
bun run s11tnext:check
bun run typecheck
git diff --exit-code -- .s11tnext
```

### Slice 2: Typed Catalog and Provider Executor

Priority: P0

Changes:

- Catalog singleton、locale binding、LLM executorを追加する。
- client message型とprovider message型を分離する。
- executorのhash、ordering、size、role boundary testを追加する。
- provider mock helperをexecutor経由へ更新する。

Acceptance:

- system messageは常に先頭1件。
- hash不一致、system role混入、size超過はprovider call前に失敗する。
- manifestがprovider responseと同じreturn valueに含まれる。
- provider implementationはs11tnext packageへ直接依存しない。

### Slice 3: Agentic Search Migration

Priority: P0

Changes:

- `buildAgenticSystemContext()`をCatalog invocationへ置換する。
- user SystemContextとruntime factsをuntrusted variableにする。
- settings APIへ16,000文字上限を追加する。
- categoryへ128文字上限を追加する。
- manifestをresult/logへ伝播する。
- legacy builderとtestを削除する。

Acceptance:

- fixed instruction本文がAgentic TypeScriptから消える。
- delimiter closing sequenceがescapedになる。
- empty overlay差分がfixtureで承認される。
- Agentic tool behaviorとcitation testが回帰しない。

### Slice 4: Chat Migration and Role Boundary Closure

Priority: P0

Changes:

- 3つのChat system builderをCatalogへ置換する。
- search decision callとfinal answer callをそれぞれ個別manifestで記録する。
- external schemaを`user | assistant`へ制限する。
- ChatServiceでもsystem roleを拒否する。
- local contextへ50,000文字budgetを適用する。
- assistant message/retrieval logへmanifest配列を保存する。

Acceptance:

- APIからsystem roleを送ると400になる。
- system roleをserviceへ直接渡してもproviderは呼ばれない。
- searchなし、direct answer、local searchの全laneで正しいkeyが記録される。
- `en-US`がdirect matchし、fallbackを使用しない。
- untrusted local contextがdelimiterを閉じられない。

### Slice 5: Finding Review Migration

Priority: P1

Changes:

- fixed system promptを`reviews.findingReview`へ移す。
- user message serializerは維持する。
- routed provider callをexecutor経由にする。
- completed review outputへmanifestを保存する。
- failed reviewも可能な範囲でkey/digestをerror metadataへ残す。

Acceptance:

- existing structured output、Japanese validation、fixture laneが維持される。
- fixture-only laneはproviderを呼ばず、架空manifestを作らない。
- provider laneだけに実際のmanifestが保存される。

### Slice 6: Scan Review Migration

Priority: P1

Changes:

- fixed system promptを`scans.scanReview`へ移す。
- user bundle serializerは維持する。
- provider callとreview outputへmanifestを伝播する。
- zero-finding、filtered finding、fixture laneを回帰testする。

Acceptance:

- grouping、handoff、zero-finding policyがgolden fixtureと意味等価。
- output schema parseとJapanese validationが維持される。
- fixture laneに架空manifestを付けない。

### Slice 7: Report Summary Migration

Priority: P1

Changes:

- fixed system promptを`scans.reportSummary`へ移す。
- provider callをexecutor経由にする。
- report build result、artifact metadata、CLI/Web response metadataへmanifestを伝播する。

Acceptance:

- deterministic-only modeはCatalogをrenderしない。
- LLM summary modeだけがmanifestを持つ。
- Markdown本文へmanifest JSONを埋め込まない。

### Slice 8: Remove Legacy Paths and Enforce Full Adoption

Priority: P0

Changes:

- legacy builder、unused import、互換wrapperを削除する。
- production codeでのdirect `LlmProvider.chatCompletion()`をlint/check scriptで禁止する。
- production codeのliteral system messageをrepository checkで禁止する。
- README、architecture map、release runbookを更新する。
- full verificationとrepresentative provider canaryを実行する。

Acceptance:

```text
production fixed SystemContext in TypeScript: 0
production direct LlmProvider.chatCompletion call outside executor: 0
client-controlled system role: 0
Catalog keys: 7
LLM provider calls without manifest or explicit fixture bypass: 0
stale generated artifacts: 0
```

Verification:

```bash
bun run s11tnext:check
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run build
bun run verify
rg -n 'role: "system"' api/modules api/routes api/cli api/app -g '!*.test.ts'
rg -n '\\.chatCompletion\\(' api/modules api/routes api/cli api/app -g '!*.test.ts'
rg -n 'build[A-Za-z]*SystemPrompt|buildAgenticSystemContext' api/modules api/routes api/cli api/app -g '!*.test.ts'
```

## 11. Behavioral Validation

同一model/providerで次をbaseline/treatment比較する。

| Scenario | Primary checks |
|---|---|
| Agentic general knowledge | tool call 0、answer language |
| Agentic local fact | search_evidence first、citation validity |
| Agentic malicious overlay delimiter | boundary remains closed |
| Chat direct answer | search decision false、final text quality |
| Chat local context | selected evidence use、citation behavior |
| Finding review | schema parse、Japanese fields |
| Scan review with findings | grouping、handoff completeness |
| Scan review zero findings | no false safety claim |
| Report summary | schema parse、Markdown insertion |

動的contextを安全にencodeするため、byte-for-byte同一は要求しない。
次は意図した差分として扱う。

- trailing newline。
- S11tnext delimiter。
- JSON encoding。
- empty optional overlayの空block。
- manifest metadata追加。

それ以外のinstruction欠落、enum変更、output schema drift、locale fallbackは回帰とする。

## 12. Rollback

- 各sliceは1 flow単位でmerge可能にする。
- runtime failure時にTOML sourceを読むfallbackは実装しない。
- generated artifact invalid時は起動を継続しない。
- rollbackは該当sliceのcommit revertとし、旧/new builderの長期feature flagは持たない。
- package regressionの場合はRuntime/CLIを同じ既知versionへ戻し、
  そのversionでgenerated pairを再生成する。
- manifest field追加は既存JSON metadata内で行い、rollbackのためのDB migrationを不要にする。

## 13. Historical S11tnext 0.1.0 Product Feedback

以下は実採用の観点からの率直な評価である。
0.1.0は「小さな静的Catalogを安全にrenderする」用途にはよくできているが、
全面採用のauthoring、composition、policy、operationsまでを
一貫して快適にするには不足がある。

0.1.2では、message role、artifact v2、message hash、optional/conditional
authoring、`delimited-text`、keyspace-scoped locale、section profile、
composition receipt、README/release hygieneが実装され、以下の主要指摘は解消した。
このsectionは0.1.0採用時の検証記録として残す。

### 13.1 High priority

| Problem | Why it matters | Current workaround | Suggested improvement |
|---|---|---|---|
| optional variable/conditional sectionがない | 空overlay、任意context、feature-dependent instructionで空blockか重複keyが必要 | 空blockを許容 | optional variable、`omit_if_empty`、決定的なconditional section |
| runtime値のsize/range制約がない | untrusted値でtoken/cost/DoS budgetを破れる | host側Zodとrender上限 | `max_length`, `max_bytes`, number range, JSON depth/size |
| multiline untrusted textを可読なまま安全に補間できない | `json-string`は改行を`\n`へ変換するため、retrieved Markdownや長いuser contextの構造とLLM可読性が落ちる | delimiter内のJSON stringを受け入れ、grounding品質をcanary監視 | delimiter終端だけをescapeし改行を保持する`delimited-text` encoding、またはlength-prefixed text |
| locale requirementがCatalog全体に一律 | Chatだけen-US必須、Reviewはja-JP必須を表現できない | consumer test | release profileにkeyspace/context override |
| compositionでprovenance/taintが消える | `bindRequest.p()`はstringを返し、別contextへ渡すと由来とtrustを失う | final contextを1枚に平坦化 | typed rendered fragmentとprovenance-aware composition |
| `RequestAudit`はprovider送信内容を証明しない | render traceが最終promptへの包含を証明せず、監査訴求より弱い | host executorでfinal hash検証 | provider submission envelope、final composite hash API |
| `enforcement = schema/host`は実際には強制しない | field名がsecurity guaranteeに見え、誤用しやすい |すべてprompt扱いしhost testを別途持つ | documentation上でmetadataと明記、schema/host digest linkageまたは名称変更 |

特に`enforcement`は現状のままだと誤解を招く。
Runtimeはsection metadataを保持して連結するだけで、
schemaやhost policyとの対応を検証しない。
「enforcement」という名前を使うなら、実体とのlinkが必要である。

### 13.2 Medium priority

| Problem | Impact | Suggested improvement |
|---|---|---|
| `trust`が補間安全性とinstruction authorityを混同しやすい | user-authored SystemContextの分類が直感に反する | `interpolation_trust`への明確化、別`authority/origin` metadata |
| section metadataが毎回必須で冗長 | 長いpromptを分割するとTOML boilerplateが大きい | section defaults/profiles |
| `optimizable`にRuntime上のconsumerがない | required fieldなのに意味が観測できない | optional化、optimizer contract、inspectでの利用 |
| semantic diff commandがない | generated JSON diffではprompt reviewしづらい | `s11tnext diff`でkey/section/locale/digest差分表示 |
| watch modeがない | authoring loopが手動build依存 | `s11tnext build --watch` |
| artifact loadingが手動かつ2-file pair | Bun/Vite/Nodeでimport方法が分かれ、deploy漏れが起きる | output strategyまたはgenerated loader、各runtime recipe |
| section単位のpartial translation不可 | 大きいcontextの翻訳rolloutがall-or-nothing | policyで許可するpartial coverage mode |

### 13.3 Immediate release hygiene

- npm 0.1.0公開後もroot/runtime/CLI READMEが
  「npm registryから利用できない」と記載している。
- package publish成功とdocumentation stateが同じrelease gateで検証されていない。
- Bun/browser-compatibleを訴求する一方、Bun consumer fixtureと明示的support policyがない。

改善案:

1. publish workflowでregistry verification後にREADMEのstale release markerを検査する。
2. `examples/bun-basic`とisolated Bun consumer testを追加する。
3. Node/Bun/Viteごとのartifact loading例を追加する。
4. npm tarball READMEをpublish前にregistry-ready wordingで検査する。

### 13.4 Findings confirmed by this implementation

- Bun 1.3.14上でRuntimeのstatic JSON import、typed factory、hash verificationは動作した。
- CLIのlint/build/checkとatomicな2-file生成は速く、導入自体は素直だった。
- 7 contextをsectionへ分割すると、必須の
  `kind/severity/enforcement/optimizable`がかなりのboilerplateになる。
- `json-string`でmultiline Markdownをrenderすると、実際に改行が`\n`へescapeされた。
  安全性は上がるが、既存promptの見た目と意味表現は同値ではない。
- `enforcement = "schema"`は、hostが別途`outputSchema`を渡して初めて実体を持つ。
  今回はFinding/Scan/Reportで明示的にlinkしたが、Catalog側は対応を検証できない。
- `production.required_locales = ["$source"]`のままChatだけen-USを持たせられるが、
  Chatのen-US欠落をrelease policyとして強制できずconsumer testが必要だった。

## 14. Package Improvement Sequencing

vulnWorkbenchの全面採用を止めず、workaroundを局所化する。

```text
s11tnext 0.1.x
  - README/release hygiene
  - Bun consumer verification
  - documentation clarification

s11tnext 0.1.2 adopted
  - role-aware PromptInvocation
  - artifact v2 and message hash
  - optional/conditional authoring
  - delimited-text
  - scoped locale requirements
  - section profiles
  - enforcement semantics correction
  - composition receipts

later minor
  - runtime size/range constraints
  - provenance-aware composition
  - semantic diff/watch/loader ergonomics
```

schema/artifact shapeを変える改善は、明示的な互換性例外として0.1.2へまとめ、
Runtime/CLI/generated artifactsを同時に更新する。
vulnWorkbenchで先行実験する場合も、main branchへlocal package pathを残さない。

## 15. Definition of Done

Phase 47は次をすべて満たしたときだけ完了とする。

1. 7つのsystem contextと3つのuser prompt contextが`.context.toml`に存在する。
2. 生成型以外のstring keyでCatalogを呼んでいない。
3. 本番TypeScriptに固定system/user prompt本文が残っていない。
4. providerへ送るauthored messageはすべて`PromptInvocation`由来である。
5. provider callごとのprompt manifestが保存、response、またはstructured logへ到達する。
6. external Chat APIはsystem roleを受理しない。
7. untrusted runtime値にdelimiter/raw bypassがない。
8. runtime値とrendered textのbudget gateがある。
9. Runtime/CLI versionが一致し、generated pairがcurrentである。
10. full verifyとrepresentative canaryがpassする。
11. s11tnext product feedbackがissueまたはrelease backlogとして追跡可能になっている。
