# Hono Standard Variant Management

この文書は `hono-standard` を複数のテンプレート variant として保守し、NightWorkers などの外部ツールから clone して再利用できる状態に保つための指示書です。

## 目的

- Web アプリの標準 starter を毎回ゼロから生成せず、clone 可能なテンプレートとして再利用する。
- SQLite、PostgreSQL、pgvector などの永続化方式を branch / tag / snapshot で明確に分ける。
- テンプレートの既定値をプロダクト要件として無批判に採用しないよう、variant の責務と検証手順を明文化する。
- NightWorkers などの agent が「どの variant を使うべきか」を短い判断で選べる状態にする。

## 基本方針

- テンプレート本体は NightWorkers などの利用側 repo に vendoring しない。必要時に `git clone` または archive 展開で取得する。
- 継続保守する差分は branch で管理し、固定スナップショットは tag と archive で残す。
- `main` は local SQLite を既定にした標準 baseline とする。Docker なしで起動できることを優先し、PostgreSQL、pgvector、Cloudflare のような追加前提は `variant/*` branch に分離する。
- DB、auth、deploy、AI/RAG などの大きな前提差分は `variant/*` branch に分離する。
- SSG、SSR、認証追加など、既存 variant に重ねられる小さめの差分はまず `overlay/*` branch または patch として管理する。
- 既存プロダクト向けの実験 branch とテンプレート variant branch を混ぜない。

## Branch 構成

### Canonical branches

| Branch | 用途 |
| --- | --- |
| `main` | SQLite baseline。Hono + React + Vite + Tailwind CSS + design tokens + Drizzle を Docker なしで起動できる最小構成。 |
| `variant/sqlite` | `main` と同じ SQLite baseline を明示 branch として残す。既存 clone / tag / archive 利用者向けの互換入口。 |
| `variant/postgres` | 通常の Web app 向け。PostgreSQL を既定にする。 |
| `variant/pgvector` | RAG、embedding、AI 検索向け。PostgreSQL + pgvector を既定にする。 |
| `variant/rag` | Markdown ingestion、hybrid retrieval、chat、artifacts、agentic search、admin auth を含む RAG app template。 |
| `variant/turso` | Turso/libSQL を既定にする。local file DB fallback と remote Turso 接続を扱う。 |
| `variant/cloudflare` | Cloudflare Workers / D1 / KV / R2 など edge deploy 前提。Bun server 前提と分ける。 |

### Overlay branches

`overlay/*` branch は、DB や deploy runtime のような大前提ではなく、既存 variant に重ねて使える差分を管理する。

| Branch | 用途 |
| --- | --- |
| `overlay/ssr` | React/Vite の client-only baseline に SSR entry、server render、hydration、SSR build を追加する。 |
| `overlay/ssg` | prerender、static route manifest、build-time data loading などを追加する。 |

overlay は「単独で clone する完成テンプレート」ではなく、`main` または `variant/*` に適用できる差分として扱う。差分が大きくなり、単独 clone の需要が明確になった場合だけ `variant/ssr` や `variant/ssg` に昇格する。

### Non-canonical branches

`healthrecord` や `patient-simulator` のような具体アプリ寄り branch は、テンプレート variant ではなく sample / experiment として扱う。必要なら次のように rename する。

```bash
git branch -m healthrecord sample/healthrecord
git branch -m patient-simulator sample/patient-simulator
git push origin sample/healthrecord sample/patient-simulator
git push origin --delete healthrecord patient-simulator
```

rename は履歴共有者に影響するため、実行前に利用状況を確認する。

## Tag 命名

tag は「固定して clone できるリリース地点」として使う。branch の代わりに tag だけで差分管理しない。

形式:

```text
<variant>-v<major>.<minor>.<patch>
```

公開タグは各系列につき最新版を1つだけ維持する。新しいリリースタグを公開したら、同じ系列の旧タグは削除する。

例:

```text
baseline-v0.1.0
sqlite-v0.1.0
postgres-v0.1.0
pgvector-v0.1.0
rag-v0.1.0
cloudflare-v0.1.0
overlay-ssr-v0.1.0
overlay-ssg-v0.1.0
```

tag 作成例:

```bash
git switch variant/sqlite
bun run verify
git tag -a sqlite-v0.1.0 -m "sqlite template v0.1.0"
git push origin variant/sqlite sqlite-v0.1.0
```

overlay tag は差分取得用の固定地点として使う。

```bash
git switch overlay/ssr
bun run verify
git tag -a overlay-ssr-v0.1.0 -m "SSR overlay v0.1.0"
git push origin overlay/ssr overlay-ssr-v0.1.0
```

## Snapshot 方針

snapshot は GitHub Release asset または `dist/snapshots/` に置く archive として扱う。通常利用は tag clone を優先し、snapshot は「外部 agent が Git 履歴なしで展開したい場合」や「成果物として固定配布したい場合」に使う。

archive 作成例:

```bash
git switch variant/sqlite
bun install --frozen-lockfile
bun run verify
git archive --format=tar.gz --prefix=hono-standard-sqlite-v0.1.0/ \
  -o dist/snapshots/hono-standard-sqlite-v0.1.0.tar.gz sqlite-v0.1.0
```

snapshot に含めないもの:

- `node_modules/`
- `dist/`
- `dist-api/`
- `dist-server/`
- `.env`
- ローカル DB ファイル
- Playwright / coverage / test result などの生成物

snapshot 作成前に `.gitignore` と archive 内容を確認する。

```bash
tar -tzf dist/snapshots/hono-standard-sqlite-v0.1.0.tar.gz | head
tar -tzf dist/snapshots/hono-standard-sqlite-v0.1.0.tar.gz | rg 'node_modules|\\.env$|sqlite\\.db|test-results|playwright-report' || true
```

## Clone 利用

### Branch を指定して clone

```bash
git clone --depth 1 --branch variant/sqlite <repo-url> my-app
cd my-app
bun install
```

### Tag を指定して clone

```bash
git clone --depth 1 --branch sqlite-v0.1.0 <repo-url> my-app
cd my-app
bun install
```

### Archive から展開

```bash
mkdir my-app
tar -xzf hono-standard-sqlite-v0.1.0.tar.gz -C my-app --strip-components=1
cd my-app
bun install
git init
```

clone 後に必ず変更する項目:

- `package.json` の `name` / `version` / `description`
- README のプロジェクト名と起動手順
- `.env.example` と実際の `.env`
- DB 接続先、migration、seed
- auth provider、cookie、CORS、CSRF、CSP、rate limit の本番設定
- サンプル機能を残すか削るか
- license / author / repository metadata

## Overlay / patch 利用

SSG や SSR のように、DB variant と直交する差分は最初から `variant/ssr-sqlite`、`variant/ssr-postgres` のように掛け算で branch を増やさない。まず overlay として差分を取得し、必要な利用先に適用する。

### 差分を確認する

```bash
git fetch origin
git diff --stat origin/main...origin/overlay/ssr
git diff --name-status origin/main...origin/overlay/ssr
git diff origin/main...origin/overlay/ssr -- package.json vite.config.ts src api
```

### patch を作る

```bash
mkdir -p dist/patches
git diff --binary origin/main...origin/overlay/ssr \
  > dist/patches/overlay-ssr-v0.1.0.patch
```

### patch を適用する

```bash
git switch variant/sqlite
git switch -c app/sqlite-ssr
git apply --check dist/patches/overlay-ssr-v0.1.0.patch
git apply dist/patches/overlay-ssr-v0.1.0.patch
bun install
bun run verify
```

patch 適用時に conflict する場合は、`main` と対象 variant の差分が overlay の前提からずれている。無理に `git apply --3way` で押し込まず、overlay branch を最新 `main` に追従させてから patch を作り直す。

### branch を重ねる

patch ではなく Git branch として重ねる場合:

```bash
git switch variant/sqlite
git switch -c app/sqlite-ssr
git merge --no-ff origin/overlay/ssr
bun run verify
```

この方法は履歴を残しやすいが、overlay が `main` から作られている場合、対象 variant との conflict が起きやすい。生成された利用先 app では、merge 履歴を残すより patch 適用後に通常の app commit として整理してよい。

## Variant 作成手順

1. `main` を clean にする。

```bash
git switch main
git pull --ff-only
bun install --frozen-lockfile
bun run verify
```

2. variant branch を作成する。

```bash
git switch -c variant/sqlite
```

3. 差分を variant の責務に限定して実装する。

- DB driver / Drizzle config / migration / seed / Docker compose
- README の variant 固有手順
- `.env.example`
- verify に必要な script
- variant 固有の smoke test

4. product 固有の機能を入れない。

- 特定業務ドメインの画面
- 特定顧客向けの seed
- 固有ブランドの copy / logo
- 一時的な demo データ

5. 検証する。

```bash
bun run typecheck
bun run lint
bun run test run
bun run build
```

`bun run verify` が上記を包含している場合は `bun run verify` を使う。DB variant では fresh DB で migration と seed も確認する。

6. README とこの文書の variant 表を更新する。

## Variant Contract

各 `variant/*` branch は、DB driver や deploy runtime が違っても次の contract を満たす。

| Contract | SQLite baseline | Turso variant | PostgreSQL variant |
| --- | --- | --- | --- |
| install | `bun install --frozen-lockfile` | 同左 | 同左 |
| bootstrap | `bun run bootstrap` | Turso/local fallback 手順を README に明記 | PostgreSQL 接続と migration 手順を README に明記 |
| migration | `bun run db:migrate` | libSQL/Turso 用 migration runner | PostgreSQL 用 migration runner |
| app verify | `bun run verify` | 同左 | 同左 |
| smoke | `bun run verify:e2e` | 同左 | 同左 |
| admin user | `bun run auth:create-admin` | 同じ CLI contract を維持 | 同じ CLI contract を維持 |
| production start | `bun run build` 後 `bun run db:migrate`、`bun run start` | Turso env と migration を明記 | PostgreSQL env と migration を明記 |

`main` は SQLite baseline として、`api/db/index.ts` の public entry から `api/db/sqlite.ts` と `api/db/migrate-sqlite.ts` を呼ぶ。variant branch は次の差分を局所化する。

- DB runtime implementation。
- Drizzle schema。
- Drizzle config。
- migration runner。
- `.env.example`。
- README の setup / production / troubleshooting。
- variant 固有の smoke test setup。

共通維持するもの:

- Hono route contract。
- `shared/schemas/` の API request / response shape。
- auth cookie / token の外部 behavior。
- `bun run verify` と `bun run verify:e2e` のコマンド名。
- `docs/delivery-quality-gates.md` の Delivery 判定基準。
- `docs/template-variant-management.md` の branch / tag / snapshot 方針。

variant は `main` に全 driver を詰め込んで runtime switch する形にしない。`main` は SQLite で動く最小 baseline を保ち、Turso / PostgreSQL / pgvector は branch ごとに driver、schema、migration、docs を差し替える。

7. tag を作成する。

```bash
git tag -a sqlite-v0.1.0 -m "sqlite template v0.1.0"
git push origin variant/sqlite sqlite-v0.1.0
```

## Overlay 作成手順

1. `main` を clean にする。

```bash
git switch main
git pull --ff-only
bun install --frozen-lockfile
bun run verify
```

2. overlay branch を作成する。

```bash
git switch -c overlay/ssr
```

3. 差分を overlay の目的に限定する。

`overlay/ssr` に含めるもの:

- SSR entry point
- server render / hydrate の最小 wiring
- Vite SSR build 設定
- SSR で壊れる browser-only code の分離
- SSR smoke test
- README の適用手順

`overlay/ssr` に含めないもの:

- DB driver 変更
- auth provider 追加
- Cloudflare Workers など deploy runtime 変更
- 特定 app の route / copy / seed

4. 差分を確認する。

```bash
git diff --stat main...overlay/ssr
git diff --name-status main...overlay/ssr
```

5. patch を出力して dry-run する。

```bash
mkdir -p dist/patches
git diff --binary main...overlay/ssr > dist/patches/overlay-ssr-v0.1.0.patch
git switch main
git switch -c tmp/check-overlay-ssr
git apply --check dist/patches/overlay-ssr-v0.1.0.patch
git switch main
git branch -D tmp/check-overlay-ssr
```

6. tag を作成する。

```bash
git switch overlay/ssr
git tag -a overlay-ssr-v0.1.0 -m "SSR overlay v0.1.0"
git push origin overlay/ssr overlay-ssr-v0.1.0
```

## Variant ごとの最低要件

### `main`

- local SQLite を既定にし、Docker なしでも動くことを優先する。
- Hono、React、Vite、Tailwind CSS、design tokens、Drizzle の基本構成を保つ。
- SQLite DB ファイル保存先を README と `.env.example` に明示する。
- security middleware の考え方を README に残す。
- サンプル機能は小さく、削除しやすくする。

### `variant/sqlite`

- `main` と同じ SQLite baseline に追従する。
- 1 processにつきwritable connectionを1つだけ生成し、全書き込みを共通の `SingleWriterClient` に集約する。
- file databaseではWALとread-only readerを使い、読み取り経路からの書き込みを許可しない。
- `main` と差分を作る場合は、互換維持の理由を README とこの文書に明記する。
- tag / archive 利用者向けに、SQLite variant 名を安定して残す。

### `variant/postgres`

- Docker Compose で PostgreSQL を起動できる。
- `DATABASE_URL` の default と compose の user/password/db/port を一致させる。
- migration / seed / readiness check を揃える。
- production では memory rate limit だけに依存しない注意を書く。

### `variant/pgvector`

- PostgreSQL + pgvector extension を compose と migration で再現する。
- embedding table、index、distance metric の最小サンプルを持つ。
- embedding provider は固定しすぎず、環境変数で差し替え可能にする。
- RAG サンプルは小さく保ち、アプリ固有のプロンプトを入れない。

### `variant/turso`

- Turso/libSQL の remote 接続と local file DB fallback を README に明記する。
- local file DB fallbackではSQLiteと同じ単一writer contractを適用し、remote接続でもprocess内の書き込み入口には共通writer clientを使う。
- `DATABASE_URL` と `DATABASE_AUTH_TOKEN` の用途を `.env.example` に揃える。
- SQLite baseline と同じ auth / showcase 構成を保ち、差分を libSQL adapter に限定する。

### `variant/cloudflare`

- Workers runtime、D1/KV/R2 bindings、Wrangler 設定を main と分ける。
- Bun server 前提の middleware や API を持ち込まない。
- local dev と deploy の環境変数を分ける。

### `overlay/ssr`

- SSR entry、client hydration、server build の責務に限定する。
- route data loading の方式を README に明記する。
- browser-only API は SSR 境界の外に隔離する。
- DB や auth の方針を変えない。

### `overlay/ssg`

- prerender 対象 route と fallback の扱いを明記する。
- build-time data loading が必要な場合は、環境変数と secret の扱いを分ける。
- user-specific / auth-required route を静的生成しない。
- CMS や外部 API の具体 provider に寄せすぎない。

## 差分管理

`main` の更新を variant に取り込むときは、merge または rebase を branch ごとに明示して行う。複数 variant を一度に直さない。

```bash
git switch variant/sqlite
git fetch origin
git merge origin/main
bun run verify
```

variant 固有差分を確認する。

```bash
git diff --stat main...variant/sqlite
git diff --name-status main...variant/sqlite
```

差分が大きくなりすぎた場合は、共通化できる設定を `main` に戻す。ただし DB driver や deploy runtime のように前提が違うものは無理に共通化しない。

overlay 固有差分を確認する。

```bash
git diff --stat main...overlay/ssr
git diff --name-status main...overlay/ssr
```

overlay を patch として固定する。

```bash
mkdir -p dist/patches
git diff --binary main...overlay/ssr > dist/patches/overlay-ssr-v0.1.0.patch
```

patch は generated artifact なので、通常は tag / release asset として配布し、repo に常時 commit しない。patch を commit する場合は `dist/patches/README.md` を置き、どの tag から生成したかを明記する。

## NightWorkers からの利用ルール

NightWorkers や agent が新規 Web app を作る場合:

1. 既存 repo がある場合は、その repo の stack を優先する。
2. ユーザーが技術スタックを指定している場合は、その指定を優先する。
3. 指定がなく Web app であれば、まず `main` の SQLite baseline を候補にする。
4. local-first / desktop / prototype なら `main` または互換入口の `variant/sqlite`。
5. 通常 Web app / team / deploy 前提なら `variant/postgres`。
6. Turso / remote libSQL 前提なら `variant/turso`。
7. RAG / embedding / semantic search が主目的なら `variant/pgvector`。
8. Cloudflare Workers 前提なら `variant/cloudflare`。
9. SSR が必要なら `overlay/ssr`、SSG が必要なら `overlay/ssg` を差分として適用する。
10. clone 後はテンプレート名、DB、auth、security、sample 機能を要件に合わせて調整する。

テンプレートの既定値をプロダクトの設計判断として扱わない。特に DB 種別、auth 方式、CORS、CSRF、CSP、rate limit、deploy runtime は要件ごとに確認する。

## Release checklist

release tag を打つ前に確認する。

- `git status --short` が意図した変更だけになっている。
- README に variant 固有の起動手順がある。
- `.env.example` が variant と一致している。
- DB migration と seed が fresh DB で通る。
- `bun run verify` が通る。
- `bun run build` が通る。
- `docs/delivery-quality-gates.md` の Template Snapshot profile を満たしている。
- `node_modules`、`.env`、DB ファイル、test artifacts が snapshot に含まれない。
- tag 名が `<variant>-v<major>.<minor>.<patch>` に従っている。
- tag message に主な stack / DB / breaking changes が書かれている。
- overlay release では `git diff --stat main...overlay/<name>` と patch dry-run の結果を確認している。

## Avoid

- tag だけで variant 差分を長期保守する。
- SSG / SSR / auth のような直交差分で branch の掛け算を増やす。
- `main` に PostgreSQL、pgvector、Cloudflare、特定 auth provider などの強い前提を詰め込む。
- サンプルアプリ branch を標準 variant として扱う。
- テンプレート repo 内に利用先プロダクトの仕様や seed を混ぜる。
- clone 後の app から upstream template の履歴を無理に保ち続ける。必要なら新規 repo として `git init` する。
