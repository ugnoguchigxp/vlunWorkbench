# Delivery Quality Gates

この文書は、`hono-standard` のテンプレート、variant、overlay、およびそれらから作成したアプリケーションを Delivery 可能と判断するための品質契約です。

通常テスト、coverage、smoke test に加え、変更内容とリスクに応じてミューテーションテスト、パフォーマンステスト、vulnWorkbench によるセキュリティ診断を選択します。すべての検証を常設してテンプレートを肥大化させるのではなく、必要な保証を Delivery 時に選び、その結果と証拠を残すことを目的とします。

## 適用範囲

この契約は次の2種類の Delivery に適用します。

### Template Snapshot

- `main`、`variant/*`、`overlay/*` の release tag と archive snapshot。
- fresh clone または archive 展開後に、文書化された手順で利用を開始できることを確認する。
- variant / overlay 固有の runtime、DB、build、smoke contract も確認する。

### Application Delivery

- このテンプレートから作成したアプリケーションの release、deployment、または利用者への引き渡し。
- プロダクト固有の要件、SLO、security policy をこの契約へ追加してよい。
- テンプレートの既定値を、そのままプロダクトの合格基準として扱わない。

## 非目標

- すべての検証ツールをテンプレートの依存関係へ標準搭載すること。
- coverage または mutation score だけで正しさを証明すること。
- scanner を実行できなかった状態を安全と判断すること。
- プロダクト固有の性能値、脅威モデル、リスク受容をテンプレート側で決めること。
- 明確な実行条件なしに、すべての Delivery へ高コストな検証を要求すること。

## 用語

この文書では重要度を次のように扱います。

| 重要度 | 意味 |
| --- | --- |
| 必須 | 適用対象では必ず実行し、合格しなければ Delivery を停止する。 |
| 推奨 | 原則として実行する。省略する場合は理由を記録する。 |
| 条件付き必須 | 記載された trigger に該当する場合だけ必須になる。 |

検証結果は次のいずれかで記録します。

| Status | 意味 | Delivery 判断 |
| --- | --- | --- |
| `pass` | 合格基準を満たした。 | 続行可能。 |
| `fail` | 合格基準を満たさない、または検証自体が失敗した。 | 必須項目では停止。 |
| `not_applicable` | trigger に該当せず、検証対象外。 | 理由を記録して続行可能。 |
| `policy_skip` | policy に基づいて意図的に省略した。 | policy 名と理由が必要。 |
| `unavailable` | tool、環境、接続先などが利用できず実行できなかった。 | `pass` として扱わない。 |
| `accepted_risk` | finding または未実行リスクを権限者が期限付きで受容した。 | 承認者、理由、期限が必要。 |

## Gate 一覧

| ID | Gate | Template Snapshot | Application Delivery |
| --- | --- | --- | --- |
| `DQ-BOOT-001` | Fresh bootstrap | 必須 | 初回構築時に推奨 |
| `DQ-BASE-001` | Static checks / unit and contract tests / build | 必須 | 必須 |
| `DQ-COV-001` | Coverage threshold | 必須 | 必須 |
| `DQ-SMOKE-001` | API / browser smoke | 必須 | 必須 |
| `DQ-MUT-001` | Mutation testing | 条件付き必須 | 条件付き必須 |
| `DQ-PERF-001` | Performance verification | 条件付き必須 | 条件付き必須 |
| `DQ-SEC-001` | vulnWorkbench security diagnostic | 推奨 | 公開 Delivery では推奨、security-sensitive change では必須 |

## 常時実行する Gate

### `DQ-BOOT-001`: Fresh bootstrap

Template Snapshot は、tracked file だけから新しい環境を構築できることを確認します。

基本手順:

```bash
bun install --frozen-lockfile
bun run bootstrap
```

合格基準:

- lockfile と manifest が一致している。
- `.env.example` から文書化された local environment を準備できる。
- variant 固有の追加前提が README に記載されている。
- secret、local DB、build artifact を snapshot に含めていない。

失敗時:

- install、bootstrap、README、snapshot 内容の不一致を修正して再実行する。
- fresh environment で未確認の snapshot は公開しない。

### `DQ-BASE-001`: Static checks / tests / build

基本コマンド:

```bash
bun run verify
```

このテンプレートでは、`verify` が少なくとも次を含みます。

- TypeScript typecheck。
- Biome lint。
- format check。
- Vitest unit / contract / integration tests。
- coverage threshold。
- production build。

合格基準:

- すべての step が exit code `0` で終了する。
- skipped test、flaky retry、既知の失敗を成功として隠さない。
- test は可能な範囲で status、response body、永続状態、不変条件などの外部 behavior を具体的に検証する。

失敗時:

- 原因を修正して `bun run verify` 全体を再実行する。
- 必須 step を一時的に削除して通過扱いにしない。

### `DQ-COV-001`: Coverage threshold

このテンプレートの既定 threshold は、測定対象の lines、branches、functions、statements すべて `95%` です。

合格基準:

- `bun run test:coverage` が設定済み threshold を満たす。
- coverage 対象範囲が README または test config と一致する。
- entrypoint、generated code、薄い adapter などを除外する場合は、除外理由を test config に残す。

テンプレートの unit coverage は `api/**/*.ts`、`shared/**/*.ts`、`web/src/**/*.{ts,tsx}` のテスト可能なロジックを対象とします。React component / hook は jsdom と Testing Library で利用者操作および状態遷移を検証します。browser entrypoint、provider/route composition、variant 固有のdriverやCLIなど、薄い配線を除外する場合は `vitest.config.ts` に理由を残し、主要導線は Playwright smoke testで補完します。

coverage は未実行コードを発見するための下限であり、仕様の正しさや assertion の有効性を単独では保証しません。

### `DQ-SMOKE-001`: API / browser smoke

基本コマンド:

```bash
bun run verify:e2e
```

Template Snapshot の最小 smoke scope:

- public screen が表示できる。
- `/api/health` が成功する。
- auth を含む variant では login、protected route、logout が成立する。
- variant / overlay 固有の runtime または rendering contract を確認する。

合格基準:

- fresh environment で主要導線が成功する。
- test artifact に secret や認証情報を残さない。
- auth、route、runtime を削除した variant では、残存機能に合わせて smoke scope も更新する。

## リスクに応じて実行する Gate

### `DQ-MUT-001`: Mutation testing

目的は、通常テストが現実的な実装ミスを検出できるか評価することです。StrykerJS などの tool は必要時に導入し、通常の `bun run verify` へ常設する必要はありません。

Trigger:

- 認証、認可、tenant 分離、token、金額計算、状態遷移など重要ロジックを変更した。
- 境界条件、error handling、validation、transaction 制御を変更した。
- AI が実装とテストを同時生成し、共通原因故障の確認が必要になった。
- coverage は高いが assertion の故障検出力に疑義がある。

実行範囲:

- 変更ファイルまたは重要モジュールに限定してよい。
- 全 repository の mutation score を毎回計測する必要はない。
- syntax mutation だけで検出できない認可削除、filter 削除、`await` 削除などは、必要に応じて semantic mutation として別途確認する。

合格基準:

- security またはデータ整合性に関わる重大な mutant が生存していない。
- 生存 mutant を、test gap、等価 / 到達不能、仕様不明、低価値に分類している。
- score を上げるためだけに内部実装へ過剰適合した test を追加していない。

失敗時:

- test gap には、仕様または不変条件から導いた最小の test を追加する。
- 等価 / 到達不能 mutant を無効化する場合は、局所的な理由を残す。
- 仕様が不明なら合格扱いにせず、仕様判断へ戻す。

### `DQ-PERF-001`: Performance verification

Trigger:

- DB query、index、migration、pagination、search、cache を変更した。
- 並行処理、queue、stream、serialization、large payload を変更した。
- server rendering、asset、bundle、initial load に影響する変更を行った。
- SLO または既存 performance budget を持つ機能を変更した。

検証項目の例:

- p50 / p95 / p99 latency。
- throughput。
- error rate。
- CPU / memory usage。
- frontend bundle size または initial load。
- 変更前 baseline からの回帰率。

合格基準:

- Delivery 対象の SLO または performance budget を満たす。
- shared CI の揺らぎを考慮し、単発値だけでなく複数回の代表値または同一環境の baseline と比較する。
- template にはプロダクト固有の絶対値を固定せず、Application Delivery 側で予算を定義する。

失敗時:

- bottleneck と再現条件を記録して修正する。
- 予算変更で受容する場合は、影響、承認者、理由を記録する。

### `DQ-SEC-001`: vulnWorkbench security diagnostic

vulnWorkbench を、scanner-backed evidence に基づく統合セキュリティ診断として扱います。Semgrep、Gitleaks、OSV、Trivy、DAST などは vulnWorkbench 内部の scanner / profile であり、Delivery Gate として重複計上しません。

Trigger:

- 外部公開する Application Delivery。
- 認証、認可、session、cookie、token、secret、暗号処理を変更した。
- request validation、file upload、URL fetch、command execution、template rendering を変更した。
- dependency、container、runtime、deployment 設定を変更した。
- public API、管理画面、機密データ処理を追加または変更した。

合格基準:

- 対象変更に適した scanner / profile が実行されている。
- blocking severity の scanner-backed finding が未解決で残っていない。
- finding の修正後に、関連 scanner と通常の回帰検証を再実行している。
- DAST が必要な場合は、対象アプリケーションを安全な検証環境で起動して実行する。
- LLM-only concern を confirmed vulnerability として扱わない。

結果の扱い:

- `unavailable`、timeout、scanner failure を `pass` に変換しない。
- `policy_skip` は、対象外と判断した scanner、policy、理由を記録する。
- finding を受容する場合は、影響、代替対策、承認者、期限を記録する。

## Delivery Profile

### Baseline Template

必須:

- `DQ-BOOT-001`
- `DQ-BASE-001`
- `DQ-COV-001`
- `DQ-SMOKE-001`

リスクに応じて追加:

- `DQ-MUT-001`
- `DQ-PERF-001`
- `DQ-SEC-001`

### Public Web Application

必須:

- `DQ-BASE-001`
- `DQ-COV-001`
- `DQ-SMOKE-001`

原則として実行:

- `DQ-SEC-001`

Trigger に応じて必須:

- `DQ-MUT-001`
- `DQ-PERF-001`

### Security-sensitive Application

必須:

- `DQ-BASE-001`
- `DQ-COV-001`
- `DQ-SMOKE-001`
- `DQ-SEC-001`

重要ロジック変更時に必須:

- `DQ-MUT-001`

SLO または performance-sensitive change がある場合に必須:

- `DQ-PERF-001`

## 証拠

各実行では、該当する範囲で次を保存します。

- commit SHA、tag、snapshot 名。
- 実行日時と実行環境。
- 実行した command、tool version、profile。
- pass / fail / skip / unavailable の結果。
- coverage、mutation、performance、security report。
- finding、修正、再検証の対応関係。
- `policy_skip` または `accepted_risk` の理由と承認情報。

secret、token、cookie、個人情報、private source を report や公開 artifact に含めません。

## Delivery 判定

Delivery は次の条件をすべて満たした場合に可能です。

1. 適用される必須 Gate がすべて `pass` である。
2. 条件付き必須 Gate の trigger 判定が記録されている。
3. `fail` または未評価の blocking finding が残っていない。
4. `unavailable` を成功として扱っていない。
5. `policy_skip` と `accepted_risk` に必要な理由と承認がある。
6. Snapshot では archive 内容と checksum を確認している。

## Delivery Checklist

```text
Delivery target:
Commit / tag:
Profile:

[ ] DQ-BOOT-001 Fresh bootstrap
[ ] DQ-BASE-001 Static checks / tests / build
[ ] DQ-COV-001 Coverage threshold
[ ] DQ-SMOKE-001 API / browser smoke

[ ] DQ-MUT-001 Trigger evaluated
[ ] DQ-PERF-001 Trigger evaluated
[ ] DQ-SEC-001 Trigger evaluated

Blocking findings:
Policy skips:
Accepted risks:
Evidence:
Decision:
```

## Maintenance

- command、threshold、variant contract を変更した場合は、この文書と実装を同じ変更で更新する。
- Gate の意味を変えずに command だけ変更する場合は、既存 ID を維持する。
- Gate を廃止する場合は ID を再利用しない。
- 自動化が必要になるまでは、この Markdown を正本とし、同じ基準を別の YAML / JSON へ重複管理しない。
