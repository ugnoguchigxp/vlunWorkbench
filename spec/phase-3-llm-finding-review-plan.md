# Phase 3: LLM Finding Review Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 3として、既存findingに対するLLM reviewを追加するためのもの。

Phase 1でscan/finding/evidence保存基盤を作り、Phase 2でSemgrep adapterを実toolとして接続した。Phase 3では、CLI toolが生成した一次証拠をLLMがレビューし、人間が判断しやすい構造化結果として保存、参照できるようにする。

このPhaseでも、LLMにrepoを自由探索させない。LLMの入力は、DBに保存済みのfinding/evidence/artifact metadataと、finding locationからdeterministicに抽出された最小snippetに限定する。

## Source Baseline

前提文書:

- `spec/vuln-workbench-concept.md`
- `spec/phase-1-cli-scan-foundation-plan.md`
- `spec/phase-2-semgrep-adapter-plan.md`

既に成立している前提:

- `projects`, `scan_runs`, `tool_runs`, `scan_artifacts`, `findings`, `finding_evidence` が保存できる。
- `scan:import` はfixture artifactを取り込み、finding/evidenceを作れる。
- `scan:semgrep` はSemgrep CLIを実行し、raw JSON/stdout/stderrをartifactとして保存できる。
- Semgrep JSONからdeterministicにfinding/evidenceが生成される。
- LLM provider未設定でもscan foundationは動く。

## Scope

Phase 3で実装するもの。

- finding review用DB table
- review outputの共有Zod schema
- finding/evidenceからLLM入力bundleを作るdeterministic builder
- source snippet extractionの境界チェック
- LLM review promptとstructured output validation
- provider未設定時の明確なエラー
- `review:finding` CLI command
- finding review API
- finding detailからreviewを参照できる最小frontend/API surface
- review runner unit tests
- fixture providerによるE2E test

Phase 3で実装しないもの。

- LLMによるrepo自由探索
- LLM toolとしての任意file read
- scan実行中の自動LLM review queue
- reviewer decision workflow
- Markdown report generation
- cross-scan dedupe
- Gitleaks/OSV/Trivy adapter
- Docker toolbox image
- SARIF parser
- patch生成、patch適用、修正PR作成
- sandbox再現、DAST、fuzzing
- public CVE/CWE lookupのlive network統合

## Definition of Done

Phase 3は、次を満たしたら完了とする。

- 既存finding IDを指定してLLM reviewを実行できる。
- review入力bundleがfinding/evidence/artifact metadata/source snippetに限定されている。
- LLMが任意pathを指定して追加読取できない。
- review出力がZod schemaでvalidationされ、失敗時はDBに不正なreviewを保存しない。
- review結果がDBに永続化され、finding detail APIから取得できる。
- review結果は一次証拠ではなく、findingに紐づく後段レビューとして区別できる。
- provider未設定時はscan/finding APIを壊さず、review command/APIだけが明確に失敗する。
- fixture providerでLLMなしのテストができる。
- `bun run verify` が通る。

## Data Model

追加table案:

```text
finding_reviews
  id
  finding_id
  provider
  model
  status
  summary
  likely_impact
  false_positive_assessment
  evidence_strength
  remediation_direction
  reviewer_notes
  confidence_adjustment
  input_bundle
  output
  error_message
  created_by_user_id
  started_at
  completed_at
  created_at
  updated_at
```

`finding_reviews.status` の最小値:

```text
running
completed
failed
```

`confidence_adjustment` の最小値:

```text
unchanged
increase
decrease
unknown
```

`finding.confidence` はPhase 3で自動更新しない。LLM reviewが完了しても、findingそのものの状態遷移は後続のreviewer decision workflowで扱う。

`finding_evidence.kind` に `llm-review` を追加するかは実装時に判断する。ただし、LLM reviewを一次証拠と同列に扱わないため、Phase 3の主保存先は `finding_reviews` とし、`finding_evidence` へのミラーは必要になった場合だけ行う。

## Review Output Schema

共有schemaを `shared/schemas/scan.schema.ts` またはreview専用schemaへ追加する。

最小構造:

```ts
{
  summary: string;
  likelyImpact: string;
  falsePositiveAssessment: {
    level: "low" | "medium" | "high" | "unknown";
    reasoning: string;
  };
  evidenceStrength: {
    level: "weak" | "moderate" | "strong" | "unknown";
    reasoning: string;
  };
  remediationDirection: string;
  reviewerNotes: string[];
  confidenceAdjustment: "unchanged" | "increase" | "decrease" | "unknown";
}
```

Validation方針:

- すべての文字列に最大長を設ける。
- `reviewerNotes` は件数と各項目の長さを制限する。
- LLM出力に未許可fieldがあっても保存しない。
- JSON parse失敗、schema validation失敗、空出力はreview failedとして保存する。

## Evidence Bundle Boundary

LLM入力bundleは次に限定する。

```text
finding:
  id
  sourceTool
  ruleId
  title
  description
  severity
  confidence
  status
  primaryLocation

scan context:
  scanRunId
  profile
  toolName
  toolVersion
  command metadata without secrets

evidence:
  tool-output evidence summaries
  source-location evidence snippets
  scan-log summaries
  linked artifact ids, kind, format, sha256, size

source snippets:
  only paths and line ranges derived from finding/evidence location
  bounded line window
  redacted before prompt construction
```

禁止:

- repo全体のfile treeをLLMへ渡す。
- LLMが指定したpathを追加で読む。
- prompt内で「必要なら他のfileを探索して」と指示する。
- raw artifact全文を無制限にpromptへ入れる。
- secret値を未redactでpromptへ入れる。

## Source Snippet Extraction

snippet builderは、finding/evidenceのlocationだけを入力にする。

必要条件:

- project repo pathの外へ出ない。
- symlink経由でrepo外へ出ない。
- binary fileを読まない。
- 最大file sizeと最大snippet bytesを設ける。
- line rangeは上限を設け、finding行の前後だけにする。
- 読めない場合はreviewを止めず、bundleに `snippetUnavailable` と理由を入れる。

ここでのsnippet抽出はLLM探索ではない。Semgrepなどの一次証拠が示したlocationを補足するdeterministic処理である。

## LLM Review Runner

追加module案:

```text
api/modules/reviews/
  finding-review-repository.ts
  finding-review-bundle.ts
  finding-review-runner.ts
  finding-review-prompt.ts
  finding-review-types.ts
```

Runner responsibilities:

- findingが存在することを確認する。
- findingに紐づくevidence/artifact metadataを読む。
- boundary付きbundleを作る。
- provider設定を確認する。
- structured JSON outputを要求する。
- responseをschema validationする。
- completed/failed reviewを保存する。

Avoid:

- provider moduleにscan DBの知識を持たせる。
- prompt builderにfilesystem探索を持たせる。
- LLM responseをそのまま信用してfinding statusを変える。
- LLM失敗でscan/findingをfailedにする。

## CLI Contract

追加script:

```json
{
  "review:finding": "bun run api/cli/review-finding.ts"
}
```

Command shape:

```bash
bun run review:finding -- \
  --finding-id <finding-id>
```

Optional inputs:

```text
--provider azure-openai
--model <deployment-or-model>
--max-snippet-lines <number>
--fixture-output <json-path>
```

Required behavior:

- stdoutはmachine-readable JSONだけにする。
- provider logやprompt debugはstdoutへ混ぜない。
- `--fixture-output` はテスト用にLLM呼び出しを置き換える。
- review失敗時もfinding/scanを変更しない。

Successful output:

```json
{
  "ok": true,
  "findingId": "...",
  "reviewId": "...",
  "status": "completed"
}
```

Failure output:

```json
{
  "ok": false,
  "findingId": "...",
  "reviewId": "...",
  "status": "failed",
  "message": "LLM provider is not configured"
}
```

## API Contract

追加または拡張するAPI:

```text
GET  /api/findings/:id/reviews
POST /api/findings/:id/reviews
GET  /api/finding-reviews/:id
```

最小要件:

- `GET /api/findings/:id` でlatest review summaryを返すか、reviewsを明示的に取得できる。
- `POST /api/findings/:id/reviews` はreviewを同期実行してよい。長時間queue化はPhase 3では必須にしない。
- provider未設定時は4xxで分かりやすいmessageを返す。
- review outputはschema済みの構造だけ返す。

## Frontend Scope

Phase 3のUIは最小でよい。

- finding detailにlatest reviewを表示する。
- review未実行なら実行buttonを出す。
- 実行中、失敗、完了の状態を表示する。
- 表示対象はsummary、false positive assessment、evidence strength、remediation direction、reviewer notes。

このPhaseではreviewer decision UIは作らない。採用、保留、誤検知の状態変更はPhase 4に分離する。

## Implementation Steps

### P0: Baseline Inspection

- 現在のfinding/evidence API responseを確認する。
- Semgrep finding detailに必要なlocation/snippet/artifact metadataが揃っているか確認する。
- Azure/OpenAI providerの既存interfaceがstructured JSON出力に使えるか確認する。

Completion criteria:

- review runnerに必要な既存repository/APIの差分が明確になっている。
- provider抽象の再利用範囲が決まっている。

### P1: Review Schema and Migration

- `finding_reviews` migrationを追加する。
- Drizzle schemaを更新する。
- shared Zod schemaを追加する。
- repositoryを追加する。

Completion criteria:

- review recordをcreate/update/list/getできる。
- schema validationのunit testがある。

### P2: Evidence Bundle Builder

- finding/evidence/artifact metadataを集約するbuilderを追加する。
- source snippet extractionを追加する。
- repo path boundary、symlink、file size、line count、redactionをテストする。

Completion criteria:

- builderが任意pathを受け取らず、finding/evidence locationだけからbundleを作る。
- repo外参照や読取不能fileが安全に扱われる。

### P3: Review Runner and Prompt

- structured output promptを追加する。
- provider呼び出しをrunnerへ接続する。
- output validationとfailed保存を実装する。
- fixture provider/test pathを追加する。

Completion criteria:

- fixture outputでreview completedを保存できる。
- invalid LLM outputはfailed reviewになり、不正JSONをcompleted扱いしない。
- provider未設定時の失敗がscan/findingへ波及しない。

### P4: CLI and API

- `api/cli/review-finding.ts` を追加する。
- `review:finding` scriptを追加する。
- finding review APIを追加する。
- finding detail APIからlatest reviewを取得できるようにする。

Completion criteria:

- CLI stdoutがJSONだけになる。
- APIからreview実行と取得ができる。
- auth境界が既存project/finding APIと整合している。

### P5: Minimal UI Surface

- finding detail viewにreview panelを追加する。
- review実行button、loading、error、completed表示を追加する。
- LLM reviewが一次証拠ではないことが表示構造上分かるようにする。

Completion criteria:

- Semgrep finding detailからreviewを実行し、結果を読める。
- tool evidence/source locationとLLM reviewが混ざって表示されない。

### P6: Verification and Regression Review

- unit testsを追加する。
- fixture E2Eを追加する。
- `bun run verify` を通す。
- `git diff --check` を通す。

Completion criteria:

- scan foundationとSemgrep adapterの既存テストが通る。
- LLM未設定環境でもreview以外の機能が壊れていない。

## Verification Commands

```bash
bun run test
bun run verify
git diff --check
```

必要に応じて個別に実行する。

```bash
bun test ./api/modules/scans/*.test.ts ./api/modules/scans/**/*.test.ts
bun run review:finding -- --finding-id <finding-id> --fixture-output tests/fixtures/reviews/finding-review.json
```

## Stop Conditions

次の状態になったら実装を止めて計画を見直す。

- LLMに任意file read権限を渡さないとreviewが成立しない。
- raw artifact全文をpromptへ入れないとschemaを満たせない。
- provider実装がscan/finding基盤の必須依存になる。
- review完了時にfinding statusを自動変更したくなる。
- reviewer decision workflowやreport generationを同時に入れないとUIが成立しない。

## Handoff to Phase 4

Phase 4では、人間の判断workflowを実装する。

候補:

- finding status: accepted / false_positive / deferred
- reviewer decision comment
- review history
- scan/finding listでのreview state filter
- Markdown report generation

Phase 4でも、LLM reviewは判断補助であり、人間のdecisionとは別のrecordとして扱う。
