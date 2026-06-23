# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-%23E36022.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE.md)

vulnWorkbench は、ローカルリポジトリに対するCLIセキュリティスキャン結果を保存、正規化、レビューするための脆弱性診断ワークベンチです。

重い診断と証拠生成は Semgrep などのCLIツールが担当します。LLMはリポジトリを自由探索して脆弱性を探す主体ではなく、既存のfinding、raw artifact、source snippet、scan logをレビューして、人間が判断しやすい形に整理する後段処理として扱います。

## Current Status

実装済み:

- project registration API
- scan run / tool run / artifact / finding / evidence の保存基盤
- fixture JSON artifact import CLI
- Semgrep CLI adapter
- Semgrep raw JSON / stdout / stderr artifact保存
- Semgrep JSONからfinding/evidenceへのdeterministic normalizer
- findings / scans / projects API

次の実装対象:

- 既存findingに対するLLM review
- review結果の構造化保存
- LLMが読むevidence bundleの境界定義
- review結果をAPIから参照できる最小UI/API surface

## Architecture

基本フロー:

```text
CLI scan command
  -> raw artifacts / logs / JSON / SARIF
  -> deterministic normalizer
  -> findings / evidence store
  -> LLM review
  -> human review / report
```

責務分担:

| Component | Role |
| --- | --- |
| CLI tools | 診断実行、raw evidence生成 |
| Normalizer | CLI出力をdeterministicにfinding/evidenceへ変換 |
| API | project、scan、finding、artifact、review surfaceを提供 |
| LLM review | 既存findingと証拠の説明、誤検知観点、修正方針を構造化 |
| Human reviewer | 採用、保留、誤検知、修正対象の最終判断 |

## Project Layout

| Path | Role |
| --- | --- |
| `api/app/hono.ts` | Hono app composition、route登録、静的配信 |
| `api/app/server.ts` | Bun server bootstrap |
| `api/app/env.ts` | runtime env parser |
| `api/db/schema.ts` | Drizzle schema |
| `api/routes/projects.route.ts` | project API |
| `api/routes/scans.route.ts` | scan run / artifact API |
| `api/routes/findings.route.ts` | finding / evidence API |
| `api/cli/scan-import.ts` | fixture/raw scan artifact import CLI |
| `api/cli/scan-semgrep.ts` | Semgrep scan CLI |
| `api/modules/scans/` | scan repository、artifact storage、normalizers、tool runner |
| `shared/schemas/scan.schema.ts` | scan domainの共有Zod schema |
| `web/src/` | React frontend |
| `drizzle/` | SQL migrations |
| `spec/` | concept、実装計画、完了条件 |
| `scripts/verify.ts` | typecheck / lint / format / test / build の検証pipeline |

既存テンプレート由来のMarkdown source、search、chat APIも残っていますが、vulnWorkbench MVPの主軸はscan/finding/evidence/reviewです。

## Setup

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run auth:create-admin -- --email admin@example.com --name "Admin User"
bun run dev
```

`auth:create-admin` は対話でpasswordを読みます。自動化する場合は標準入力から渡せます。

```bash
printf '%s\n' '<password>' | bun run auth:create-admin -- --email admin@example.com --name "Admin User" --password-stdin
```

開発サーバーは `http://localhost:5173` で起動します。Vite dev server がfrontendを配信し、`/api/*` はHonoへ渡されます。

## Scan Commands

Fixture artifactを取り込む:

```bash
bun run scan:import -- \
  --project-id <project-id> \
  --tool fixture \
  --artifact tests/fixtures/scans/fixture-result.json
```

Semgrepを実行して取り込む:

```bash
bun run scan:semgrep -- \
  --project-id <project-id> \
  --profile semgrep-baseline \
  --config auto
```

Semgrep scanはhost上の `semgrep` executableを呼びます。LLM provider設定は不要です。

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | health check |
| `POST` | `/api/auth/login` | email/password login。httpOnly cookieを設定 |
| `POST` | `/api/auth/refresh` | refresh token rotation |
| `POST` | `/api/auth/logout` | refresh token revoke と cookie clear |
| `GET` | `/api/auth/me` | 現在のlogin user |
| `GET` | `/api/projects` | project一覧 |
| `POST` | `/api/projects` | local repo project登録 |
| `GET` | `/api/projects/:projectId` | project detail |
| `GET` | `/api/scans?projectId=<project-id>` | project内のscan run一覧 |
| `GET` | `/api/scans/:id` | scan run detail |
| `GET` | `/api/scans/:id/events` | scan event一覧 |
| `GET` | `/api/scans/:id/artifacts` | scan artifact一覧 |
| `GET` | `/api/scans/:id/findings` | scan内のfinding一覧 |
| `GET` | `/api/findings/:id` | finding detailとevidence |

`/api/auth/me` などのprotected endpointはaccess tokenが必要です。frontend clientは401を受けると `/api/auth/refresh` を一度試し、成功した場合だけ元のrequestを再実行します。

## Environment Variables

非シークレットの既定値は `api/config/appDefaults.ts` にあります。`.env.example` はlocal development向けの値です。

| Variable | Required | Description | Default |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` / `test` / `production` | `development` |
| `DATABASE_URL` | no | SQLite database path。`file:` または `sqlite://` prefixを使えます | `file:./data/vuln-workbench.sqlite` |
| `JWT_SECRET` | production yes | JWT signing secret。32文字以上。productionではdev defaultのままだと起動しません | dev default |
| `APP_URL` | no | public origin。cookie secure既定値とCORSに使う | `http://localhost:5173` |
| `CORS_ORIGINS` | no | 追加許可origin。カンマ区切り | `http://localhost:5173` |
| `AUTH_COOKIE_SECURE` | no | auth cookieに`Secure`を付けるか | production/HTTPSでは`true` |
| `AUTH_COOKIE_SAME_SITE` | no | auth cookie SameSite | `lax` |
| `SECURITY_HEADERS_MODE` | no | HTTPS前提headerの有効化方針。`auto` / `http` / `https` | `auto` |
| `AZURE_OPENAI_ENDPOINT` | LLM review/chat yes | Azure OpenAI endpoint | none |
| `AZURE_OPENAI_API_KEY` | LLM review/chat yes | Azure OpenAI API key | none |
| `AZURE_OPENAI_DEPLOYMENT` | no | chat/review deployment | `gpt-4o-mini` |
| `OPENAI_API_KEY` | optional | OpenAI-compatible provider key | none |
| `CONTENT_ROOT` | legacy Markdown search only | Markdown source root | `./wiki-knowledge` |

Scan foundationとSemgrep adapterはLLM API keyなしで動く必要があります。LLM provider設定はreview/chatなどの後段機能でのみ使います。

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Vite + Hono dev server |
| `bun run start` | Bun serverを直接起動 |
| `bun run auth:create-admin -- --email <email> --name "<name>"` | admin user作成 |
| `bun run db:migrate` | `drizzle/*.sql` を順番に適用 |
| `bun run scan:import` | raw/fixture scan artifactを取り込みfinding/evidenceを作成 |
| `bun run scan:semgrep` | Semgrep CLIを実行してfinding/evidenceを作成 |
| `bun run typecheck` | TypeScript check |
| `bun run lint` | Biome lint |
| `bun run format` | Biome format write |
| `bun run format:check` | Biome format check |
| `bun run test` | Vitest + Bun scan module tests |
| `bun run build` | Vite production build |
| `bun run verify` | typecheck、lint、format:check、test、build |

## Security Boundary

- LLM API keyはhost側にのみ置く。
- scan対象repoへLLM API keyやsecretを注入しない。
- Semgrepなどのtool processへLLM API keyを渡さない。
- CLI commandはshell文字列ではなくstructured argsとして組み立てる。
- raw artifactは保存するが、LLM reviewへ渡す前に必要最小限へ絞る。
- secret findingの値は原則redactして表示、保存、reviewする。
- external target scan、DAST、fuzzing、sandbox再現、patch自動適用はMVP対象外。

## Verification

```bash
bun run verify
```

実装計画とMVP境界は `spec/vuln-workbench-concept.md` を基準に確認します。
