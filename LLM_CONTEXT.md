# LLM Context: vulnWorkbench

この文書は、vulnWorkbench で作業入口を決めるための圧縮コンテキストです。現在の主目的は、CLI セキュリティスキャンの証拠を保存・正規化し、LLM review と人間の decision へつなげるローカル脆弱性診断ワークベンチです。

## Repository Snapshot

- Bun + Hono backend と React + Vite frontend を同一 origin で動かす。
- DB は SQLite + sqlite-vec。Drizzle schema は `api/db/schema.ts`、migration は `drizzle/`。ファイル DB の読取りは各プロセスの read-only connection、書込みは DB ごとに1つの SQLite Writer process を経由する。
- Backend app composition は `api/app/hono.ts`、server bootstrap は `api/app/server.ts`。
- Frontend entry は `web/src/App.tsx`、router は `web/src/router.tsx`、API client は `web/src/api.ts`。
- Auth 実装は `api/modules/auth/`、route は `api/routes/auth.route.ts`、login UI は `web/src/domains/auth/login-domain.tsx`。
- Scan workflow は `api/modules/scans/`、CLI は `api/cli/scan-*.ts`、UI は `web/src/domains/scans/`。スキャナーは adapter 葉であり、能力ドメイン（実行 / 証跡 / カバレッジ / レポート / 改善出力）には切らない。
- Reproduction / dynamic / DAST は Docker 隔離と bounded profile を前提に扱う。
- Legacy knowledge / search / chat API は補助機能として残っているが、主 workflow は scan / finding / evidence / review / decision / report。
- Package manager / runtime は Bun。dev server は `bunx --bun vite` で起動する。

## Top-Level Map

| Path | Role |
| --- | --- |
| `api/app/hono.ts` | Hono middleware、API route、static fallback、`AppType` export |
| `api/app/server.ts` | Bun server bootstrap |
| `api/app/env.ts` | environment parsing and defaults |
| `api/config/appDefaults.ts` | non-secret app defaults |
| `api/db/` | SQLite connection and Drizzle schema |
| `api/db/writer/` | Unix socket Writer client/server、FIFO write queue、single-writer lock |
| `api/routes/` | auth、projects、scans、findings、reviews、decisions、reports、reproductions、dynamic、DAST routes |
| `api/cli/` | scan/review/decision/report/reproduction/dynamic/DAST CLI entrypoints |
| `api/modules/scans/` | scan capability root。所有は下表。新規 scanner は adapter + normalizer + fixture のみ |
| `api/modules/reviews/` | LLM finding review workflow |
| `api/modules/decisions/` | human decision persistence and workflow |
| `api/modules/reproductions/` | sandbox reproduction runner and storage |
| `api/modules/dynamic/` | test / sanitizer / lightweight fuzzing runner and profiles |
| `api/modules/dast/` | bounded HTTP baseline / browser-oriented DAST support |
| `api/modules/diagnostics/` | diagnostic checks and zero-finding report context |
| `api/providers/` | LLM provider interfaces, Azure/OpenAI-compatible adapters, routing |
| `shared/schemas/` | Zod schema and public API object types shared by api and web |
| `web/src/domains/scans/` | scan workspace UI。scanner 別ルートは作らない |
| `drizzle/` | SQL migrations |
| `scripts/verify.ts` | verification pipeline |
| `spec/` | Product concepts, decisions, policies, templates, and evidence |
| `spec/docs/active-plans/` | Active implementation plans and designs with remaining completion conditions |
| `spec/docs/.archived/` | Completed plans retained for history; do not load unless the user explicitly requests a historical audit |

## Scan capability ownership

スキャナー（Gitleaks / OSV / Trivy / Semgrep）はドメインではない。`StaticScannerAdapter` の葉としてだけ置く。分割単位はスキャン横断の能力である。

| Capability | Owns | Start here | Must not own |
| --- | --- | --- | --- |
| ScanExecution | profile 解決、preflight、step 監督、artifact、supervisor、削除 | `api/modules/scans/execution/`（旧パスは再エクスポート） | finding 詳細 UI、Markdown 本文、improvementRequest |
| ScannerAdapters | tool runner、normalize、adapter registry、license 境界 | `api/modules/scans/tools/`, `findings/normalizers/`（旧 `normalizers/` は再エクスポート）、`static-scanner-adapter.ts`, `builtin-static-scanner-adapters.ts` | report / coverage / handoff の tool 専用分岐 |
| FindingsEvidence | 正規化 finding 永続化、evidence、grouping、finding 詳細 | `api/modules/scans/findings/`, `web/src/domains/scans/findings/` | profile 実行、scanner spawn |
| Coverage | SAST 未実行、control catalog、runtime/DAST gap を一つの read model に集約 | `api/modules/scans/coverage/`, `web/src/domains/scans/coverage/` | scanner 実行そのもの |
| Reporting | 決定論 Markdown と section 契約 | `api/modules/scans/reporting/`, `web/src/domains/scans/reporting/` | LLM をレポート本文の正にすること |
| DiagnosticHandoff | scan review、improvementRequest、diagnostic readiness | `api/modules/scans/handoff/`, `web/src/domains/scans/handoff/` | CLI scanner 起動 |

DAST / runtime-scans モジュールは独立のまま。ScanExecution だけがそれらを呼ぶ。NightWorkers 合成と static-intelligence、legacy chat/search はこの所有表の外。

受け入れ条件: 新規 scanner 追加は adapter + normalizer + fixture のみ。report / coverage / handoff / finding-detail に tool 専用分岐を足したら戻す。

## Task Routing

| Task | Start here | Usually also read | Defer unless touched |
| --- | --- | --- | --- |
| Change scan import/profile logic | `api/modules/scans/` ScanExecution, `api/cli/scan-*.ts` | `api/routes/scans.route.ts`, `shared/schemas/scans.schema.ts`, focused tests | frontend styling |
| Change scanner adapter | `api/modules/scans/tools/`, `static-scanner-adapter.ts` | matching normalizer and fixture | report / coverage / handoff |
| Change coverage | `api/modules/scans/coverage/` | report coverage renderer, Web coverage summary | tool runners |
| Change deterministic report | `api/modules/scans/reporting/` | `shared/report-sections.ts`, report UI | scanner spawn |
| Change improvement / diagnostic handoff | `api/modules/scans/handoff/` | `contexts/scans/`, scan review schema | DAST internals |
| Change finding detail | `api/modules/scans/findings/`, `web/src/domains/scans/findings/` | `api/routes/findings.route.ts` | profile orchestrator |
| Change finding review | `api/modules/reviews/`, `api/providers/` | `api/routes/reviews.route.ts`, `shared/schemas/reviews.schema.ts` | DAST/dynamic internals |
| Change human decision | `api/modules/decisions/` | `api/routes/decisions.route.ts`, scan UI domain | tool runner internals |
| Change reproduction/dynamic/DAST | matching `api/modules/*/` directory and CLI entrypoint | route tests, shared schema, Docker README if behavior changes | legacy knowledge routes |
| Change scan UI | `web/src/domains/scans/` | `web/src/api.ts`, `web/src/styles-scans.css`, shared schema | backend runner implementation unless API changes |
| Change auth/API shell | `api/routes/auth.route.ts`, `api/modules/auth/`, `api/middleware/auth.ts` | `web/src/api.ts`, `web/src/domains/auth/login-domain.tsx` | scan runner details |
| Change env/config | `api/app/env.ts`, `api/config/appDefaults.ts`, `.env.example` | `drizzle.config.ts`, README environment table | unrelated frontend views |
| Change docs/metadata | `README.md`, `package.json`, `LLM_CONTEXT.md`, `spec/` | source truth for mentioned commands and modules | behavior changes |

## Implementation Contracts

- Keep backend routes on Hono; do not introduce a parallel API framework.
- File-backed SQLite mutation must go through `SqliteWriterClient`; do not add writable `bun:sqlite` connections outside `api/db/writer/internal/connection.ts`.
- Keep `/api/*` on Hono and non-API paths on Vite/static frontend.
- Treat CLI tools as evidence producers. Do not make LLMs freely inspect source to discover vulnerabilities.
- Do not add scanner-specific domains (SemgrepDomain, TrivyDomain). Tool-specific code belongs in adapters, runners, and normalizers only.
- Store raw artifacts where useful, but redact or minimize before LLM review and report output.
- Build CLI commands as structured args, not shell strings.
- Do not pass host LLM API keys into scan, reproduction, dynamic, or DAST target processes.
- Keep Docker socket unmounted in toolbox, reproduction, dynamic, and DAST runners.
- DAST targets must stay explicit and bounded. Do not broaden to arbitrary external scanning without a separate plan.
- `web/src/api.ts` owns browser fetch behavior, credential inclusion, refresh retry, and unauthorized events.
- Shared request/response validation should use schemas under `shared/schemas/` when the shape is used on both sides.
- `JWT_SECRET` is optional only for local development; production must fail closed when it is missing or still set to the dev default.

## Verification Matrix

| Change type | Minimum useful verification |
| --- | --- |
| Docs/metadata only | `bun run format:check` plus targeted search for stale names |
| API contract or route | `bun run typecheck` and targeted route/module tests |
| Scan/review/decision logic | focused tests for the touched module, then `bun run test` when behavior is shared |
| Frontend UI | `bun run typecheck` and `bun run build` |
| Env/DB/schema | `bun run typecheck`, focused migration/config tests, and `bun run format:check` |
| Broad or cross-cutting change | `bun run verify` |

## Commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run dev` | Start Vite + Hono dev server |
| `bun run db:migrate` | Apply SQL migrations |
| `bun run db:writer` | Run the single SQLite Writer in the foreground |
| `bun run db:writer:health` | Inspect the active SQLite Writer without starting one |
| `bun run db:boundary` | Reject direct production SQLite write paths |
| `bun run db:seed` | Create or reset the local `admin@example.com` admin user |
| `bun run auth:create-admin -- --email <email> --name <name>` | Create admin user |
| `bun run scan:profile` | Run a configured scan profile and optionally write a report |
| `bun run scan:semgrep` | Run Semgrep adapter for a project |
| `bun run scan:gitleaks` | Run Gitleaks adapter for a project |
| `bun run scan:osv` | Run OSV adapter for a project |
| `bun run scan:trivy` | Run Trivy adapter for a project |
| `bun run review:finding` | Generate LLM review for an existing finding |
| `bun run decision:finding` | Record human decision for a finding |
| `bun run repro:finding` | Run bounded sandbox reproduction for a finding |
| `bun run dynamic:run` | Run bounded dynamic verification profile |
| `bun run scan:dast` | Run bounded DAST / HTTP baseline profile |
| `bun run report:scan` | Export scan report |
| `bun run report:diagnostic` | Export diagnostic report |
| `bun run typecheck` | TypeScript check |
| `bun run test` | Vitest + Bun scan module tests |
| `bun run build` | Vite production build |
| `bun run verify` | Full local verification pipeline |
