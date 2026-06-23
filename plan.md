# LLM主導型 脆弱性診断ワークベンチ コンセプトドキュメント

## 1. 概要

本プロジェクトは、LLMを中心に据えつつ、既存のLinux OSSセキュリティツール、使い捨てサンドボックス、RAG基盤、Web UIを組み合わせた脆弱性診断ワークベンチである。

目的は、LLM単体に脆弱性判定を任せることではない。LLMは、コード理解、仮説生成、追加検査計画、結果の統合、誤検知の整理、修正案作成を担う。一方で、実際の証拠生成はSemgrep、Trivy、OSV-Scanner、Gitleaks、Nuclei、ZAP、各種テスト実行、将来的にはfuzzingやsanitizerに任せる。

本プロジェクトの基本思想は次の通りである。

```text
LLM = 調査・推論・仮説生成の主体
OSS tools = 客観的な証拠生成器
Toolbox container = Linux依存ツールの実行環境
Sandbox container = 対象コードを実行する使い捨て環境
RAG = コード・ログ・finding・過去知見の検索基盤
Web UI = 証拠と判断過程をレビューするインターフェース
```

## 2. 基本方針

本プロジェクトは、TypeScriptベースで独自実装する。ただし、脆弱性診断エンジン自体を再実装するのではなく、既存OSSツールを安全に呼び出す制御層を実装する。

### 2.1 TypeScriptで実装する領域

```text
- Web UI
- API server
- scan orchestration
- LLM gateway
- RAG / retrieval integration
- Docker runner
- tool adapter
- evidence normalization
- finding management
- report generation
- policy / permission control
```

### 2.2 Linux OSSに任せる領域

```text
- static analysis
- dependency vulnerability scan
- secret scan
- IaC / container scan
- DAST
- template-based vulnerability scan
- build / test / runtime execution
- fuzzing
- sanitizer-based memory error detection
```

### 2.3 重要な設計原則

```text
- LLMの判断は必ずevidenceに紐付ける
- LLM API keyはhost側にのみ置く
- toolbox/sandboxにはsecretを渡さない
- 対象コードは原則sandboxでのみ実行する
- toolboxは検査ツール実行とartifact解析に限定する
- Docker socketはcontainerへ渡さない
- sandboxはscanごとに使い捨てる
- artifactを境界として各層を疎結合にする
```

## 3. 全体アーキテクチャ

```text
Host OS
├─ React Web UI
├─ Hono API
├─ TypeScript Orchestrator
│  ├─ project manager
│  ├─ scan planner
│  ├─ LLM gateway
│  ├─ RAG retriever
│  ├─ Docker runner
│  ├─ tool adapter registry
│  ├─ evidence normalizer
│  └─ report generator
│
├─ Local DB / RAG store
│  ├─ projects
│  ├─ scans
│  ├─ findings
│  ├─ evidence
│  ├─ code chunks
│  ├─ embeddings
│  └─ tool outputs
│
├─ Docker
│  ├─ vulnlab-toolbox
│  └─ vulnlab-sandbox disposable
│
└─ artifacts/
   ├─ raw/
   ├─ normalized/
   ├─ sarif/
   ├─ logs/
   ├─ coverage/
   ├─ crashes/
   └─ reports/
```

## 4. コンテナ構成

本プロジェクトでは、コンテナを大量に分割しない。基本は以下の2つのみとする。

```text
1. toolbox container
2. disposable sandbox container
```

### 4.1 Toolbox container

Toolboxは、Linux依存の強いセキュリティツールをまとめて格納する検査用コンテナである。

責務は次の通り。

```text
- static scan
- dependency scan
- secret scan
- IaC / container scan
- template scan
- DAST補助
- tool output生成
- artifact解析補助
```

Toolboxは対象コードを原則実行しない。対象アプリのbuild、test、server起動、fuzzing、再現確認はsandboxで行う。

初期候補ツールは以下。

```text
- Semgrep
- Trivy
- OSV-Scanner
- Gitleaks
- Nuclei
- OWASP ZAP
- jq
- yq
- git
- ripgrep
- python
- node
```

将来的に追加する候補。

```text
- CodeQL optional
- Grype optional
- Syft optional
- custom Semgrep rules
- custom Nuclei templates
```

### 4.2 Disposable sandbox container

Sandboxは、対象コードを実行するための使い捨て環境である。

責務は次の通り。

```text
- package install
- build
- unit test
- integration test
- app startup
- API runtime
- crash reproduction
- fuzz-lite
- sanitizer build
```

Sandboxはscanごとに破棄する。ホストのrepoを直接変更しないよう、read-only mountされた対象repoをcontainer内部の作業ディレクトリにコピーしてから実行する。

推奨設定。

```text
- networkは原則off
- secretは渡さない
- CPU / memory / pids / timeoutを制限する
- cap-drop ALL
- no-new-privileges
- artifact出力先のみwrite可能
- 実行後はcontainerを破棄
```

### 4.3 DAST時の例外

Web/API診断では、sandbox内で対象アプリを起動し、toolboxからZAPやNucleiでアクセスする必要がある。この場合のみ、一時的なprivate Docker networkを作成する。

```text
private scan network
├─ sandbox: target application
└─ toolbox: ZAP / Nuclei
```

このnetworkは外部インターネットへ出さない。scan完了後にnetworkごと破棄する。

## 5. Linux OSSツール選定

### 5.1 Static Analysis

#### Semgrep

用途。

```text
- 多言語SAST
- 危険API検出
- 認証・認可漏れのパターン検出
- LLM生成ruleの検証
- SARIF/JSON出力
```

初期実装では最優先で対応する。

### 5.2 Dependency / Supply Chain

#### Trivy

用途。

```text
- filesystem scan
- dependency vulnerability scan
- container image scan
- IaC misconfiguration scan
- secret scan補助
- license scan補助
```

#### OSV-Scanner

用途。

```text
- lockfile / manifest based dependency vulnerability scan
- OSV databaseとの照合
- package ecosystem横断の既知脆弱性検査
```

TrivyとOSV-Scannerは重複する部分もあるが、初期段階では両方を使い、findingを統合する。

### 5.3 Secret Scan

#### Gitleaks

用途。

```text
- API key
- token
- private key
- credential
- .env混入
- git history scan optional
```

RAG index前のsecret redactionにも利用する。

### 5.4 Template-based Scan

#### Nuclei

用途。

```text
- known CVE template scan
- exposed admin panel
- misconfiguration
- common web vulnerability check
- OpenAPI / URL listに対する軽量検査
```

Nucleiは許可されたtargetにのみ実行する。外部targetへの無制限scanは行わない。

### 5.5 DAST

#### OWASP ZAP

用途。

```text
- baseline scan
- API scan
- OpenAPI / GraphQL / SOAP定義からのscan
- sandbox上で起動した対象アプリへの動的検査
```

初期ではZAP API scanまたはbaseline scanから対応する。

### 5.6 Browser Automation

#### Playwright

用途。

```text
- login flow automation
- session/cookie取得
- UI操作
- test user setup
- authenticated scanの事前準備
- screenshot / trace artifact
```

PlaywrightはDAST本体ではなく、認証済み状態を作る補助ツールとして扱う。

### 5.7 Fuzzing / Memory Safety

初期MVPでは対象外またはexperimentalとする。

将来的な候補。

```text
- AFL++
- libFuzzer
- clang / LLVM sanitizer
- ASan
- UBSan
- MSan
- TSan
- llvm-symbolizer
```

これらはsandbox側に配置し、toolboxには置かない。

## 6. npm / TypeScriptパッケージ選定

### 6.1 Web / API

```text
- React
- Hono
- Vite
- TypeScript
```

ReactはWeb UI、HonoはAPI serverに使う。既存のReact + Honoテンプレートを流用する。

### 6.2 LLM Provider

候補。

```text
- openai npm package
- Azure OpenAI compatible client
- provider abstraction layer
```

Azure OpenAI APIを主対象とする。将来的にOpenAI API、OpenAI-compatible local endpoint、社内LLM gatewayへ差し替えられるようにする。

LLM provider interfaceは以下のように抽象化する。

```ts
type LlmProvider = {
  chat(input: ChatRequest): Promise<ChatResponse>;
  embed?(input: EmbedRequest): Promise<EmbedResponse>;
};
```

### 6.3 Validation / Schema

```text
- zod
- ajv optional
```

LLM出力、tool output、API request/responseを必ずschema validationする。

### 6.4 Docker制御

候補。

```text
- execa
- dockerode
```

初期はexecaでdocker CLIを呼ぶ方式が簡単。高度なcontainer lifecycle管理が必要になったらdockerodeを追加する。

### 6.5 Job / Queue

候補。

```text
- p-queue
- bullmq optional
```

ローカルMVPではp-queueで十分。複数ユーザー・長時間job・retry管理が必要になったらBullMQ + Redisを検討する。

### 6.6 Database

候補。

```text
- SQLite
- better-sqlite3
- Drizzle ORM
```

初期はSQLiteでよい。OSS利用者がすぐ起動できることを優先する。チーム利用やサーバーデプロイが必要になったらPostgreSQLへ移行可能にする。

### 6.7 RAG / Retrieval

RAGテンプレートを流用する。設計上は以下の二段構えにする。

```text
v0:
  deterministic context pack
  ripgrep
  file path search
  symbol/path based retrieval

v1:
  embeddings
  vector search
  hybrid search
  previous findings retrieval
```

候補バックエンド。

```text
- local template default
- SQLite FTS
- LanceDB
- pgvector optional
- Azure AI Search optional
```

RAGはチャットボット用途ではなく、脆弱性診断用のContext Retrievalとして使う。

### 6.8 UI補助

候補。

```text
- TanStack Query
- TanStack Router optional
- React Hook Form
- shiki or monaco-editor
- mermaid optional
```

コード表示、finding表示、evidence graph、scan progress表示を重視する。

## 7. RAG設計

RAGは必須ではないが、将来的な診断精度とユーザー体験のために最初から設計に含める。

### 7.1 RAGに入れる情報

```text
- source code chunks
- file path metadata
- language metadata
- imports / exports
- route definitions
- controllers
- config files
- package manifests
- Dockerfile
- CI files
- Semgrep results
- Trivy results
- OSV results
- Gitleaks results
- Nuclei results
- ZAP results
- sandbox logs
- previous findings
- accepted / rejected LLM hypotheses
```

### 7.2 RAGに入れない情報

```text
- .env
- private keys
- credentials
- large binary files
- node_modules
- vendor directories by default
- dist / build artifacts by default
- ignored files
```

`.gitignore` と `.vulnlabignore` を尊重する。

### 7.3 Context Pack

LLMに毎回巨大なrepo全体を渡さない。代わりに、scan目的ごとにcontext packを作る。

例。

```text
AuthZ Context Pack
- route definitions
- middleware
- controller
- user/session model
- role/permission logic
- related Semgrep findings
- related tests

Dependency Risk Context Pack
- package manifest
- lockfile excerpt
- OSV result
- Trivy result
- import usage
- reachable call sites

Secret Context Pack
- redacted secret finding
- file path
- surrounding code
- git metadata optional
```

### 7.4 Retrieval Inspector

UIには、LLMに渡したcontextを確認できる画面を用意する。

表示項目。

```text
- prompt template
- selected files
- selected chunks
- token count
- redaction result
- retrieval score
- LLM response
- parsed structured output
```

これにより、LLM判断の透明性を確保する。

## 8. インターフェース設計

本プロジェクトは複数のinterfaceを持つ。

```text
1. Web UI
2. REST API
3. CLI
4. Tool Adapter Interface
5. Docker Runtime Interface
6. LLM Provider Interface
7. Retrieval Interface
8. Evidence / Finding Interface
```

### 8.1 Web UI

主要画面。

```text
- Project List
- Project Detail
- Scan Config
- Scan Run
- Finding List
- Finding Detail
- Evidence Viewer
- Artifact Viewer
- Retrieval Inspector
- Settings
```

#### Project Detail

```text
- repo path
- project language
- detected framework
- last scan
- risk summary
- enabled tools
```

#### Scan Run

```text
- current phase
- toolbox logs
- sandbox logs
- tool execution status
- generated artifacts
- LLM triage status
```

#### Finding Detail

```text
- title
- severity
- confidence
- CWE
- affected file
- source snippet
- evidence list
- LLM explanation
- reproduction status
- suggested fix
- reviewer decision
```

### 8.2 REST API

初期API案。

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
DELETE /api/projects/:id

POST   /api/projects/:id/scans
GET    /api/scans/:scanId
GET    /api/scans/:scanId/events
GET    /api/scans/:scanId/artifacts

GET    /api/findings
GET    /api/findings/:id
PATCH  /api/findings/:id

POST   /api/llm/triage
POST   /api/retrieval/search

GET    /api/settings
PATCH  /api/settings
```

scan progressはServer-Sent EventsまたはWebSocketで配信する。

### 8.3 CLI

Web UIが主interfaceだが、CLIも提供する。

```text
vulnlab init
vulnlab scan ./repo
vulnlab ui
vulnlab report <scan-id>
vulnlab toolbox pull
vulnlab sandbox test
```

CIではCLIを使う。

### 8.4 Tool Adapter Interface

各Linux OSSツールは同じinterfaceに寄せる。

```ts
type ToolAdapter = {
  name: string;
  version(): Promise<ToolVersion>;
  plan(input: ToolPlanInput): Promise<ToolPlan>;
  run(input: ToolRunInput): Promise<ToolRunResult>;
  parseArtifacts(input: ParseInput): Promise<NormalizedFinding[]>;
};
```

出力は `NormalizedFinding` に統一する。

```ts
type NormalizedFinding = {
  id: string;
  source: string;
  title: string;
  description?: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: "hypothesis" | "static" | "multi_tool" | "reproduced" | "patched";
  cwe?: string;
  locations: SourceLocation[];
  evidence: EvidenceRef[];
  remediation?: string;
  rawArtifactRefs: string[];
};
```

### 8.5 Docker Runtime Interface

Host側TypeScriptからtoolbox/sandboxを起動する。

```ts
type ContainerRunRequest = {
  image: string;
  command: string[];
  mounts: MountSpec[];
  network: "none" | "private-scan-network" | "default";
  readonlyRootfs?: boolean;
  timeoutSec: number;
  memoryMb?: number;
  cpus?: number;
  env?: Record<string, string>;
};
```

デフォルトでは安全側に倒す。

```text
- network none
- cap-drop all
- no-new-privileges
- readonly rootfs where possible
- timeout required
- memory limit required
```

### 8.6 LLM Provider Interface

Azure OpenAI APIを主対象とする。

```ts
type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  responseSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
};

type ChatResponse = {
  text: string;
  structured?: unknown;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};
```

LLM出力は必ずschema validationする。finding生成、triage、patch提案などはJSON schemaを定義する。

### 8.7 Retrieval Interface

```ts
type RetrievalQuery = {
  projectId: string;
  query: string;
  mode: "keyword" | "vector" | "hybrid";
  filters?: {
    paths?: string[];
    languages?: string[];
    artifactTypes?: string[];
  };
  limit: number;
};

type RetrievalResult = {
  id: string;
  kind: "code" | "artifact" | "finding" | "log";
  path?: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
};
```

### 8.8 Evidence Interface

```ts
type Evidence = {
  id: string;
  kind:
    | "tool-output"
    | "source-location"
    | "sandbox-log"
    | "reproduction"
    | "test-result"
    | "llm-analysis"
    | "patch";
  title: string;
  artifactRef?: string;
  location?: SourceLocation;
  summary?: string;
  createdAt: string;
};
```

## 9. Scan Workflow

初期MVPのworkflow。

```text
1. project registration
2. repo indexing
3. secret pre-scan
4. toolbox static scan
5. toolbox dependency scan
6. toolbox secret scan
7. result normalization
8. RAG context pack generation
9. LLM triage
10. finding grouping
11. report generation
12. Web UI review
```

将来workflow。

```text
1. LLM hypothesis generation
2. additional Semgrep rule generation
3. targeted scan
4. sandbox build/test
5. DAST against sandbox app
6. crash reproduction
7. patch proposal
8. regression test generation
9. human approval
```

## 10. Confidence Model

findingにはconfidenceを持たせる。

```text
C0 hypothesis:
  LLM仮説のみ

C1 static:
  1つのtoolで検出

C2 multi_tool:
  複数toolまたはRAG evidenceで補強

C3 reproduced:
  sandboxやDASTで再現

C4 patched:
  patchとregression testまで確認
```

UIではseverityとconfidenceを分けて表示する。

```text
severity = 影響の大きさ
confidence = 証拠の強さ
```

## 11. セキュリティ方針

このプロジェクト自体が未信頼コードを扱うため、設計上の安全性を重視する。

```text
- LLM API keyはhostのみ
- containerへsecretを渡さない
- Docker socketをcontainerにmountしない
- 対象repoはread-only mount
- sandbox内で作業コピーを作る
- artifactのみhostに戻す
- external scanは明示許可制
- DASTはprivate network内を基本とする
- .vulnlabignoreを尊重する
- RAG index前にsecret redactionする
- LLMへ送信したcontextを監査可能にする
```

## 12. 初期MVPスコープ

### v0.1

```text
- React + Hono Web UI
- local project registration
- toolbox container
- Semgrep adapter
- Trivy adapter
- OSV-Scanner adapter
- Gitleaks adapter
- artifact viewer
- normalized finding model
- Azure OpenAI provider
- LLM triage
- context pack
- Markdown report
```

### v0.2

```text
- RAG template integration
- code chunking
- retrieval inspector
- .vulnlabignore
- secret redaction
- Nuclei adapter
- scan progress events
```

### v0.3

```text
- sandbox container
- build/test runner
- DAST private network
- ZAP adapter
- Playwright login/session helper
```

### v0.4

```text
- LLM-generated Semgrep rule
- targeted re-scan
- finding deduplication
- patch suggestion
- reviewer workflow
```

### v0.5

```text
- fuzz-lite
- sanitizer build helper
- crash artifact
- regression test proposal
```

## 13. 非スコープ

初期段階では以下を対象外とする。

```text
- 完全自動exploit生成
- 許可されていない外部target scan
- malware解析
- phishing生成
- credentialを使った侵入テスト自動化
- Docker以外の強sandbox完全対応
- 大規模multi-tenant SaaS
```

## 14. プロジェクト構成案

```text
repo/
├─ apps/
│  ├─ web/
│  └─ api/
│
├─ packages/
│  ├─ core/
│  ├─ llm/
│  ├─ retrieval/
│  ├─ docker-runner/
│  ├─ tool-adapters/
│  ├─ evidence/
│  ├─ report/
│  └─ shared/
│
├─ images/
│  ├─ toolbox/
│  │  └─ Dockerfile
│  └─ sandbox/
│     └─ Dockerfile
│
├─ templates/
│  ├─ prompts/
│  ├─ policies/
│  └─ scan-profiles/
│
├─ artifacts/
│  └─ .gitkeep
│
├─ docker-compose.yml
├─ package.json
├─ pnpm-workspace.yaml
└─ README.md
```

## 15. まとめ

本プロジェクトは、LLMを脆弱性診断の中心に置きつつ、判定の信頼性をOSSツールとsandbox evidenceで補強するワークベンチである。

最初の実装方針は次の通り。

```text
- UI/APIはReact + Hono
- LLMはAzure OpenAI APIを主対象
- RAGテンプレートを流用
- Linux依存はtoolbox containerへ集約
- 対象コード実行はdisposable sandboxへ隔離
- findingはevidence-firstで管理
- Web UIで判断過程を可視化
```

最終的な価値は、単なるスキャン結果の一覧ではなく、次のような診断体験を提供することにある。

```text
LLMが怪しい箇所を見つける
↓
OSSツールが証拠を出す
↓
sandboxが再現可能性を確認する
↓
RAGが関連コードと過去findingを補足する
↓
Web UIで人間がレビューする
↓
patch / regression test / reportへつなげる
```
