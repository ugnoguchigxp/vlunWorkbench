# Hono Standard

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-%23E36022.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE.md)

Hono backend と React + Vite frontend を同一 origin で動かす、RAG app template です。SQLite + sqlite-vec + Drizzle のユーザー認証、Markdown ingestion、hybrid retrieval、chat endpoint、React Router ベースの画面、コンポーネント showcase を含みます。

## 構成

| Path | Role |
| --- | --- |
| `api/app/hono.ts` | Hono app composition。middleware、API route、静的配信、`AppType` を登録 |
| `api/app/server.ts` | Bun server bootstrap |
| `api/app/env.ts` | runtime env parser |
| `api/config/appDefaults.ts` | 非シークレットの既定値 |
| `api/db/schema.ts` | Drizzle schema |
| `api/routes/auth.route.ts` | `/api/auth/*` route |
| `api/routes/health.route.ts` | `/api/health` route |
| `api/routes/sources.route.ts` | Markdown source reindex / category API |
| `api/routes/search.route.ts` | `/api/search` hybrid retrieval API |
| `api/routes/chat.route.ts` | `/api/chat` RAG chat API |
| `api/modules/auth/` | password hash、JWT、cookie、auth service |
| `api/modules/sources/` | Markdown ingestion、source repository |
| `api/modules/rag/` | source retriever、search evidence |
| `api/providers/` | LLM / embedding provider interface と Azure OpenAI 実装 |
| `api/middleware/auth.ts` | protected API middleware |
| `web/src/` | React frontend |
| `shared/schemas/` | frontend/backend で共有する Zod schema と API object type |
| `drizzle/` | SQL migrations |
| `scripts/verify.ts` | typecheck / lint / format / test / build の検証 pipeline |

## 前提

| Tool | 用途 |
| --- | --- |
| Bun | package manager、runtime、scripts |
| SQLite + sqlite-vec | auth user / refresh token / RAG source storage |

## セットアップ

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run auth:create-admin -- --email admin@example.com --name "Admin User"
bun run import:markdown
bun run dev
```

`auth:create-admin` は対話で password を読みます。自動化する場合は次のように標準入力から渡せます。

```bash
printf '%s\n' '<password>' | bun run auth:create-admin -- --email admin@example.com --name "Admin User" --password-stdin
```

開発サーバーは `http://localhost:5173` で起動します。Vite dev server が frontend を配信し、`/api/*` は Hono に渡されます。

## 環境変数

非シークレットの既定値は `api/config/appDefaults.ts` にあります。`.env.example` は local development 向けの値です。

| Variable | Required | Description | Default |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` / `test` / `production` | `development` |
| `DATABASE_URL` | no | SQLite database path。`file:` または `sqlite://` prefix を使えます | `file:./data/vuln-workbench.sqlite` |
| `CONTENT_ROOT` | no | Markdown source root。`pages/<category>/*.md` を index する | `./wiki-knowledge` |
| `AZURE_OPENAI_ENDPOINT` | chat/embedding yes | Azure OpenAI endpoint | none |
| `AZURE_OPENAI_API_KEY` | chat/embedding yes | Azure OpenAI API key | none |
| `AZURE_OPENAI_DEPLOYMENT` | no | chat completion deployment | `gpt-4o-mini` |
| `AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT` | no | embedding deployment。1536 dimensions が必要 | `text-embedding-3-small` |
| `JWT_SECRET` | production yes | JWT signing secret。32 文字以上。production では未設定または dev default のままだと起動しません | dev default |
| `APP_URL` | no | public origin。cookie secure 既定値と CORS に使う | `http://localhost:5173` |
| `CORS_ORIGINS` | no | 追加許可 origin。カンマ区切り | `http://localhost:5173` |
| `AUTH_COOKIE_SECURE` | no | auth cookie に `Secure` を付けるか | production/HTTPS では `true` |
| `AUTH_COOKIE_SAME_SITE` | no | auth cookie SameSite | `lax` |
| `SECURITY_HEADERS_MODE` | no | HTTPS 前提 header の有効化方針。`auto` / `http` / `https` | `auto` |

`AUTH_COOKIE_SAME_SITE=none` を使う場合は、HTTPS の `APP_URL` または `AUTH_COOKIE_SECURE=true` が必要です。

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Vite + Hono dev server |
| `bun run start` | Bun server を直接起動 |
| `bun run auth:create-admin -- --email <email> --name "<name>"` | admin user 作成 |
| `bun run import:markdown` | `CONTENT_ROOT/pages/**.md` を source index に取り込む |
| `bun run db:migrate` | `drizzle/*.sql` を順番に適用 |
| `bun run db:generate` | Drizzle migration 生成 |
| `bun run db:migrate:drizzle` | drizzle-kit migration generation/check。`DATABASE_URL` は process env または `.env` から読む |
| `bun run typecheck` | TypeScript check |
| `bun run lint` | Biome lint |
| `bun run format` | Biome format write |
| `bun run format:check` | Biome format check |
| `bun run test` | Vitest |
| `bun run build` | Vite production build |
| `bun run verify` | typecheck、lint、format:check、test、build |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | health check |
| `POST` | `/api/auth/login` | email/password login。httpOnly cookie を設定 |
| `POST` | `/api/auth/refresh` | refresh token rotation |
| `POST` | `/api/auth/logout` | refresh token revoke と cookie clear |
| `GET` | `/api/auth/me` | 現在の login user |
| `GET` | `/api/sources/health` | source index 設定確認 |
| `GET` | `/api/sources/categories` | indexed category 一覧 |
| `POST` | `/api/sources/reindex` | Markdown source を再取り込み |
| `POST` | `/api/search` | local Markdown の hybrid retrieval |
| `POST` | `/api/chat` | retrieved context を使った chat response |

`/api/auth/me` は access token が必要です。frontend client は 401 を受けると `/api/auth/refresh` を一度試し、成功した場合だけ元の request を再実行します。

API request / response の共有 schema は `shared/schemas/` に置きます。Backend route はその schema を `zValidator` で使い、frontend は `api/app/hono.ts` から export される `AppType` を `hono/client` に渡して API 型を共有します。

## Build / Runtime

```bash
bun run build
NODE_ENV=production bun run start
```

production では `JWT_SECRET` を必ず強いランダム値に変更してください。未設定または dev default のままの場合、アプリは起動時に失敗します。HTTPS で公開する場合は `APP_URL=https://...` とし、必要に応じて `AUTH_COOKIE_SECURE=true`、`SECURITY_HEADERS_MODE=https` を明示します。

## RAG Notes

- この branch は `variant/rag` です。RAG の基本機能は `api/` に配置し、frontend/backend 共通 request schema は `shared/schemas/rag.schema.ts` にあります。
- 認証は optional UI として残しています。Home と Showcase は未ログインでも表示されます。
- `/api/sources/*`, `/api/search`, `/api/chat` は login が必要です。
- `CONTENT_ROOT/pages/<category>/*.md` を `bun run import:markdown` または `/api/sources/reindex` で index します。
- Azure OpenAI が未設定でも全文検索 API は動きます。embedding と chat response には Azure OpenAI の設定が必要です。
- clone 後は `package.json` の name / description、README、`.env.example`、SQLite DB path、cookie/CORS/security 設定を利用先に合わせて見直してください。
