# Scan Review Improvement Request Plan

## Purpose

この計画は、vulnWorkbench のスキャン後フローを「人間が Decision を入力して履歴を蓄積する」体から、スキャン結果をもとに改善点を考案し、次の LLM または実装者へ渡せる改善依頼書を生成する体へ寄せるための実装計画である。

中心に置く成果物は Decision ではなく `Improvement Request` とする。

完了時の到達条件:

- `scan_review` が、保存済み scan run、findings、evidence、finding review、Decision、verification context だけを入力にして改善点を構造化できる。
- `scan_review` の出力に、LLM へそのまま渡せる改善依頼書が含まれる。
- Decision は最終分類として残り、改善依頼書生成の中心責務を持たない。
- Markdown report と UI で、最新の改善依頼書を確認できる。
- 通常の deterministic report は LLM を必須にしない。
- CLI scan / reproduction / dynamic / DAST は引き続き evidence producer であり、LLM が自由探索して脆弱性を探す設計にはしない。

## Current Baseline

現状の主導線:

```text
CLI scan / DAST / reproduction / dynamic
  -> findings / evidence / artifacts
  -> finding-level LLM review
  -> human Decision
  -> scan-level review
  -> Markdown report
```

既存の責務:

- `api/modules/scans/scan-review-runner.ts`
  - scan run 全体の保存済み context を bundle 化し、`scan_review` task route の LLM へ渡す。
  - `scan_reviews` に構造化 review を保存する。
- `api/modules/scans/scan-review-prompt.ts`
  - scan review の system/user prompt を生成する。
  - 現在は risk、coverage、false positive hotspots、recommended next actions、finding triage hints を要求する。
- `shared/schemas/scan.schema.ts`
  - `scanReviewOutputSchema` が scan review の構造化出力を定義する。
- `api/modules/decisions/finding-decision-repository.ts`
  - finding 単位の最終判断を `finding_decisions` に保存する。
  - 保存対象は `decision`、`reason`、`comment`、`linkedReviewId`。
- `api/modules/scans/report-builder.ts`
  - stored scan/finding/review/decision/evidence data から deterministic Markdown report を組み立てる。
- `web/src/domains/scans/`
  - finding review、Decision、verification、report の UI 導線を持つ。
  - scan-level review は実行できるが、改善依頼書としての表示はまだ弱い。

設計上の問題:

- Decision は人間の最終分類としては妥当だが、改善点考案や実装依頼書生成の器としては情報が薄い。
- `scan_review` はすでに `recommendedNextActions` を持つが、次の LLM に渡す依頼書としては目的、範囲、受け入れ条件、検証、非ゴールが足りない。
- report は finding ごとの修正方向を出せるが、スキャン結果全体を一つの実装依頼へ変換する section がない。

## Non-Goals

- Decision を LLM が自動で確定する機能は作らない。
- `finding_decisions` を改善依頼書の保存先にしない。
- 新しい scan engine、agentic vulnerability search、自由な repository 探索を追加しない。
- LLM に scan/reproduction/dynamic/DAST/browser/Docker/shell/file edit を実行させない。
- deterministic report を live LLM、provider availability、Codex auth に依存させない。
- provider/task routing の strictness や Codex adapter 自体をこの計画で再実装しない。
- 最初の実装で専用 `improvement_requests` table を作らない。

## Target Workflow

目標の主導線:

```text
CLI scan / DAST / reproduction / dynamic
  -> findings / evidence / artifacts
  -> finding-level LLM review
  -> optional human Decision
  -> scan-level LLM review
  -> Improvement Request
  -> UI / Markdown report / export
```

Decision の位置づけ:

- 残す:
  - `needs_fix`
  - `false_positive`
  - `accepted`
  - `deferred`
- 使い方:
  - 改善依頼書の優先順位や除外判定の補助信号にする。
  - 最終的な人間判断として report に残す。
- やらないこと:
  - 改善依頼書本文を Decision comment に押し込む。
  - Decision の有無を Improvement Request 生成の必須条件にする。

Improvement Request の位置づけ:

- `scan_review` の構造化出力として生成する。
- 初期実装では `scan_reviews.output` JSON に保存する。
- UI と Markdown report で表示する。
- 後続で編集、履歴、承認、再生成が必要になったら専用 table 化を検討する。

## Data Contract

`scanReviewOutputSchema` に `improvementRequest` を追加する。

初期 schema 案:

```ts
improvementRequest: z.object({
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(2000),
  scope: z.array(z.string().min(1).max(1000)).max(20),
  priorityPlan: z.array(
    z.object({
      priority: z.enum(["critical", "high", "medium", "low"]),
      rationale: z.string().min(1).max(1000),
      findingIds: z.array(z.string().uuid()).max(50),
    }),
  ).max(20),
  implementationTasks: z.array(
    z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(2000),
      findingIds: z.array(z.string().uuid()).max(50),
      evidenceRefs: z.array(z.string().min(1).max(200)).max(50),
    }),
  ).max(30),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(20),
  verificationCommands: z.array(z.string().min(1).max(500)).max(20),
  constraints: z.array(z.string().min(1).max(1000)).max(20),
  nonGoals: z.array(z.string().min(1).max(1000)).max(20),
  handoffPrompt: z.string().min(1).max(6000),
})
```

Rules:

- 本文は日本語で生成する。
- JSON key と enum は英語のままにする。
- `findingIds` は bundle に含まれる finding のみ許可する。
- `evidenceRefs` は evidence id、artifact id、または location text のみ許可する。
- `handoffPrompt` は、別 LLM に渡しても意味が通る standalone 依頼文にする。
- bundle にない repository file、runtime state、web page、raw artifact を見たかのように書かせない。
- 判断が不足している場合は、捏造せず `constraints` または `acceptanceCriteria` に不足情報として入れる。

## Implementation Phases

### Phase 0: Baseline Lock

Files:

- `shared/schemas/scan.schema.ts`
- `api/modules/scans/scan-review-prompt.ts`
- `api/modules/scans/scan-review-runner.ts`
- `api/modules/scans/report-builder.ts`
- `web/src/domains/scans/`
- `api/modules/scans/scan-review-runner.test.ts`
- `api/modules/scans/report-builder.test.ts`

Tasks:

- 現在の `scanReviewOutputSchema` の field を確認する。
- `scan_review` が保存している `scan_reviews.output` の形を確認する。
- 現在の deterministic report が LLM を呼ばないことを確認する。
- 現在の Decision が `finding_decisions` だけに保存されることを確認する。
- 既存 UI で scan review の実行導線と表示導線を確認する。

Verification:

```bash
rg -n "scanReviewOutputSchema|scan_reviews|finding_decisions|buildMarkdownReport|triggerScanReview" shared api web/src
bun test api/modules/scans/scan-review-runner.test.ts api/modules/scans/report-builder.test.ts
```

Completion criteria:

- 変更前の scan review / Decision / report の責務が説明できる。
- 既存テストの失敗がある場合は、この計画の変更前からの失敗かどうかを記録する。

Stop conditions:

- 同じ対象ファイルに未確認のユーザー変更がある場合は、変更前に差分を読んで衝突を避ける。
- report builder が既に別の LLM summary flow に依存している場合は、この計画を report contract に合わせて見直す。

### Phase 1: Schema Extension

Files:

- `shared/schemas/scan.schema.ts`
- `web/src/api.ts`
- `api/modules/scans/scan-review-runner.test.ts`
- `web/src/domains/scans/diagnostic-dashboard.test.ts`

Tasks:

- `scanReviewOutputSchema` に `improvementRequest` を追加する。
- `ScanReview` frontend type に `output` または typed `improvementRequest` を追加する。
- 既存の scan review fixture/test data に `improvementRequest` を追加する。
- `findingTriageHints` と同じく、`improvementRequest.priorityPlan[].findingIds` と `implementationTasks[].findingIds` が bundle 外 finding を参照しないよう validation を追加する。

Verification:

```bash
bun test api/modules/scans/scan-review-runner.test.ts
bun test web/src/domains/scans/diagnostic-dashboard.test.ts
bun run typecheck
```

Completion criteria:

- 構造化出力に `improvementRequest` が必須で含まれる。
- bundle 外 finding id を含む improvement request は failed review になる。
- English-only 本文は既存の日本語チェックで拒否される。

Stop conditions:

- `improvementRequest` の追加で既存の persisted old rows が UI/API で読めなくなる場合は、後方互換 fallback を先に設計する。

### Phase 2: Prompt Contract

Files:

- `api/modules/scans/scan-review-prompt.ts`
- `api/modules/scans/scan-review-runner.test.ts`

Tasks:

- system prompt に「Decision を作成・変更しない」制約を残す。
- system prompt に「改善依頼書を作る」責務を追加する。
- prompt の JSON 例に `improvementRequest` を追加する。
- `handoffPrompt` には次を必ず含めるよう指示する。
  - 目的
  - 対象範囲
  - 修正対象 finding
  - 実装タスク
  - 受け入れ条件
  - 検証方法
  - 非ゴール
  - 使ってよい根拠が保存済み context に限定されること
- LLM が repository 全体を見たふりをしない制約を維持する。

Verification:

```bash
bun test api/modules/scans/scan-review-runner.test.ts
```

Completion criteria:

- test が prompt に `improvementRequest`、`handoffPrompt`、日本語制約、bundle-only 制約が含まれることを確認する。
- scan review output schema と prompt の JSON 例が一致している。

Stop conditions:

- prompt が長くなりすぎて scan bundle と合わせた入力が不安定になる場合は、schema を削る。専用 table や別 LLM task へ分離する前に、まず request fields を絞る。

### Phase 3: Runner Persistence

Files:

- `api/modules/scans/scan-review-runner.ts`
- `api/modules/scans/scan-review-repository.ts`
- `api/modules/scans/scan-review-runner.test.ts`

Tasks:

- `parseOutput()` で `improvementRequest` を schema validation する。
- bundle 外 finding id validation を `findingTriageHints` だけでなく `improvementRequest` にも適用する。
- `reviewRepo.updateReview()` の `output` に `improvementRequest` を保存する。
- 初期実装では新規 DB column は追加しない。
- `providerRouting` は既存どおり `output` に残す。

Verification:

```bash
bun test api/modules/scans/scan-review-runner.test.ts
```

Completion criteria:

- completed row の `scan_reviews.output.improvementRequest` に依頼書が保存される。
- failed row は既存と同様に structured error を保存する。
- LLM provider/task routing の挙動は変わらない。

Stop conditions:

- UI/API が `scan_reviews.output` を返しておらず表示に使えない場合は、route response/type を先に拡張する。DB migration で解決しない。

### Phase 4: UI Display

Files:

- `web/src/api.ts`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/components/review-section.tsx`
- `web/src/styles-scans.css`

Tasks:

- 最新の completed scan review から `improvementRequest` を取得する。
- Review tab に scan-level `Improvement Request` section を追加する。
- 表示項目:
  - title
  - objective
  - priorityPlan
  - implementationTasks
  - acceptanceCriteria
  - verificationCommands
  - constraints
  - nonGoals
  - handoffPrompt
- `handoffPrompt` はコピーしやすい pre/code 表示にする。
- Decision form は削除しない。
- UI 文言は「レビュアー判断」ではなく「改善依頼書」として区別する。

Verification:

```bash
bun run build:web
```

Completion criteria:

- scan review 未実行時、running、failed、completed の各状態で UI が破綻しない。
- finding-level review と Decision が混同されない。
- 長い handoff prompt が layout を壊さない。

Stop conditions:

- Review tab が過密になり、finding-level review と scan-level request が混ざって見える場合は、専用 tab への分離を検討する。

### Phase 5: Markdown Report Integration

Files:

- `api/modules/scans/report-builder.ts`
- `api/modules/scans/report-builder.test.ts`
- optional: `api/modules/scans/report-summary-runner.ts`

Tasks:

- deterministic report に最新 completed scan review の `improvementRequest` を追加する。
- section 名は `## 改善依頼書` とする。
- report の早い位置、`全体考察` の後に置く。
- `handoffPrompt` は fenced code block で出力する。
- scan review がない場合は、section を省略するか「生成されていません」と明記する。初期方針は省略。
- `deterministic_with_llm_summary` は既存の report summary flow を壊さず、deterministic content の一部として improvement request を含める。

Verification:

```bash
bun test api/modules/scans/report-builder.test.ts api/modules/scans/report-summary-runner.test.ts
```

Completion criteria:

- scan review ありの report に `改善依頼書` section が含まれる。
- scan review なしの report は既存 report と同じく生成できる。
- deterministic report は LLM を呼ばない。

Stop conditions:

- report builder が `scan_reviews.output` の old row で落ちる場合は、safe parser を追加して old rows を無視する。

### Phase 6: Export and Handoff

Files:

- `api/routes/scans.route.ts`
- `web/src/domains/scans/components/review-section.tsx`
- optional: `api/cli/review-scan.ts`

Tasks:

- UI で `handoffPrompt` をコピーできる操作を追加する。
- 必要なら API で latest improvement request を返す lightweight endpoint を追加する。
- CLI で `review:scan` 実行後に `improvementRequest.handoffPrompt` を JSON stdout に含めるか検討する。

Verification:

```bash
bun run typecheck
bun run build:web
```

Completion criteria:

- ユーザーが report を開かなくても latest handoff prompt を取得できる。
- API/CLI の stdout は machine-readable のまま保たれる。

Stop conditions:

- export のためだけに storage/table を増やしたくなった場合は、まず `scan_reviews.output` 参照で足りるか確認する。

## Future Storage Option

初期実装では専用 table は作らない。

次の条件を満たしたら `improvement_requests` table を検討する。

- 依頼書の手動編集が必要になる。
- scan review と独立した再生成履歴が必要になる。
- 複数の依頼書候補から採用版を選ぶ必要がある。
- report に含める版を固定したい。
- 実装済み/却下/再依頼などの workflow state が必要になる。

候補 schema:

```text
improvement_requests
  id
  scan_run_id
  scan_review_id
  status
  title
  objective
  body_json
  handoff_prompt
  created_by_user_id
  created_at
  updated_at
```

この table 化は別計画で扱う。

## End-to-End Verification Gate

最終的な変更一式の検証:

```bash
bun test api/modules/scans/scan-review-runner.test.ts
bun test api/modules/scans/report-builder.test.ts api/modules/scans/report-summary-runner.test.ts
bun test web/src/domains/scans/diagnostic-dashboard.test.ts
bun run typecheck
bun run build:web
```

広範囲の挙動へ触れた場合のみ:

```bash
bun run verify
```

Verification expectations:

- `scan_review` は `improvementRequest` を含む completed row を作る。
- `improvementRequest` の finding references は bundle 内に限定される。
- Decision は従来どおり作成、一覧、report 表示できる。
- deterministic report は LLM なしで生成できる。
- report には latest completed scan review の改善依頼書が含まれる。
- UI は latest improvement request を review tab で確認できる。

## Rollout Order

実装順:

1. Phase 0 baseline
2. Phase 1 schema
3. Phase 2 prompt
4. Phase 3 runner persistence
5. Phase 5 report integration
6. Phase 4 UI display
7. Phase 6 export and handoff

Reasoning:

- Schema / prompt / runner が先に安定しないと UI は仮表示になる。
- Report integration は UI より先に検証しやすい。
- Export は実際に依頼書の形が固まってからでよい。

## Completion Definition

この計画の完了条件:

- `scan_review` の primary output として `improvementRequest` が生成される。
- `Improvement Request` が DB の existing JSON output、Markdown report、UI の少なくとも 2 箇所で確認できる。
- Decision は final classification として残り、改善依頼書の保存先や主生成器になっていない。
- 既存の finding review、Decision、report の基本導線が壊れていない。
- 検証コマンドの結果が記録され、失敗がある場合は既存問題か今回の変更かが切り分けられている。
