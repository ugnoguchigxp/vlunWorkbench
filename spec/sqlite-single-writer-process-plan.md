# SQLite Single Writer Process 実装計画

- Status: Implemented
- Target: vulnWorkbench
- Scope: SQLite write path only
- Last updated: 2026-07-18

実装では既存 repository の段階移行を安全に完了するため、`createDbConnection()` の返す Drizzle facade が read query をローカル read-only connection、mutation builder を `SqliteWriterClient` へ振り分ける。したがって関数名は互換性のため残るが、ファイル DB に対する writable connection は返さず、旧 direct-write factory としての性質は廃止済みである。

## 1. 目的

SQLite への全書込みを、DBファイルごとにただ1つ存在する専用 Writer プロセスへ集約する。

通常の Web サーバー、CLI、scan worker、Static Intelligence worker は writable SQLite connection を持たない。書込みが必要なコードは、必ず `SqliteWriterClient` を取得し、IPC 経由で Writer プロセスへ依頼する。

読み取りは集約しない。各プロセスは read-only SQLite connection を直接開き、現在の SQLite / Drizzle query を利用できる。

到達点は次の状態である。

```text
Web server / CLI / worker
  ├─ read  ───────────────> SQLite read-only connection
  └─ write -> Writer Client -> Unix domain socket
                              -> one Writer process
                              -> one writable SQLite connection
```

この計画でいう「単一 Writer」は、SQLite が同時刻に1つのwriterしか許さないという意味ではない。アプリケーションプロセスとして writable connection の所有者を1プロセスに限定し、書込みの受付、順序、transaction、失敗処理をそのプロセスに集約することを意味する。

## 2. 結論

次の構成を採用する。

1. `createDbConnection()` を read/write 共用関数として公開する現在の構成を廃止する。
2. 通常プロセス向けに `createReadDbConnection()` を提供する。
   - `new Database(path, { readonly: true, strict: true })`
   - `PRAGMA query_only = ON`
   - writable raw handle は公開しない。
3. writable SQLite connection の生成は Writer プロセス内部モジュールだけに置く。
4. `getSqliteWriterClient()` が Unix domain socket 上の Writer を取得する。
5. 書込み用 Drizzle query は `drizzle-orm/sqlite-proxy` を使って Writer Client から生成する。
6. client側には `insert` / `update` / `delete` / atomic batch だけを公開し、通常read queryはread-only DBを使う。
7. Writer は明示的な FIFO queue で1リクエストずつ処理し、1本のSQLite connection以外を開かない。
8. migrationを含む全DB mutationをWriter経由へ移し、直接書込みのビルド時・CI時・実行時の三重防止を入れる。
9. Writerへ接続できない場合に直接SQLiteへfallbackしない。

Repository全体を生SQL RPCへ置き換える方式や、Web serverをWriterとして流用する方式は採用しない。前者は型とtransaction境界を弱くし、後者はstandalone CLIやMCP serverをWeb serverの生存に依存させるためである。

## 3. 現状ベースライン

### 3.1 共通接続関数はプロセス単位の接続生成である

`api/db/index.ts` の `createDbConnection()` は、呼び出しごとに次を行う。

- SQLite pathを解決する。
- `new Database(..., { create: true, strict: true })` で接続を開く。
- `foreign_keys = ON` と `journal_mode = WAL` を設定する。
- Bun SQLite用Drizzle instanceを返す。

この関数はsingleton Writerを取得していない。各プロセスが同じ `DATABASE_URL` に対して独立した writable connection を作れる。

非testの `api/app` / `api/cli` だけで、現在36ファイルが `createDbConnection()` を呼ぶ。そのうち35ファイルはCLI entrypointである。read-only CLIも含まれるため、この件数自体はwriter数ではないが、writable connectionを取得できる境界が広すぎることを示している。

### 3.2 現在確認できる多重Writerプロセス

| 実行主体 | 親側の書込み | 子・別プロセス側の書込み | 現在の接続方法 |
| --- | --- | --- | --- |
| Web scan | `projects.route.ts` がqueued scan/eventを作成 | `scan-profile.ts` がclaim、tool run、artifact、finding、evidence、statusを更新 | 親子が同じ `DATABASE_URL` で各自接続 |
| Web dynamic run | Web routeが認可・設定を処理 | `dynamic-run.ts` がdynamic run/artifact/evidenceを更新 | routeがCLIをspawnし、CLIが直接接続 |
| Web DAST | Web routeが認可・設定を処理 | `scan-dast.ts` がDAST run/artifact/evidenceを更新 | routeがCLIをspawnし、CLIが直接接続 |
| Web reproduction | Web routeがfindingを検証 | `repro-finding.ts` がreproduction run/artifact/evidenceを更新 | routeがCLIをspawnし、CLIが直接接続 |
| Static Intelligence MCP | prepare tool handlerがprepare jobを作成 | detached `static-intelligence-prepare-worker.ts` がjob/scan/generationを更新 | MCPとworkerが各自接続 |
| Standalone scan CLI | なし | scan/import/profile/oracle CLIがscan関連テーブルを更新 | CLIが直接接続 |
| Standalone workflow CLI | なし | review/decision/report/diagnostic/dynamic/DAST/reproduction CLIが更新 | CLIが直接接続 |
| Static Intelligence CLI | なし | build/index CLIがartifact/generation/embeddingを更新 | CLIが直接接続 |
| 管理CLI | なし | admin作成、seed、markdown import、LLM route repairが更新 | CLIが直接接続 |
| migration / fixture | なし | migrationとfixture scriptsがraw SQLiteまたはDrizzleで更新 | scriptが直接接続 |

### 3.3 Web scanは親子両方がwriterになる

現在のWeb scan flowは次の通りである。

```text
Web server
  -> INSERT scan_runs(status=queued)
  -> INSERT scan_events(scan.queued)
  -> spawn api/cli/scan-profile.ts

scan-profile child process
  -> createDbConnection(same DATABASE_URL)
  -> UPDATE scan_runs(status=running)  // atomic claim
  -> INSERT/UPDATE tool_runs
  -> INSERT scan_artifacts/findings/finding_evidences/events
  -> UPDATE scan_runs(terminal status)
```

`ScanProcessSupervisor` の ownership token は、scan processのcancel ownershipとstale recoveryを守るものであり、SQLite writerを単一化するものではない。

### 3.4 Web routeから起動される別のwriter CLI

次のrouteも、Web serverとは別のBunプロセスを起動し、そのCLIが直接DBへ書く。

- `api/routes/dynamic.route.ts` -> `api/cli/dynamic-run.ts`
- `api/routes/dast.route.ts` -> `api/cli/scan-dast.ts`
- `api/routes/reproductions.route.ts` -> `api/cli/repro-finding.ts`
- `api/routes/projects.route.ts` -> `api/cli/scan-profile.ts`

これらはscannerやsandboxを別プロセスへ隔離する安全境界としては維持する。変更するのはDB接続だけであり、scanner executionをWriterプロセス内へ移さない。

### 3.5 Static Intelligenceも親子writerになる

`api/cli/static-intelligence-mcp-server.ts` はprepare job作成後にdetached workerを起動する。workerは `api/cli/static-intelligence-prepare-worker.ts` で独自接続を作り、次を更新する。

- `static_intelligence_prepare_jobs` のclaim、lease、stage、failure、ready状態
- scan run / scan event
- generated scan artifacts
- static intelligence embeddings

heartbeatによる定期更新も別プロセスの直接writeである。

### 3.6 Mutation実装の所有箇所

| Domain | 主な実装 | 主なmutation |
| --- | --- | --- |
| Project / scan | `api/modules/scans/repositories.ts` | projects、scan_runs、scan_events、tool_runs、scan_artifacts、findings、finding_evidences |
| Scan report/review | `report-repository.ts`、`scan-review-repository.ts` | scan_reports、scan_reviews |
| Finding review/decision | `finding-review-repository.ts`、`finding-decision-repository.ts` | finding_reviews、finding_decisions |
| Dynamic | `dynamic-repository.ts` | dynamic configs/runs/artifacts/evidence |
| DAST | `dast-repository.ts` | DAST configs/runs/artifacts/evidence |
| Reproduction | `reproduction-repository.ts` | reproduction runs/artifacts/evidence |
| Diagnostics | `diagnostics/repository.ts` | attack surface、security checks/results、diagnostic reports |
| Authentication | `auth.service.ts`、`token.service.ts` | users、refresh_tokens |
| Settings | `settings.repository.ts`、`llm-settings.repository.ts` | user settings、LLM endpoints/routes/health checks |
| Sources | `source.repository.ts` | sources、source_fragments、embeddings |
| Chat | `chat.service.ts`、`chat.route.ts`、`artifacts.route.ts` | conversations、messages、retrieval logs、chat artifacts |
| Static Intelligence | `generation-repository.ts`、`embedding-repository.ts`、`prepare-repository.ts` | generated artifacts、embeddings、prepare jobs |
| Maintenance | `api/cli/migrate.ts`、seed/fixture scripts | DDL、migration history、fixture rows |

上表に加え、route内の直接Drizzle mutationがある。

- `api/routes/artifacts.route.ts`: artifact update
- `api/routes/chat.route.ts`: conversation delete

これらは移行時にRepository/commandへ寄せ、routeへWriter DBを直接渡さない。

### 3.7 読取りに見える暗黙write

read-only connectionへの分離前に、次の暗黙writeを解消する必要がある。

- `SettingsRepository.getSystemContext*()`
  - global recordがない場合、read中にinsert/migrateする。
- `LlmSettingsRepository.getSettings()` / `findEndpointById()`
  - defaultで環境変数からseedする。
- project path resolver
  - optionによりread/resolve中にproject/userを作成する。

これらは「readでなければ初期化する」という明示commandへ分離する。通常のqueryメソッドはread-only DBだけで完結し、存在しない場合はdefault viewを返すか、呼び出し側がWriter Clientを取得して初期化commandを実行する。

### 3.8 現在のtransaction

非test runtimeで明示的なDrizzle transaction callbackは現在2箇所である。

- `api/modules/scans/profile-runner.ts`
  - tool failure eventとtool run failure update
- `api/modules/static-intelligence/generation-repository.ts`
  - generation artifactsの複数insert

いずれも、結果依存のない有限statementへ整理できるため、Writer IPCのatomic batchへ置換する。client側で `BEGIN` と `COMMIT` を別リクエストとして送る方式は、他clientのstatementがtransaction内へ混入し得るため採用しない。

## 4. Scope

### 4.1 In scope

- DBファイルごとの単一Writer process
- Unix domain socket based Writer Client
- read-only SQLite connection
- Drizzle sqlite-proxy based write adapter
- FIFO write queue
- atomic write batch
- Writer lifecycle、discovery、startup race防止、stale socket recovery
- protocol version / database identity handshake
- all runtime write path migration
- migration / seed / fixture write path migration
- hidden writeの明示command化
- type/import/runtime boundary enforcement
- multi-process integration tests
- current CLI behaviorの維持

### 4.2 Non-goals

- read queryをWriterへ集約すること
- scanner、Docker、browser、LLM処理をWriter内で実行すること
- durable general-purpose job queueの新設
- SQLiteから別DBへの移行
- Web APIをWriter IPCとして流用すること
- arbitrary remote clientsへの公開
- network TCP socketでWriterを公開すること
- schema redesignやdomain model変更
- 書込み性能を上げるための並列実行

## 5. Target architecture

### 5.1 Process topology

```text
                         +-----------------------------+
Web server ------------- |                             |
scan CLI ----------------| SqliteWriterClient          |
dynamic/DAST/repro CLI --|  - protocol validation      |
MCP prepare worker ------|  - request/response codec   |--- Unix socket ---+
admin/maintenance CLI ---|  - no direct-write fallback |                   |
                         +-----------------------------+                   v
                                                              +-------------------+
each process:                                                 | SQLite Writer      |
  createReadDbConnection() ------------------------------+    | - singleton lock  |
                                                        |    | - FIFO queue      |
                                                        |    | - one connection  |
                                                        |    | - atomic batch    |
                                                        |    +---------+---------+
                                                        |              |
                                                        v              v
                                                 SQLite read-only   SQLite writable
                                                   connections       connection x1
```

### 5.2 One Writer per canonical database identity

Writerの単位はアプリ全体ではなく、canonical SQLite file pathごととする。

- `file:` / `sqlite://` / relative pathをabsolute canonical pathへ正規化する。
- canonical pathのSHA-256から `databaseId` を作る。
- socket名、lock名、handshakeに同じ `databaseId` を使う。
- clientは異なるDB用Writerへ誤接続した場合、handshakeで拒否する。
- `:memory:` は別プロセスと共有できないためproduction Writerでは禁止する。
- unit testではtest-only in-process Writer harnessを使う。
- process integration testではtemp file SQLiteを使う。

### 5.3 Unix domain socket

BunのUnix socket対応を使う。TCP portは開かない。

default socket pathはUnix socketのpath長制限を避けるため、次のような短いpathとする。

```text
${TMPDIR}/vuln-workbench-${uid}-${databaseId.slice(0, 16)}.sock
```

要件:

- `SQLITE_WRITER_SOCKET` でtest/運用上のoverrideを許可する。
- filesystem socketのpermissionをowner-onlyにする。
- handshakeでprotocol version、databaseId、writerInstanceIdを確認する。
- request body sizeに上限を設ける。初期値は16 MiBとし、source/embeddingの実測後に固定する。
- SQL parameterやsource本文、secretを通常logへ出さない。

## 6. Connection and capability boundary

### 6.1 Read connection

新規 `createReadDbConnection()` は次を満たす。

```ts
type ReadDbConnection = {
  db: ReadDatabase;
  close(): void;
};
```

- Bun SQLiteを `{ readonly: true, strict: true }` で開く。
- `PRAGMA query_only = ON` を設定する。
- `sqlite.run()` / `sqlite.exec()` を呼べるraw handleをruntime callerへ返さない。
- `ReadDatabase` の型から `insert` / `update` / `delete` / `transaction` / mutation-capable `run` を除外する。
- sqlite-vecはqueryに必要なためread connectionにもloadする。

OS-level readonlyとTypeScript capabilityの両方を使う。型castや誤importがあっても、通常プロセスのconnectionではSQLite自身がwriteを拒否する状態にする。

### 6.2 Writable connection

writable connection factoryは `api/db/writer/internal/connection.ts` に置き、公開barrelからexportしない。

このfactoryをimportできるproduction fileはWriter serverだけとする。

```ts
type WriterOwnedConnection = {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
  close(): void;
};
```

Writer起動時にのみ次を設定する。

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- 必要なら計測で決めた `busy_timeout`
- sqlite-vec extension

Writerは1本のconnectionをprocess lifetime中保持する。requestごとにconnectionを作らない。

### 6.3 Writer Client

public APIは次の形にする。

```ts
type SqliteWriterClient = {
  readonly databaseId: string;
  readonly writerInstanceId: string;
  readonly db: WriterDatabase;
  atomicBatch(statements: WriterStatement[]): Promise<WriterBatchResult>;
  health(): Promise<WriterHealth>;
  close(): Promise<void>;
};

async function getSqliteWriterClient(
  env: AppEnv,
  options?: { autoStart?: boolean; connectTimeoutMs?: number },
): Promise<SqliteWriterClient>;
```

`WriterDatabase` は `drizzle-orm/sqlite-proxy` で構築するが、public typeにはmutation APIだけを残す。

- `insert`
- `update`
- `delete`
- atomic batch用のquery preparation

通常selectは `ReadDatabase` で実行する。mutationの `RETURNING` は同じwrite statementのresponseとしてWriterから返してよい。

### 6.4 Repository dependency

mutationを持つRepositoryは、read DBだけでは構築できない形へ変更する。

推奨形:

```ts
const reads = new ScanQueryRepository(readConnection.db);

const writer = await getSqliteWriterClient(env);
const writes = new ScanCommandRepository(writer);

await writes.createScanRun(input);
```

移行量が大きいdomainは、一時的に次のconstructorを許可する。

```ts
new ScanRepository({ readDb, writerClient })
```

ただし最終形ではqueryとcommandの責務を分ける。read-only callerがWriter Clientを要求される状態や、mutation callerへBun SQLite DBを渡す状態を残さない。

## 7. IPC protocol

### 7.1 Protocol envelope

shared Zod schemaでrequest/responseを固定する。

```ts
type WriterRequest = {
  protocolVersion: 1;
  requestId: string;
  databaseId: string;
  kind: "health" | "execute" | "atomic_batch" | "admin_migrate";
  payload: unknown;
};

type WriterResponse = {
  protocolVersion: 1;
  requestId: string;
  writerInstanceId: string;
  sequence: number;
  ok: boolean;
  result?: unknown;
  error?: WriterError;
};
```

`sequence` はWriterがdequeueした順番で単調増加させる。production correctnessをsequenceだけに依存させないが、順序testと診断に使う。

### 7.2 Supported execution

通常clientが送れるのは次だけとする。

- one mutation statement
- mutation statementsのatomic batch
- health/handshake

DDL、ATTACH、DETACH、VACUUM、任意PRAGMAは通常clientから拒否する。migrationは別のadmin request kindで実行する。

SQL文字列とparameterはDrizzle sqlite-proxy callbackが生成する。application codeが生SQL文字列を直接組み立てるAPIは公開しない。

### 7.3 Value codec

JSONで失われる値をtagged encodingする。

- `null`
- string / finite number / boolean
- bigint
- `Uint8Array` / Buffer（base64）
- DateはDrizzle mapping後のinteger/stringとして送る

NaN、Infinity、function、class instance、循環参照はclient側で拒否する。

### 7.4 FIFO and atomicity

Writerはsocket handler内で直接並行実行せず、全requestをFIFO queueへ入れる。

```text
receive request
  -> validate envelope/databaseId
  -> enqueue
  -> dequeue exactly one
  -> execute synchronously on owned SQLite connection
  -> commit/rollback
  -> respond
  -> dequeue next
```

atomic batchは1回のqueue itemとして処理する。

```sql
BEGIN IMMEDIATE;
-- all statements
COMMIT;
```

失敗時は `ROLLBACK` し、batch全体をfailedにする。他clientのstatementをtransaction途中へ入れない。

client callbackを複数IPC requestへ分割するremote transactionは実装しない。現在の2箇所のtransactionはatomic batchまたは単一multi-row insertへ書き換える。

### 7.5 Backpressure

- queue lengthに上限を設ける。
- 上限超過は `WRITER_QUEUE_FULL` を返す。
- queue wait timeとexecution timeを別々に計測する。
- client timeoutでrequest自体を勝手にcancelしない。SQLite execution開始後の取消しは結果不明を生むためである。
- shutdown時は新規受付を止め、in-flightとqueueをdrainしてからconnectionを閉じる。

## 8. Lifecycle and singleton guarantee

### 8.1 Startup

次の起動方法を用意する。

```bash
bun run db:writer
bun run start
```

- `db:writer` はforeground Writer serverとして起動する。
- `start` はWriter readinessを確認してからWeb serverを起動する。
- standalone CLIは `getSqliteWriterClient({ autoStart: true })` を使い、Writerがなければ起動を試みる。
- testは明示したsocket/temp DBでWriter lifecycleを管理する。

### 8.2 Concurrent auto-start

複数clientが同時にWriterを起動しようとしても、writable connectionを2本開かないことが必須である。

手順:

1. clientは既存socketへhealth requestを送る。
2. 接続できなければ、databaseId単位のatomic startup lock取得を試す。
3. lock取得者だけがWriter processをspawnする。
4. 他clientはbounded retryでsocket readinessを待つ。
5. Writerはstartup lockを所有した状態でsocket bindし、その後writable connectionを開く。
6. 2つ目のWriterはlock/bindに失敗し、DBを開かず終了する。

lockにはPID、databaseId、writerInstanceId、createdAtを記録する。stale recoveryはsocket health失敗かつPID不在を確認した場合だけ行う。PIDだけを信頼してlockを消さない。

### 8.3 Shutdown and crash

- SIGINT/SIGTERMで受付停止、queue drain、connection close、socket/lock cleanupを行う。
- process crash時のSQLite transactionはrollbackされることをintegration testで確認する。
- stale socket/lockは次回client startupで安全に回復する。
- request送信後にconnectionが切れた場合、clientは自動再送しない。
- callerは既知IDをread-only DBから照合し、結果をreconcileする。

少なくとも初期実装では「切断後のtransparent exactly-once retry」は目標にしない。各create commandのIDは可能な限りclient側で先に生成し、再試行時に同じIDを使えるようにする。

## 9. Hidden write elimination

read-only connection導入前に次を変更する。

### 9.1 Settings

```ts
// read only
getSystemContext(): Promise<SystemContextRecord | null>

// Writer Client required
initializeGlobalSystemContext(writer): Promise<SystemContextRecord>
updateSystemContext(writer, input): Promise<SystemContextRecord>
```

read requestでglobal recordがなければ、空のdefault viewを返す。startup/bootstrapが明示的にinitialize commandを呼ぶ。

### 9.2 LLM settings

`getSettings()` と `findEndpointById()` からenv seedを外す。

```ts
getSettings({ maskSecrets }): Promise<LlmSettingsResponse> // read only
initializeSettingsFromEnv(writer, env): Promise<void>      // explicit write
replaceSettings(writer, input): Promise<void>              // explicit write
```

Web startupまたはbootstrapがWriter Client取得後に一度だけinitializeする。

### 9.3 Project path resolution

path lookupとproject作成を分ける。

```ts
resolveExistingProjectByPath(readDb, path)
createProjectForPath(writer, validatedPath, owner)
```

`createProject` optionを使うCLIは、明示的にWriter Clientを取得してcreate commandを呼ぶ。

## 10. Migration inventory

### 10.1 Web server domain writes

次をWriter Client依存へ変更する。

- AuthService / refresh token
- SettingsRepository
- LlmSettingsRepository / health check record
- SourceRepository / markdown importer / fragment embedding update
- ChatService / conversation delete / artifact update
- ProjectRepository mutation
- ScanRepository mutation
- FindingDecisionRepository
- FindingReviewRepository
- ScanReviewRepository
- ScanReportRepository
- DiagnosticsRepository
- DynamicRepository
- DastRepository
- ReproductionRepository
- Static Intelligence prepare/generation/embedding repositories

routeへ `WriterDatabase` を直接渡さない。routeはdomain command serviceまたはcommand repositoryを受け取る。

### 10.2 Child process writers

優先度順に移行する。

1. `scan-profile.ts`
2. legacy direct scan CLIs
   - `scan-semgrep.ts`
   - `scan-gitleaks.ts`
   - `scan-osv.ts`
   - `scan-trivy.ts`
   - `scan-import.ts`
3. `dynamic-run.ts`
4. `scan-dast.ts`
5. `repro-finding.ts`
6. `static-intelligence-prepare-worker.ts`

scanner、Docker、artifact file作成は引き続きchild processで行う。DB rowの登録・更新だけをWriter Clientへ切り替える。

### 10.3 Standalone mutation CLI

- `auth-create-admin.ts`
- `seed.ts`
- `import-markdown.ts`
- `scan-profile.ts` と各scan CLI
- `oracle-security.ts`
- `review-finding.ts`
- `review-scan.ts`
- `decision-finding.ts`
- `report-scan.ts`
- `inventory-attack-surface.ts`
- `check-security.ts`
- `report-diagnostic.ts`
- `dynamic-run.ts`
- `scan-dast.ts`
- `repro-finding.ts`
- `intelligence-build.ts`
- `intelligence-index.ts`
- `llm-route-repair.ts`
- `static-intelligence-prepare-worker.ts`

### 10.4 Read-only CLI

次のCLIはWriter Clientを取得せず、`createReadDbConnection()`へ切り替える。

- intelligence query / export
- code structure / project structure read
- communities / landscape / agent query
- exploration catalog
- knowledge source / guardrail material
- Static Intelligence MCPのread-only tools

prepare toolだけはWriter Clientを取得してjobを登録する。

### 10.5 Migration / seed / fixtures

`api/cli/migrate.ts` のraw SQLite writeをWriterの `admin_migrate` requestへ移す。

- migration directoryの列挙とfile readはclient側で行ってよい。
- migration SQLの実行とmigration history insertはWriter側の1 transactionで行う。
- `db:migrate:drizzle` は直接write bypassになるため削除するかWriter経由commandへ置換する。
- seedは通常Writer Client経由にする。
- fixture scriptsはtest Writer harnessまたはfixture用Writer Clientを使う。
- production runtime moduleから `wrapExternalDatabase()` を削除し、必要ならtest-only helperへ移す。

## 11. Implementation slices

### Slice 0: Baseline and inventory lock

1. 現在のwrite surface inventoryをtest fixtureとして固定する。
2. `scripts/check-sqlite-write-boundary.ts` の最初の版を追加する。
3. 初期段階では既存direct writerをallowlistに列挙する。
4. allowlistは減少のみ許可し、新規direct writer追加をCIで失敗させる。
5. baseline commands:

```bash
git status --short
rg -n "createDbConnection|new Database|\.insert\(|\.update\(|\.delete\(|\.transaction\(" api scripts
bun test api/modules/scans/scan-process-supervisor.test.ts api/modules/scans/scan-semgrep.e2e.test.ts
bun run verify
```

Acceptance:

- 現在のdirect write filesが機械可読allowlistに固定される。
- 新しいdirect writerを追加するとCIが失敗する。

### Slice 1: Protocol and sqlite-proxy compatibility spike

最初にtemp DBとreal subprocessで小さいvertical sliceを作る。

検証対象:

- insert/update/delete
- `RETURNING`
- on-conflict insert/update
- multi-row insert
- JSON column
- Date column
- Buffer / embedding blob
- sqlite-vec load
- atomic batch commit/rollback
- concurrent client order
- Writer disconnect error

既存dependencyの `drizzle-orm/sqlite-proxy` を使い、新規ORMは導入しない。

Stop condition:

- 現在のschema valueをlosslessにround-tripできない。
- `RETURNING` mappingが既存Bun SQLite driverと互換にならない。
- atomic batch内へ別clientのwriteが混入する。

Stop conditionを満たした場合はdomain command protocolへ設計を更新し、generic SQL transportを中途半端に残さない。

### Slice 2: Read/write connection split

1. `api/db/read.ts` を追加する。
2. `api/db/writer/internal/connection.ts` を追加する。
3. `AppDatabase` を `ReadDatabase` / `WriterDatabase` / internal DB typeへ分離する。
4. read connectionをOS-level readonly + `query_only` にする。
5. hidden writeを明示commandへ分離する。
6. read-only CLIを先に `createReadDbConnection()` へ移す。

Acceptance:

- read connectionからinsertを試すintegration testがreadonly errorになる。
- read-only CLIがDB fileを変更しない。
- query method内の暗黙insert/update/deleteがなくなる。

### Slice 3: Writer server/client core

追加予定:

- protocol schema
- value codec
- Unix socket server
- FIFO queue
- atomic batch executor
- singleton startup lock
- client discovery/autostart
- health/handshake
- signal shutdown
- structured error mapping

Acceptance:

- 20以上のclient processを同時起動してもwriterInstanceIdが1つだけである。
- 全response sequenceが一意で、処理順を再現できる。
- row数が期待値と一致し、`SQLITE_BUSY` が発生しない。
- 2つ目のWriterはwritable connectionを開く前に終了する。

### Slice 4: Repository capability split

domainごとにquery/command dependencyを分ける。

優先順:

1. scan/project/artifact/finding
2. review/decision/report
3. dynamic/DAST/reproduction
4. diagnostics
5. Static Intelligence prepare/generation/embedding
6. auth/settings/LLM
7. sources/chat

mutation repositoryは `SqliteWriterClient` なしでconstructできないようにする。

Acceptance:

- mutation repositoryへ `ReadDatabase` を渡すコードがcompileしない。
- query repositoryはWriter Clientなしで利用できる。
- route/serviceへraw writable DBを渡す箇所がない。

### Slice 5: Web scan and child scan cutover

1. Web server startupでread connectionとWriter Clientを取得する。
2. queued scan/event作成をWriterへ移す。
3. child `scan-profile.ts` にsocket/database identityを継承する。
4. childの全scan mutationをWriterへ移す。
5. atomic claimをWriter statementとして維持する。
6. process ownership/cancel testsを維持する。

Acceptance:

- Web serverとscan childはwritable connectionを開かない。
- queued -> running -> terminal transitionが同じWriter instanceで記録される。
- duplicate claimは従来どおり1件だけ成功する。
- scan E2EがWriter process経由でpassする。

### Slice 6: Other spawned writer cutover

個別に次を移行する。

- dynamic run
- DAST
- reproduction
- Static Intelligence prepare worker / recovery worker

各sub-sliceでdirect connectionを削除し、focused E2Eを通してから次へ進む。

Acceptance:

- 各child processはread-only DB + Writer Clientだけを持つ。
- detached worker heartbeatもWriter queue経由になる。
- scanner/sandbox process境界は変わらない。

### Slice 7: Web domain and standalone CLI cutover

残るWeb route/serviceとstandalone mutation CLIをdomain単位で移行する。

特にroute内直接mutationを先にRepositoryへ移す。

- artifact update
- conversation delete

Acceptance:

- `api/routes` にDrizzle insert/update/deleteが残らない。
- standalone CLIをWeb server停止中に実行してもWriter autostart経由で動く。
- Writer接続失敗時に直接SQLiteへfallbackしない。

### Slice 8: Migration, seed, fixtures

1. migrationをadmin Writer requestへ移す。
2. seedをWriter Clientへ移す。
3. fixture/test setupをtest Writer harnessへ移す。
4. `:memory:` direct DB mutation testを段階的にin-process Writer harnessへ置換する。
5. real process behaviorを確認するtestはtemp file + Unix socketを使う。

Acceptance:

- package scriptsに直接SQLiteを書き込むmigration commandがない。
- test-only bypassはtest directoryからだけimport可能である。
- production build graphにtest writable factoryが入らない。

### Slice 9: Hard enforcement and legacy removal

1. `createDbConnection()` を削除する。
2. production `wrapExternalDatabase()` を削除する。
3. direct writer allowlistを空にする。
4. writable Bun SQLite importをWriter internalの1箇所へ限定する。
5. Writer-required modeをdefaultにする。
6. legacy direct modeを削除する。
7. README / LLM_CONTEXT / operational docsを更新する。

Acceptance:

- boundary check allowlistが空でpassする。
- Writer process以外のproduction processがwritable connectionを作れない。
- Writer停止時のmutationは明示的にfailし、DBへ直接writeされない。
- full verificationがpassする。

## 12. Enforcement

### 12.1 Static enforcement

`scripts/check-sqlite-write-boundary.ts` を `bun run verify` に組み込む。

最低限、次を検査する。

- `bun:sqlite` のproduction import allowlist
- `new Database()` のproduction usage
- `{ create: true }` / `{ readwrite: true }` usage
- `createWritableDbConnection` import
- raw `sqlite.run/exec/query(...).run` mutation
- route内のDrizzle insert/update/delete
- legacy `createDbConnection` usage
- mutation repositoryがWriter Client型を要求しているか

単純な文字列だけではhash `.update()` やMap `.delete()` を誤検出するため、最終版はTypeScript ASTとimport sourceを使う。

### 12.2 Runtime enforcement

- normal connectionはSQLite readonly flagでopenする。
- `query_only` を追加する。
- writable factoryはWriter internalだけに置く。
- Writer singleton lockなしではwritable connectionを開かない。
- protocol/database identity不一致を拒否する。
- Writer unavailable時にdirect fallbackしない。

### 12.3 Test enforcement

次のnegative testsを必須にする。

- read connectionのINSERTが失敗する。
- normal CLIからwritable DB factoryをimportできない。
- Writerなし + autostart disabledのmutationが明示エラーになる。
- Writerなしでもread-only CLIは動く。
- 2つ目のWriterが起動できない。
- invalid databaseId/protocol version requestが拒否される。
- DDL requestが通常clientから拒否される。

## 13. Failure contract

shared error codeを定義する。

```text
WRITER_UNAVAILABLE
WRITER_START_TIMEOUT
WRITER_PROTOCOL_MISMATCH
WRITER_DATABASE_MISMATCH
WRITER_QUEUE_FULL
WRITER_REQUEST_TOO_LARGE
WRITER_INVALID_STATEMENT
WRITER_TRANSACTION_FAILED
WRITER_RESULT_UNKNOWN
WRITER_SHUTTING_DOWN
```

規則:

- validation errorはretryしない。
- queue full / unavailableはcaller policyに従いbounded retry可能。
- request送信後の切断は `WRITER_RESULT_UNKNOWN` とし、自動再送しない。
- DB constraint errorは元のSQLite codeをsanitized detailsとして保持する。
- SQL/params/secret/source本文をerror messageへ含めない。

## 14. Observability

Writer log/eventに次を含める。

- writerInstanceId
- databaseIdの短縮値
- requestId
- sequence
- operation kind
- queue wait ms
- execution ms
- statement count
- success/error code
- queue depth

含めないもの:

- SQL parameter value
- source body
- API key/token/password
- full database path（通常logではrootRef相当へredact）

health response:

```ts
type WriterHealth = {
  status: "ready" | "draining";
  writerInstanceId: string;
  databaseId: string;
  protocolVersion: 1;
  pid: number;
  queueDepth: number;
  lastSequence: number;
};
```

## 15. Verification plan

### 15.1 Focused unit tests

- protocol schema
- tagged value codec
- request size limit
- FIFO queue
- atomic batch commit/rollback
- error mapping/redaction
- stale lock decision
- read/write type boundaries

### 15.2 Real process integration tests

1. temp SQLite fileをmigrationする。
2. Writer processを1つ起動する。
3. 20〜50 client processを並行起動する。
4. 各clientがunique rowをinsert/updateする。
5. responseのwriterInstanceIdが1つであることを確認する。
6. sequenceの重複がないことを確認する。
7. read-only connectionから最終row数を確認する。
8. `SQLITE_BUSY` / lost writeがないことを確認する。

追加scenario:

- 同時autostart
- Writer crash during batch
- client crash after send
- stale socket/lock recovery
- queue full
- large blob/JSON payload
- migration中の通常write拒否
- shutdown drain

### 15.3 Existing E2E migration

現在、親test processが接続を持ったままchild scan CLIへ同じDBを書かせるE2Eがある。これを次の期待へ変更する。

```text
parent: read-only connection
child: read-only connection + Writer Client
writer: only writable connection
```

既存のscan/dynamic/DAST/reproduction/static-intelligence CLI testsは、DB結果だけでなくWriter instance identityも検証する。

### 15.4 Full verification

各sliceでfocused testsを実行し、final cutover前に次を実行する。

```bash
bun run typecheck
bun run lint
bun run format:check
bun test api/db/writer
bun run verify
bun run build
```

## 16. Performance acceptance

目的は並列write性能ではなく、競合しない予測可能なwriteである。ただし明らかなregressionを防ぐ。

計測するもの:

- 1 statement round-trip p50/p95
- 100 sequential writes
- 20 concurrent clientsのtotal completion time
- scan profile 1回のDB write total time
- Static Intelligence generation artifact/embedding persistence time
- max queue depth

初期acceptance:

- correctness testでlost write / duplicate execution / `SQLITE_BUSY` が0件。
- 通常Web mutationが既定client timeout以内に完了する。
- scan全体時間に対してWriter IPCが支配的にならない。
- regression thresholdはSlice 1 baseline採取後に数値固定する。

## 17. Rollout strategy

移行期間だけ次のmodeを持つ。

```text
legacy   : 未移行domainのみ。新規write pathでは使用禁止。
broker   : 移行済みdomainはWriter必須。fallback禁止。
required : 全domainでWriter必須。legacy factory利用時は起動失敗。
```

規則:

- dual-writeは行わない。
- broker failure時にlegacy direct writeへfallbackしない。
- domain単位でlegacyかbrokerのどちらか一方だけを使う。
- CIは早期からrequired modeの対象testを増やす。
- Slice 9でlegacy modeとflag自体を削除する。

rollbackはprocess稼働中のmode切替ではなく、Writerを停止して以前のreleaseへ戻す。新旧processが同じDBへ同時writeする状態を作らない。

## 18. Target files

新規候補:

- `api/db/read.ts`
- `api/db/types.ts`
- `api/db/writer/protocol.ts`
- `api/db/writer/codec.ts`
- `api/db/writer/client.ts`
- `api/db/writer/server.ts`
- `api/db/writer/queue.ts`
- `api/db/writer/lifecycle.ts`
- `api/db/writer/internal/connection.ts`
- `api/db/writer/testing/in-process-writer.ts`
- `api/cli/sqlite-writer.ts`
- `scripts/check-sqlite-write-boundary.ts`
- `scripts/start-with-sqlite-writer.ts`

主な変更対象:

- `api/db/index.ts`
- `api/app/env.ts`
- `api/app/hono.ts`
- `api/app/server.ts`
- `api/modules/**/**repository.ts`
- mutationを持つservice/runner
- spawned CLI routes
- mutation CLI entrypoints
- `api/cli/migrate.ts`
- seed/fixture scripts
- `scripts/verify.ts`
- `package.json`
- `README.md`
- `README.jp.md`
- `LLM_CONTEXT.md`

## 19. Implementation gates

1. **Gate A: Proxy compatibility**
   - existing schema values、RETURNING、upsert、blob、atomic batchがreal processでpassする。
2. **Gate B: Read-only truthfulness**
   - read APIに暗黙writeがなく、OS-level readonlyで全read testsがpassする。
3. **Gate C: Singleton lifecycle**
   - concurrent startupでもwritable connection ownerが1processだけになる。
4. **Gate D: First end-to-end domain**
   - Web scan親子の全writeが同一Writerを通る。
5. **Gate E: All spawned workers**
   - dynamic/DAST/reproduction/prepare workerがdirect writeをしない。
6. **Gate F: All runtime domains**
   - Web/CLIの全mutationがWriter Clientを要求する。
7. **Gate G: Maintenance closure**
   - migration/seed/fixtureにもproduction bypassがない。
8. **Gate H: Hard enforcement**
   - allowlist空、legacy factory削除、required mode、full verify pass。

## 20. Definition of done

次をすべて満たした時だけ、単一Writer化を完了とする。

- DBファイルごとにwritable SQLite connectionを持つproduction processが1つだけである。
- Writer processが1本のconnectionをprocess lifetime中保持する。
- Web server、全CLI、全workerはread-only connectionしか直接開けない。
- 全mutation APIが `SqliteWriterClient` を取得しなければ利用できない。
- Writer unavailable時のdirect fallbackがない。
- migration、seed、fixtureを含む残存direct writeがない。
- read method内の暗黙writeがない。
- atomic batchへ別clientのstatementが混入しない。
- concurrent client integration testでlost write、duplicate write、`SQLITE_BUSY` がない。
- second Writer startupが拒否される。
- static boundary checkのallowlistが空である。
- existing focused tests、`bun run verify`、buildがpassする。
- READMEに起動、障害、手動health確認、stale recovery手順が記載される。

## 21. Avoid

- Writer接続失敗時に直接SQLite writeへfallbackしない。
- Web serverを起動していないとstandalone CLIが使えない設計にしない。
- scannerやLLM処理をWriter queue内で実行しない。
- transactionをBEGIN/statement/COMMITの別IPC requestへ分割しない。
- read methodに初期化writeを隠さない。
- migrationだけ恒久的なdirect-write例外にしない。
- test helperをproduction import可能な場所からexportしない。
- generic SQL APIをapplication codeへ公開しない。
- legacy/brokerへのdual-writeをしない。
- allowlistが残った状態で完了扱いにしない。
