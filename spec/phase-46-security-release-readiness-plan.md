# Phase 46: Security Release Readiness and Operational Hardening Plan

## Implementation Status

> Update: the global Web/API project allowed-root restriction introduced in this
> phase was later removed. Current registration accepts any existing, readable
> directory and stores its canonical path.

2026-07-24時点でlocal release rehearsalは完了し、判定は
**CONDITIONAL GO**。残るblockerは、現在のPhase 46 working treeをcommitし、
そのclean commitでpinned GitHub Actionsを成功させてfinal commit SHAを
release evidenceへ記録すること。

検証結果は`spec/evidence/phase-46-release-readiness.md`を参照する。

## 1. Purpose

この計画は、2026-07-23 のリポジトリ評価で確認したリリースブロッカーと改善事項をすべて解消し、vulnWorkbench を「ローカル単一ユーザー前提の高機能プロトタイプ」から、明示した信頼境界の中で安全にリリース判断できる状態へ移行するためのもの。

Phase 46 の主眼は新機能追加ではなく、次の境界を閉じることである。

- 認証済みユーザーがホスト上の任意パスを project として登録・走査できない。
- 一般ユーザーがグローバル LLM 設定、外向き通信先、host credential を操作できない。
- 既知の High / Moderate dependency advisory を release gate が見逃さない。
- local hook に依存せず、すべての test file と security check が CI で再現可能に実行される。
- CSP、proxy trust、API validation、secret persistence、artifact tracking が production policy と一致する。
- Docker image、frontend bundle、巨大 module、backup / restore、observability、governance の弱点を段階的に閉じる。

この計画は、既存の scanner-backed evidence、LLM handoff、Static Intelligence、SQLite single-writer の責務境界を維持する。scanner や LLM の新機能は追加しない。

## 2. Release Decision

Phase 46 完了までは、次の release status とする。

```text
local single-user development: allowed with documented limitations
shared workstation deployment: blocked
network-accessible multi-user deployment: blocked
production release: blocked
```

release block を解除できるのは、少なくとも次の Gate がすべて合格した場合だけである。

1. Host Path Authorization Gate
2. LLM Administration and Outbound Network Gate
3. Dependency and Browser Security Gate
4. Complete Verification and CI Gate
5. Repository and Supply-chain Hygiene Gate
6. Operational Recovery Gate

性能改善や大規模 module 分割は P0 security gate の後に行う。ただし、Phase 46 全体の完了条件には含める。

## 3. Current Baseline

評価時点の repository baseline:

```text
commit: f681bb6 feat: harden scanning and persistence workflows
TypeScript: 約 110,000 行
source files: 330
test files: 151
test cases detected by source search: 839
files over 500 lines: 46
files over 1,000 lines: 10
tracked artifact files: 739
maintainers represented in git history: 1
```

実行 baseline:

```text
sqlite-write-boundary: pass
typecheck: pass
lint: pass
format: fail (4 files)
default test command: 389 tests pass
production web build: pass with large-chunk warnings
coverage command: pass, but only 764 lines are included
bootstrap readiness: pass
bun audit: 15 vulnerabilities
  high: 5
  moderate: 7
  low: 3
gitleaks history scan: 1 fixture-like finding
```

`bun test api` の一括実行は 340 tests が通った後、module mock と DB facade mock が file 間で衝突し、連鎖的な failure を起こす。これは product failure として数えないが、test isolation と test inventory の欠陥として扱う。

実装前に baseline artifact を保存する。

```bash
git status --short
git rev-parse HEAD
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run test:coverage
bun run build
bun audit
git ls-files artifacts | wc -l
rg --files api web shared -g '*.test.ts' -g '*.test.tsx' | sort
```

baseline は `spec/evidence/phase-46-baseline.json` に machine-readable に保存する。secret、absolute home path、API key、cookie、token は保存しない。

## 4. Scope

### 4.1 In Scope

- Web project path allowed-root policy
- Existing project path revalidation
- macOS folder picker authorization
- Global LLM settings RBAC
- Wiki / shared source mutation RBAC
- LLM outbound URL / DNS / redirect policy
- Environment credential binding
- Stored LLM API key encryption and migration
- Dependency advisory remediation and release gate
- CSP rollout
- Trusted proxy and rate-limit key hardening
- Complete test inventory and process isolation
- Backend coverage baseline and ratcheting
- CI workflows
- Request validation and authorization matrix
- Generated artifact tracking cleanup
- Secret scan policy
- Docker dependency pinning, checksum verification, SBOM, vulnerability scan
- Frontend code splitting and bundle budget
- Browser E2E and accessibility checks
- Large module responsibility extraction
- Structured logging, readiness, backup / restore, release runbook
- SECURITY / CONTRIBUTING / CHANGELOG and supported-platform documentation

### 4.2 Non-goals

- New scanner integration
- Public internet DAST expansion
- SaaS billing, organization, team, or invitation model
- Redis or distributed rate-limit backend
- Patch auto-apply
- LLM-driven free source exploration
- SQLite replacement
- UI redesign unrelated to accessibility or bundle reduction
- Git history rewrite when no real credential is confirmed
- All source filesへの一律 coverage 80% 強制
- Windows Writer transport の全面実装

## 5. Fixed Security Decisions

### 5.1 Project Path Handling (Updated)

- Browser/API は存在して読み取り可能な任意の directory を登録・走査できる。
- 登録時に `realpath` で canonical path を保存する。
- scan 開始時にも path の存在、directory、read/execute access を再検証する。
- global allowed-root 設定は使用しない。
- direct CLI と Web-launched CLI は同じ path availability check を行う。
- existing project の path が利用不能な場合、record は削除せず scan を block して理由を返す。
- folder picker は admin only とする。

### 5.2 Global Administration Model

- `admin` だけが LLM endpoint、task route、provider health、Codex status の設定 surface を利用できる。
- `admin` だけが shared wiki/source の create/update/delete/reindex/blob push を実行できる。
- member は masked LLM 設定を含め管理 surface を読めない。
- member は設定済み route を通した finding review / scan review / report summary を利用できる。
- source/wiki の read/search は authenticated member に残す。

### 5.3 Outbound Provider Policy

- `openai` は既定で `https://api.openai.com` だけを許可する。
- `azure` は environment 由来 endpoint または operator allowlist に一致する HTTPS host だけを許可する。
- `openai-compatible` は `LLM_PROVIDER_ALLOWED_HOSTS` に明示した HTTPS host だけを許可する。
- `local` は loopback HTTP/HTTPS だけを許可する。
- URL userinfo、fragment、non-HTTP scheme、wildcard host、IPv4-mapped IPv6 bypass を拒否する。
- public host は DNS 解決後に private、loopback、link-local、multicast、reserved、cloud metadata range を拒否する。
- redirect は自動追跡せず、必要な場合は location を同じ policy で再検証する。
- validation は保存時と request 直前の両方で行う。

### 5.4 Environment Credential Binding

- environment API key は environment から生成された provider identity にだけ使う。
- stored endpoint が environment endpoint の ID を名乗るだけでは key fallback しない。
- key fallback には provider kind、canonical URL、environment endpoint identity の一致を必要とする。
- health check と LLM request は同じ credential resolution policy を使う。
- browser response、log、health history に key または authorization header を保存しない。

### 5.5 Secret at Rest

- UI から保存した LLM API key は平文 SQLite column に新規保存しない。
- AES-256-GCM、random nonce、endpoint ID/kind を AAD として暗号化する。
- production は `LLM_SETTINGS_ENCRYPTION_KEY` 未設定時に stored-secret provider を利用できない。
- encryption key は 32-byte base64 とし、repository、DB、artifact に保存しない。
- migration は dual-read / encrypted-write から開始し、検証後に plaintext を消去する。

### 5.6 Proxy and Browser Policy

- `TRUST_PROXY` の既定値は `false`。
- proxy header を使う場合は `TRUSTED_PROXY_CIDRS` に direct peer が一致する必要がある。
- production で `TRUST_PROXY=true` かつ trusted CIDR が空なら起動を拒否する。
- CSP は report-only 観測後に enforcement へ移行する。
- production で CSP 無効状態を許可しない。

## 6. Target Architecture

新しい主要 component:

```text
api/security/project-path-policy.ts
  -> canonicalize allowed roots
  -> authorize registration and execution surfaces
  -> explain blocked existing projects

api/security/outbound-url-policy.ts
  -> parse and canonicalize provider URL
  -> DNS/IP classification
  -> redirect revalidation

api/security/secret-crypto.ts
  -> encrypt/decrypt stored provider secrets
  -> key identity and rotation support

api/security/authorization-policy.ts
  -> global administration policy
  -> route-level role helpers

scripts/test-inventory.ts
  -> all test files belong to exactly one isolated shard

scripts/verify.ts
  -> deterministic ordered local gate

.github/workflows/verify.yml
  -> clean-checkout release-equivalent gate
```

既存の `api/modules/static-intelligence/path-boundary.ts` と DAST target validator の path/IP classification は参考にするが、異なる trust domain を無理に一つの巨大 helper に統合しない。

## 7. Implementation Slices

### Slice 0: Freeze Baseline and Repair Existing Verification

Priority: P0
Dependencies: none

Changes:

1. 4件の既存 format 差分を機械的に整形する。
2. `spec/evidence/phase-46-baseline.json` を追加する。
3. verify の各 step が失敗時に step 名と command を保持する現仕様を維持する。
4. baseline 取得時の `bun audit` と test inventory count を記録する。
5. Phase 46 の実装中は unrelated feature を同じ PR に入れない。

Acceptance:

- `bun run format:check` が clean checkout で成功する。
- `bun run verify` が format より後の step まで到達する。
- baseline JSON は secret と absolute user path を含まない。

Verification:

```bash
bun run format:check
bun run verify
git diff --check
```

Expected:

- format failure が解消する。
- 既存 product behavior の差分がない。

Failure handling:

- formatter 以外の差分が混入した場合は Slice 0 から除外する。
- verify が別の既存 failure を返した場合は baseline defect として分類し、後続 slice の成功に見せない。

Rollback:

- formatter-only diff と baseline artifact を戻せば元の状態へ戻る。

### Slice 1: Host Project Path Authorization (Historical; Superseded)

This slice records the original implementation. The current behavior is defined
in section 5.1 above.

Priority: P0 release blocker
Dependencies: Slice 0

Primary files:

- `api/app/env.ts`
- `api/config/appDefaults.ts`
- `api/routes/projects.route.ts`
- `api/modules/scans/profile-runner.ts`
- `api/modules/scans/project-resolver.ts`
- `shared/schemas/scan.schema.ts`
- `.env.example`
- `README.md`
- `README.jp.md`

New files:

- `api/security/project-path-policy.ts`
- `api/security/project-path-policy.test.ts`
- `scripts/audit-project-paths.ts`

Changes:

1. （後続変更で撤回）global project allowed-root 設定を parse、canonicalize、deduplicate する。
2. root 自体が存在する directory であることを bootstrap/readiness で確認する。
3. project registration で candidate の existence、directory、realpath、allowed-root containment を確認する。
4. Web scan 起動前と `profile-runner` の execution surface claim 後に path を再検証する。
5. symlink swap や root 外移動を scan 時の realpath 再検証で拒否する。
6. `/api/projects/folder-picker` に admin middleware を適用する。
7. picker 結果が root 外なら path を返さず policy error にする。
8. read-only audit CLI で existing project を `allowed` / `blocked` / `missing` に分類する。
9. blocked project の record、scan history、artifact は削除しない。
10. UI は blocked reason を表示し、scan button を無効化する。

Required tests:

- root と同じ path
- root の正常な child
- sibling prefix confusion (`/repo-safe` vs `/repo-safe-evil`)
- `..` traversal
- symlink escape
- missing path
- file path
- multiple allowed roots
- production empty roots
- development default root
- existing project が登録後に root 外 symlink へ変化
- member folder picker rejection
- admin picker success
- Web-launched CLI revalidation
- direct local CLI compatibility

Acceptance:

- member が allowed roots 外の path を登録できない。
- Web scan は登録済み record だけを信用せず毎回 path policy を通る。
- production empty-root configuration は fail closed。
- direct CLI の明示的な local operator workflow は維持される。

Verification:

```bash
bun test api/security/project-path-policy.test.ts
bun test api/routes/projects.route.test.ts
bun test api/modules/scans/profile-runner.test.ts
bun run bootstrap:check -- --skip-port
bun run typecheck
```

Failure handling:

- legitimate project が block された場合、policy を無効化して通さず、allowed root 設定を修正する。
- canonicalization が platform 差で不安定な場合、Windows support を推測せず supported-platform check を追加する。

Migration:

1. `scripts/audit-project-paths.ts` を enforcement 前に実行する。
2. legitimate existing project を含む最小 root を operator が設定する。
3. audit が `blocked=0` になってから production enforcement を有効化する。

Rollback:

- application version を戻し、旧 env を復元できる。
- DB record の migration は行わないため data rollback は不要。

### Slice 2A: Global Settings and Shared Mutation RBAC

Priority: P0 release blocker
Dependencies: Slice 0

Primary files:

- `api/app/hono.ts`
- `api/routes/settings.route.ts`
- `api/routes/sources.route.ts`
- `api/middleware/auth.ts`
- `web/src/App.tsx`
- `web/src/app-header.tsx`
- `web/src/settings-panel.tsx`

Changes:

1. LLM settings/status/health routes を admin-only group に分離する。
2. user-scoped system context routes は authenticated user のまま維持する。
3. shared source read routes と mutation routes を分離する。
4. source create/update/delete/folder mutation/reindex/blob publish を admin only にする。
5. member UI から LLM administration control と shared source mutation control を隠す。
6. UI 非表示だけに依存せず API middleware で拒否する。
7. authorization matrix test を追加する。

Acceptance:

- member は global LLM document を read/update/health-check できない。
- member は shared source を変更できない。
- member は configured LLM route を使用する scan review 等を実行できる。
- admin は従来の管理 workflow を維持できる。

Verification:

```bash
bun test api/routes/settings.route.test.ts
bun test api/routes/sources.route.test.ts
bun test api/middleware/auth.test.ts
bun run typecheck
```

Failure handling:

- member workflow が global setting API response に依存していた場合、必要な非機密 capability だけを専用 read model で返す。
- masked secret document 全体を member に戻す対応はしない。

Rollback:

- route middleware と UI visibility change を同時に戻す。
- data migration はない。

### Slice 2B: LLM Outbound Network and Credential Binding

Priority: P0 release blocker
Dependencies: Slice 2A

Primary files:

- `api/modules/llm-settings/llm-settings.schema.ts`
- `api/modules/llm-settings/provider-health.ts`
- `api/providers/llmProviderFactory.ts`
- `api/providers/openAiCompatibleProvider.ts`
- `api/providers/AzureOpenAiProvider.ts`
- `api/app/env.ts`

New files:

- `api/security/outbound-url-policy.ts`
- `api/security/outbound-url-policy.test.ts`
- `api/providers/provider-credential-resolver.ts`
- `api/providers/provider-credential-resolver.test.ts`

Changes:

1. endpoint URL を `z.string().url()` だけで済ませず、provider kind policy で検証する。
2. DNS lookup を injectable dependency とし、保存時と request 時に address range を確認する。
3. IPv4、IPv6、IPv4-mapped IPv6、decimal/octal/hex alias、localhost alias を test する。
4. fetch redirect を manual にし、Location を再検証する。
5. health check と completion request で共通 policy を使用する。
6. environment key fallback を environment provider identity と canonical URL に bind する。
7. arbitrary stored endpoint に OpenAI/Azure environment key を補完しない。
8. provider error に response body 全文や secret-bearing header を含めない。
9. URL policy failure を stable failure kind として API/UI に返す。

Acceptance:

- member/admin が DB を操作できた場合でも environment key を任意 host へ送れない。
- private network SSRF、metadata service、DNS rebinding、redirect escape が拒否される。
- explicitly configured local loopback provider は development で動作する。
- production policy は HTTP public endpoint を拒否する。

Verification:

```bash
bun test api/security/outbound-url-policy.test.ts
bun test api/providers/provider-credential-resolver.test.ts
bun test api/modules/llm-settings/provider-health.test.ts
bun test api/providers/llmRouter.test.ts
bun run typecheck
```

Failure handling:

- enterprise endpoint が block された場合は UI からの bypass を追加せず、operator-controlled allowlist に追加する。
- DNS validation が利用環境で解決不能なら request を送らず explicit failure とする。

Rollback:

- old version へ戻す前に、new policy 下で追加された endpoint が旧 version で environment key fallback を受けないことを確認する。
- unsafe endpoint が残る場合は disable してから rollback する。

### Slice 2C: Encrypt Stored LLM Secrets

Priority: P0/P1
Dependencies: Slice 2A, Slice 2B

Primary files:

- `api/db/schema.ts`
- `api/modules/llm-settings/llm-settings.repository.ts`
- `api/modules/llm-settings/secret-mask.ts`
- `api/app/env.ts`
- `api/cli/llm-route-repair.ts`

New files:

- `api/security/secret-crypto.ts`
- `api/security/secret-crypto.test.ts`
- `api/cli/migrate-llm-secrets.ts`
- next available `drizzle/*_llm_secret_encryption.sql`

Data model:

```text
api_key                  legacy plaintext, read-only during migration
api_key_ciphertext       base64 ciphertext
api_key_nonce            base64 random nonce
api_key_auth_tag         base64 GCM tag
api_key_key_id           non-secret key identity
```

Changes:

1. encrypted columns を追加する。
2. repository は encrypted secret を優先して読む。
3. new/updated secret は encrypted columns にだけ保存する。
4. migration CLI は transactionally plaintext を暗号化し、verify 後に plaintext を null にする。
5. migration CLI は dry-run、count、failure JSON を提供する。
6. production は key missing、wrong key、partial ciphertext を fail closed にする。
7. decrypted secret を log、error、health history、test snapshot に含めない。
8. key rotation は previous key で read、current key で rewrite できるようにする。

Acceptance:

- new API key が SQLite plaintext search で見つからない。
- legacy row は explicit migration 後に plaintext が null。
- wrong key で provider request を実行しない。
- masked-secret update は既存 ciphertext を保持する。

Verification:

```bash
bun test api/security/secret-crypto.test.ts
bun test api/modules/llm-settings/llm-settings.repository.test.ts
bun run db:migrate
bun run llm-secrets:migrate -- --dry-run
sqlite3 data/vuln-workbench.sqlite "select count(*) from llm_provider_endpoints where api_key is not null and api_key <> '';"
```

Expected:

- migration 後の plaintext count は `0`。
- encrypted provider route が正常に resolve される。

Failure handling:

- encryption verify が1件でも失敗した場合は plaintext cleanup を行わない。
- partial migration を完了扱いにしない。

Rollback:

- plaintext cleanup 前は old application へ rollback 可能。
- cleanup 後は encrypted-key backup と DB backup が揃わない限り old version へ戻さない。
- destructive plaintext cleanup 前に Writer-consistent DB backup を必須とする。

### Slice 3A: Dependency Advisory Remediation

Priority: P0 release blocker
Dependencies: Slice 0

Primary files:

- `package.json`
- `bun.lock`
- dependency override policy documentation

Changes:

1. Hono を advisory patched version 以上へ更新する。
2. Undici override を patched version 以上へ更新する。
3. Mermaid/DOMPurify、MCP SDK tree、brace-expansion、fast-uri の patched resolution を確認する。
4. unused vulnerable dependency がある場合は upgrade より削除を優先する。
5. override ごとに理由、owner、review date を documentation に記録する。
6. `bun audit` JSON output を release gate で解析する。
7. High/Critical は zero tolerance とする。
8. Moderate allowlist は advisory ID、applicability、expiry date を必要とする。

Acceptance:

- `bun audit` が High/Critical 0。
- Moderate は0、または期限付き documented exception のみ。
- application tests と build が通る。

Verification:

```bash
bun install --frozen-lockfile
bun audit
bun run verify
```

Failure handling:

- breaking upgrade を unrelated refactor と混ぜない。
- audit suppression だけで dependency を残さない。

Rollback:

- `package.json` と `bun.lock` を一緒に戻す。
- vulnerable version へ戻る rollback は production release には使用しない。

### Slice 3B: Trusted Proxy, Rate Limit, and CSP

Priority: P1 security
Dependencies: Slice 3A

Primary files:

- `api/config/appDefaults.ts`
- `api/app/env.ts`
- `api/middleware/rate-limiter.ts`
- `api/app/hono.ts`
- `web/index.html`

Changes:

1. `TRUST_PROXY=false` を default にする。
2. `TRUSTED_PROXY_CIDRS` を追加し、direct peer が trusted の場合だけ forwarded header を使う。
3. login limiter を IP に加えて normalized email でも制限する。
4. rate-limit response に `Retry-After` を付与する。
5. memory store が single-process policy であることを明記する。
6. CSP report-only mode を追加し、必要 directive を収集する。
7. inline script を排除し、可能な限り nonce 不要の static policy にする。
8. production では CSP enforcement を default にする。
9. Mermaid、worker、blob/data image の必要最小 directive を test/build で確認する。
10. `frame-ancestors 'none'`、`object-src 'none'`、`base-uri 'self'` を含める。

Acceptance:

- direct client が `X-Forwarded-For` を変えて login limit を回避できない。
- trusted proxy configuration は explicit。
- production response に enforcing CSP がある。
- login、Mermaid report、knowledge view、download が CSP 下で動作する。

Verification:

```bash
bun test api/middleware/rate-limiter.test.ts
bun test api/app/env.test.ts
bun test api/app/hono.test.ts
bun run build
```

Failure handling:

- CSP violation が出た場合は wildcard を追加せず、resource loading path を特定する。
- emergency rollback は enforcement から report-only までとし、production CSP 全無効化はしない。

Rollback:

- CSP は enforce -> report-only へ戻せる。
- proxy policy は default false を維持し、trusted CIDR 設定だけを戻す。

### Slice 4A: Complete Test Inventory and Isolation

Priority: P1 release gate
Dependencies: Slice 0

Primary files:

- `package.json`
- `vitest.config.ts`
- `scripts/verify.ts`

New files:

- `scripts/test-inventory.ts`
- `scripts/run-api-test-shards.ts`
- `tests/test-shards.json`

Changes:

1. repository 内の全 `*.test.ts` / `*.test.tsx` を inventory する。
2. 各 test file は exactly one shard に所属させる。
3. duplicate と omission を CI failure にする。
4. Bun module mock が process 間で共有されないよう shard を別 process で起動する。
5. Web/shared pure tests は Vitest、Bun/SQLite tests は Bun test に固定する。
6. auth、middleware、routes、providers、DB Writer、Static Intelligence を既定 `bun run test` に含める。
7. timeout の長い CLI fixture は dedicated shard にする。
8. test command の exit code と summary を集約する。

Suggested scripts:

```text
test:inventory
test:web
test:api:unit
test:api:db
test:api:routes
test:api:cli
test:api:static-intelligence
test:e2e
test
```

Acceptance:

- 151件以上の current test files が omission/duplicate なしで実行される。
- `bun test api` の mock contamination を release signal に使わない。
- test file 追加時に shard 未登録なら CI が失敗する。
- default `bun run test` が全 shard を実行する。

Verification:

```bash
bun run test:inventory
bun run test
bun run test:inventory -- --assert-complete
```

Failure handling:

- flaky test を skip して green にせず、quarantine shard と issue/expiry を必要とする。
- test runner を一括置換しない。

Rollback:

- old test command へ戻す場合も inventory check は残す。

### Slice 4B: Meaningful Coverage and CI

Priority: P1 release gate
Dependencies: Slice 4A

New files:

- `.github/workflows/verify.yml`
- `.github/dependabot.yml`
- `scripts/check-audit-policy.ts`
- `scripts/check-bundle-budget.ts`

Changes:

1. clean checkout で Bun version を固定する。
2. frozen lockfile install を使う。
3. typecheck、lint、format、test inventory、all test shards、build、audit、secret scan、DB boundary を CI job にする。
4. backend coverage を測定し、auth、path policy、outbound policy、artifact/path validation から threshold を導入する。
5. coverage denominator と included files を summary に表示する。
6. global 80% を即時要求せず、baseline を下回れない ratchet にする。
7. branch protection が利用可能な repository では `verify` job を required check にする。
8. Dependabot PR は CI を通らない限り merge しない。

Acceptance:

- local hook を bypass しても remote CI が release gate を実行する。
- coverage report が全体 coverage と限定 coverage を誤認させない。
- current security-critical modules に branch coverage threshold がある。

Verification:

```bash
bun run verify
bun run test:coverage
bun run check:audit
bun run check:bundle
```

Failure handling:

- CI-only failure は environment drift として再現 command を記録する。
- threshold を下げて通さず、test または instrumentation を修正する。

Rollback:

- flaky external checks は non-blocking へ落とせるが、typecheck/test/audit High/Critical/DB boundary を外さない。

### Slice 5: API Validation and Authorization Matrix

Priority: P1
Dependencies: Slice 1, Slice 2A, Slice 2B

Primary files:

- `api/routes/*.ts`
- `shared/schemas/*.schema.ts`
- `api/app/hono.ts`
- `web/src/api.ts`

Changes:

1. 124 route handler の input surface を inventory する。
2. body、query、param がある route は shared/local Zod schema を持つ。
3. raw `c.req.json()` を expected schema parse に置換する。
4. UUID、limit、enum、URL、path、free-text size に upper bound を設定する。
5. route ごとに public/authenticated/member-owner/admin を表にする。
6. ownership check を repeated ad hoc lookup から typed helper へ寄せる。
7. response failure kind と HTTP status を統一する。
8. frontend duplicate type は shared schema inference または generated read type へ段階的に寄せる。

Acceptance:

- request input を未検証のまま command/path/network/config に渡す route がない。
- authorization matrix と middleware wiring が test で一致する。
- malformed JSON は一貫した 400 response。
- ownership failure は object existence leakage を最小化する。

Verification:

```bash
rg -n 'c\.req\.json\(' api/routes
bun test api/routes
bun run typecheck
bun run test
```

Failure handling:

- shared schema 化が domain coupling を増やす場合は route-local schema を許可する。
- response redesign をこの slice へ混ぜない。

Rollback:

- schema tightening は compatibility note を残し、必要なら一時的に旧 field alias を受ける。

### Slice 6: Repository Hygiene, Secret Scanning, and Governance

Priority: P1
Dependencies: Slice 4B

Primary files:

- `.gitignore`
- `.gitleaksignore`
- `README.md`
- `README.jp.md`

New files:

- `SECURITY.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `scripts/check-artifact-tracking.ts`

Changes:

1. `artifacts/` の739 tracked filesを index から外す。
2. local runtime files 自体は削除しない。
3. permanent test fixture は `tests/fixtures/` へ明示的に移す。
4. tracked artifact count が0でない場合 CI failure にする。
5. gitleaks history/current scan を CI に追加する。
6. fixture false positive は fingerprint と理由を限定して suppress する。
7. real secret が見つかった場合は先に revoke/rotate し、その後 history remediation を別判断する。
8. SECURITY に supported versions、reporting、secret response、release policy を記載する。
9. CONTRIBUTING に test shard、format、artifact、migration policy を記載する。
10. CHANGELOG に security-impacting behavior change を記録する。

Acceptance:

- `git ls-files artifacts` が空。
- fixture 以外の secret finding が0。
- runtime artifacts は local に残り、test fixture は明示 directory にある。
- new contributor が release gate を再現できる。

Verification:

```bash
git ls-files artifacts
bun run check:artifact-tracking
gitleaks git . --no-banner --redact
bun run verify
```

Failure handling:

- artifact に唯一の再現 fixture がある場合は先に fixture directory へ移して test を更新する。
- user-owned local artifact を削除しない。

Rollback:

- index cleanup は Git から復元可能。
- local files は保持される。
- real secret revoke は rollback しない。

### Slice 7: Docker and Build Supply-chain Hardening

Priority: P1
Dependencies: Slice 3A, Slice 4B

Primary files:

- `docker/toolbox/Dockerfile`
- `docker/dynamic/Dockerfile`
- `scripts/build-toolbox-image.ts`
- `scripts/build-dynamic-image.ts`
- Docker documentation

Changes:

1. base image を digest pin する。
2. downloaded scanner/runtime binary に SHA-256 verification を追加する。
3. `curl | sh` を checksum-verifiable artifact install に置換する。
4. Bun、Rust、Node、Go、pytest を explicit version にする。
5. amd64/arm64 mapping を両 image で検証する。
6. build context に `.env`、data、artifacts が入らないことを check する。
7. image SBOM を CycloneDX/SPDX で生成する。
8. Trivy image scan を CI/release gate にする。
9. High/Critical OS package finding を release block にする。
10. scanner version update procedure と checksum source を documentation に残す。

Acceptance:

- network取得物はversionとchecksumで再現可能。
- Dockerfile に unpinned `latest`/`stable` install がない。
- image は non-root、cap-drop、read-only runtime policy を維持する。
- Docker socket は mount されない。
- supported architecture の smoke test が通る。

Verification:

```bash
bun run docker:toolbox:build
bun run docker:dynamic:build
docker run --rm --network none vuln-workbench-toolbox:local semgrep --version
trivy image --severity HIGH,CRITICAL --exit-code 1 vuln-workbench-toolbox:local
trivy image --severity HIGH,CRITICAL --exit-code 1 vuln-workbench-dynamic:local
```

Failure handling:

- upstream が checksum を提供しない binary は release asset provenance を別経路で検証するか採用を停止する。
- vulnerability exception は expiry と non-applicability evidence を必要とする。

Rollback:

- previous known-good image digest を保持する。
- vulnerable digest への rollback は production で許可しない。

### Slice 8: Frontend Performance, Browser E2E, and Accessibility

Priority: P2 release quality
Dependencies: Slice 3B, Slice 4B, Slice 5

Primary files:

- `web/src/App.tsx`
- `web/src/router.tsx`
- `web/src/api.ts`
- Mermaid-consuming views
- `vite.config.ts`

Changes:

1. Mermaid と diagram type modules を report/chat/knowledge route 単位で lazy load する。
2. legacy knowledge/search/chat/showcase surface を initial scan workflow bundle から分離する。
3. frontend API client を domain 別 module に分割する。
4. initial route bundle と route chunk の budget を `check-bundle-budget` で固定する。
5. Playwright で login、project path rejection、member/admin boundary、scan result、report preview を test する。
6. `@axe-core/playwright` 等で主要 route の serious/critical accessibility violation を gate にする。
7. keyboard navigation、focus return、dialog labeling、loading/error status を確認する。
8. production CSP 下で E2E を実行する。

Initial budgets:

```text
initial JS gzip: <= 250 KiB
single lazy chunk minified: <= 500 KiB
initial CSS gzip: <= 35 KiB
```

budget が現在値から一度に到達不能な場合は、baseline、intermediate、target の3段階を記録し、各PRで悪化を禁止する。

Acceptance:

- Vite large-chunk warning が initial application path で解消する。
- main scan route は Mermaid 全 renderer を事前ロードしない。
- 主要 user journey が browser test で再現される。
- serious/critical a11y violation が0。

Verification:

```bash
bun run build
bun run check:bundle
bun run test:e2e
```

Failure handling:

- arbitrary warning limit 引き上げで合格にしない。
- snapshot だけで behavior test を置き換えない。

Rollback:

- route-level lazy loading は個別 route ごとに戻せる。
- bundle budget と E2E gate は残す。

### Slice 9: Maintainability Refactors

Priority: P2
Dependencies: Slices 1-5, Slice 8 API split

Primary targets:

```text
web/src/api.ts
web/src/domains/scans/use-scans-controller.ts
api/modules/scans/profile-runner.ts
api/app/hono.ts
web/src/domains/projects/projects-domain.tsx
api/modules/scans/report-builder.ts
```

Changes:

1. behavior characterization tests を先に追加する。
2. `web/src/api.ts` を auth/settings/projects/scans/static-intelligence/source domain client に分ける。
3. scan controller から query orchestration、mutation orchestration、derived view、polling state を分離する。
4. profile runner から step executor、persistence lifecycle、report finalization を分離する。
5. Hono composition から middleware policy、route registration、runtime construction を分離する。
6. report builder を section builder 単位に分ける。
7. circular import と public export boundary を static check する。
8. refactor PR で schema、prompt、workflow behavior を変更しない。

Acceptance:

- 対象6ファイルの責務が documentation に一致する。
- touched production file に 1,500行超を残さない。
- existing API contract と saved report snapshot が変わらない。
- type cast / `any` が増えない。

Verification:

```bash
bun run test
bun run typecheck
bun run build
git diff --stat
```

Failure handling:

- behavior change が必要になった場合は refactor PR から分離する。
- line count だけを目的に forwarding file を大量生成しない。

Rollback:

- domain ごとの extraction PR を独立 revert 可能にする。

### Slice 10: Operational Recovery and Observability

Priority: P2 release readiness
Dependencies: Slice 4B, Slice 7

New/updated surfaces:

- structured application logger
- request ID middleware
- liveness/readiness diagnostics
- Writer-consistent backup CLI
- restore verification CLI
- production deployment and rollback runbook

Changes:

1. application log を structured JSON にし、request ID、event、level、duration、failure kind を持たせる。
2. logs から API key、authorization、cookie、source snippet、absolute sensitive path を redact する。
3. `/api/health` liveness と readiness を分離する。
4. readiness は DB read、migration state、Writer compatibility、artifact root、configured execution policy を確認する。
5. backup は live SQLite file copy ではなく Writer-consistent mechanism を使う。
6. restore は temporary location で integrity check、migration checksum、representative record count を検証する。
7. secret encryption key backup と DB backup の依存関係を runbook に記載する。
8. upgrade/rollback 手順に Writer protocol restart と migration compatibility を含める。
9. artifact retention、log retention、backup retention を設定化する。
10. supported platforms と unsupported Windows Writer transport を明記する。

Acceptance:

- operator が deploy 前 readiness、backup、restore rehearsal、rollback可否を確認できる。
- restore test が isolated temporary DB で成功する。
- logs に secret がない。
- health endpoint が internal configuration detail を anonymous user に返さない。

Verification:

```bash
bun run bootstrap:check -- --skip-port
bun run db:writer:health
bun run backup:create -- --output <temporary-path>
bun run backup:verify -- --input <temporary-path>
bun run test
```

Failure handling:

- backup verify が失敗した場合は release を停止する。
- readiness failure を liveness success で隠さない。

Rollback:

- schema cleanup 後の rollback capability は backup verification がある場合だけ宣言する。
- log format consumer がある場合は version field で compatibility を保つ。

### Slice 11: Final Release Acceptance

Priority: final gate
Dependencies: Slices 0-10

Required clean-checkout commands:

```bash
bun install --frozen-lockfile
bun run bootstrap
bun run bootstrap:check -- --skip-port
bun run verify
bun run test:inventory -- --assert-complete
bun run test:coverage
bun run test:e2e
bun run check:audit
bun run check:artifact-tracking
bun run check:bundle
gitleaks git . --no-banner --redact
```

Required security scenarios:

1. member cannot register `/`, home, sibling prefix, symlink escape.
2. member cannot open folder picker.
3. existing project moved outside allowed root cannot scan.
4. member cannot read/update global LLM settings.
5. member cannot trigger provider health.
6. attacker endpoint cannot receive environment OpenAI/Azure key.
7. private IP、metadata IP、redirect escape、DNS rebind are rejected.
8. stored API key is not plaintext in SQLite.
9. spoofed X-Forwarded-For does not bypass login limiter.
10. production response has enforcing CSP.
11. all test files execute exactly once.
12. tracked runtime artifact count is zero.
13. High/Critical dependency and image advisory count is zero.
14. backup restore rehearsal succeeds.

Release acceptance:

- all required commands return exit code 0.
- documented exception has owner and expiry.
- no P0/P1 TODO remains.
- rollback instructions match actual migration state.
- final release report records commit SHA, dependency audit, image digest, test inventory count, bundle budget, backup rehearsal result.

## 8. Implementation Order and PR Strategy

Recommended PR sequence:

```text
PR 46-00 baseline + format repair
  -> PR 46-01 project path authorization
  -> PR 46-02 global RBAC
  -> PR 46-03 outbound URL + credential binding
  -> PR 46-04 encrypted LLM secrets

PR 46-05 dependency remediation
  -> PR 46-06 proxy + CSP

PR 46-07 test inventory + isolation
  -> PR 46-08 coverage + CI
  -> PR 46-09 API validation matrix

PR 46-10 artifact/governance cleanup
PR 46-11 Docker supply-chain
PR 46-12 frontend performance + E2E/a11y
PR 46-13 maintainability refactors
PR 46-14 operational recovery
PR 46-15 final release evidence
```

Parallel work is allowed only for:

- PR 46-01 and PR 46-05 after baseline
- PR 46-07 and PR 46-05 after baseline
- PR 46-10 and PR 46-11 after CI gate exists

The following must remain sequential:

- RBAC -> outbound policy -> secret migration
- test inventory -> CI -> API validation matrix
- security behavior -> maintainability refactor
- backup verification -> plaintext cleanup/final release

Each PR should be independently reviewable and revertable. P0 security fixes should not wait for P2 refactors before merge.

## 9. Coverage Matrix

| Evaluation finding | Implemented by |
| --- | --- |
| arbitrary host project path | Slice 1 |
| folder picker exposed to member | Slice 1 |
| global LLM settings available to member | Slice 2A |
| shared wiki mutation available to member | Slice 2A |
| provider SSRF / private network access | Slice 2B |
| environment key exfiltration | Slice 2B |
| plaintext stored provider API key | Slice 2C |
| 15 dependency vulnerabilities | Slice 3A |
| `trustProxy=true` default | Slice 3B |
| login limiter spoofing | Slice 3B |
| CSP disabled | Slice 3B |
| verify blocked by format | Slice 0 |
| tests omitted from default command | Slice 4A |
| all-API mock contamination | Slice 4A |
| misleading narrow coverage | Slice 4B |
| no CI | Slice 4B |
| incomplete request validation | Slice 5 |
| repeated ownership logic | Slice 5 |
| 739 tracked artifacts | Slice 6 |
| no remote secret-scan gate | Slice 6 |
| no SECURITY/CONTRIBUTING/CHANGELOG | Slice 6 |
| unverified Docker downloads | Slice 7 |
| floating runtime installs | Slice 7 |
| no image SBOM/security gate | Slice 7 |
| 1.65 MB initial JS / large chunks | Slice 8 |
| no browser/component/a11y tests | Slice 8 |
| oversized modules | Slice 9 |
| console-oriented logging | Slice 10 |
| weak readiness/backup/restore story | Slice 10 |
| single-maintainer operational risk | Slices 4B, 6, 10 |
| portability ambiguity | Slices 7, 10 |

## 10. Release Metrics

Phase 46 completion metrics:

```text
P0 open findings: 0
P1 open findings: 0
dependency High/Critical: 0
container High/Critical: 0
tracked artifacts: 0
test inventory omissions: 0
test inventory duplicates: 0
default test command: all test files
format/typecheck/lint/build: pass
security-critical branch coverage: >= 90%
initial JS gzip: <= 250 KiB or approved staged target with no regression
serious/critical accessibility violations: 0
backup restore rehearsal: pass
```

## 11. Stop Conditions

Implementationを停止して計画を更新する条件:

- allowed-root enforcement が legitimate project を安全に移行できない。
- environment credential と stored endpoint identity を確実に区別できない。
- secret migration の decrypt verification が1件でも失敗する。
- dependency upgrade が scanner evidence format を変える。
- CSP enforcement に wildcardまたは`unsafe-eval`が必要になる。
- test inventory を完全にできないまま CI green にする必要が生じる。
- artifact cleanup が唯一の再現証拠を失う。
- Docker checksum provenance を取得できない。
- backup restore rehearsal が失敗する。
- maintainability refactor が security behavior を同時変更する。
- rollback に必要な旧 key / DB backup / image digest がない。

Stop condition 発生時は、失敗した gate より後の release slice を進めない。診断、修正、再検証を行い、結果を plan/evidence に反映する。

## 12. Definition of Done

Phase 46 は次をすべて満たした場合のみ完了とする。

- Host path は configured root と execution surface で認可される。
- member/admin の global administration boundary が API と UI で一致する。
- outbound provider は URL、DNS、redirect、credential binding policy を通る。
- stored LLM secret は暗号化され、legacy plaintext が残らない。
- dependency/browser/image advisory gate が合格する。
- trusted proxy と CSP が production-safe default になる。
- repository の全 test file が exactly once 実行される。
- CI が clean checkout で local release gate を再現する。
- API input と authorization matrix が検証済みである。
- runtime artifacts が Git tracking から除外される。
- Docker build provenance と SBOM が確認できる。
- initial frontend bundle と accessibility が budget を満たす。
- 主要 oversized module が責務分割され、behavior regression がない。
- structured logs、readiness、backup、restore、rollback runbook が実証される。
- final release evidence が commit SHA と共に保存される。

この状態になって初めて、network-accessible multi-user deployment の release review を再開する。
