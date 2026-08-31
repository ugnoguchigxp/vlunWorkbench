# Intelligence 4画面 UI 改修 実装計画書

## 1. ステータス

- 作成日: 2026-08-08
- 対象ベースライン: `56cf38f`
- 対象画面: `/projects/:projectId/intelligence`
- 状態: 実装完了、検証済み
- 方針: Intelligence のメインコンテンツを4つのタブ画面へ再編する
- 対象タブ:
  1. 判断優先
  2. 調査ビュー
  3. リスクマップ
  4. ガイド方式

この文書は実装順序、既存実装との対応、データ契約、テスト、受け入れ条件を固定する。実装中に要件変更が必要になった場合は、コードより先に本書の「固定仕様」または「決定事項」を更新する。

実装結果（2026-08-08）:

- URL連動の4タブ、各画面、Finding詳細・構造・Ontologyの遅延取得、Landscape補足取得、互換Decision保存を実装
- 390px幅、URL履歴、基礎APIの再取得防止、重大・深刻なaxe違反なしをE2Eで確認
- Project Overviewの既存E2Eを含む7件のブラウザテストが成功
- TypeScript、Webテスト204件、lint、production buildが成功

## 2. 目的

現在の Intelligence 画面は、生成状態、リスクファイル、証拠グラフ、構造、Agent Bundle、Ontology Handoff、ソース状態、スキャン履歴が縦に連続しており、情報量は十分だが、次の判断や操作へ移るための視線移動が大きい。

今回の改修では、同じ Intelligence データを利用目的ごとに4画面へ整理し、次を達成する。

- 最初に「何を確認すべきか」が分かる
- ファイル、Finding、Evidence の関係を追いやすい
- プロジェクト全体のリスク偏在を把握しやすい
- Finding を一件ずつ確認する利用者を迷わせない
- 既存の技術情報と機能を失わない
- タブをURLで共有でき、ブラウザの戻る・進むが自然に動く
- デスクトップと狭い画面の双方で横方向の探索負荷を抑える

## 3. 固定するプロダクト仕様

### 3.1 情報設計

Intelligence のメインコンテンツ先頭に、次のタブをこの順序で配置する。

| 表示 | URL値 | 役割 |
| --- | --- | --- |
| `01 判断優先` | `priority` | 現状と優先対応を短時間で判断する |
| `02 調査ビュー` | `investigate` | ファイル、Finding、Evidence を掘り下げる |
| `03 リスクマップ` | `landscape` | モジュール単位のリスク分布を俯瞰する |
| `04 ガイド方式` | `guided` | 一件ずつ手順に沿って確認する |

タブは既存のプロジェクトナビゲーションより下、Intelligence のメインコンテンツ内に置く。グローバルヘッダーやプロジェクトナビゲーションより上には配置しない。

### 3.2 ルーティング

- 既存パス `/projects/:projectId/intelligence` は変更しない。
- 任意の検索パラメータ `intelligenceView` を追加する。
- パラメータ省略時および未知の値では `priority` を表示する。
- `scanRunId` はタブ切り替え後も保持する。
- 既存リンクとブックマークはそのまま「判断優先」を開く。
- タブは単なるローカルボタン状態ではなくリンクとして実装し、URL共有、再読み込み、戻る・進むに対応する。
- タブ切り替えだけでは、プロジェクトと選択済みスキャンの基礎データを再取得しない。

URL例:

```text
/projects/prj_123/intelligence?scanRunId=scan_456&intelligenceView=investigate
```

### 3.3 既存ナビゲーションとの境界

今回変更するのは Intelligence のメインコンテンツ部分である。次は変更しない。

- アプリ全体のグローバルナビゲーション
- Project Detail の `Overview / Scans / Intelligence` ナビゲーション
- プロジェクト切り替えの導線
- Scan Workspace の基本ナビゲーション

現在 Intelligence 内にある `Overview / Structure / Risk & Evidence / Agent Context / Ontology Handoff / Source Health` のアンカー型ナビゲーションは、4画面への移行完了後に削除する。

### 3.4 選択中スキャンと生成状態

- 選択中の `scanRunId`、generation、export、refresh 状態は4画面で共有する。
- スキャンを変更した場合は、そのスキャンに依存するタブ内選択をリセットする。
- Finding、構造、landscape 等の追加データは、`scanRunId` と generation を含むキーでキャッシュする。
- Refresh 完了後は古い generation のタブ別キャッシュを破棄する。
- タブごとの通信失敗は、そのタブ内で表示し、他タブの閲覧を妨げない。

### 3.5 Finding の判定に関する意味

既存の `FindingDecision` は互換性レコードであり、通常の正式なプロダクトフローはスキャン単位の LLM handoff を中心としている。この意味をUI改修で暗黙に変更しない。

- ガイド方式は「任意の確認支援フロー」とする。
- 既存の review と decision は表示する。
- Finding の判定保存は既存APIを使い、互換性レコードとして保存されることを画面上で明記する。
- `needs_fix`、`false_positive`、`deferred` への保存は確認フォームを経由する。
- 理由は利用者が明示的に選び、必要に応じてコメントを入力する。
- 画面表示だけを根拠に理由を自動決定しない。
- LLM review を自動実行しない。
- 既存のスキャン単位 handoff や Scan Workspace の導線は残す。

## 4. 現在の実装ベースライン

### 4.1 画面構成

主な実装は次にある。

- `web/src/domains/projects/project-overview-panels.tsx`
  - Project Detail 全体と `Overview / Scans / Intelligence` の切り替え
  - 選択中スキャンのUI
- `web/src/domains/projects/project-intelligence-panels.tsx`
  - 現在の `IntelligenceView`
  - サマリー、readiness、内部アンカー、各セクションの組み立て
- `web/src/domains/projects/project-detail-sections.tsx`
  - Risk、Evidence Graph、Code Structure、Agent Bundle、Source Health、Scan Runs
- `web/src/domains/projects/project-structure-panels.tsx`
  - Structure Explorer、Ontology Handoff、File Risk
- `web/src/domains/projects/projects-domain.tsx`
  - ルート状態、基礎データ取得、refresh、Agent preview
- `web/src/router.tsx`
  - `/projects/$projectId/intelligence` の検索パラメータ検証
- `web/src/styles-projects.css`
  - 現行 Project / Intelligence のスタイル

### 4.2 利用可能なデータとAPI

今回必要なデータの大半は既存契約で取得できる。

| 用途 | 既存契約・関数 | 主な利用画面 |
| --- | --- | --- |
| 選択中スキャン、export、readiness、degraded reason | `fetchProjectIntelligenceView` | 全画面 |
| ファイルリスク、Finding node、Evidence graph | `ProjectIntelligenceView.export` | 判断優先、調査ビュー、リスクマップ |
| モジュール、file refs、finding IDs | `fetchProjectStructure` | 調査ビュー、リスクマップ |
| Finding 一覧 | `fetchScanFindings` | 調査ビュー、ガイド方式 |
| Finding 詳細、Evidence、最新 review / decision | `fetchFinding` | 調査ビュー、ガイド方式 |
| review 履歴 | `fetchFindingReviews` | ガイド方式 |
| decision 履歴・保存 | `fetchFindingDecisions` / `createFindingDecision` | ガイド方式 |
| landscape、coverage、remediation | `fetchScanIntelligenceAgentQuery` の `overview` | リスクマップ |
| Agent Bundle | 現行 Agent preview / query | 判断優先の分析詳細 |
| Ontology Handoff | `fetchProjectOntologyHandoff` | 判断優先の分析詳細 |

### 4.3 再利用するロジック

- `web/src/domains/scans/decision-workflow.ts`
  - `buildDecisionWorkflow`
  - Evidence checklist
  - 推奨理由、最新 review / decision の整理
- `project-intelligence-readiness` 系の view model
- `project-intelligence-view-model` 系の既存集計
- `FileRiskSection`、`EvidenceGraphSection`、`StructureExplorer` 等の既存表示部品

既存部品は最初から全面的に書き換えず、新しいタブコンテナから再利用し、画面ごとの役割が固まってから分割・縮小する。

## 5. スコープ

### 5.1 対象

- 4タブのURL連動シェル
- 4画面のメインコンテンツ
- 各画面用の純粋な view model
- タブごとの遅延読込とキャッシュ
- Loading、Empty、Degraded、Error 状態
- レスポンシブ対応とアクセシビリティ
- ガイド方式からの既存 decision 保存
- 単体、統合、E2Eテスト
- 旧 Intelligence 内部アンカーの撤去

### 5.2 対象外

- 新しいDBテーブル、schema migration
- 新しい scanner や Intelligence 生成処理
- 新しい chart library の導入
- FindingDecision のドメイン上の位置づけ変更
- review / decision の自動生成
- 外部エージェントへの自動送信
- Project Overview、Scans、Scan Workspace の全面改修
- グローバルナビゲーションの変更
- 既存 Intelligence API の破壊的変更

## 6. 目標画面構成

### 6.1 共通シェル

4画面で共通する領域は次に限定する。

1. Intelligence 内タブ
2. 選択中スキャンと生成日時の簡潔なコンテキスト
3. refresh の状態と操作
4. タブ固有コンテンツ

大きなサマリーや全 readiness 項目を全タブで繰り返さない。必要な情報は各画面の目的に合わせて配置する。

概念構造:

```text
Project navigation
└─ Intelligence main
   ├─ Scan context / refresh
   ├─ Intelligence tabs
   │  ├─ 01 判断優先
   │  ├─ 02 調査ビュー
   │  ├─ 03 リスクマップ
   │  └─ 04 ガイド方式
   └─ Active tab content
```

### 6.2 画面1: 判断優先

#### 目的

画面を開いて最初の30秒で、状態、優先箇所、次の行動を判断できるようにする。

#### 表示順

1. 対応要否コールアウト
2. 4つの主要指標
3. 優先確認ファイル
4. Intelligence readiness の要約
5. 分析詳細の折りたたみ

#### 主要指標

- Risk: export に含まれる最大 severity と severity 別件数
- Evidence: Evidence の有無・品質を既存契約のラベルで表示
- Findings: Finding 総数と High / Critical 件数
- Structure: 構造解析の利用可否と対象ファイル数

数値を生成できない場合は `0` にせず `未生成` または `取得不可` とする。既存APIが持たない割合やスコアは推測しない。

#### 対応要否コールアウト

次の明示的な状態だけを使用し、推測で「要対応」としない。

- generation / export が失敗または未生成
- readiness が blocked / degraded
- `degradedReasons` が存在する
- Critical / High Finding が存在する
- 既存 review が明示的な確認事項を返している

複数条件がある場合は、重要度順に主メッセージを一つ、補足を最大二つ表示する。

#### 優先確認ファイル

- severity 降順
- 同一 severity は Finding 件数降順
- さらに同値の場合は path 昇順
- 初期表示は上位5件
- 各行から調査ビューへ遷移し、対象ファイルを選択状態にする
- 追加の選択検索パラメータを使う場合は `file` ではなく衝突しにくい `focusPath` とし、値を検証する

#### 分析詳細

既存機能を失わないため、次を「分析詳細」配下に残す。

- Agent Bundle / Agent preview
- Ontology Handoff
- Source Health
- Scan history

これらは初期状態で閉じる。開いたときに初めて必要な追加データを取得する。

### 6.3 画面2: 調査ビュー

#### 目的

リスクのあるファイルから Finding と Evidence へ段階的に移動し、原因を追跡できるようにする。

#### レイアウト

デスクトップでは2ペイン、狭い画面では1カラムの段階表示とする。

```text
┌────────────────────┬──────────────────────────────┐
│ File / Finding list│ Selected finding detail      │
│ filters            │ summary, location, evidence  │
│ risk files         │ graph/context, next action   │
└────────────────────┴──────────────────────────────┘
```

#### 左ペイン

- severity filter
- scanner filter
- path text filter
- リスクファイル一覧
- 選択ファイル内の Finding 一覧
- 選択件数と絞り込み結果件数

ファイルに複数の Finding があることを前提とし、ファイル選択と Finding 選択を別状態として持つ。

#### 右ペイン

- Finding title / rule / severity / scanner
- file path と line
- Finding description
- Evidence checklist / evidence detail
- Evidence Graph の対象部分
- 最新 review / decision の要約
- Scan Workspace で開く導線

Finding 詳細は選択時に `fetchFinding(findingId)` で取得する。キャッシュは Finding ID 単位とし、高速に選択を切り替えた場合の古いレスポンスで現在選択を上書きしない。

#### 初期選択

1. URLの有効な `focusPath` があれば対象ファイル
2. なければ優先順位が最も高いファイル
3. ファイル内で優先順位が最も高い Finding

Finding がない場合は、Evidence Graph または構造情報のみを表示できる空状態にする。

この画面では decision の更新を行わない。保存操作はガイド方式または既存 Scan Workspace に集約する。

### 6.4 画面3: リスクマップ

#### 目的

リスクがどのモジュール・severity に偏っているかを俯瞰し、調査対象を絞る。

#### レイアウト

1. 全体のリスク要約
2. Module × Severity マトリクス
3. 選択モジュール詳細
4. Coverage / Evidence / Remediation の要約
5. Structure Explorer の詳細表示

#### マトリクスの生成

新しい集計APIは追加せず、次をクライアントの純粋関数で結合する。

- `ProjectStructureListResponse.modules[].risk.findingIds`
- export graph の Finding node にある `sourceId` と `severity`

セルの値は Finding 件数とする。色だけに依存せず、常に数値と severity ラベルを表示する。

並び順:

- 行: Critical / High を持つモジュールを先頭、その後 Finding 総数降順、label 昇順
- 列: Critical / High / Medium / Low / Unknown

#### フォールバック

- 構造データが未生成の場合は、file risk を単位とする簡易マップへ切り替える。
- Finding が0件の場合は「安全」と断定せず、「現在の生成物では Finding がありません」と表示する。
- Finding ID を graph node に解決できない場合は Unknown として集計し、欠損件数を注記する。

#### Landscape bundle

Coverage、Evidence、Remediation は既存 Agent Query の `overview` bundle に含まれる landscape を遅延取得する。

- タブを初めて開いたときに取得
- 失敗してもマトリクスは表示する
- 再試行は該当カード内に置く
- APIが返す定義とラベルをそのまま使用し、独自の割合を作らない

#### ドリルダウン

マトリクスのセルまたはモジュールを選択すると、対象モジュールの file refs と Finding を表示する。「調査ビューで開く」から `focusPath` を渡して移動できる。

### 6.5 画面4: ガイド方式

#### 目的

専門知識や画面理解に依存せず、Finding を一件ずつ確認できるようにする。

#### レイアウト

1. 進捗と対象件数
2. 現在の Finding
3. 確認ステップ
4. Evidence checklist
5. 既存 review / decision
6. 次へ、前へ、判定操作

#### キュー

キューは同じ入力から常に同じ順序を返す純粋関数で生成する。

1. decision 未登録を先にする
2. severity 降順
3. path 昇順
4. Finding ID 昇順

フィルター:

- 未確認のみ
- severity
- scanner
- 全件

#### 確認ステップ

`buildDecisionWorkflow` を再利用し、少なくとも次を順に表示する。

1. Finding の内容と発生箇所を確認
2. Evidence の充足状態を確認
3. review / decision の既存情報を確認
4. Scan Workspace で追加確認、または互換 decision を保存

#### 判定保存

UIラベルと既存値の対応は次とする。

| UIラベル | 保存値 |
| --- | --- |
| 問題として確認 | `needs_fix` |
| 誤検知 | `false_positive` |
| 保留 | `deferred` |

`accepted` は既存値として表示・履歴参照は行うが、今回の主要アクションには追加しない。追加する場合は別途文言と利用目的を決定する。

保存フロー:

1. アクションを選択
2. 確認フォームを開く
3. reason を明示選択
4. optional comment を入力
5. 「互換 decision として保存」の説明を確認
6. 保存
7. 対象 Finding の詳細、履歴、進捗を再取得

二重送信を防止し、失敗はフォーム内に表示する。失敗時に次の Finding へ自動移動しない。成功後も自動移動は行わず、結果を確認してから利用者が「次へ」を押す。

## 7. 状態・データ取得設計

### 7.1 ルート状態

`ProjectRouteState` に次を追加する。

```ts
type IntelligenceViewId =
  | "priority"
  | "investigate"
  | "landscape"
  | "guided";

type ProjectRouteState = {
  projectId: string;
  tab: "list" | "overview" | "intelligence";
  scanRunId: string | null;
  intelligenceView: IntelligenceViewId;
  focusPath: string | null;
};
```

`focusPath` は調査ビューとリスクマップのドリルダウンにのみ使う。長さ上限を設定し、不正な値は無視する。

基礎データの request key には `intelligenceView` と `focusPath` を含めない。これらが変わっても `fetchProjectIntelligenceView` と `fetchScans` を再実行しないことをテストする。

### 7.2 取得タイミング

| データ | タイミング | キャッシュキー |
| --- | --- | --- |
| Project Intelligence view / scans | route の project / scan 変更時 | projectId + scanRunId |
| structure | 調査またはリスクマップ初回表示時 | projectId + scanRunId + generation |
| findings | 調査またはガイド初回表示時 | scanRunId |
| finding detail | Finding 選択時 | findingId |
| landscape bundle | リスクマップ初回表示時 | scanRunId + generation |
| ontology handoff | 分析詳細を開いた時 | projectId + scanRunId + generation |
| agent preview | 利用者が明示操作した時 | scanRunId + mode + focus |

タブ切り替え後に同じキーの成功データがあれば再利用する。エラーはキャッシュして固定せず、再試行できるようにする。

### 7.3 競合とキャンセル

- `AbortController` または request sequence を使い、古い要求の結果を無視する。
- scanRunId が変わったら Finding 選択とタブ固有 error をリセットする。
- refresh 前の generation のレスポンスは画面へ反映しない。
- decision 保存中は対象 Finding の操作だけを無効化し、タブ全体はブロックしない。

### 7.4 純粋な view model

JSX内に集計条件を散らさず、最低限次の純粋関数を作る。

- URL値から `IntelligenceViewId` への正規化
- priority summary と priority files の生成
- file → findings の index 生成
- modules × severity matrix の生成
- 解決不能 Finding の集計
- guided queue の並び替え
- decision status と進捗の集計

入力を immutable として扱い、同一入力で安定した結果を返す。

## 8. 実装ファイル構成

既存の大きなファイルへ追記し続けず、画面単位に分割する。各ファイルは原則500行未満に保つ。

### 8.1 追加候補

```text
web/src/domains/projects/
├─ project-intelligence-tabs.tsx
├─ project-intelligence-priority-panel.tsx
├─ project-intelligence-investigation-panel.tsx
├─ project-intelligence-landscape-panel.tsx
├─ project-intelligence-guided-panel.tsx
├─ project-intelligence-tab-model.ts
├─ project-intelligence-priority-model.ts
├─ project-intelligence-landscape-model.ts
├─ project-intelligence-guided-model.ts
└─ use-intelligence-finding-detail.ts

web/src/
└─ styles-project-intelligence.css

tests/e2e/
└─ project-intelligence.spec.ts
```

必要以上にファイルを細分化せず、実装時に小さな model は統合してよい。ただし4つの画面コンポーネントは分離する。

### 8.2 変更対象

- `web/src/router.tsx`
  - `intelligenceView` と `focusPath` の search validation
- `web/src/domains/projects/projects-domain.tsx`
  - route parse、共有キャッシュ、タブ別遅延読込
- `web/src/domains/projects/project-intelligence-panels.tsx`
  - 現在の縦長画面を共通シェルへ縮小
- `web/src/domains/projects/project-detail-sections.tsx`
  - 既存セクションを再利用可能な粒度へ限定的に調整
- `web/src/domains/projects/project-structure-panels.tsx`
  - 選択状態や compact 表示に必要な props を追加
- `web/src/main.tsx`
  - 新しいCSSを分離する場合の import
- `web/src/styles-projects.css`
  - 旧内部アンカー用スタイルの削除

## 9. アクセシビリティとレスポンシブ仕様

### 9.1 タブ

- `<nav aria-label="Intelligence views">` 内のリンクとして実装する。
- 選択中リンクに `aria-current="page"` を付与する。
- Enter で遷移できる標準リンク動作を維持する。
- focus ring を消さない。
- 色だけで選択状態を伝えず、border、背景、文字ウェイトを併用する。
- 数字の `01` 等は表示上残すが、スクリーンリーダー向けラベルは画面名を中心にする。

### 9.2 狭い画面

- 390px幅でページ全体に横スクロールを発生させない。
- タブは画面幅に応じて2列または横スクロール可能なタブ列とする。横スクロールを採用する場合も、ページ全体ではなくタブ領域だけに限定する。
- 調査ビューの2ペインは1カラム化し、選択詳細へ移動したことが分かる見出しと「一覧へ戻る」を表示する。
- リスクマップの表は専用コンテナ内だけで横スクロールを許可し、先頭列を識別可能にする。
- ガイド方式の主要操作は一列に積み、保存ボタンが画面外へはみ出さないようにする。

### 9.3 非視覚的表現

- severity color には常にテキストラベルを併記する。
- マトリクスセルに件数の accessible name を付ける。
- loading は `aria-busy`、非同期結果は必要な箇所だけ `aria-live="polite"` を使う。
- error と入力項目を `aria-describedby` で関連付ける。

## 10. Loading / Empty / Degraded / Error

各画面は次を明示的に実装する。

| 状態 | 共通挙動 |
| --- | --- |
| スキャン未選択 | スキャン選択または生成開始への導線を表示 |
| Intelligence 未生成 | 空のダッシュボードを出さず、生成方法を表示 |
| 基礎データ loading | 共通シェル内にレイアウトが跳ねない skeleton |
| タブ固有 loading | タブ内容のみ skeleton、タブ切り替えは可能 |
| 0 Findings | 「現在の生成物では0件」と表現し、安全と断定しない |
| structure なし | file 単位フォールバックまたは生成案内 |
| degraded | 利用可能なデータを表示し、欠けた機能と理由を併記 |
| タブ固有 error | タブ内再試行、他画面をブロックしない |
| refresh error | 共通コンテキスト内に表示し、直前の成功データは残す |
| decision error | フォーム内に表示し、入力値を保持 |

## 11. 実装スライス

一つのスライスを実装、確認、コミット可能な単位にする。後続画面のために先行して大規模な抽象化をしない。

### Slice 0: ベースライン固定とfixture整備

#### 変更

- 現行 Intelligence の主要状態をスクリーンショットとテストで固定
- 既存API fixture を4画面で再利用できる形に整理
- 0件、degraded、structureなし、複数Findingのfixtureを用意
- 既存内部アンカーと各機能の移行先一覧をテストコメントまたは本書と対応付ける

#### 受け入れ条件

- 現行機能の移行漏れを判定できるfixtureがある
- 正常系以外に最低3種類の状態を再現できる
- 実装前の既存テストが成功する

#### 確認

```bash
bunx vitest run web/src/domains/projects/project-intelligence-readiness.test.ts web/src/domains/projects/project-intelligence-view-model.test.ts
bunx playwright test tests/e2e/project-overview.spec.ts
```

### Slice 1: URL連動タブと共通シェル

#### 変更

- `IntelligenceViewId` とtab definitionを追加
- route search validationを追加
- タブリンクをメインコンテンツ内に追加
- `scanRunId` の保持、default/fallback、戻る・進むを実装
- 4つの空 panel を共通シェルから切り替える
- 基礎データ request key から `intelligenceView` / `focusPath` を除外

#### 受け入れ条件

- パラメータなしで判断優先が開く
- 各タブURLを直接開ける
- タブ切り替えで `scanRunId` が失われない
- browser back / forward で画面が戻る
- タブ切り替えだけでは基礎APIを再取得しない
- タブはプロジェクトナビゲーションより下にある

#### 確認

- tab model の単体テスト
- route search の単体または統合テスト
- Playwright で deep link / history / API request count

### Slice 2: 判断優先

#### 変更

- priority summary の純粋関数
- 対応要否コールアウト
- 4指標
- 優先確認ファイル上位5件
- compact readiness
- 「分析詳細」へ Agent / Ontology / Source / Scan history を移設
- 調査ビューへの `focusPath` 遷移

#### 受け入れ条件

- 主要情報が初期viewportで把握できる
- 優先順位がseverity、件数、pathで安定する
- 未取得値を0として誤表示しない
- degraded reason が隠れない
- 既存の技術情報へ引き続きアクセスできる
- 折りたたみを開くまで不要な追加取得をしない

#### 確認

- priority model のtable-driven test
- 0件、欠損、degraded のcomponent test
- keyboardで分析詳細を開閉できること

### Slice 3: 調査ビュー

#### 変更

- file / finding index の純粋関数
- filter と選択状態
- desktop 2ペイン / mobile 1カラム
- Finding 詳細の遅延取得hookとキャッシュ
- Evidence detail / graph の再利用
- Scan Workspace への導線
- `focusPath` による初期選択

#### 受け入れ条件

- 一つのファイルに複数Findingを表示できる
- fileとFindingの選択が混同されない
- 選択変更時の古いレスポンスが表示を上書きしない
- 同じFindingを再選択しても不要な再取得をしない
- filter後に選択対象が消えた場合、安全に次候補または空状態へ移る
- mobileで一覧と詳細を往復できる

#### 確認

- index / filter / initial selection の単体テスト
- request race とcacheのhook test
- Playwrightでfile→Finding→Evidenceの操作

### Slice 4: リスクマップ

#### 変更

- module × severity 集計の純粋関数
- accessible matrix table
- module detail と調査ビューへのドリルダウン
- structure の遅延取得とfile fallback
- landscape bundle の遅延取得、個別error / retry
- Structure Explorer の詳細領域への移設

#### 受け入れ条件

- 同じFindingを二重集計しない
- severity不明と未解決IDを欠落させず表示する
- structureなしでもfile単位で利用できる
- landscape取得失敗時もリスクマップを閲覧できる
- セルは色なしでも意味が分かる
- 選択モジュールから調査ビューへ移動できる

#### 確認

- 重複ID、不明severity、空module、欠損nodeの単体テスト
- matrix keyboard / screen reader label のcomponent test
- Playwrightでdrill-downとfallbackを確認

### Slice 5: ガイド方式

#### 変更

- guided queue / progress の純粋関数
- Finding 詳細、review、decision の遅延取得
- `buildDecisionWorkflow` の再利用
- 前へ / 次へとfilter
- decision確認フォーム
- `createFindingDecision` との接続
- 保存後の詳細、履歴、進捗再取得

#### 受け入れ条件

- 未判定が先、severity順、path/id順で安定する
- Evidence未取得を「Evidenceなし」と誤表示しない
- reason未選択では保存できない
- UIラベルが既存保存値へ正しく対応する
- 保存中の二重送信を防ぐ
- 保存失敗時に入力と現在位置を保持する
- 成功後に最新decisionと進捗が更新される
- LLM reviewを自動実行しない
- 互換decisionであることを画面上で確認できる

#### 確認

- queue / decision mapping / progress の単体テスト
- confirmation / error / retry のcomponent test
- PlaywrightでPOST payloadと成功・失敗を確認

### Slice 6: 旧画面整理、アクセシビリティ、レスポンシブ

#### 変更

- 旧内部アンカーと不要になった重複サマリーを削除
- 未使用props、CSS、importを削除
- 390px、768px、1280pxのレイアウト調整
- tab order、focus移動、aria属性、contrastを確認
- reduced motion を尊重

#### 受け入れ条件

- 既存機能の移行先がすべて残っている
- ページ全体に意図しない横スクロールがない
- キーボードだけで4画面と主要操作を利用できる
- focusが見える
- loading / error / save結果が適切に通知される
- dead code と旧CSSが残っていない

#### 確認

- Playwright の desktop / mobile viewport
- axe 等が既に依存関係にある場合は自動検査を追加。なければ今回だけのために新規依存を追加せず手動確認項目を残す
- browser console error がないこと

### Slice 7: 統合検証とリリース準備

#### 変更

- E2E fixtureの最終整理
- API request回数とタブ遅延取得の確認
- 既存 Project Overview / Scan Workspace の回帰確認
- 文言、空状態、互換decision説明のレビュー
- 必要に応じて運用ドキュメントとスクリーンショットを更新

#### 受け入れ条件

- 本書のDefinition of Doneを満たす
- 既存のProject / Scan導線に回帰がない
- 新しいbackend migrationなしでリリースできる
- build、typecheck、lint、test、source-size checkが成功する

## 12. テスト計画

### 12.1 単体テスト

新規テスト候補:

```text
web/src/domains/projects/project-intelligence-tab-model.test.ts
web/src/domains/projects/project-intelligence-priority-model.test.ts
web/src/domains/projects/project-intelligence-investigation-model.test.ts
web/src/domains/projects/project-intelligence-landscape-model.test.ts
web/src/domains/projects/project-intelligence-guided-model.test.ts
```

最低限のケース:

- 正常なtab値、不明値、省略値
- `scanRunId` と `focusPath` の保持
- severityの全値とunknown
- 同点時の安定ソート
- Finding ID重複
- graph node欠損
- structureなし
- Findings 0件
- review / decisionあり・なし
- decision UIラベルとpayloadの対応

### 12.2 コンポーネント・統合テスト

- タブ切り替え時の表示と `aria-current`
- tab切り替えで基礎APIが再取得されない
- タブ固有APIが初回表示まで呼ばれない
- Finding選択のrace condition
- degraded中も利用可能部分が表示される
- error retryが対象カードだけを更新する
- decisionフォームvalidation、double submit防止、入力保持

### 12.3 E2E

`tests/e2e/project-intelligence.spec.ts` を追加する。

主要シナリオ:

1. パラメータなしで判断優先を表示
2. 4タブを切り替え、URLとhistoryを確認
3. 選択スキャンを保持
4. 判断優先のリスクファイルから調査ビューへ移動
5. 調査ビューでfile、Finding、Evidenceを選択
6. リスクマップからmodule / fileを掘り下げる
7. structureなしでfile fallbackを表示
8. ガイド方式でreasonを選択しdecisionを保存
9. decision POST失敗後に再試行
10. 390pxで主要操作とスクロール範囲を確認
11. keyboardでタブと主要アクションを操作
12. タブ別APIの失敗が他タブへ波及しない

既存 `tests/e2e/project-overview.spec.ts` は回帰テストとして維持する。

### 12.4 検証コマンド

実装中の短いループ:

```bash
bunx vitest run web/src/domains/projects/project-intelligence-*.test.ts
bun run typecheck:app
```

スライス完了時:

```bash
bunx playwright test tests/e2e/project-intelligence.spec.ts
bun run lint
bun run format:check
bun run check:source-size
git diff --check
```

最終確認:

```bash
bun run typecheck
bun run test
bun run test:e2e -- tests/e2e/project-intelligence.spec.ts tests/e2e/project-overview.spec.ts
bun run build
bun run check:source-size
git diff --check
```

環境依存で全E2Eを実行できない場合は、未実行理由と代替確認をPRへ明記する。失敗を既知問題として無条件に無視しない。

## 13. 計測と非機能条件

専用の分析基盤追加は今回の必須条件にしない。ブラウザのnetwork記録とテストで次を確認する。

- タブ切り替えだけで基礎Intelligence APIが再実行されない
- 未訪問タブ用のFinding detail / landscapeを取得しない
- 同一Findingの再選択でキャッシュが使われる
- refresh後に新generationへ更新される
- 初期の判断優先で全詳細データを待たない

既存のログ基盤でイベント記録が容易な場合のみ、次を追加候補とする。

- Intelligence tab opened
- risk file drill-down
- guided decision confirmation opened
- guided decision saved / failed

Finding本文、Evidence本文、path等の機微情報をanalytics payloadへ送らない。

## 14. リスクと対策

| リスク | 対策 |
| --- | --- |
| 4画面で同じデータ取得が重複する | scan/generation単位の共有キャッシュとrequest count test |
| タブ追加で基礎データが毎回reloadされる | route stateとrequest keyを分離し統合テストで固定 |
| matrix集計でFindingを二重計上する | Finding IDをdedupeする純粋関数と重複fixture |
| 古いFinding detailが選択を上書きする | abortまたはsequence guard |
| ガイド方式が正式な判定フローに見える | 互換decision説明、確認フォーム、Scan Workspace導線を常設 |
| 既存のAgent/Ontology/Source機能が消える | 判断優先の分析詳細へ明示的に移設しE2Eで確認 |
| 0件が安全の保証に見える | 「現在の生成物では0件」という限定表現 |
| 色中心のrisk mapになる | ラベル、数値、accessible nameを必須化 |
| CSSが既存画面へ波及する | Intelligence専用CSSと名前空間化したclass |
| コンポーネント肥大化 | 画面単位の分割、500行目安、純粋model分離 |

## 15. 移行・リリース手順

1. 旧画面を残したまま共通シェルと判断優先を接続する。
2. 各タブを一つずつ完成させ、完成していないタブを中途半端に公開しない。
3. 4画面で既存機能の移行先が揃った時点で旧内部アンカーを削除する。
4. backend schema変更なし、既存URL互換ありを確認する。
5. desktop / mobileのスクリーンショット差分をレビューする。
6. decision文言と保存payloadをプロダクト・実装双方で確認する。
7. 検証コマンドを完了してリリースする。

機能フラグは原則追加しない。改修中に長期間 main へ段階マージする必要が生じた場合だけ、既存画面へ戻せる一時フラグを検討する。その場合もデフォルト挙動と削除期限を本書へ追記する。

## 16. Definition of Done

### 情報設計

- [ ] Intelligence のメインコンテンツ内に4タブがある
- [ ] タブがプロジェクトナビゲーションより上に出ない
- [ ] `intelligenceView` 省略時は判断優先が開く
- [ ] タブURLを共有・再読み込みできる
- [ ] `scanRunId` を保持し、戻る・進むが機能する

### 判断優先

- [ ] 状態、主要指標、優先ファイル、次の行動を短時間で把握できる
- [ ] 欠損値を0や安全として誤表示しない
- [ ] 既存のAgent、Ontology、Source、Scan historyへアクセスできる

### 調査ビュー

- [ ] file、Finding、Evidenceの関係を段階的に追える
- [ ] 複数Finding、filter、初期focusが正しく動く
- [ ] 非同期選択のrace conditionがない
- [ ] Scan Workspaceへの導線がある

### リスクマップ

- [ ] module × severityを件数とラベルで把握できる
- [ ] 不明・欠損データが隠れない
- [ ] structureなしでもfile単位で利用できる
- [ ] 調査ビューへドリルダウンできる

### ガイド方式

- [ ] 一件ずつEvidenceと既存review / decisionを確認できる
- [ ] queue順序と進捗が安定している
- [ ] reason必須の確認フォームを経て既存decisionを保存できる
- [ ] 保存の意味が互換レコードであると分かる
- [ ] 自動LLM reviewや自動次送りを行わない

### 品質

- [ ] 390pxでページ全体に意図しない横スクロールがない
- [ ] keyboardだけで主要操作を完了できる
- [ ] severityを色だけで表現しない
- [ ] Loading / Empty / Degraded / Errorを各画面で確認済み
- [ ] タブ切り替えで不要な基礎API再取得がない
- [ ] 新規単体・統合・E2Eテストが成功する
- [ ] 既存Project / Scanの回帰テストが成功する
- [ ] typecheck、lint、format、build、source-size、diff checkが成功する

## 17. 実装開始時の最初の作業

実装は Slice 0 と Slice 1 から開始する。最初のPRでは、4画面すべての見た目を同時に作らず、次だけを完成させる。

1. route search contract
2. URL連動タブ
3. 共通シェル
4. 基礎APIを再取得しないことのテスト
5. 空のタブpanelと既存画面の一時的な移設先

この土台が安定した後、判断優先から順番に各画面を実装する。
