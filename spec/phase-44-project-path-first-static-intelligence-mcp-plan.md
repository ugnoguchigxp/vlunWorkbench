# Phase 44: projectPath-first Static Intelligence MCP 改修計画

- Status: Planned
- Target: vulnWorkbench
- Depends on: Phase 43 Static Intelligence MCP
- Consumer: NightWorkers controlled pilot
- Last updated: 2026-07-15

## 1. 目的

NightWorkers などの外部クライアントが、vulnWorkbench 内部の `projectId`、`scanRunId`、`generationId`、`rootRef` を事前に解決せず、登録済みリポジトリの絶対パスだけで Static Intelligence を準備・参照できるようにする。

Phase 43 では、永続化済み Static Intelligence を安全に公開する read-only MCP を整備した。一方、現在の入力契約は vulnWorkbench 内部IDを前提としているため、外部クライアントには次の問題が残る。

- 外部クライアントは内部IDを知らない。
- IDを得るためだけの専用APIや事前同期が必要になる。
- パスとIDの対応を外部側で永続化すると、再作成・再スキャン・環境移行で不整合が起きる。
- `projectId -> scanRunId -> generationId` という内部ライフサイクルが外部契約へ漏れる。
- 構造情報が未生成の場合、read-only MCPだけでは自動準備できない。

Phase 44 では、外部契約を `projectPath` 起点へ変更し、内部IDの解決、スキャン、Static Intelligence生成、最新世代の選択を vulnWorkbench の責務へ戻す。

## 2. 結論

外部クライアントがプロジェクトを指定するキーは、正規化前の入力としての `projectPath` だけとする。

```text
NightWorkers registeredProject.repoPath
  -> vulnWorkbench path-first MCP
  -> realpath による正規化と許可範囲検証
  -> project の内部解決または作成
  -> scan / generation の再利用または準備
  -> snapshot / catalog / readiness を返却
```

次の設計は採用しない。

```text
projectPath
  -> 専用 resolver API
  -> projectId
  -> MCP 呼び出し
```

`projectId`、`scanRunId`、`generationId` などは、監査・診断用 provenance として応答に含めてもよいが、NightWorkers が後続リクエストへ渡す必須キーにはしない。

## 3. Phase 43 から変更する責務境界

### 3.1 維持するもの

- Static Intelligence の永続化形式
- generation 単位の整合性
- 既存の正規化・redaction・サイズ制限
- Phase 43 の read-only サービス関数
- 既存IDベースMCPの挙動と回帰テスト
- 証拠台帳、guardrail、verification manifest の生成規則
- scanner、worker、queue の既存責務

### 3.2 追加するもの

- `projectPath` を内部 project へ解決する共通サービス
- パスの canonicalization と許可ルート検証
- Static Intelligence を明示的に準備する action MCP
- 準備状態をパスで確認する status MCP
- 最新の利用可能な generation をパスから選ぶ read facade
- 同一パスへの重複準備を防ぐ永続ジョブ状態
- 再起動後の回復、失敗理由、再試行可否の可観測性

### 3.3 明示的な変更点

Phase 43 の「MCPはスキャンや生成を開始しない」という制約は、参照系ツールについて維持する。Phase 44 では別の action ツールを追加し、利用者が明示的に要求した場合だけ準備処理を開始する。

getter の内部で暗黙にスキャンや生成を開始してはならない。

## 4. 外部契約の原則

### 4.1 プロジェクト識別

- 必須入力は `projectPath: string`。
- `projectId`、`scanRunId`、`generationId`、`rootRef` を project selector として要求しない。
- 入力パスは絶対パスを要求する。
- 内部では `fs.realpath` 相当で canonical path に変換する。
- `path/.`、シンボリックリンク、表記差が同じ実体を指す場合は、同じ project として扱う。
- canonical path と project の対応は vulnWorkbench が管理する。

### 4.2 副作用の分離

MCPを次の2種類に分ける。

| 種別 | 役割 | 副作用 | MCP annotation |
| --- | --- | --- | --- |
| Action | scan / generation の準備を要求 | あり | `readOnlyHint: false` |
| Query | 状態・snapshot・catalogを参照 | なし | `readOnlyHint: true` |

Query は未準備の場合に `not_prepared` を返し、Action の呼び出しを案内する。Query 自身は準備を開始しない。

### 4.3 外部へ公開する識別子

- プロジェクト: `projectPath`
- finding: `findingFingerprint` のような安定したドメイン識別子
- module / symbol: Static Intelligence が返す安定化済み path / symbol selector
- 内部ID: 任意の provenance のみ

finding 単位の参照で現在 `findingId` を要求している箇所は、`projectPath + findingFingerprint` へ移行する。内部 `findingId` の解決は vulnWorkbench 内で行う。

## 5. MCP ツール契約

ツール名は実装時に既存命名との衝突を確認するが、Phase 44 の契約名は以下で固定する。

### 5.1 `vuln_prepare_project_intelligence`

指定パスについて、利用可能な永続化済み Static Intelligence generation を準備する action ツール。

入力:

```json
{
  "projectPath": "/absolute/path/to/repository"
}
```

入力スキーマ:

```ts
z.object({
  projectPath: z.string().min(1),
}).strict()
```

挙動:

1. パスを検証・正規化する。
2. canonical path に対応する project を内部で解決し、存在しなければ作成する。
3. 現在のソース状態に対する利用可能な generation を探す。
4. fresh な generation があれば再利用し、`ready` を返す。
5. 同じソース状態の prepare job があれば、その状態を返す。
6. 利用可能な scan がなければ scan をqueueへ投入する。
7. scan 完了後に Static Intelligence generation をbuildする。
8. generation の publish 完了後に `ready` へ遷移する。

応答例:

```json
{
  "ok": true,
  "status": "queued",
  "projectPath": "/canonical/path/to/repository",
  "stage": "security_scan",
  "reused": false,
  "retryAfterMs": 2000
}
```

fresh generation 再利用時:

```json
{
  "ok": true,
  "status": "ready",
  "projectPath": "/canonical/path/to/repository",
  "stage": "complete",
  "reused": true,
  "provenance": {
    "projectId": "internal-diagnostic-only",
    "generationId": "internal-diagnostic-only"
  }
}
```

このツールは副作用を持つため、read-only として登録しない。

### 5.2 `vuln_get_project_intelligence_status`

指定パスの準備状態を返す read-only ツール。

入力:

```json
{
  "projectPath": "/absolute/path/to/repository"
}
```

主な状態:

| status | 意味 |
| --- | --- |
| `not_prepared` | project または prepare job が未作成 |
| `queued` | 実行待ち |
| `running` | scan または generation build 実行中 |
| `ready` | 最新ソース状態に利用可能な generation がある |
| `stale` | generation はあるがソース状態が変化している |
| `failed` | 準備に失敗した |

未準備の応答例:

```json
{
  "ok": false,
  "status": "not_prepared",
  "projectPath": "/canonical/path/to/repository",
  "nextAction": "vuln_prepare_project_intelligence"
}
```

失敗応答には、秘密情報を除去した `errorCode`、`message`、`retryable` を含める。スタックトレースやscannerの生出力は返さない。

### 5.3 `vuln_get_code_structure_snapshot`

入力を `projectPath` に統一する。参照時点で利用可能な最新generationの構造snapshotを返す。

```json
{
  "projectPath": "/absolute/path/to/repository"
}
```

- read-only を維持する。
- repository scan や generation build を暗黙に開始しない。
- generation がなければ `not_prepared` を返す。
- stale generation を返すか拒否するかは、応答の一貫性を優先し、既定では `stale` を明示して最後のpublished generationを返す。
- 呼び出し側は `freshness.status` を必ず確認できる。

### 5.4 `vuln_get_project_exploration_catalog`

NightWorkers の探索計画向けに、最新generationから探索対象を絞り込む。

```json
{
  "projectPath": "/absolute/path/to/repository",
  "focus": {
    "paths": ["api/modules"],
    "modules": ["static-intelligence"],
    "terms": ["projectPath", "MCP"]
  }
}
```

- `focus` は任意。
- `projectId`、`rootRef`、`generationId` は入力に含めない。
- 応答内の内部IDは provenance として任意。
- Phase 43 のサイズ制限、redaction、決定的順序を維持する。

### 5.5 finding / manifest 系ツール

以下の既存機能も、NightWorkers が利用する経路では path-first facade を追加する。

- guardrail context
- evidence ledger
- verification manifest
- readiness / health

finding の指定は次を基本形とする。

```json
{
  "projectPath": "/absolute/path/to/repository",
  "findingFingerprint": "stable-domain-fingerprint"
}
```

`findingFingerprint` が一意でない既存データがある場合、曖昧さを内部IDで外部に押し返さず、候補を返すエラー契約を定義する。

## 6. path resolver

共通の `resolveProjectByPath` サービスを追加し、全path-firstツールが必ず経由する。

### 6.1 検証順序

1. 文字列長とNUL文字を検証する。
2. 絶対パスであることを検証する。
3. filesystem上に存在することを検証する。
4. directory であることを検証する。
5. `realpath` でcanonical pathを取得する。
6. canonical path が許可ルート配下であることを検証する。
7. repositoryとして扱えることを検証する。
8. canonical path の完全一致で既存projectを検索する。
9. Action の場合のみ、必要ならprojectを作成する。

### 6.2 許可ルート

prepare はローカルfilesystemを読み取る副作用を持つため、任意パスを許可しない。

- 環境変数または設定ファイルで `allowedProjectRoots` を定義する。
- 判定は文字列prefixではなく、canonical path のpath境界を考慮する。
- シンボリックリンクで許可ルート外へ抜けるパスを拒否する。
- 許可ルート自身またはその子孫だけを対象とする。
- 設定が空の場合の既定値は fail-closed とする。
- Query も同じresolverを通し、Actionとの判定差を作らない。

### 6.3 project の一意性

canonical path に一意制約を持たせる。既存DBに同一実体の重複projectがある場合は、Phase 44 migration前に検出し、機械的に安全なものだけ統合する。

次はすべて同一projectになる必要がある。

```text
/repo
/repo/.
/workspace/link-to-repo
```

## 7. prepare lifecycle

scan と generation build は数分かかる可能性があるため、MCP呼び出し内で完了まで同期実行しない。永続ジョブとして開始し、statusをpollする。

### 7.1 状態遷移

```text
requested
  -> resolving_project
  -> checking_freshness
  -> queued_scan
  -> running_scan
  -> queued_generation
  -> building_generation
  -> publishing
  -> ready

任意の実行状態
  -> failed
```

fresh generation が存在する場合は `checking_freshness -> ready` へ短絡する。

### 7.2 永続ジョブ

`static_intelligence_prepare_jobs` 相当のテーブルを追加する。最終的な命名は既存DB規約に合わせる。

候補フィールド:

| field | 用途 |
| --- | --- |
| `id` | 内部ジョブID |
| `project_id` | 内部project参照 |
| `canonical_project_path` | 監査・一意性確認 |
| `source_fingerprint` | 準備対象ソース状態 |
| `status` | job状態 |
| `stage` | 現在工程 |
| `scan_run_id` | 内部連携 |
| `generation_id` | 内部連携 |
| `attempt_count` | 再試行回数 |
| `error_code` | 安定エラーコード |
| `error_message_redacted` | 安全化済み失敗理由 |
| `created_at` / `updated_at` | lifecycle監査 |
| `started_at` / `completed_at` | 実行時間監査 |

active job には `project_id + source_fingerprint` の一意性を持たせ、同一ソースへの同時prepareを1ジョブへ集約する。

### 7.3 freshness

Phase 44 のprepareは、一時的な構造抽出だけではなく、NightWorkersがcatalog、manifest、guardrailを同じgenerationから参照できるよう、完全な永続化済み Static Intelligence generation を準備する。

freshness は少なくとも次を含む決定的fingerprintで判定する。

- canonical project path
- repository source state
- scanner / extractor version
- Static Intelligence schema version
- generation builder version
- 有効な解析設定

Git repositoryでは commit SHA だけに依存せず、未commit差分を含むsource stateを扱う。実装時は既存scannerのsource hash規則を優先し、同一入力が同じfingerprintになることをfixtureで固定する。

### 7.4 再起動回復

- worker起動時に中断状態を検出する。
- scan run が継続中なら既存状態へ再接続する。
- 完了scanがありgenerationだけ未作成ならgeneration buildから再開する。
- lease切れのjobは再queueまたは明示的なfailedへ遷移する。
- 同一jobを複数workerがpublishしない。

## 8. エラー契約

安定した `errorCode` を定義し、クライアントが文言解析をしなくてよいようにする。

| errorCode | 意味 | retryable |
| --- | --- | --- |
| `PROJECT_PATH_REQUIRED` | path未指定 | false |
| `PROJECT_PATH_NOT_ABSOLUTE` | 相対パス | false |
| `PROJECT_PATH_NOT_FOUND` | path不存在 | false |
| `PROJECT_PATH_NOT_DIRECTORY` | directoryではない | false |
| `PROJECT_PATH_NOT_ALLOWED` | 許可ルート外 | false |
| `PROJECT_PATH_UNREADABLE` | 読み取り不可 | 条件次第 |
| `PROJECT_NOT_PREPARED` | generation未作成 | true |
| `PREPARE_ALREADY_RUNNING` | 同一job実行中 | true |
| `SCAN_FAILED` | scan失敗 | 条件次第 |
| `GENERATION_FAILED` | generation build失敗 | 条件次第 |
| `AMBIGUOUS_FINDING` | fingerprintが一意でない | false |
| `INTERNAL_ERROR` | 安全化済み予期せぬ失敗 | true |

ローカルパス、ソース本文、環境変数、scannerの生ログ、stack traceをエラー本文へ展開しない。`projectPath` の返却範囲は呼び出し元が入力した対象に限定し、ログや下流promptへ無条件に複製しない。

## 9. 既存IDベースMCPとの互換性

Phase 44 では既存IDベースサービスを即時削除しない。

- 既存サービス関数はpath-first facadeの内部実装として再利用する。
- 既存MCPツールはlegacyとして当面維持する。
- NightWorkersの新規実装はlegacyツールを呼ばない。
- legacy入力に新しい依存を追加しない。
- 利用状況と移行完了を確認後、別Phaseで削除可否を判断する。

Phase 44 が置き換えるのは外部project selectorであり、DB内部の主キーやrelationではない。

## 10. 実装対象

正確な配置はPhase 44Aで既存構成を再確認するが、主な変更候補は次の通り。

- `api/modules/static-intelligence/mcp-tool-schemas.ts`
- `api/modules/static-intelligence/mcp-server.ts`
- `api/modules/static-intelligence/*project-path*`
- `api/modules/static-intelligence/*prepare*`
- `api/modules/static-intelligence/*read-service*`
- scanner / queue / worker の連携箇所
- DB schema とmigration
- Static Intelligence MCP unit / integration tests
- Phase 43 fixture と新しいpath-first fixture
- `README.jp.md`
- MCP設定例とNightWorkers向けhandoff文書

## 11. 実装フェーズ

### Phase 44A: 契約固定とpath resolver

実装:

- path-first入出力型を追加する。
- `allowedProjectRoots` 設定を追加する。
- canonicalization、存在、directory、symlink escapeを検証するresolverを追加する。
- canonical pathでprojectを解決・作成するserviceを追加する。
- project pathの一意性と既存重複を監査するmigrationを追加する。

完了条件:

- パス表記差が1projectへ解決される。
- 許可ルート外を拒否する。
- Queryはprojectを作成しない。
- Actionだけがprojectを作成できる。
- NightWorkers向け入力型に内部IDが存在しない。

### Phase 44B: 永続prepare lifecycle

実装:

- prepare job schema / repository / serviceを追加する。
- `vuln_prepare_project_intelligence` を追加する。
- scan queue とgeneration builderを接続する。
- freshness判定、重複排除、再利用を実装する。
- worker再起動回復と安全な失敗状態を実装する。
- `vuln_get_project_intelligence_status` を追加する。

完了条件:

- 同一pathへの同時prepareが1つのscanへ集約される。
- fresh generationがある場合はscanを再実行しない。
- source変更後は新しいgenerationが作成される。
- 再起動後にjobが失われない。
- prepareはread-only annotationを持たない。

### Phase 44C: path-first read facade

実装:

- code structure snapshotをpath-first化する。
- exploration catalogをpath-first化する。
- readiness / manifest / guardrail / evidenceをpath-first化する。
- finding selectorをfingerprintへ移行する。
- latest published generationの選択を共通化する。
- legacy ID-based toolの回帰を維持する。

完了条件:

- NightWorkersが全参照を `projectPath` だけから開始できる。
- NightWorkersから送るrequestに内部IDが含まれない。
- readツールの呼び出しでDB行数、scan数、generation数が変化しない。
- stale / not_prepared が明示される。

### Phase 44D: 可観測性と文書

実装:

- prepare status、stage、所要時間、再利用有無を構造化ログへ追加する。
- pathを必要以上にログへ残さないredactionを追加する。
- README、MCP設定例、運用手順を更新する。
- NightWorkersへの依頼文と受け入れ条件を確定する。

完了条件:

- 障害時にscanとgenerationのどちらで失敗したか判別できる。
- ログからsource本文や秘密情報が漏れない。
- 外部利用者向け手順に内部ID解決ステップがない。

### Phase 44E: end-to-end fixture

実装:

- 一時repositoryを作るpath-first fixtureを追加する。
- prepare、poll、snapshot、catalog、manifestまで実行する。
- duplicate、stale、failure、restart相当を検証する。

完了条件:

- path-onlyの正常系が1コマンドで再現できる。
- すべてのNightWorkers requestを記録し、内部IDが入力にないことを検査できる。
- Phase 43の既存fixtureと全テストが通る。

## 12. 検証計画

### 12.1 resolver

- 絶対パスを受理する。
- 相対パスを拒否する。
- 存在しないパスを拒否する。
- file pathを拒否する。
- 許可ルート外を拒否する。
- 許可ルート内から外へ向くsymlinkを拒否する。
- `/repo`、`/repo/.`、symlinkが同じprojectへ解決される。
- Queryは未登録pathにDB書き込みを行わない。

### 12.2 prepare

- 未登録pathからproject、scan、generationを準備できる。
- 同一pathへの並行呼び出しが1jobへ集約される。
- fresh generationを再利用する。
- source変更を検知して新generationを作る。
- scan失敗をredacted errorとして返す。
- generation失敗から安全に再試行できる。
- worker再起動後に処理が回復する。

### 12.3 read-only保証

各Queryの前後で次の件数が変化しないことを確認する。

- projects
- scan runs
- prepare jobs
- generations
- findings / evidence / manifests

### 12.4 契約

- 全path-first入力が `.strict()` である。
- 余分な `projectId`、`scanRunId`、`generationId`、`rootRef` を渡すと拒否する。
- prepareだけが副作用ありとして登録される。
- Queryはすべてread-only annotationを維持する。
- 応答サイズ、順序、redactionが決定的である。
- finding fingerprintの曖昧性が安定エラーになる。

### 12.5 回帰

- Phase 43 MCP unit / integration test
- Static Intelligence fixture
- project / scan / generation既存テスト
- typecheck
- lint
- repository全体のtest / verify

実装時はrepositoryに既存の正規コマンドを確認し、Phase 44文書内の固定コマンドではなくpackage scriptsをsource of truthとして実行する。

## 13. NightWorkers へのhandoff条件

NightWorkers側の改修はPhase 44E完了後に開始する。

NightWorkersが保持・送信する値:

```text
registeredProject.repoPath
```

NightWorkersが保持しない値:

```text
vulnWorkbench projectId
scanRunId
generationId
rootRef
findingId
```

期待する利用フロー:

```text
1. registeredProject.repoPath を取得
2. vuln_prepare_project_intelligence({ projectPath })
3. vuln_get_project_intelligence_status({ projectPath }) をpoll
4. ready 後に path-first catalog / snapshot / manifest を参照
5. 取得結果を既存の証拠台帳へ保存
6. MCP unavailable / failed の場合は既存探索へfail-open
```

NightWorkers側のcontrolled pilot条件:

- app-managed MCP設定を利用する。
- feature flag既定値はoff。
- native / API実行経路だけを対象とする。
- Codex SDK、planning、test、review、general answer laneへ波及させない。
- vulnWorkbench内部DBを直接参照しない。
- 内部IDのresolver APIを追加しない。
- MCP障害時に既存の探索・回答を停止しない。
- provenanceと証拠台帳を維持する。

## 14. NightWorkers への依頼文

Phase 44完了後は、以下をNightWorkers側への実装依頼として使用する。

> vulnWorkbench Static Intelligence MCPを、登録プロジェクトの `repoPath` を起点として利用してください。vulnWorkbench固有の `projectId`、`scanRunId`、`generationId`、`rootRef` は保存・解決・送信しないでください。最初に `vuln_prepare_project_intelligence({ projectPath })` を呼び、`vuln_get_project_intelligence_status({ projectPath })` をpollして `ready` を確認した後、同じ `projectPath` でexploration catalog、code structure snapshot、verification manifest等を参照してください。MCPはcontrolled pilotのfeature flag配下に置き、既定off、native/API経路限定、障害時fail-openとしてください。取得した出典とfreshnessは既存の証拠台帳へ保持し、vulnWorkbench DBへの直接接続や内部ID解決APIは追加しないでください。

## 15. リスクと対策

### 任意filesystem読み取り

対策: canonical path、allowed roots、symlink escape拒否、fail-closed設定を必須化する。

### 重い処理をMCP request内で同期実行

対策: prepareを永続非同期jobとし、status pollingへ分離する。

### 暗黙の副作用

対策: prepareとQueryを別ツールにし、annotationとDB件数テストで固定する。

### 同じrepositoryの重複登録

対策: realpathとcanonical path一意性を導入する。

### source変更とgenerationの不一致

対策: source fingerprintとschema / builder versionをfreshnessに含める。

### 内部IDの再流出

対策: NightWorkers向け入力スキーマをpath-first専用型にし、余剰キーを拒否するfixtureを追加する。

### path情報の漏えい

対策: 応答は要求対象に限定し、ログ・prompt・errorへ無条件に展開しない。

## 16. 非目標

- NightWorkersのcanonical ontology変更
- task compilerやcontext stateの変更
- 任意shell command実行MCPの追加
- NightWorkersからvulnWorkbench DBへの直接接続
- 内部IDを解決する専用APIの追加
- getter内の暗黙scan / generation
- scanner profile全体の再設計
- Codex SDK、planning、test、review、general answer laneの変更
- Phase 43永続形式の全面置換

## 17. Definition of Done

Phase 44は、次をすべて満たした時点で完了とする。

- NightWorkersが `projectPath` だけで準備を開始できる。
- status、snapshot、catalog、manifestを `projectPath` だけで参照できる。
- NightWorkersのrequest入力にvulnWorkbench内部IDがない。
- prepareの副作用が明示され、Queryはread-onlyを維持する。
- path canonicalization、allowed roots、symlink防御がある。
- 同一ソースへのprepareが重複実行されない。
- fresh generation再利用とsource変更後の再生成が機能する。
- prepare lifecycleが再起動後も回復できる。
- redaction、サイズ制限、決定的順序を維持する。
- Phase 43回帰を含むunit、integration、fixture、repository verifyが成功する。
- READMEとNightWorkers handoffが内部ID解決を要求しない。

## 18. 実装開始判定

この文書により改修計画は必要かつ確定とする。Phase 43の成果を破棄せず、その上にpath-first facadeと明示的prepare lifecycleを追加する。

実装順は `44A -> 44B -> 44C -> 44D -> 44E` とし、NightWorkers側のconsumer変更は44Eの受け入れ完了後に行う。
