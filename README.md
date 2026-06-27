# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-%23E36022.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE.md)

vulnWorkbench は、ローカルリポジトリに対する CLI セキュリティスキャン結果を保存、正規化、レビューするための脆弱性診断ワークベンチです。

重い診断と証拠生成は CLI ツールが担当します。LLM はリポジトリを自由探索して脆弱性を探す主体ではなく、既存の finding、raw artifact、source snippet、scan log をレビューして、人間が判断しやすい形に整理する後段処理として扱います。

## Current Status

Phase 1〜12 の全実装および統合・堅牢化が完了しています。

実装済み機能:
- **CLI scan foundation** (Semgrep, Gitleaks, OSV, Trivy adapters & deterministic normalizer)
- **Scan Profile Orchestration** (複数ツールを順次実行するプロファイルランナー)
- **LLM Finding Review** (LLMによる脆弱性レビューと説明・誤検知判定)
- **Human Decision Workflow** (人間による最終ステータス判断)
- **Sandbox Reproduction** (Docker隔離コンテナによる再現実行)
- **Dynamic Verification** (テスト、サニタイザ、ファジングの実行)
- **DAST / HTTP Baseline** (ローカル対象の自動起動・HTTPベースラインチェック。ブラウザスモークは実ブラウザadapter実装まで無効)
- **Markdown Report Export** (全診断結果、証拠、メタデータを統合したレポート出力)
- **Final Hardening** (パス走査対策、Docker socketマウント不使用、シークレット難読化、Failure kindの統一)

## Architecture

基本フロー:

```text
CLI scan command / scan:profile
  -> raw artifacts / logs / JSON / SARIF
  -> deterministic normalizer & secret redaction
  -> findings / evidence store
  -> LLM review
  -> human decision
  -> sandbox reproduction / dynamic verification / DAST check
  -> Markdown report export
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
| `api/app/hono.ts` | Hono app composition、route登録、静的配信、エラーハンドラ |
| `api/app/server.ts` | Bun server bootstrap |
| `api/app/env.ts` | runtime env parser |
| `api/db/schema.ts` | Drizzle ORM schema (repro/dynamic/dast対応) |
| `api/routes/` | API エンドポイント (auth, projects, scans, findings, dast, reproductions, dynamic など) |
| `api/cli/` | CLI ツール群 (scan:profile, repro:finding, dynamic:run, scan:dast, report:diagnostic など) |
| `api/modules/` | コアビジネスロジック、runner、storage、normalizers、report |
| `shared/schemas/` | フロント・バックエンド共有の Zod schema / failure定義 |
| `web/src/` | React frontend |
| `drizzle/` | SQL migrations |
| `spec/` | concept、実装計画、完了条件 |
| `scripts/verify.ts` | 一元化された検証パイプライン |

既存テンプレート由来の Markdown source、search、chat API も補助機能として残っていますが、vulnWorkbench の主軸は scan/finding/evidence/review です。

## Setup

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev
```

`db:seed` は `admin@example.com` の管理者ユーザーを作成または初期化します。パスワード未指定時は12文字のパスワードを生成し、JSONの `password` に出力します。固定したい場合は環境変数または標準入力から渡せます。

```bash
SEED_ADMIN_PASSWORD='<password>' bun run db:seed
printf '%s\n' '<password>' | bun run db:seed -- --password-stdin
```

既存ユーザーのパスワードを変えずに管理者属性だけ揃える場合は `bun run db:seed -- --keep-existing-password` を使います。

開発サーバーは `http://localhost:29831` で起動します。Vite dev server がfrontendを配信し、`/api/*` はHonoへ渡されます。

## CLI Commands

### 1. プロファイルスキャンの実行 (複数ツール + 最終レポート生成)
```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --timeout-sec 600 \
  --report-output report.md
```

`baseline` は Semgrep、Gitleaks、OSV-Scanner でコード実装、シークレット、依存関係の基本観点を確認します。Static 全検査を実行したい場合は `detailed-security` を使います。

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile detailed-security \
  --timeout-sec 1200 \
  --report-output detailed-report.md
```

### 2. Sandbox上での脆弱性再現 (Reproduction)
```bash
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile gitleaks-recheck
```

### 3. Dynamic Verificationの実行
```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test
```

### 4. DAST / HTTP baseline スキャンの実行

対象プロジェクトの `package.json` から起動スクリプトと空きポートを推定し、一時的にローカル対象を起動してHTTP baselineを実行できます。

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --profile http-baseline \
  --auto-target true
```

保存済みtargetを明示して実行する場合:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile http-baseline
```

### 5. レポートのエクスポート
`scan:profile` は既定で最終レポートを生成します。既存の scan run から再生成したい場合は次を使います。

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown \
  --output-path report.md
```

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

`/api/auth/me` などの protected endpoint は access token が必要です。frontend client は 401 を受けると `/api/auth/refresh` を一度試し、成功した場合だけ元の request を再実行します。

## Environment Variables

非シークレットの既定値は `api/config/appDefaults.ts` にあります。`.env.example` はlocal development向けの値です。

| Variable | Required | Description | Default |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` / `test` / `production` | `development` |
| `DATABASE_URL` | no | SQLite database path。`file:` または `sqlite://` prefixを使えます | `file:./data/vuln-workbench.sqlite` |
| `JWT_SECRET` | production yes | JWT signing secret。32文字以上。productionではdev defaultのままだと起動しません | `vuln-workbench-dev-jwt-secret-change-this-for-production` |
| `APP_URL` | no | public origin。cookie secure既定値とCORSに使う | `http://localhost:29831` |
| `CORS_ORIGINS` | no | 追加許可origin。カンマ区切り | `http://localhost:29831` |
| `AUTH_COOKIE_SECURE` | no | auth cookieに`Secure`を付けるか | production/HTTPSでは`true` |
| `AUTH_COOKIE_SAME_SITE` | no | auth cookie SameSite | `lax` |
| `SECURITY_HEADERS_MODE` | no | HTTPS前提headerの有効化方針。`auto` / `http` / `https` | `auto` |
| `AZURE_OPENAI_ENDPOINT` | LLM review/chat yes | Azure OpenAI endpoint | none |
| `AZURE_OPENAI_API_KEY` | LLM review/chat yes | Azure OpenAI API key | none |
| `AZURE_OPENAI_DEPLOYMENT` | no | chat/review deployment | `gpt-4o-mini` |
| `OPENAI_API_KEY` | optional | OpenAI-compatible provider key | none |
| `CONTENT_ROOT` | legacy Markdown search only | Markdown source root | `./wiki-knowledge` |

## Runtime Security Boundary

- **Path Traversal 防止**: リポジトリパスおよびアーティファクトの入出力に対し、`path.relative` を用いた厳格な正規化チェックを実施。
- **隔離実行境界 (Docker)**: `toolbox`, `reproduction`, `dynamic`, `DAST` のすべてのコンテナランナーで Docker socket はマウントせず、非特権モードで実行。
- **シークレット難読化**: APIキーやトークン、クッキーはLLM送信前およびレポート・アーティファクト永続化前に正規表現で自動難読化 (Redact)。
- **環境変数の scrubbing**: ランナーコンテナへ LLM の API キーなどホスト側の不要な機密環境変数を漏洩させない環境フィルタリングを適用。

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Vite + Hono dev server |
| `bun run start` | Bun serverを直接起動 |
| `bun run auth:create-admin -- --email <email> --name "<name>"` | admin user作成 |
| `bun run db:migrate` | `drizzle/*.sql` を順番に適用 |
| `bun run db:seed` | `admin@example.com` のローカル管理者ユーザーを作成または初期化 |
| `bun run scan:import` | raw/fixture scan artifactを取り込みfinding/evidenceを作成 |
| `bun run scan:semgrep` | Semgrep CLIを実行してfinding/evidenceを作成 |
| `bun run typecheck` | TypeScript check |
| `bun run lint` | Biome lint |
| `bun run format` | Biome format write |
| `bun run format:check` | Biome format check |
| `bun run test` | Vitest + Bun scan module tests |
| `bun run build` | Vite production build |
| `bun run verify` | typecheck、lint、format:check、test、build |

## Product Boundary

- LLM API keyはhost側にのみ置く。
- scan対象repoへLLM API keyやsecretを注入しない。
- Semgrepなどのtool processへLLM API keyを渡さない。
- CLI commandはshell文字列ではなくstructured argsとして組み立てる。
- raw artifactは保存するが、LLM reviewへ渡す前に必要最小限へ絞る。
- secret findingの値は原則redactして表示、保存、reviewする。
- DAST はローカル対象または明示的に保存した target config に限定する。
- fuzzing / dynamic verification / sandbox reproduction は bounded profile と Docker 隔離を前提に実行する。
- patch自動適用は対象外。

## Verification

```bash
bun run verify
```

実装計画とMVP境界は `spec/vuln-workbench-concept.md` を基準に確認します。
