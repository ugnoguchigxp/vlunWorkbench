# Phase 4: Reviewer Decision Workflow Implementation Plan

## Purpose

この計画は、vulnWorkbench のPhase 4として、findingに対する人間の判断workflowを実装するためのもの。

Phase 3でLLM reviewは `finding_reviews` として保存できるようになった。Phase 4では、LLM reviewを参考情報として扱いつつ、人間が最終判断を記録できる状態にする。

このPhaseの中心は、LLMの役割拡張ではない。LLM reviewは判断補助であり、accepted、false positive、deferred、needs fix などの最終判断は人間のdecision recordとして保存する。

## Source Baseline

前提文書:

- `spec/vuln-workbench-concept.md`
- `spec/phase-1-cli-scan-foundation-plan.md`
- `spec/phase-2-semgrep-adapter-plan.md`
- `spec/phase-3-llm-finding-review-plan.md`

既に成立している前提:

- CLI scan結果からfinding/evidenceを保存できる。
- Semgrep adapterで実toolのfindingを作れる。
- LLM reviewは既存finding/evidenceだけを入力にして実行できる。
- LLM reviewは `finding_reviews` に保存され、finding本体のstatusを自動更新しない。
- finding detail UIでevidenceとlatest reviewを参照できる。

## Scope

Phase 4で実装するもの。

- reviewer decision用DB table
- decision入力/出力の共有Zod schema
- decision repository
- decision作成/一覧/取得API
- finding detail APIでlatest decisionを返す拡張
- finding listでdecision stateを確認する最小UI
- finding detailでdecisionを追加できる最小UI
- `decision:finding` CLI command
- decision履歴の保存
- decisionとLLM reviewを分離した表示
- decision workflow unit/API tests

Phase 4で実装しないもの。

- LLM reviewの再設計
- LLMによるdecision自動確定
- LLMによるrepo自由探索
- patch生成、patch適用、修正PR作成
- Markdown report generation
- cross-scan dedupe
- Gitleaks/OSV/Trivy adapter
- Docker toolbox image
- SARIF parser
- sandbox再現、DAST、fuzzing
- CI統合
- multi-user approval workflow

## Definition of Done

Phase 4は、次を満たしたら完了とする。

- finding IDを指定して、人間のdecisionを保存できる。
- decisionはLLM reviewとは別recordとして保存される。
- accepted / false_positive / deferred / needs_fix の最小decision stateを扱える。
- decisionには理由、任意のcomment、任意のlinked review IDを保存できる。
- decision作成後もCLI artifact、finding evidence、LLM reviewは失われない。
- finding detail APIでlatest decisionを取得できる。
- finding listまたはdetail UIでdecision stateを確認できる。
- UIからdecisionを記録して履歴を確認できる。
- CLIからdecisionを記録でき、自動化や回帰確認に使える。
- LLM provider未設定でもdecision workflowは動く。
- `bun run verify` が通る。

## Design Principle

Phase 4では、次の3つを分離する。

```text
finding = CLI toolが検出した正規化結果
finding_review = LLMが既存finding/evidenceをレビューした補助情報
finding_decision = 人間が最終判断として記録した状態
```

LLM reviewの `confidenceAdjustment` はdecisionの参考にはできるが、decisionを自動確定しない。

decisionは人間の操作または明示的なCLI commandだけで作る。scan、normalizer、LLM review runnerはdecisionを勝手に作らない。

## Data Model

追加table案:

```text
finding_decisions
  id
  finding_id
  decision
  reason
  comment
  linked_review_id
  decided_by_user_id
  created_at
  updated_at
```

`decision` の最小値:

```text
accepted
false_positive
deferred
needs_fix
```

各値の意味:

```text
accepted:
  findingを有効な問題として採用する。

false_positive:
  findingを誤検知として退ける。

deferred:
  今は判断せず、追加確認または後続判断へ回す。

needs_fix:
  問題として扱い、修正対象にする。
```

`reason` の最小値:

```text
confirmed_by_evidence
confirmed_by_review
insufficient_evidence
environment_specific
tool_noise
not_exploitable
accepted_risk
other
```

`linked_review_id` は任意にする。LLM reviewが存在しなくてもdecisionは作れる必要がある。

## Finding Status Projection

Phase 4では、decision履歴を一次情報とする。

`findings.status` を拡張するかどうかは実装時に判断する。ただし、拡張する場合でも、`finding_decisions` を真の履歴として残す。

候補:

```text
open
accepted
false_positive
deferred
needs_fix
```

Projection方針:

- latest decisionをfinding detail/listで返す。
- `findings.status` を更新する場合はlatest decisionからの派生値として扱う。
- decision削除はPhase 4では実装しない。訂正は新しいdecisionを追加して履歴で表現する。

## API Contract

追加または拡張するAPI:

```text
GET  /api/findings/:id/decisions
POST /api/findings/:id/decisions
GET  /api/finding-decisions/:id
```

既存API拡張:

```text
GET /api/findings/:id
  -> latestDecision を追加

GET /api/scans/:id/findings
  -> latestDecisionSummary または decisionState を追加
```

`POST /api/findings/:id/decisions` request:

```json
{
  "decision": "needs_fix",
  "reason": "confirmed_by_evidence",
  "comment": "Semgrep location and snippet match the unsafe call.",
  "linkedReviewId": "optional-review-id"
}
```

Response:

```json
{
  "decision": {
    "id": "...",
    "findingId": "...",
    "decision": "needs_fix",
    "reason": "confirmed_by_evidence",
    "comment": "...",
    "linkedReviewId": "...",
    "decidedByUserId": "...",
    "createdAt": "..."
  }
}
```

Required behavior:

- request userがfindingのproject ownerであることを確認する。
- `linkedReviewId` が指定された場合、そのreviewが同じfindingに属することを確認する。
- decision作成にLLM provider設定を要求しない。
- decision作成失敗でfinding/evidence/reviewを壊さない。
- 既存decisionの上書きではなく、新しいdecisionを追加する。

## CLI Contract

追加script:

```json
{
  "decision:finding": "bun run api/cli/decision-finding.ts"
}
```

Command shape:

```bash
bun run decision:finding -- \
  --finding-id <finding-id> \
  --decision needs_fix \
  --reason confirmed_by_evidence \
  --comment "Semgrep evidence matches the vulnerable call."
```

Optional inputs:

```text
--linked-review-id <review-id>
--decided-by-user-id <user-id>
```

Required behavior:

- stdoutはmachine-readable JSONだけにする。
- findingが存在しない場合はfailed JSONを出してnon-zero exitする。
- `linked-review-id` が同じfindingに属さない場合はfailed JSONを出してnon-zero exitする。
- LLM設定は読まない。
- scanやreviewを実行しない。

Successful output:

```json
{
  "ok": true,
  "findingId": "...",
  "decisionId": "...",
  "decision": "needs_fix"
}
```

Failure output:

```json
{
  "ok": false,
  "findingId": "...",
  "status": "failed",
  "message": "Linked review does not belong to this finding"
}
```

## Frontend Scope

Phase 4のUIは、既存のScans画面に最小追加する。

Finding list:

- decision state badgeを表示する。
- 未判断は `open` または `undecided` として表示する。
- severity、source tool、decision stateが同時に読めるようにする。

Finding detail:

- LLM review panelとは別に `Reviewer Decision` panelを置く。
- accepted / false positive / deferred / needs fix を選択できる。
- reasonを選択できる。
- commentを入力できる。
- latest reviewがある場合、任意でlinked reviewとして紐づけられる。
- decision historyを時系列で表示する。

Avoid:

- decision UIをLLM review結果の中に混ぜ込まない。
- LLM review完了時にdecisionを自動選択しない。
- report generation UIを同時に作らない。

## Implementation Steps

### P0: Baseline Inspection

- `findings.status` と `findingReview` の現在のschema/API responseを確認する。
- Scans UIでfinding list/detailがどのresponseを使っているか確認する。
- Phase 3のreview APIがdecisionから参照できる形になっているか確認する。

Completion criteria:

- decision tableを追加する場所と、API拡張箇所が明確になっている。
- `findings.status` を拡張するか、latest decision projectionに留めるか判断できる。

### P1: Schema and Migration

- `finding_decisions` migrationを追加する。
- Drizzle schemaを追加する。
- shared Zod schemaを追加する。
- reason/decision enumを定義する。

Completion criteria:

- decision recordをinsert/list/getできる。
- invalid decision/reasonがschemaで拒否される。
- linked review FKまたはapplication validation方針が明確になっている。

### P2: Repository and Validation

- `api/modules/decisions/` を追加する。
- decision repositoryを追加する。
- linked reviewが同一findingに属することを検証する。
- latest decision取得を実装する。

Completion criteria:

- latest decisionが安定して取得できる。
- 別findingのreviewをlinked reviewとして保存できない。
- decision作成はscan/review実行に依存しない。

### P3: API

- `GET /api/findings/:id/decisions` を追加する。
- `POST /api/findings/:id/decisions` を追加する。
- `GET /api/finding-decisions/:id` を追加する。
- `GET /api/findings/:id` にlatestDecisionを追加する。
- scan findings listにdecision summaryを追加する。

Completion criteria:

- owner以外はdecisionを読めない/作れない。
- decision作成後、finding detailでlatestDecisionが返る。
- linked review validationがAPI testで確認されている。

### P4: CLI

- `api/cli/decision-finding.ts` を追加する。
- `decision:finding` scriptを追加する。
- CLI args validationを追加する。
- stdoutをJSONだけにする。

Completion criteria:

- CLIからdecisionを作成できる。
- failure pathでもmachine-readable JSONを返す。
- LLM設定なしで動く。

### P5: Minimal UI

- Scans finding listにdecision badgeを追加する。
- Finding detailにReviewer Decision panelを追加する。
- decision create formを追加する。
- decision historyを表示する。

Completion criteria:

- UIからdecisionを作成できる。
- 作成後、latest decisionとhistoryが更新される。
- LLM review panelとdecision panelが表示上分離されている。

### P6: Verification and Regression Review

- repository unit testsを追加する。
- route testsを追加する。
- CLI smoke testを追加する。
- UI buildが通ることを確認する。
- full verifyを実行する。

Completion criteria:

- `bun run verify` が通る。
- `git diff --check` が通る。
- LLM provider未設定でもdecision testsが通る。
- Phase 3 review testsが壊れていない。

## Verification Commands

Phase 4実装中は、次を完了条件として扱う。

```bash
bun run test
bun run verify
git diff --check
```

個別確認:

```bash
bun test ./api/modules/decisions/*.test.ts ./api/modules/decisions/**/*.test.ts
bunx vitest run api/routes/findings.route.test.ts
bun run decision:finding -- --finding-id <finding-id> --decision needs_fix --reason confirmed_by_evidence --comment "Confirmed from evidence."
```

Fresh migration確認:

```bash
rm -f /tmp/vuln-workbench-phase4-fresh.sqlite
DATABASE_URL=file:/tmp/vuln-workbench-phase4-fresh.sqlite bun run db:migrate
```

Expected results:

- all migrations apply in numeric order.
- decision table exists after migration.
- invalid decision input is rejected.
- linked review from another finding is rejected.
- latest decision is returned from finding detail.
- LLM provider settings are not required.

Failure handling:

- migration failure: migration order and FK target table existenceを先に直す。
- API authorization failure: project ownership checkを先に直す。
- linked review validation failure: repository validationを先に直す。
- UI build failure: API response shapeとfrontend typeを合わせる。
- verify failure: Phase 4以外の便乗修正に広げず、該当差分へ戻って直す。

## Stop Conditions

次の状態になったら実装を止めて計画を見直す。

- LLM reviewからdecisionを自動確定したくなる。
- decision作成にLLM provider設定が必要になる。
- decisionを保存するためにCLI artifactやfinding evidenceを書き換える必要が出る。
- decision履歴を残さず、finding statusだけを上書きする設計になる。
- report generationやpatch workflowを同時に入れないとUIが成立しない。
- reviewer decisionとLLM reviewの表示が混ざり、どちらの判断か分からなくなる。

## Handoff to Phase 5

Phase 5では、decision済みfindingを使ったMarkdown report generationを実装する。

候補:

- accepted / needs_fix findingのreport section生成
- false_positive / deferredの扱い方
- raw artifact and evidence references
- LLM review summaryの任意引用
- report artifact保存
- report export CLI

Phase 5でも、reportは既存finding/evidence/review/decisionを出力する後段処理であり、新しい脆弱性探索は行わない。
