# Project Context: Hono Standard

この文書は、`hono-standard` の構造、主要entrypoint、責務の所在、アーキテクチャ上の境界を要約する参照資料である。タスク固有の進め方、探索手順、実装順序、検証計画、完了条件は扱わない。ただし、Projectが恒常的に提供する正本品質ゲートと、その構成scriptの関係はProject contractとして記載する。

## Repository Profile

- Bun runtime上でHono APIとReact/Vite frontendを同一originから提供するtemplate。
- `variant/sqlite` はlocal SQLite baselineを明示する互換variant。
- Backend composition rootは `api/app/hono.ts`、Bun server entryは `api/app/server.ts`。
- Frontend entryは `web/src/main.tsx`、provider構成は `web/src/App.tsx`、route compositionは `web/src/router.tsx`。
- DB public entryは `api/db/index.ts`。SQLite runtimeは `api/db/sqlite.ts`、schemaは `api/db/schema.ts`、migration entryは `api/db/migrate.ts`。
- API contractは `shared/schemas/` のZod schemaと、`api/app/hono.ts`がexportする `AppType`で表現される。

## Project Map

| Path | Responsibility |
| --- | --- |
| `api/app/` | application composition、runtime env、server bootstrap、security headers |
| `api/modules/<domain>/` | backendのドメイン単位の実装 |
| `api/db/` | DB runtime、schema、migration境界 |
| `api/middleware/` | 複数routeに適用されるHono middleware |
| `api/routes/` | 現行実装に残るHono route modules |
| `shared/schemas/` | APIとfrontendが共有するvalidation/contract |
| `web/src/modules/<domain>/` | frontendのドメイン単位の実装領域 |
| `web/src/routes/` | URL、search parameter、route guard |
| `web/src/views/` | 現行のpage-level UI |
| `web/src/styles.css` | Tailwind v4、global token、共通class |
| `drizzle/` | SQL migrations |
| `scripts/` | bootstrap、seed、build、quality関連script |
| `tests/e2e/` | Playwright browser smoke tests |

## Backend Architecture

Backendはドメイン指向のmodular monolithとして構成される。ドメイン実装の配置単位は `api/modules/<domain>/` で、永続化を持つドメインは次の3層で表現される。

```text
api/modules/<domain>/
  routing.ts
  service.ts
  repository.ts
  types.ts
  index.ts
```

| Layer | Responsibility | Main dependencies |
| --- | --- | --- |
| routing | Hono route、validation、HTTP request/response、cookie/status変換 | service、shared contract |
| service | use case、業務ルール、ドメイン上の判断 | repository、domain types |
| repository | query、永続化、DB rowとの変換 | `api/db/`、Drizzle、DB schema |

基本の依存方向は `api/app/hono.ts → routing → service → repository → api/db`。`index.ts`はドメイン外へ公開する境界を表す。DBを持たないドメインではrepository層は存在しない。

## Frontend Architecture

Frontendのドメイン実装領域は `web/src/modules/<domain>/` で、APIアクセス、server state、ドメインUIを同じ機能境界にまとめる構成を取る。

```text
web/src/modules/<domain>/
  api.ts
  hooks/
  components/
  views/
  types.ts
  index.ts
```

| Area | Responsibility |
| --- | --- |
| `api.ts` | `hc<AppType>`を利用する型付きendpoint access |
| `hooks/` | React Queryのquery、mutation、cache state |
| `components/` | ドメイン固有UI |
| `views/` | hooksとcomponentsから構成されるpage-level UI |
| `index.ts` | ドメイン外へ公開するfrontend API |

route filesはURL/search/guardとviewの対応を表す。共通transportはcredential、401 refresh、error変換を担い、request/response contractは `AppType` と `shared/schemas/` に由来する。

## Current Feature Locations

| Area | Current implementation |
| --- | --- |
| Auth API/session | `api/routes/auth.route.ts`, `api/modules/auth/`, `api/middleware/auth.ts`, `shared/schemas/auth.schema.ts` |
| Protected sample | `api/routes/protected.route.ts`, `shared/schemas/protected.schema.ts`, `web/src/routes/protected-route.tsx`, `web/src/views/protected-view.tsx` |
| Frontend auth state | `web/src/api.ts`, `web/src/auth-context.tsx` |
| Login UI | `web/src/domains/auth/login-domain.tsx`, `web/src/views/login-view.tsx`, `web/src/routes/login-*` |
| App shell/routing | `web/src/App.tsx`, `web/src/router.tsx`, `web/src/routes/root-route.tsx` |
| Showcase | `web/src/views/showcase-view.tsx`, `web/src/showcase-settings-context.tsx`, `web/src/showcase-table-search.ts`, `web/src/styles.css` |
| SQLite | `api/db/index.ts`, `api/db/sqlite.ts`, `api/db/schema.ts`, `api/db/migrate*.ts`, `drizzle/` |
| Runtime configuration | `api/app/env.ts`, `api/config/appDefaults.ts`, `.env.example`, `drizzle.config.ts` |

## Current Layout Notes

現在のコードには、ドメイン配置へ移行する以前の構造が残っている。

- Hono routingの一部は `api/routes/` に配置されている。
- Auth serviceは `api/modules/auth/` にある一方、routingは `api/routes/auth.route.ts` に分かれている。
- Frontendのauth UIは `web/src/domains/auth/`、page UIは `web/src/views/` に配置されている。
- `web/src/api.ts` は共通transportとfeature固有API/hooksの両方を含む。

これらは現在の実装配置を示すもので、`api/modules/<domain>/` と `web/src/modules/<domain>/` がドメイン単位のアーキテクチャ境界として定義されている。

## Verification Contract

- 正本品質ゲートは`bun run verify`であり、typecheck、Biome lint/format check、Vitest unit/contract/integration test、coverage threshold、production buildを内包する。
- 内包scriptを事前検証として重ねず、失敗工程の診断・修正に限って個別commandを使う。source変更後は`bun run verify`全体を再実行し、その成功だけを完了の証跡とする。
- `bun run format`は修正操作であり検証証跡ではない。E2Eは通常の`verify`に含めず、要求された場合だけ`bun run verify:e2e`または`bun run verify:all`を使う。

## Variant Boundary

DB driver、migration、deploy runtime、RAG/AI機能、SSR/SSGの差分は `variant/*` または `overlay/*` branchに分かれる。各branchでは `api/db/`、runtime entry、固有module、build entryの構成がこのbaselineと異なる。

variantの管理方法と配布形式は `docs/template-variant-management.md`、起動方法とpackage scriptsは `README.md` と `package.json` に記載されている。
