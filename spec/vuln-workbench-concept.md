# vulnWorkbench Concept

Cross-projectのSecurity Intelligence循環と、vulnWorkbench / NightWorkers / contextStill / Project Declarationの責務境界は、[Security Intelligence Integration Concept](security-intelligence-integration-concept.md)を参照する。

vulnWorkbench側の最初の実装順序とPR境界は、[Security Intelligence Initial Implementation Roadmap](security-intelligence-initial-implementation-roadmap.md)を参照する。

## Purpose

vulnWorkbench は、既存のセキュリティCLIツールが生成した診断結果を、証跡制約付きLLMが評価し、統合診断結果と実装可能なレポートへ自動変換するローカル脆弱性診断ワークベンチである。

このプロジェクトの中心は、LLMにソースコードを逐次探索させて脆弱性を探させることではない。重い診断、網羅的な探索、証拠生成はCLIコマンドとその実行環境が担当する。LLMは、その結果を読み、誤検知の可能性、影響、修正方針、レビュー観点を整理する。

後続の実装計画は、この文書を前提にして作る。ここでは実装手順ではなく、MVPで守るべきプロダクト境界、責務分担、非目標、完了判定の考え方を定義する。

## Core Principle

基本フローは次の通り。

```text
CLI scan command
  -> raw artifacts / logs / SARIF / JSON
  -> deterministic parser / normalizer
  -> findings / evidence store
  -> deterministic consolidated report
  -> evidence-constrained LLM criticality review
  -> final report / implementation handoff
```

LLMは診断の実行主体ではなく、レビュー主体である。

```text
CLI tools = evidence generation
Normalizer = deterministic interpretation
LLM = evidence-constrained review, explanation, prioritization
Server policy = authorization, credentials, network and resource boundaries
```

この分離により、診断結果の根拠をLLMの推測ではなく、再実行可能なCLI出力に置く。

## Product Shape

MVPのユーザー体験は、次の一連の流れとして成立させる。

```text
1. ユーザーがローカルrepoを登録する
2. ユーザーがscan profileを選ぶ
3. vulnWorkbenchがCLI scanを実行する
4. raw artifactとログを保存する
5. deterministic normalizerがfindingとevidenceを作る
6. deterministic reportを自動生成する
7. LLMが保存済み証跡だけからfinding単位・scan単位のcriticalityを評価する
8. UIがfinding、evidence、LLM review、raw artifact、limitationを表示する
9. 統合Markdown reportとimplementation handoffを自動出力する
```

Web UIは、診断を始めるための操作面であり、結果をレビューするための画面である。診断の重い処理をWeb UIやLLMの逐次対話に閉じ込めない。

## CLI-First Scan Model

重い診断タスクはCLIコマンドとして表現する。

MVPで扱うCLI scanは、次の性質を持つ。

- 入力は対象repo、scan profile、出力ディレクトリ、必要な制限値である。
- 出力はraw artifact、ログ、tool metadata、終了状態である。
- 実行結果は再読込できる形で永続化する。
- CLIの終了コードだけでなく、toolごとの結果とartifactを保存する。
- LLM reviewが失敗しても、CLI scan結果、normalized finding、deterministic reportは残り、`ready_with_limitations`として完了する。

MVPでは、CLI scanをWeb APIから起動してもよい。ただし、概念上の主語はAPIではなくCLI scan commandである。将来的にCIや手動CLIから同じscanを実行できる形にできることを前提にする。

## Tool Scope

MVPの証拠生成は、既存OSSツールに任せる。

優先対象は次の通り。

- Semgrep: 静的解析、危険パターン、SARIF/JSON出力
- Gitleaks: secret検出
- OSV-Scanner: lockfile / manifest ベースの依存脆弱性
- Trivy: filesystem、dependency、IaC、secret補助

これらのツールは、vulnWorkbenchの内部ロジックで置き換えない。vulnWorkbenchが実装するのは、実行制御、artifact保存、正規化、自動診断、レポート、表示である。

## LLM Review Model

LLMに許可する役割は、CLI結果のレビューである。

LLM reviewの入力は、原則として次に限定する。

- normalized finding
- raw artifactへの参照
- tool名、tool version、scan profile
- 該当file/lineから決定的に抽出したsource snippet
- manifestや設定ファイルの必要最小限の抜粋
- 同一scan内の関連finding
- 必要に応じたCWE、CVE、公開情報の要約

LLM reviewの出力は、schema validation可能な構造化データにする。

例:

```text
- summary
- likelyImpact
- falsePositiveAssessment
- evidenceStrength
- remediationDirection
- reviewerNotes
- confidenceAdjustment
- evidenceRefs
- assumptions
- unknowns
- implementationHandoff
```

LLMに許可しない役割は、repoを自由に巡回して脆弱性を探索することである。LLMは任意pathを読みながら「怪しい箇所探し」をしない。必要なsource snippetは、finding locationやscan artifactからdeterministicに抽出されたものだけを渡す。

LLMはactive scanの許可、認証情報の選択・復号、target scopeの拡張、network policy、request budget、container resource limitを判断しない。これらはserver側のfail-closedな契約で決定する。

## Evidence Model

findingは必ずevidenceに紐づく。

MVPでのevidenceは、少なくとも次を表現できる必要がある。

- tool-output: CLI toolが出したraw result
- source-location: file path、line、column、snippet
- scan-log: 実行ログ、stderr、stdout、exit code
- llm-review: LLMがfindingをどうレビューしたか
- report-section: Markdown reportへ出した要約

LLM reviewはevidenceの一種ではあるが、一次証拠ではない。一次証拠はCLI output、source location、実行ログである。

## Confidence Model

severityとconfidenceは分ける。

```text
severity = 影響の大きさ
confidence = 証拠の強さ
```

confidenceは一次証拠と検証種別から導出し、scanner severityやLLM criticalityと分ける。

```text
static:
  1つ以上のCLI toolが検出した状態

reviewed:
  static findingをLLMがレビューし、説明と注意点が付いた状態

observed:
  scanner recheckまたは安全なruntime observationで現象を確認した状態

reproduced:
  明示的に許可されたlabで影響を再現した状態
```

人間のDecision recordは任意の互換・監査注釈であり、診断・review・report・retry・exportの完了条件に含めない。

## RAG Position

RAGはMVPの主役ではない。

MVPにおける検索やcontext生成は、findingに紐づく範囲へ限定する。LLMが広範囲のrepo探索をするためのRAGではなく、CLI結果をレビューするためのevidence bundleを作る補助として扱う。

具体的には、finding locationから周辺snippetを取り出す、依存脆弱性に関係するmanifest抜粋を添える、secret findingの周辺文脈をredacted状態で添える、といった使い方に限定する。

既存のMarkdown knowledge RAGは、プロジェクトコード診断とは別物として扱う。コード、tool artifact、finding、過去レビューを同じ検索空間に混ぜる場合は、明示的なkindとproject境界を持たせる。

## Security Boundary

vulnWorkbenchは未信頼コードを扱うため、MVPでも次の境界を守る。

- LLM API keyはhost側にのみ置く。
- scan対象repoにsecretを注入しない。
- tool実行環境へLLM API keyを渡さない。
- Docker socketをtool containerへ渡さない。
- raw artifactは保存するが、LLMへ送る前に必要最小限へ絞る。
- secret findingの値は原則redactして表示、保存、LLM reviewする。
- DAST credentialはencrypted auth contextとして保存し、送信直前にだけ復号する。
- public / production targetへのactive scanはfail-closedにする。
- state-changing scanはlocal / ephemeral / staging、Rules of Engagement、method/path/request budget、seed/cleanup contractをすべて満たす場合に限る。
- 対象repoを変更する処理はMVP対象外にする。

## MVP Scope

MVPで成立させる最小のプロダクト価値は次の通り。

```text
ローカルrepoに対してCLI scanを実行し、
再実行可能なartifactを保存し、
deterministicにfindingへ正規化し、
deterministic reportと証跡制約付きLLM評価を自動生成し、
統合診断結果とimplementation handoffを出力できる。
```

MVPに含めるもの。

- local project registration
- scan profile selection
- CLI scan execution
- raw artifact and log storage
- normalized finding model
- evidence model
- finding list and detail UI
- automatic LLM review for existing findings
- automatic deterministic and assessed report generation
- optional compatibility decision annotations
- authenticated read-only DAST

MVPに含めないもの。

- LLMによる自由探索型の脆弱性発見
- LLMによる任意path読取と逐次ソースレビュー
- exploit生成
- patch自動適用
- sandboxでの再現確認
- public / production active DAST
- unrestricted fuzzing
- user supplied browser / shell scripts
- CI統合
- multi-tenant SaaS
- 外部target scan

## Implementation Planning Anchors

後続の実装計画は、次の順序を前提に分解する。

```text
1. scan domain model
2. CLI scan command contract
3. artifact storage contract
4. deterministic parser / normalizer
5. findings and evidence API
6. Web UI review surfaces
7. deterministic report runner
8. evidence-constrained LLM review schema and runner
9. automatic diagnostic orchestration and retry
10. end-to-end fixture scan
```

各ステップは、LLM reviewより前にCLI outputとnormalized findingが独立して確認できることを完了条件にする。

LLMが未設定でも、scan、artifact保存、normalization、finding表示、deterministic report生成は動く必要がある。LLM reviewは価値を追加する後段処理であり、失敗時は明示的なlimitationを保存する。

## Verification

このコンセプト文書を前提にした実装計画は、次を満たす必要がある。

- CLIが証拠生成の主体になっている。
- LLMが探索主体ではなくレビュー主体になっている。
- raw artifactが保存され、後から再確認できる。
- normalized findingがLLMなしで生成される。
- LLM reviewが失敗しても一次証拠とfindingが失われない。
- scan完了後に人間のDecisionなしでdeterministic reportとLLM reviewが開始される。
- LLMが失敗してもdeterministic reportが`ready_with_limitations`で完了する。
- Web UIがLLM出力だけでなく、tool outputとsource locationを表示する。
- LLMに認可、credential、active scan許可、network/resource limitを委譲していない。
- secretとLLM API keyの境界が崩れていない。

## Avoid

後続の計画や実装では、次を避ける。

- LLMにrepo全体を探索させて脆弱性を探させる。
- LLM toolとして任意ファイル読取を先に作る。
- CLI outputなしのLLM仮説をfindingとして扱う。
- scan結果とchat artifactを同じ意味で扱う。
- Web UIから直接重い診断ロジックを逐次実行する。
- LLM未設定時にscan基盤まで使えなくする。
- 人間のDecision、peer approval、manual finding reviewを通常完了のgateにする。
- LLM出力だけでactive scanの許可やtarget scopeを拡張する。
- unrestricted fuzzingやpatch自動化を暗黙に有効化する。
- raw artifactを残さず、正規化結果だけを保存する。
