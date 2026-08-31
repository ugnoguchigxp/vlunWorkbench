# Phase 48: Quality, Reliability, and Maintainability Hardening Plan

Status: Proposed

Baseline commit: `21ac659`

Baseline date: 2026-07-30

Owner: vulnWorkbench maintainers

Target: Phase 48 の全 slice が完了するまで active plan として扱う

## 1. 目的

この計画は、release-readiness 評価で判明した次の改善点を、相互に壊さず段階的に実装するための実行計画である。

1. fresh install で実行不能な Web coverage gate を復旧する。
2. 実 DB・実 API・実 scan process を通る最小 UI E2E を追加する。
3. 巨大な UI/controller と backend 中核を責務単位に分割する。
4. 4 種類の個別 scanner CLI に重複する lifecycle を共通化する。
5. scanner の大量出力と Docker resource 消費に上限を設ける。
6. local verification、CI、README、dependency override 文書の意味を一致させる。
7. `scripts/` を TypeScript・Biome の検証対象へ入れる。
8. Mermaid 描画機能と依存を完全に削除し、bundle 上限を 500 KB 以下へ引き下げる。

単に現時点の gate を通すのではなく、同種のドリフトと可用性事故を再発させない仕組みまでを完了条件に含める。

## 2. 現状と優先度

| Priority | 現状 | 影響 |
| --- | --- | --- |
| P1 | `test:coverage:web` が `@vitest/coverage-v8` 不在で起動前に失敗する | CI の coverage job が fresh install で必ず失敗する |
| P2 | scan 結果 UI E2E が `**/api/**` の大部分を mock する | API、DB、scan lifecycle、UI の接続不良を検出できない |
| P2 | 39 production files が 500 行以上 | 中核変更の review 面積と regression risk が大きい |
| P2 | 4 scanner CLI、合計 1,426 行に lifecycle 重複がある | exit code、metadata、cleanup、error handling がずれやすい |
| P2 | scanner stdout/stderr が全量 memory buffer される | 悪意ある、大規模な対象で host memory を枯渇させ得る |
| P2 | static scanner container に既定 resource/pids limit がない | fork-heavy process や重い scan が共有 host を圧迫し得る |
| P3 | `verify`、CI、README の closeout 定義が異なる | local green と CI green の意味が一致しない |
| P3 | `scripts/` 3,510 行が TypeScript・Biome の対象外 | release gate 自体の regression を静的検査で捕捉できない |
| P3 | dependency override 文書と `package.json` が不一致 | security pin の根拠と実装がドリフトする |
| P3 | Mermaid chunk が 800,711 bytes | 暫定 820 KB 上限直下で、500 KB 目標を超える |

baseline の規模は TypeScript 約 122,647 行、production TypeScript 約 88,632 行、500 行以上の production file 39 件、4 scanner CLI 合計 1,426 行である。Slice 48.0 で同じ集計条件を script 化し、以後の比較条件を固定する。

## 3. この計画で固定する判断

実装中に同じ設計判断を繰り返さないため、以下を Phase 48 の固定契約とする。

### 3.1 verification の意味

- `bun run verify` は、日常開発向けの再現性が高い fast gate とする。
- `bun run verify:strict` は release/closeout gate とし、`verify`、Web/critical coverage、browser E2E を含める。
- CI は個別コマンドを独自に並べず、原則 `bun run verify:strict` を唯一の入口にする。
- README、CONTRIBUTING、production runbook で `verify` を closeout gate と表現しない。
- strict gate の step 一覧は 1 つの TypeScript module から構成し、CI と文書で別々に複製しない。

### 3.2 coverage

- `vitest` と `@vitest/coverage-v8` は同一の完全固定 version `4.1.8` とする。
- coverage dependency は optional peer の偶然の解決に依存せず、root `devDependencies` に明示する。
- 現在の 80% threshold は復旧時に下げない。
- 巨大 `.tsx` を一度に coverage 対象へ加えて数値を埋めるのではなく、純粋 state transition、API orchestration、表示 component の seam を抽出してから対象を広げる。
- coverage include/exclude の変更は、必ず「新たに守る production path」とそのテストを同じ PR に含める。

### 3.3 実 UI E2E

- 新しい critical-flow E2E は SQLite、Hono API、scan supervisor、CLI、repositories、React UI を実際に通す。
- `page.route("**/api/**")` や API response fixture を critical-flow E2E では使用しない。
- 外部 network や開発端末に入った scanner binary には依存しない。
- `tests/e2e/fixtures/bin` の deterministic scanner executables を、E2E server process の `PATH` 先頭にだけ追加する。
- test fixture binary は本番 profile や本番 package から参照できない配置・起動方法にする。
- scan 結果は fixture binary が実 scanner の machine-readable contract に沿って出力し、production parser/normalizer を通す。

### 3.4 scanner output limit

- stdout/stderr は `arrayBuffer()` で全量保持しない。
- stdout は一時 artifact file へ stream しながら byte 数と SHA-256 を計測する。
- 初期既定値は stdout 64 MiB、stderr 8 MiB、diagnostic tail 64 KiB とする。
- server operator は環境変数で値を小さくできる。大きくする場合も hard ceiling の stdout 256 MiB、stderr 32 MiB を超えられない。
- limit 超過時は process/container 全体を停止し、`tool_output_limit_exceeded` として scan event と metadata に記録する。
- 途中までの JSON/SARIF を parse して部分成功にはしない。finding の一部保存も行わない。
- timeout、cancel、output-limit のすべてで一時 file と child/container を cleanup する。

### 3.5 Docker resource policy

static scanner container の既定値を次で開始する。

| Resource | Default | Server-side allowed range |
| --- | ---: | ---: |
| memory | 4 GiB | 512 MiB–8 GiB |
| memory swap | memory と同値 | memory と同値 |
| CPU | 2 | 0.25–4 |
| PIDs | 512 | 64–1,024 |

- Docker command には常に `--memory`、`--memory-swap`、`--cpus`、`--pids-limit` を付ける。
- Web request から server 上限を緩和できない。現在の `memory`、`cpus` request field は削除する。
- CLI override が必要な場合も、server policy が定めた範囲内に validation する。
- 実効値は scan event と tool metadata に保存し、障害解析時に確認できるようにする。
- 既定値が特定 scanner に不足する場合、無制限へ戻さず、測定結果と owner を添えて tool-specific policy を追加する。

### 3.6 Mermaid removal

- Mermaid diagram rendering は product feature から削除する。
- `mermaid`、`@mermaid-js/parser`、Mermaid 専用 Vite alias、`enableMermaid`、`mermaidLib` を production source と root dependency から除去する。
- Markdown の `mermaid` fenced block は diagram として実行せず、通常の code block として安全に表示する。
- 新規 artifact type として `mermaid` は受け付けない。
- 既存 DB の `artifacts.type = 'mermaid'` は migration で `code` へ変換し、`metadata.legacyArtifactType = 'mermaid'` を残す。
- migration 前後の互換期間は API/UI の unknown type fallback でも plain code として表示し、内容を消失させない。
- historical spec と既存 migration の記録は改ざんしない。禁止対象は active runtime、build config、package graph、current docs である。
- Mermaid が唯一の理由である `dompurify` override は dependency tree を再確認し、consumer がなければ同じ PR で削除する。

### 3.7 大規模 file の分割

- 行数だけを目的に意味のない wrapper を増やさない。
- 分割前に characterization test を追加し、外部 API、DB schema、CLI stdout、exit code、UI route を維持する。
- orchestration file は原則 500 行未満を目標、暫定上限 700 行とする。
- 新規 production file は原則 500 行未満とする。
- 500 行以上の既存 file は size-budget manifest に owner、理由、削減目標を登録し、増加を禁止する。
- Phase 48 では下記の高リスク中核を優先する。他の既存 large file は ratchet で悪化を防ぎ、別計画へ送る。

Phase 48 で 500 行未満へ分割する優先対象:

| File | Baseline LOC | 主な分割軸 |
| --- | ---: | --- |
| `web/src/domains/scans/use-scans-controller.ts` | 1,587 | selection、load、launch、finding、report、verification |
| `api/modules/scans/report-builder.ts` | 1,505 | query model、section builders、assembly |
| `api/modules/scans/profile-runner.ts` | 1,339 | step executors、failure policy、event mapping |
| `api/db/schema.ts` | 1,325 | domain schema、relations、shared columns |
| `web/src/domains/projects/projects-domain.tsx` | 1,264 | list/form、members、path policy、panels |
| `web/src/settings-panel.tsx` | 1,236 | provider、credential、runtime、maintenance |
| `api/app/hono.ts` | 1,009 | runtime、middleware、routes、errors、static serving |

元の 7 path はそれぞれ 500 行未満、抽出先も原則 500 行未満とする。これにより 500 行以上の production file 数を少なくとも 39 件から 32 件以下へ減らす。責務上 500 行未満にできないことが判明した場合は、700 行以下の期限付き例外として evidence、owner、次回分割日を size-budget manifest に記録し、Phase 48 closeout の residual risk にする。

## 4. 対象範囲

### 4.1 必須対象

- `package.json`
- `bun.lock`
- `.github/workflows/verify.yml`
- `vitest.config.ts`
- `playwright.config.ts`
- `tests/e2e/setup-fixture.ts`
- `tests/e2e/release-readiness.spec.ts`
- `scripts/verify.ts`
- `scripts/check-bundle-budget.ts`
- `tsconfig.json` または新設する `tsconfig.scripts.json`
- `biome.json`
- `docs/dependency-overrides.md`
- `README.md`
- `README.jp.md`
- `CONTRIBUTING.md`
- `docs/production-runbook.md`
- `api/modules/scans/tools/tool-process-runner.ts`
- 4 scanner CLI と共通 lifecycle
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/projects/projects-domain.tsx`
- `web/src/settings-panel.tsx`
- `api/modules/scans/report-builder.ts`
- `api/modules/scans/profile-runner.ts`
- `api/db/schema.ts`
- `api/app/hono.ts`
- Mermaid を import、initialize、render する全 active source

### 4.2 non-goals

- scanner の detection rule や finding severity policy の変更
- DB engine の SQLite からの変更
- UI framework、Hono、Drizzle、test runner の置換
- 全 39 large file の Phase 48 内での完全分割
- historical planning document の書き換え
- E2E で実際の third-party scanner を download すること
- scanner output を無制限に保持するための object storage 導入

## 5. 目標状態

Phase 48 完了後の検証経路は次の直列契約になる。

```text
clean checkout
  -> frozen install
  -> verify (static checks, unit/integration, build, bundle, audit)
  -> coverage:web + coverage:critical
  -> browser E2E with isolated real SQLite
  -> strict success
```

scan 実行経路は次の責務境界になる。

```text
thin scanner CLI
  -> shared single-tool lifecycle
  -> tool-specific runner
  -> bounded stream collector
  -> tool-specific normalizer
  -> repository writes and event metadata
```

UI は page/controller から純粋 state と副作用を分け、E2E と unit/component test の両方で重要経路を守る。

## 6. 実装順序と依存関係

| Slice | Priority | 内容 | 前提 |
| --- | --- | --- | --- |
| 48.0 | P0 | baseline と契約の固定 | なし |
| 48.1 | P1 | coverage gate と strict verification の復旧 | 48.0 |
| 48.2 | P2 | Mermaid 削除と bundle 500 KB 化 | 48.1 |
| 48.3 | P2 | 実 DB critical-flow browser E2E | 48.1、48.2 |
| 48.4 | P2 | scanner output/resource hardening | 48.3 の fixture contract |
| 48.5 | P2 | 4 scanner CLI lifecycle 共通化 | 48.4 |
| 48.6 | P2 | UI/controller 分割と直接テスト | 48.3 |
| 48.7 | P2 | backend 中核分割と size ratchet | 48.4、48.5 |
| 48.8 | P3 | scripts、docs、override sync の恒久化 | 48.1–48.7 |
| 48.9 | P0 | clean checkout closeout | 全 slice |

48.5 と 48.6 は 48.4 完了後に並行実装できる。48.7 は scanner lifecycle の最終境界を前提とし、同じ file を複数 PR で同時変更しない。

## 7. Slice 48.0: baseline と契約の固定

### 7.1 実装

1. baseline commit、Bun version、OS、DB migration 数を evidence に記録する。
2. 次の command の current result、duration、peak RSS が取得可能ならそれも記録する。
   - `bun install --frozen-lockfile`
   - `bun run verify`
   - `bun run test:coverage`
   - `bun run test:coverage:critical`
   - `bun run test:e2e`
   - `bun run build`
   - `bun run check:bundle`
3. production TypeScript LOC、500 行以上の file 一覧、scanner CLI 4 file の行数を machine-readable JSON に保存する。
4. bundle asset 名、raw bytes、gzip bytes、module graph を保存する。
5. `test:coverage` の期待失敗を「既知の P1」として記録し、他の失敗と区別する。

### 7.2 成果物

- `spec/evidence/phase-48-baseline.json`
- `spec/evidence/phase-48-large-files.json`
- `spec/evidence/phase-48-bundle-baseline.json`

### 7.3 完了条件

- 後続 PR が数値を改善・悪化させたか比較できる。
- evidence は secret、absolute home path、generated artifact 本体を含まない。
- current failure が coverage provider 不在であることを再現できる。

## 8. Slice 48.1: coverage gate と strict verification

### 8.1 変更

1. `devDependencies` に `"@vitest/coverage-v8": "4.1.8"` を追加する。
2. `bun.lock` を Bun で更新し、Vitest と provider の version 一致を確認する。
3. `bun run test:coverage:web` と `bun run test:coverage:critical` を個別に通す。
4. `scripts/verify.ts` の step definition と process execution を再利用可能な module に分ける。
5. `verify:strict` を実体のある full gate に変更する。
6. `.github/workflows/verify.yml` は setup 後に `bun run verify:strict` を呼ぶ。
7. coverage report と Playwright artifact の CI upload は失敗時にも取得できるようにする。
8. strict 実行時の test 二重実行は初回は許容し、duration evidence を基に後で最適化する。最適化で gate を省略しない。

### 8.2 clean install 検証

- 既存 `node_modules` に依存しない clean checkout または一時 worktree で検証する。
- `bun install --frozen-lockfile` が lockfile を変更せず成功する。
- `bun pm ls @vitest/coverage-v8` が `4.1.8` を示す。
- install 後、最初の command として `bun run test:coverage:web` が起動・完走する。

### 8.3 failure handling

- provider/Vitest version がずれた場合、threshold を下げたり provider を Istanbul へ変更して回避しない。
- platform-specific install failure は lockfile の原因 package を evidence 化し、CI matrix を無効化しない。
- coverage report generation 自体の failure は test failure と別 label で表示する。

### 8.4 完了条件

- fresh frozen install から Web coverage が成功する。
- Web と critical coverage が各 80% threshold を満たす。
- `verify:strict` が coverage と E2E を必ず含む。
- CI と local strict gate の command graph が一致する。
- P1 を修正する PR は他の large refactor を含まない。

## 9. Slice 48.2: Mermaid removal と bundle budget

### 9.1 product behavior

1. `MarkdownEditor` から Mermaid enablement と library injection を削除する。
2. chat の Mermaid artifact 専用 render branch を削除する。
3. search、knowledge、scan report detail、chat の Markdown 表示は通常の Markdown/code 表示を維持する。
4. `mermaid` fenced block と旧 Mermaid artifact は `<pre><code>` 相当の inert text として表示する。
5. unknown artifact type を空文字に置換して内容を捨てる挙動をやめ、安全な code fallback とする。

### 9.2 data compatibility

1. migration 前に `artifacts.type = 'mermaid'` 件数を取得できる check を用意する。
2. forward migration で type を `code` に変換する。
3. `metadata` が object の場合は `legacyArtifactType: "mermaid"` を merge する。
4. `metadata` が null または不正な legacy 値でも migration が停止しないように test fixture を用意する。
5. migration の down は diagram rendering を復元せず、必要なら type label のみを戻す。production rollback は application rollback と DB backup restore の手順を runbook に記す。

### 9.3 dependency/build cleanup

- `package.json` から `mermaid` を削除する。
- `bun.lock` から root Mermaid graph を除去する。
- `vite.config.ts` の Mermaid alias を削除する。
- active source の Mermaid import、`initialize`、`enableMermaid`、`mermaidLib` を削除する。
- `api/modules/artifacts/types.ts` と extraction allowlist から `mermaid` を削除する。
- dependency tree を確認し、不要になった `dompurify` override を削除する。
- current docs の Mermaid rendering 説明を削除する。

### 9.4 500 KB budget

Mermaid 削除後に次に大きい chunk が 500 KB を超える場合、`MarkdownEditor`、syntax highlight、chart、report detail など route-specific UI を dynamic import へ分ける。単に上限を次の大きい chunk に合わせて引き上げない。

`scripts/check-bundle-budget.ts` の完了時 budget:

| Metric | Hard limit |
| --- | ---: |
| initial JavaScript gzip | 256,000 bytes |
| initial CSS gzip | 35,000 bytes |
| largest JavaScript chunk raw | 500,000 bytes |

さらに asset/module 名に `mermaid` または `@mermaid-js/parser` が含まれないことを検査する。Mermaid にのみ由来していた graph/layout package も dependency graph から消えたことを確認する。

### 9.5 tests

- artifact extraction: legacy Mermaid input が code artifact へ安全に normalize される。
- artifact UI: unknown/legacy type でも content が消えない。
- Markdown UI: Mermaid fence が実行されず code として表示される。
- DB migration: null metadata、既存 metadata、0 件、複数件。
- route smoke: search、knowledge、scan report、chat が crash しない。
- build assertion: Mermaid chunk/import がない。

### 9.6 完了条件

- `rg` で active source/package/build config に Mermaid runtime 参照がない。
- clean frozen install が成功する。
- `bun run build` と `bun run check:bundle` が 500 KB hard limit で成功する。
- legacy content が失われず、script/diagram として実行されない。
- dependency override 文書から削除した pin の理由も消えている。

## 10. Slice 48.3: 実 DB critical-flow browser E2E

### 10.1 scenario

新しい test は 1 つの browser session で次を実行する。

1. seeded admin で login する。
2. UI から allowed root 内の fixture project を登録する。
3. UI から既存 `baseline` profile の scan を作成する。E2E process では scanner command だけを fixture binaries へ解決する。
4. scan status を UI/API polling の通常経路で `completed` まで待つ。
5. Semgrep または Gitleaks fixture が作った finding を scan results UI に表示する。
6. finding title、severity、location、evidence の最低 1 件を確認する。
7. UI から report を生成する。
8. report status、本文、finding reference を表示または download して確認する。
9. SQLite を read-only 接続し、project、scan run、finding、report の foreign-key chain が同じ ID で存在することを確認する。

### 10.2 fixture design

- `tests/e2e/fixtures/project` に最小の manifest と source を置く。
- `tests/e2e/fixtures/bin` に Semgrep、Gitleaks、OSV の executable fixture を置く。
- fixture は version check と scan command の両方に deterministic response を返す。
- fixture output は実 tool schema の最小 valid payload とする。
- Playwright web server の `PATH` 先頭だけを fixture bin にする。
- E2E isolated process では `SCAN_EXECUTION_MODE=host` と `ALLOW_HOST_SCANNER_EXECUTION=true` を使う。
- production/default environment の host execution policy は緩和しない。
- DB、writer socket、artifact root、project root は worker/process ごとに `.tmp/e2e` へ隔離する。
- setup は stale DB だけでなく artifact/temp process state も掃除する。

### 10.3 mock test の扱い

- 既存 mock ベース test は UI error/empty/loading state を高速に確認する component/contract test として残せる。
- release-readiness の証拠は real-flow test を参照する。
- test 名に `mocked` または `real-db` を含め、保証範囲を曖昧にしない。
- critical-flow spec で `page.route` を使用しないことを code review checklist に含める。

### 10.4 reliability

- 固定 sleep を使用せず、scan status/event を条件付きで poll する。
- timeout 時は最後の scan events、supervisor stdout/stderr tail、DB row を test artifact に残す。
- fixture executable の invocation log を test artifact に残し、secret や absolute user path は redact する。
- retry 前提で隠さず、CI retry は 0 から開始する。

### 10.5 完了条件

- fresh DB で project 登録から report 生成まで成功する。
- critical-flow test に API response mock がない。
- third-party network access と installed scanner binary が不要である。
- failure 時にどの layer で停止したか artifacts から判定できる。
- Chromium で 10 回連続実行し flaky failure がない。

## 11. Slice 48.4: scanner output と container resource の境界

### 11.1 bounded stream collector

新設候補:

- `api/modules/scans/tools/bounded-process-output.ts`
- `api/modules/scans/tools/process-output-policy.ts`
- `api/modules/scans/tools/process-output-error.ts`

collector の責務:

1. stdout/stderr stream を独立して読む。
2. stdout を同一 filesystem 上の temporary file へ書く。
3. stderr は bounded tail を保持し、必要なら bounded diagnostic artifact に書く。
4. byte count と SHA-256 を更新する。
5. limit 到達時に abort signal を発火する。
6. child process group または Docker container を停止し、終了を待つ。
7. success の場合だけ atomic rename で正式 artifact にする。
8. parse が full text を必要とする tool は size check 後に file を読む。memory は最大 64 MiB に制限される。

### 11.2 error contract

共通 error code:

- `tool_output_limit_exceeded`
- `tool_stderr_limit_exceeded`
- `tool_timed_out`
- `tool_cancelled`
- `tool_process_failed`
- `tool_output_parse_failed`

保存 metadata:

- configured limit
- observed bytes
- stdout/stderr の別
- truncated flag
- SHA-256（完全出力を得られた場合）
- exit code/signal
- effective Docker resource policy
- cleanup result

diagnostic tail は UI に直接 HTML として挿入せず、既存 escaping を通す。

### 11.3 Docker command

1. resource policy の schema と resolver を `api/app/env.ts` 近傍へ追加する。
2. static scanner の全 Docker invocation に fixed flags を追加する。
3. memory と memory-swap を同値にし、swap による host pressure 拡大を防ぐ。
4. `--pids-limit=512` を既定にする。
5. request body の `memory` と `cpus` を Web API/client から削除する。
6. command preview、events、report metadata に effective policy を含める。
7. Docker unavailable、OOMKilled、PID exhaustion を区別して event 化する。

### 11.4 tests

- 64 MiB を実際に生成せず、小さい injected limit で stdout 超過を再現する。
- stderr 超過を再現する。
- limit 丁度、limit + 1 byte、multi-byte chunk 境界を確認する。
- stdout と stderr を同時に出す deadlock case を確認する。
- timeout、cancel、limit の race で cleanup が 1 回だけ行われる。
- malformed JSON は parse failure になり、partial finding が保存されない。
- Docker args snapshot に memory、swap、CPU、PIDs が必ずある。
- Web request が resource 値を指定すると validation error になる。
- CLI override の範囲外を拒否する。

### 11.5 rollout

1. local fixture scanner で collector を導入する。
2. Semgrep、Gitleaks、OSV、Trivy の順に切り替える。
3. CI E2E fixture で limit 未満の正常系を確認する。
4. staging 相当で実 scan の output size 分布を記録する。
5. 既定値を変更する場合は evidence と runbook を同じ PR に含める。

### 11.6 完了条件

- scanner stdout/stderr の無制限 `arrayBuffer()` がない。
- output limit 超過が deterministic に失敗し、child/container と temp file が残らない。
- static Docker scanner は未指定時にも全 resource limit を持つ。
- Web user は server resource ceiling を緩和できない。
- failure metadata から timeout、OOM、PID、output overflow を区別できる。

## 12. Slice 48.5: scanner CLI lifecycle 共通化

### 12.1 対象

- `api/cli/scan-semgrep.ts`
- `api/cli/scan-gitleaks.ts`
- `api/cli/scan-osv.ts`
- `api/cli/scan-trivy.ts`

### 12.2 分割

共通 module 候補:

- `api/modules/scans/cli/run-single-tool-scan.ts`
- `api/modules/scans/cli/single-tool-scan-contract.ts`
- `api/modules/scans/cli/single-tool-scan-errors.ts`

tool adapter が供給するもの:

- tool ID と display name
- argument schema と tool-specific options
- version check
- host/Docker command builder
- output format
- normalizer
- finding/tool metadata extension

共通 lifecycle が所有するもの:

- shared argument parse
- DB/runtime initialization
- project/scan ownership lookup
- scan/tool event の開始・成功・失敗
- timeout/cancel/abort wiring
- bounded output collector
- artifact save
- normalization 後の transactional write
- stdout JSON envelope
- exit code mapping
- cleanup

### 12.3 characterization tests

refactor 前の 4 CLI について次を golden contract として保存する。

- help/invalid args
- tool version unavailable
- success with zero findings
- success with findings
- non-zero tool exit
- malformed output
- timeout
- output limit
- DB write failure
- duplicate finding handling
- required/optional tool failure policy
- stdout が 1 個の machine-readable JSON object である

### 12.4 migration order

1. contract と test harness を追加する。
2. Semgrep を共通 lifecycle へ移す。
3. Gitleaks を移す。
4. OSV を移す。
5. Trivy を移す。
6. 旧 helper と重複 branch を削除する。
7. profile runner と single-tool CLI の metadata field 名を照合する。

### 12.5 完了条件

- 4 entrypoint は adapter wiring と引数定義を中心に各 100 行以下を目標とする。
- normalizer と tool-specific command builder は無理に統合しない。
- stdout、exit code、artifact naming、event ordering の既存 contract を維持する。
- error code と resource metadata が 4 tool で共通になる。
- 重複 LOC を baseline から 60% 以上削減する。

## 13. Slice 48.6: UI/controller 分割と直接テスト

### 13.1 `use-scans-controller.ts`

責務候補:

- `scan-selection-state.ts`: project/scan/finding selection の pure reducer
- `use-scan-catalog.ts`: profiles、runs、summary、events の loading
- `use-scan-launch.ts`: preview、start、cancel
- `use-finding-review.ts`: finding details、decision、review
- `use-scan-report.ts`: report generation/download
- `use-scan-verification.ts`: reproduction、dynamic、DAST
- `use-scans-controller.ts`: child hooks の composition と public view model

最初に public return shape の type-level test と current state transition の characterization test を作る。component が参照する field 名を一括変更しない。

### 13.2 `projects-domain.tsx`

責務候補:

- project list/query state
- create/edit form state と validation
- member/role administration
- path-policy/health display
- presentational panels/dialogs

API mutation と modal UI を同じ component に残さない。role/ownership の security expectation は既存 browser E2E と route test の両方で維持する。

### 13.3 `settings-panel.tsx`

責務候補:

- provider/model settings
- secret credential form
- connection verification
- scanner/runtime settings
- backup/restore/maintenance
- section navigation と presentational shell

secret の state、redaction、save/verify sequence は専用 hook に閉じ、render component の snapshot に secret 値を出さない。

### 13.4 test strategy

- pure reducer/formatter/validation: Vitest
- hook/API orchestration: jsdom と Testing Library
- dialog、keyboard、loading/error state: component test
- project → scan → finding → report: real browser E2E
- security authorization: Hono route test と browser E2E

必要な場合は `@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom` を完全固定 version で devDependency に追加する。

### 13.5 coverage expansion

`vitest.config.ts` の blanket `**/*-controller.ts` exclusion を段階的に除去する。

1. 抽出した pure modules を include する。
2. child hooks を include する。
3. thin composition controller を include する。
4. `.tsx` presentational component の critical branches を include する。

global 80% を維持し、対象追加 PR ごとに changed critical module の lines/functions 85%、branches 80% を目標にする。

### 13.6 完了条件

- 3 target file は各 500 行未満で、抽出先も原則 500 行未満である。
- scan launch、selection race、report generation、project role、settings save/verify に直接テストがある。
- stale request が新しい selection state を上書きしない test がある。
- error、loading、empty、permission denied の各状態を守る。
- real-flow E2E が分割前後で同じ user-visible flow を通る。

## 14. Slice 48.7: backend 中核分割と source-size ratchet

### 14.1 `report-builder.ts`

分割候補:

- report model/query assembly
- executive summary
- coverage/tool status section
- findings/grouping section
- verification/reproduction section
- appendix/table rendering
- final Markdown assembly

section order、heading anchor、escaping、report option の golden test を先に追加する。

### 14.2 `profile-runner.ts`

分割候補:

- static tool step executor
- DAST step executor
- dynamic/runtime step executor
- SBOM/schema step executor
- failure policy resolver
- event/metadata mapper
- orchestration shell

failure policy と cleanup は 48.4/48.5 の共通契約を再利用し、二つ目の lifecycle abstraction を作らない。

### 14.3 `api/db/schema.ts`

- domain ごとの schema module に分け、1 つの public barrel から export する。
- table 名、column 名、index 名、foreign key、default SQL を変更しない。
- Drizzle migration diff が空であることを確認する。
- circular import を避けるため、shared column helper と domain relation を明示的に分ける。
- schema snapshot test で table/column/index 一覧を固定する。

### 14.4 `api/app/hono.ts`

分割候補:

- runtime/dependency construction
- middleware/security setup
- health/static serving
- route registry
- error handling
- test app factory

route mount path、middleware order、CSP/CORS/auth/error mapping の integration test を追加する。

### 14.5 source-size ratchet

`scripts/check-source-size-budget.ts` と JSON manifest を追加する。

manifest field:

- path
- current baseline lines
- allowed maximum
- target maximum
- owner
- reason
- review date

policy:

- unlisted new production file が 500 行以上なら failure。
- listed file が allowed maximum を 1 行でも超えると failure。
- file 分割後は allowed maximum を下げ、戻さない。
- generated、migration SQL、test fixture は別 category にし、黙って除外しない。

### 14.6 完了条件

- 4 backend target の public behavior が characterization test で維持される。
- report/profile/schema/Hono の元 target path は各 500 行未満で、抽出先も原則 500 行未満である。
- schema 分割だけで migration SQL が生成されない。
- Hono route/middleware order が snapshot/integration test で固定される。
- source-size ratchet が `verify` に含まれる。
- Phase 48 対象外の large file も baseline より増加できない。

## 15. Slice 48.8: scripts、文書、dependency override の同期

### 15.1 scripts の静的検証

第一選択は `tsconfig.scripts.json` を新設し、application typecheck と script typecheck を分離する。

- include: `scripts/**/*.ts` と scripts が直接 import する config/helper
- `bun run typecheck` は app と scripts の両方を実行する。
- Biome は `scripts/**/*.ts` を lint/format 対象にする。
- intentional process exit、Bun API、top-level await に必要な型設定を明示する。
- script test は既存 blanket test exclusion の意図を記録し、重要 parser/policy は unit test 対象にする。

### 15.2 verification scripts 自身の test

- step order
- fail-fast
- child exit code propagation
- stdout/stderr diagnostic
- SQLite writer cleanup
- strict が coverage/E2E を含むこと
- signal forwarding

`scripts/verify.ts` 自体も無制限 `arrayBuffer()` を使用しているため、48.4 の bounded collector を直接 import して application coupling を作らず、簡易 bounded diagnostic reader を scripts helper として使う。

### 15.3 dependency override sync

`scripts/check-dependency-override-docs.ts` を追加する。

検査内容:

1. `package.json.overrides` の package/version を読む。
2. `docs/dependency-overrides.md` の表を読む。
3. package 集合と pinned version の完全一致を要求する。
4. owner、next review、reason が空でないことを要求する。
5. review date が 31 日を超過していないことを警告または failure にする。
6. override を削除した場合、文書の stale row も failure にする。

初回修正では少なくとも次を実装と一致させる。

- `brace-expansion`: `5.0.8`
- `postcss`: `8.5.23`
- `minimatch`: `10.2.5`
- Mermaid 削除後に consumer がなくなる場合の `dompurify`

### 15.4 文書同期

更新対象:

- `README.md`
- `README.jp.md`
- `CONTRIBUTING.md`
- `docs/production-runbook.md`
- `docs/dependency-overrides.md`
- `CHANGELOG.md`

記載すること:

- `verify` と `verify:strict` の保証範囲
- clean install/coverage の再現手順
- E2E fixture が実 DB だが fixture scanner であること
- output/resource limit の default、override、failure code
- Mermaid artifact の legacy code 表示
- source-size exception の登録方法

### 15.5 完了条件

- `scripts/` が typecheck、lint、format を通る。
- verification runner の contract test がある。
- package override と文書の差分が gate で自動検出される。
- README、CI、runbook の closeout command が `verify:strict` で一致する。
- docs 内の version が実装と一致する。

## 16. Slice 48.9: final closeout

### 16.1 clean checkout matrix

最低限次を確認する。

| Environment | Required checks |
| --- | --- |
| local supported OS | frozen install、verify、coverage、E2E |
| CI Linux | `verify:strict` |
| Docker available host | static scanner limits、OOM/PID/output tests |
| Docker unavailable host | 明示的 capability error、host fallback なし |

### 16.2 required commands

```bash
bun install --frozen-lockfile
bun run verify
bun run test:coverage:web
bun run test:coverage:critical
bun run test:e2e
bun run verify:strict
```

追加 read-only checks:

```bash
git diff --check
git status --short
git ls-files artifacts
```

### 16.3 final evidence

- `spec/evidence/phase-48-release-report.json`
- `spec/evidence/phase-48-bundle-final.json`
- `spec/evidence/phase-48-large-files-final.json`
- browser trace/screenshot は CI artifact とし、通常は Git に commit しない。

release report に含める:

- command、exit code、duration
- coverage percentages
- E2E test count と real/mock 区分
- largest chunk
- Mermaid dependency absence
- target large file の before/after LOC
- scanner CLI duplicate LOC before/after
- output/resource policy values
- override doc sync result
- known residual risks と owner

### 16.4 Phase 48 Definition of Done

- [ ] `@vitest/coverage-v8@4.1.8` が明示 dependency である。
- [ ] fresh frozen install 後の coverage が成功する。
- [ ] 80% coverage threshold を下げていない。
- [ ] strict gate が coverage と real browser E2E を含む。
- [ ] project → scan → finding → report の実 DB E2E がある。
- [ ] critical-flow E2E は API response mock を使わない。
- [ ] scanner stdout/stderr は bounded streaming である。
- [ ] output limit 超過で partial findings を保存しない。
- [ ] static Docker scan に memory、swap、CPU、PIDs limit が常時ある。
- [ ] Web request から resource ceiling を緩和できない。
- [ ] 4 scanner CLI が共通 lifecycle を利用する。
- [ ] 3 large UI target に直接 test がある。
- [ ] report/profile/schema/Hono の責務分割が完了する。
- [ ] source-size ratchet が regression を防ぐ。
- [ ] `scripts/` が typecheck、lint、format 対象である。
- [ ] override 文書と package の自動同期 check がある。
- [ ] Mermaid runtime、dependency、chunk が存在しない。
- [ ] largest JavaScript chunk が 500,000 bytes 以下である。
- [ ] README、CI、runbook の closeout 定義が一致する。
- [ ] clean checkout で `bun run verify:strict` が成功する。

## 17. PR 分割

大きな regression と review overload を避けるため、原則として次の PR に分ける。

1. `phase48/coverage-gate`: coverage dependency、lockfile、strict command の最小復旧
2. `phase48/remove-mermaid`: data compatibility、runtime/dependency removal
3. `phase48/bundle-budget`: lazy loading と 500 KB hard limit
4. `phase48/real-db-e2e`: deterministic scanner fixture と critical flow
5. `phase48/bounded-output`: stream collector と error contract
6. `phase48/docker-limits`: static scanner resource policy
7. `phase48/scanner-cli-lifecycle`: 4 CLI の段階移行
8. `phase48/scans-controller`: scan UI seam と direct tests
9. `phase48/projects-settings`: project/settings UI seam と direct tests
10. `phase48/backend-decomposition`: report/profile/schema/Hono を責務別の小 PR にさらに分割
11. `phase48/tooling-doc-sync`: scripts verification、source budget、override sync、docs
12. `phase48/closeout`: evidence のみ。未修正 code を混ぜない

各 PR は独立して green にし、互換 adapter を置いたまま次 PR に進める。複数の巨大 file を同じ PR で移動しない。

## 18. risk register

| Risk | Mitigation | Rollback/response |
| --- | --- | --- |
| coverage 対象拡大で一時的に gate が大幅低下 | seam 抽出と test を同一 PR にする | include だけの PR を merge しない |
| E2E fixture が実 tool contract とずれる | real sample の最小 payload と parser test を共有する | fixture を更新し parser を bypass しない |
| output limit が正当な大型 scan を拒否する | output size metrics と tool-specific policy | evidence 付きで bounded range 内調整 |
| Docker 4 GiB が CI host に重い | CI 専用の小さい bounded policy と小 fixture | limit 自体は無効化しない |
| Mermaid migration で legacy metadata が壊れる | backup、null/invalid metadata test、row count check | application rollback + DB backup restore |
| dynamic import で UX が遅延する | loading state、prefetch、route-level measurement | chunk cap を上げず split point を調整 |
| large-file split で circular dependency が生じる | public barrel と dependency direction test | slice 単位で revert 可能にする |
| scanner CLI 共通化で tool 差異を失う | adapter contract と golden characterization | tool-specific adapter へ差異を戻す |
| scripts typecheck で legacy error が大量発生 | 専用 tsconfig で段階導入、skip list に期限 | `any` 一括導入や scripts 除外へ戻さない |
| strict gate が長すぎる | duration を計測し cache/重複 test を最適化 | coverage/E2E は削除しない |

## 19. 計測する成功指標

| Metric | Baseline | Phase 48 target |
| --- | ---: | ---: |
| fresh-install Web coverage | 起動不能 | pass |
| Web/critical coverage threshold | 80% | 80% 以上 |
| real DB browser critical flows | 0 | 1 以上 |
| production files >=500 lines | 39 | 32 以下 + 全体 ratchet |
| 4 scanner CLI LOC | 1,426 | common lifecycle 化し重複 60% 以上削減 |
| unbounded scanner output readers | あり | 0 |
| default static Docker PIDs limit | なし | 512 |
| largest JS chunk | 800,711 bytes | 500,000 bytes 以下 |
| Mermaid runtime/root dependency | あり | なし |
| scripts TypeScript/Biome coverage | 対象外 | 対象 |
| package/docs override mismatch | あり | 0、gate で再発防止 |
| closeout command definitions | 不一致 | `verify:strict` に統一 |

## 20. 完了後の残課題

Phase 48 で 39 large production file のすべてを分割することは目的にしない。closeout 時に size-budget manifest を review し、残る例外を risk と変更頻度で並べた次期計画を作る。例外は無期限にせず、owner と review date を持つ。

また、scanner output の streaming parser 化は tool format ごとの設計が必要である。Phase 48 では memory を hard bound し、partial success を禁止するところまでを必須とする。64 MiB 全体を parse memory に載せることも許容できない運用規模になった場合、NDJSON/SARIF streaming parser または external artifact storage を別 phase で評価する。
