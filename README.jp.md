# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-1.3.14-black?logo=bun)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-19-20232a?logo=react)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local-07405e?logo=sqlite)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE.md)

[English](README.md) | 日本語

vulnWorkbenchは、複数のセキュリティスキャナーによる検査結果を一か所に集め、根拠をたどれるレポートとして残すローカルアプリです。ソースコード、依存ライブラリ、設定ファイル、実行中のWebアプリなどを検査し、「何が見つかったか」だけでなく「どこまで検査できたか」「何が未確認か」も記録します。

ここでいう**ワークベンチ**は、単体のスキャナーではなく、検査の準備、実行、結果の整理、再確認、レポート作成までを同じ画面とデータベースで扱う作業台という意味です。

> [!IMPORTANT]
> vulnWorkbenchは、専門家によるペネトレーションテストの代替ではありません。ペネトレーションテストとは、攻撃者の立場でシステムへ侵入できるかを総合的に調べる診断です。v1.0.0の検証証跡では、専門的な自動診断能力に関する総合判定は`not_met`（基準未達）のままです。詳しくは[現在確認できている限界](#現在確認できている限界)を参照してください。

## なぜ作ったか

スキャナーを何種類も使うと、出力形式がばらばらになり、失敗した検査まで「問題なし」に見えることがあります。AIによる要約だけを読む運用では、元の出力を確認しにくく、AIがどの事実を根拠にしたのかも曖昧になりがちです。

vulnWorkbenchは、次の順序を崩さないように作られています。

```text
ローカルのプロジェクト
  → 実行前の条件確認
  → スキャナーによる検査と証跡の保存
  → 共通形式への変換
  → 保存済みデータから作る基本レポート
  → 必要に応じたLLMレビュー
  → 修正担当者へ渡せるレポートと作業依頼
```

**証跡**は、判断の根拠になったスキャナー出力、ログ、対象ファイルの位置、実行条件などです。**LLM**（Large Language Model、大規模言語モデル）は文章を理解・生成するAIですが、このアプリではリポジトリを自由に探索させません。LLMが読むのは、アプリが保存して範囲を制限した検出結果と証跡だけです。

LLMを設定していない場合や、LLMの応答が所定の形式に合わなかった場合も、スキャナーの事実から作る基本レポートは残ります。その場合は、AIレビューを完了できなかった理由が制限事項として記録されます。

## できること

- ローカルにあるリポジトリをプロジェクトとして登録する。
- 検査目的に合わせたスキャンプロファイルを選び、複数のスキャナーをまとめて実行する。
- Gitのコミット、ブランチ間の差分、コミット前の作業ツリーだけを対象にする。
- 各ツールの出力を、重大度、検出位置、根拠を持つ共通の「検出結果」へ変換する。
- 検査済み、未実行、対象外、失敗を区別し、検査範囲を記録する。
- 過去のスキャンと比較し、新規・継続・悪化した問題を確認する。
- 保存済みの検出結果を、AIの要約を含まないテキストとしてダウンロードする。
- 根拠の強さ、誤検知の可能性、悪用のしやすさ、業務への影響、修正案をLLMで整理する。
- Markdown形式のレポートと、別の開発担当者やコーディングエージェントへ渡す修正依頼を作る。Markdownは、見出しや表を普通のテキストで表せる文書形式です。コーディングエージェントは、依頼に沿ってコードを調査・変更するAIツールを指します。
- ソースコード本文を渡さずに、ファイル構成やモジュール間の関係を外部エージェントへ公開する。

**スキャンプロファイル**とは、対象範囲、使うツール、制限時間、失敗時の扱いをまとめた実行メニューです。利用者がスキャナーごとの細かな引数を毎回組み立てなくても、同じ条件で検査を繰り返せます。

## 最初に動かす

### 必要なもの

- [Bun](https://bun.sh/) 1.3.14
- ローカルで動かすためのターミナル
- 実際にスキャンする場合は、選んだプロファイルが使うスキャナー、またはDocker

Bunは、TypeScriptの実行、パッケージの導入、テストを一つで扱う実行環境です。このリポジトリはBun 1.3.14で検証されています。

開発環境では、スキャナーをホスト、つまり自分のPC上で直接実行する設定が初期値です。たとえば`baseline`プロファイルには`gitleaks`と`osv-scanner`が必要です。Dockerを選ぶ場合は、スキャナーをまとめたツールボックスイメージを先に用意します。

### セットアップ

```bash
git clone https://github.com/ugnoguchigxp/vlunWorkbench.git
cd vulnWorkbench
bun install --frozen-lockfile
bun run bootstrap
bun run dev
```

`bun run bootstrap`が行うのは次の3点です。

1. `.env`がなければ`.env.example`をコピーする。
2. SQLiteのマイグレーションを適用する。マイグレーションとは、保存済みデータを残したままデータベースの構造を更新する処理です。
3. ローカル管理者`admin@example.com`を作成または確認し、初回は生成したパスワードを表示する。

ブラウザで[http://localhost:29831](http://localhost:29831)を開き、コマンドに表示されたメールアドレスとパスワードでログインしてください。2回目以降の`bootstrap`は、既存の管理者パスワードを変更しません。変更したい場合だけ次を実行します。

```bash
bun run bootstrap -- --reset-admin-password
```

セットアップ後の状態は、次のコマンドで確認できます。`.env`、データベース、管理者、ポート、SQLite拡張機能、スキャナーの有無を検査します。

```bash
bun run bootstrap:check
```

スキャナーが見つからないという`WARN`は、Webアプリ自体の起動失敗ではありません。ただし、そのスキャナーを使うプロファイルは実行できません。

### 画面から最初のスキャンを行う

1. **Projects**で対象リポジトリの絶対パスを登録します。macOSでは管理者だけがフォルダ選択画面を使えます。
2. **Scans**で登録したプロジェクトを選びます。
3. まず`baseline`を選び、実行前チェックを確認します。
4. スキャンを開始し、ツールごとの進行状況と検出結果を確認します。
5. LLMを使う場合は、**Settings > AI・モデル**で接続先を、**Settings > タスクルーティング**で用途ごとのモデルを設定します。
6. レポートを開き、検査範囲、制限事項、根拠、修正案を確認します。

**実行前チェック（preflight）**は、必要なスキャナー、入力ファイル、Dockerイメージ、権限、対象範囲がそろっているかを、実際の検査前に確かめる処理です。必須条件が欠けていれば、問題のある状態で検査を始めずに停止します。

## 結果の読み方と保存内容

スキャナーが報告した1件の候補を、このプロジェクトでは**finding（検出結果）**と呼びます。findingは脆弱性の確定判定ではありません。誤検知、つまり実際には問題ではない候補も含まれます。

保存する情報は、役割ごとに分かれています。

| 情報 | 何を表すか |
| --- | --- |
| Scan run | 1回のスキャン全体。対象、プロファイル、開始・終了時刻、成否を持ちます。 |
| Tool run | スキャン内で行った各スキャナーの実行。終了コード、ログ、使用バージョンを持ちます。 |
| Finding | スキャナーが検出した問題候補。重大度、規則、場所、重複判定に使う識別子を持ちます。 |
| Evidence | findingの根拠。該当位置、短い抜粋、再現情報などです。 |
| Artifact | スキャナーの生出力、ログ、生成したレポートなどのファイルです。 |
| Coverage | どの観点を検査できたか、未実行や対象外が残っていないかを表します。 |
| Review | 保存済みデータを基にしたLLMまたは人の評価です。スキャナーの原本は書き換えません。 |

同じ入力から同じ構成を作れる基本レポートを、コード上では**deterministic report**と呼んでいます。ここでのdeterministic（決定的）は、保存済みの同じレコードを使えば見出しや集計方法が変わらない、という意味です。LLMが生成した文章まで毎回同一になるという意味ではありません。

検出が0件でも、安全だとは判定しません。必要なスキャナーが失敗した場合や、対象範囲が不足した場合は、`inconclusive`（結論を出せない）または`not_tested`（未検査）として扱います。

## 主なスキャナー

| ツール | このプロジェクトでの役割 |
| --- | --- |
| Gitleaks | ソースや履歴に、APIキーやパスワードなどの機密情報が混入していないかを探します。 |
| OSV-Scanner | 利用しているライブラリの名前とバージョンを、既知の脆弱性データベースと照合します。これはSCA（Software Composition Analysis、依存部品の検査）に当たります。 |
| Trivy | 依存ライブラリ、コンテナイメージ、機密情報、設定ミスを調べ、SBOMも作成します。 |
| zizmor | GitHub Actionsの権限、外部処理の参照固定、入力値の扱いなど、CI設定の危険な書き方を調べます。CIは、テストやビルドを自動実行する仕組みです。 |
| Semgrep | コードの書き方を規則と照合するSASTです。SAST（Static Application Security Testing、静的解析）は、アプリを起動せずにソースコードを調べる方法です。標準では無効です。 |
| Nuclei | 安全性を確認したテンプレートだけを使い、起動中のWebアプリへ少数のHTTPリクエストを送ります。 |
| ZAP Baseline | Webページをたどり、通信内容を受動的に調べます。Baseline実行では攻撃用リクエストを送りません。 |
| Schemathesis | OpenAPIまたはGraphQLの仕様を読み、読み取り専用のAPI操作に限って応答を確認します。APIは、プログラム同士が機能やデータをやり取りする入口です。OpenAPIは、その入口や入力形式を記述する仕様です。GraphQLのQueryは、データを読むための操作です。 |
| Cosign / slsa-verifier | 配布物の署名や来歴を確認します。来歴（provenance）は、誰がどのソースとビルド手順から成果物を作ったかを示す記録です。SLSA（Supply-chain Levels for Software Artifacts）は、その来歴やビルド工程の信頼性を段階的に確認する枠組みです。 |

**SBOM**（Software Bill of Materials、ソフトウェア部品表）は、アプリに含まれるライブラリとバージョンの一覧です。問題を直接検出するレポートではなく、影響を受ける部品を後から調べるための台帳として使います。

Semgrepはライセンスと配布境界を分けるため、標準ツールボックスには含めていません。利用する場合は専用イメージを作り、環境変数で明示的に有効化します。

```bash
bun run docker:plugin:semgrep:build
VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep bun run dev
```

`OPTIONAL`で有効化したSemgrepが使えない場合は、制限事項を残して処理を続けます。必須にする場合は`VULN_WORKBENCH_REQUIRED_SCANNER_ADAPTERS=semgrep`を使います。

DockerでSemgrepを動かす場合は、**Settings > スキャン実行**のイメージを`vuln-workbench-toolbox-semgrep:local`へ変更してください。ホスト実行を選ぶ場合は、PC上で`semgrep`コマンドを実行できる必要があります。

## よく使うスキャンプロファイル

| プロファイルID | 用途 |
| --- | --- |
| `baseline` | GitleaksとOSV-Scannerで、機密情報と依存ライブラリを短時間で確認します。 |
| `basic-security` | `baseline`にTrivyを加え、設定ミスも確認します。 |
| `change-gate` | コミットや作業中の差分を厳格に検査します。High以上の問題を変更の合否判定に使う設定です。 |
| `source-assurance` | リポジトリ全体をGitleaks、OSV-Scanner、Trivy、zizmorで確認します。Semgrepは有効化時だけ加わります。 |
| `dependency-supply-chain` | 依存関係、SBOM、成果物の署名または来歴を確認します。 |
| `runtime-web-safe` | 隔離して起動したWebアプリへ、受動的DAST、Nuclei、ZAP Baselineを実行します。 |
| `api-schema-readonly` | OpenAPIまたはQueryだけのGraphQL APIを、読み取り操作に限定して確認します。 |
| `container-image-security` | 既に存在するコンテナイメージまたはイメージファイルをTrivyで検査します。自動ビルドはしません。 |
| `full-security-scan` | 静的検査、SBOM、受動的なWeb検査をまとめた旧来の総合プロファイルです。能動的な攻撃は行いません。 |

**DAST**（Dynamic Application Security Testing、動的検査）は、起動中のアプリへHTTPリクエストを送り、実際の応答を調べる方法です。受動的（passive）な検査は、通常の閲覧に近いリクエストと応答の観察を中心にします。能動的（active）な検査は、異常な入力や状態変更を伴うため、別の許可と安全対策が必要です。

安定版と実験版を含む正式なプロファイル一覧は、[スキャン能力表](spec/generated/security-capability-table.html)と`api/modules/scans/profile-catalog.ts`で確認できます。

## Dockerでスキャナーを動かす

ホストへ各スキャナーを導入したくない場合は、標準ツールをまとめたDockerイメージを作れます。ビルド時は固定したソースとチェックサムを検証し、オフライン用の脆弱性データもイメージへ入れます。チェックサムは、ダウンロードした内容が想定したファイルと一致するかを確かめる値です。

```bash
bun run docker:toolbox:build
```

その後、**Settings > スキャン実行**で実行方式を`docker`、イメージを`vuln-workbench-toolbox:local`に設定します。Docker実行では、初期値としてネットワークを切り、メモリ4 GiB、CPU 2、PID 512の上限を付けます。PIDは、コンテナ内で同時に存在できるプロセス数です。

Webアプリを自動起動する実行時プロファイルには、さらに専用の隔離環境が必要です。次のコマンドはDockerの状態を確認し、固定したイメージIDと検証ハッシュをSQLiteへ保存します。

```bash
bun run runtime-isolation:auto-configure
```

この隔離環境は、対象アプリ、必要なデータベース、HTTP検査ツールを使い捨てのコンテナ名前空間へ入れます。コンテナ名前空間とは、ネットワークやプロセスをホストと分離するDockerの境界です。現時点で自動起動の対象として検証されている依存解決方式は、`package-lock.json`を使うnpmと、Bunのロックファイルを使う構成です。

## CLIから使う

### 基本スキャン

パスから初回登録し、そのまま`baseline`を実行する例です。

```bash
bun run scan:profile -- \
  --project-path /path/to/repository \
  --create-project true \
  --profile baseline \
  --timeout-sec 600 \
  --report-output report.md
```

CLIスキャンは、初期値で自動診断と最終レポート作成まで待ちます。LLMが使えなければ、制限事項付きの基本レポートを`report.md`へ書きます。スキャナーの実行だけに限定する場合は`--automated-diagnostic false`を指定します。

### Git差分のスキャン

コミット前の変更内容を確認する場合は、まずプレビューで対象ファイルと対象内容のSHA-256を確認します。SHA-256は、内容が変わると別の値になる識別用ハッシュです。

```bash
bun run scan:profile -- \
  --project-path /path/to/repository \
  --profile change-gate \
  --target working-tree \
  --base HEAD \
  --include-untracked true \
  --preview true
```

`--target commit`は1コミット、`--target range`は2つのGit参照の間、`--target working-tree`は未コミットの変更を対象にします。差分ファイルの全体を検査するため、見つかった問題がその差分で新たに作られたとは限りません。

### レポートを作り直す

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown \
  --summary-mode deterministic \
  --output report.md
```

LLMによる短い要約を追加する場合は、`--summary-mode deterministic_with_llm_summary`を使います。

### データベースをバックアップする

```bash
bun run backup:create -- --output backups/vuln-workbench.sqlite
bun run backup:verify -- --input backups/vuln-workbench.sqlite
```

バックアップの検証では、SQLiteファイルとして開けるか、必要な整合性を保っているかを確認します。暗号化して保存したLLMの認証情報を復元するには、データベースとは別に`LLM_SETTINGS_ENCRYPTION_KEY`も保管してください。

## LLMの設定と役割

管理者は**Settings > AI・モデル**で接続先とモデルを登録し、**Settings > タスクルーティング**で用途ごとのモデルを選びます。タスクルーティングとは、「検出結果のレビューはこのモデル、検索は別のモデル」のように処理の種類と接続先を対応させる設定です。

| タスク | 用途 |
| --- | --- |
| `finding_review` | 1件の検出結果と、その証跡を詳しく確認する。 |
| `scan_review` | スキャン全体の優先順位、誤検知の可能性、修正順序、引き継ぎ文を作る。 |
| `report_summary` | 既存の基本レポートへ短いAI要約を追加する。 |
| `evidence_context` | 保存済み証跡を、後続処理が読みやすい形に整理する。 |
| `agentic_search` | ローカルのナレッジ情報を複数手順で検索する。 |

保存するAPIキーはAES-256-GCMで暗号化します。AES-256-GCMは、内容を読めなくする暗号化と、改ざん検知を同時に行う方式です。利用前に次のような32バイトの鍵を作り、`.env`の`LLM_SETTINGS_ENCRYPTION_KEY`へ設定してください。

```bash
openssl rand -base64 32
```

この鍵はデータベースへ保存されません。失うと、データベース内のAPIキーを復号できなくなります。スキャナー用コンテナや検査対象のプロジェクトへ、LLMのAPIキーを渡す設計にはなっていません。

## 保存先と構成

初期設定では、主要な記録を`data/vuln-workbench.sqlite`、スキャナー出力やレポートを`artifacts/scans/`へ保存します。いずれも実行時に生まれるデータであり、Gitへコミットする対象ではありません。

ファイル型SQLiteへの書き込みは、1データベースにつき1つの**Writerプロセス**に集約します。SQLiteは1ファイルで動くデータベースです。複数のWeb処理やCLIが同時に直接書き込むと競合しやすいため、読み取りは各処理が行い、追加・更新・削除だけをWriterが順番に処理します。

```bash
bun run db:writer:health
bun run db:boundary
```

Writerへ接続できない場合、アプリは直接書き込みへ切り替えず、処理を失敗させます。現在サポートしているのは、1台のマシン上で動く1つのアプリと1つのWriterです。複数台から同じデータベースへ書き込む構成や、外部のリモートデータベースには対応していません。

主なディレクトリは次の通りです。

| パス | 内容 |
| --- | --- |
| `api/app/` | Honoを使ったHTTPサーバーの組み立てと起動処理。HonoはTypeScript向けの軽量Webフレームワークです。 |
| `api/routes/` | ログイン、プロジェクト、スキャン、レポートなどのAPI入口。 |
| `api/modules/scans/` | プロファイル、スキャナー実行、結果変換、証跡、レポートの中心処理。 |
| `api/modules/runtime-isolation/` | Webアプリを使い捨てDocker環境で起動するための検証と実行処理。 |
| `api/modules/static-intelligence/` | コード構造や検査結果を、外部エージェント向けの読み取りデータへ変換する処理。 |
| `web/src/` | Reactで作られた画面。Reactは画面を部品単位で組み立てるライブラリです。 |
| `shared/schemas/` | API、データベース、画面で共有するデータ形式と検証規則。 |
| `drizzle/` | SQLiteの変更履歴。DrizzleはTypeScriptからデータベースを扱うためのライブラリです。 |
| `contexts/` | LLMへ渡す固定メッセージの原稿。 |
| `spec/` | 製品仕様、設計判断、検証証跡。 |
| `scripts/` | セットアップ、テスト、ビルド、検証用コマンド。 |

## 対応技術

組み込みの技術検出プラグインは、プロジェクト内のファイルから言語、依存関係の管理方法、Webフレームワークを判定します。ここでいうプラグインは、外部コードを自由に実行する拡張機能ではなく、リポジトリに同梱した検出規則と解析処理です。

| 言語・環境 | 現在の主な対応 |
| --- | --- |
| TypeScript中心 | npm互換の依存関係、Hono、Express、Fastify、TypeScript/JavaScriptの構造解析とSemgrep規則。 |
| Java | Maven、Gradle、Spring Boot / Spring MVC、コード構造とAPI入口の抽出。 |
| Python | requirements系の依存関係、FastAPI、Flask、Django。構造解析には動的importを完全には追えない制限があります。 |
| Go | Go Modules、標準`net/http`、Gin、Echo。ビルド条件や型検査を完全には再現しない字句解析です。 |

言語を検出できることと、そのプロジェクトを自動起動してすべての動的検査を行えることは同じではありません。実行前チェックに表示された対応範囲を、各スキャンの正しい記録として扱ってください。

## Static IntelligenceとMCP

vulnWorkbenchは、保存済みの診断結果と軽量なコード構造を、外部のコーディングエージェントへ渡せます。この読み取り用データを**Static Intelligence**と呼びます。ソースコード本文ではなく、ファイル名、ファイル間の参照、外部へ公開している関数、パッケージ間の関係、API入口、検出結果の参照などを公開します。

**MCP**（Model Context Protocol）は、AIアプリと外部ツールが決められた形式で情報をやり取りするための通信規約です。付属のMCPサーバーは、原則として読み取り専用です。準備コマンドだけはバックグラウンド処理を登録しますが、セキュリティスキャンや修正コマンドを勝手に実行しません。

```bash
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

MCPからパスを指定して読むには、`.env`の`STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS`へ許可する親ディレクトリの絶対パスを設定します。空のままではすべて拒否するため、意図せず別のディレクトリを公開しません。

生成データをCLIで作る例です。

```bash
bun run intelligence:build -- \
  --scan-run-id <scan-run-id> \
  --include-semantic false \
  --pretty true
```

**semantic search（意味検索）**は、単語が完全一致しなくても文章の意味が近い候補を探す方法です。埋め込みモデルは、文章の意味を比較できる数値の並びへ変換するAIモデルです。`--include-semantic false`なら、この外部モデルを使わずに構造情報と検査結果だけを生成します。

NightWorkersとの連携APIも実装されていますが、初期状態では無効です。連携先が担当するのはタスク作成や修正作業であり、vulnWorkbenchの役割は診断証跡を提供するところまでです。

## 安全のために制限していること

- APIはログイン必須で、プロジェクトは所有者ごとに分離します。管理者だけが利用できる設定とユーザー管理があります。
- コマンドはシェル文字列ではなく、実行ファイルと引数の配列として組み立てます。
- Docker実行ではメモリ、CPU、PID、標準出力、標準エラー、実行時間に上限を設けます。
- スキャナー用コンテナ、再現環境、動的検証環境、DAST環境へDockerソケットを渡しません。
- 公開インターネット上の宛先を通常のDAST対象として受け付けません。ループバックまたはプライベートネットワークも明示的な許可が必要です。
- Active DASTは本番環境を拒否します。RoE、有効期限、許可するHTTPメソッドとパス、リクエスト上限、初期状態へ戻す手順が必要です。
- RoE（Rules of Engagement、実施規則）は、どの環境へ、いつ、どの操作を、何回まで行ってよいかを記録した許可条件です。
- LLMへ送る文章では、機密値を可能な範囲で伏せ、保存済み証跡の外にある事実を見たように書かせません。
- Static Intelligenceはソース本文や任意の文字列を公開せず、候補情報と参照だけを返します。

本番相当の環境で動かす前に、少なくとも`JWT_SECRET`を開発用の初期値から変更し、HTTPS、Cookie、CORS、信頼するプロキシ、LLM認証情報の暗号鍵を構成してください。`JWT_SECRET`は、ログイン状態を示すトークンがアプリの発行したものかを確かめる署名鍵です。CORSは、どのWebサイトからAPIを呼べるかを制限する仕組みです。詳しい運用条件は[SECURITY.md](SECURITY.md)にあります。

## 現在確認できている限界

バージョン管理された[Phase 55の検証証跡](spec/evidence/phase-55-diagnostic-professional-capability.json)では、総合判定は`not_met`です。OWASP Benchmarkの全体値は、再現率0.7993、適合率0.9536、誤検知率0.0399でした。

- **再現率（recall）**は、用意した脆弱な例のうち、実際に検出できた割合です。
- **適合率（precision）**は、検出した項目のうち、正しい検出だった割合です。
- **誤検知率（false-positive rate）**は、安全な例を誤って問題ありと判定した割合です。

数値だけでは総合合格になりません。証跡では、OSVの検証ゲートと、Linux上の正式なJuice Shop実行証跡が合格条件を満たしていません。Juice Shopは、Webセキュリティの検証に使われる意図的に脆弱なテストアプリです。また、合格した一連の測定を指す`passingBenchmarkRunId`も未設定です。

現在の主な対象外・制限は次の通りです。

- ネットワーク機器、クラウド設定、Active Directory、モバイルアプリ、無線、ソーシャルエンジニアリング。
- ブラウザ操作を伴う複雑な認証を使ったZAP Active Scan。
- 本番環境への能動的な攻撃や、制限のないファジング。
- 任意のスキャナースクリプトを無制限に実行する仕組み。
- 複数台構成、リモートデータベース、複数Writer。
- 「検出0件」を安全の証明として扱うこと。
- 自動修正や、修正コードの適用。アプリが作るのは修正依頼と検証候補までです。

**ファジング**は、大量の予期しない入力を与えて異常を探す方法です。このプロジェクトにも制限付きの実験プロファイルはありますが、標準診断には含めていません。

## 開発と検証

通常の変更確認には次を使います。

```bash
bun run verify
```

`verify`は、SQLiteへの書き込み経路、LLM用メッセージ、型、静的解析、整形、仕様書、テスト、Webビルド、依存関係の監査、生成物の混入を順番に確認します。

リリース前の厳格な確認では、カバレッジ、ブラウザE2E、DAST能力の検証も含む次のコマンドを使います。E2E（End-to-End）テストは、ブラウザ操作からAPI、データ保存までを通して確認するテストです。

```bash
bun run verify:strict
git diff --check
```

テストの実行環境は2種類です。画面や純粋なTypeScript処理はVitest、`bun:sqlite`を使うAPI処理はBunのテストランナーで動かします。`bun run test`は、この振り分けを自動で行います。

仕様書は`spec/`にあり、索引は[spec/index.html](spec/index.html)です。

```bash
bun run docs
bun run docs:check
```

コントリビューションの条件は[CONTRIBUTING.md](CONTRIBUTING.md)、変更履歴は[CHANGELOG.md](CHANGELOG.md)、脆弱性の連絡方法は[SECURITY.md](SECURITY.md)を参照してください。

## ライセンス

vulnWorkbench本体は[MIT License](LICENSE.md)で公開しています。連携する各スキャナーとDockerイメージには、それぞれのライセンスが適用されます。
