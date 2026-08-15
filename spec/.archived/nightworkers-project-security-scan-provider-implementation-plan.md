# NightWorkers Project Security Scan Provider 実装計画

## 0. 文書ステータス

- ステータス: Draft
- 対象リポジトリ: vulnWorkbench
- 基準ブランチ: `main`
- 基準コミット: `21ac65967644543900d77312ccdd33e3f55a3bdc`
- 作成日: 2026-07-30
- companion:
  - NightWorkers の
    `spec/project-detail-vulnerability-scan-vulnworkbench-consumer-implementation-plan.md`
- 関連計画:
  - `spec/git-diff-target-scan-implementation-plan.md`
  - `spec/static-intelligence-coding-agent-consumer-companion-plan.md`
- 対象:
  - NightWorkers から利用する versioned service integration API
  - preset registry
  - scan / event / finding / report の非同期参照
  - scoped integration credential

## 1. 結論

vulnWorkbench は NightWorkers に対し、
`/api/integrations/nightworkers/v1` 配下の provider API を提供する。

既存の user-facing Web API、CLI、scan runner、finding repository、report repository を
内部 application service として再利用するが、NightWorkers 連携では次を追加する。

1. browser cookie とは別の scoped integration credential
2. NightWorkers 向けの安定した preset registry
3. canonical project path から既存 project / scan context を安全に解決する adapter
4. end-to-end idempotent な scan / report start
5. sequence 付き event pagination
6. report start の完全非同期化と restart recovery
7. versioned response schema と structured error

vulnWorkbench が scan、finding、artifact、report の正本である。
NightWorkers に raw finding や report Markdown の複製を要求しない。

## 2. 現状

### 2.1 既存 scan API

既存 API には概ね次がある。

- `POST /api/projects/:projectId/scans`
- `GET /api/scans?projectId=...`
- `GET /api/scans/:scanRunId`
- `GET /api/scans/:scanRunId/events`
- cancel
- summary
- findings / groups
- reports
- reviews
- artifacts

scan start は `202` を返し、`ScanProcessSupervisor` が child scan、queue、cancel、recovery を
所有している。この実行基盤は provider API でも再利用する。

一方、現状の route は user JWT / cookie と内部 `projectId` を前提にする。
NightWorkers は browser user session や vulnWorkbench project ID を持たないため、
既存 route を直接公開しない。

### 2.2 scan event

`scan_events` は event ID と timestamp を持つが、run 内での単調増加 sequence と
`after` pagination がない。

polling consumer が重複・欠落なく再開するため、provider API 公開前に run 単位 sequence を
追加する。

### 2.3 report

report route は running row を作成するものの、request 内で生成完了を待つ経路がある。
NightWorkers の long-running integration には不適切なため、enqueue と execution を分離する。

既存 `ScanReviewRunner.start()` の非同期 runner / recovery pattern を参考に、
`ScanReportRunner` を追加する。

### 2.4 profile

既存 profile には次が含まれる。

- `source-baseline`
- `diff-source-baseline`
- `basic-security`
- `detailed-security`
- `full-security-scan`
- その他 focused profiles

NightWorkers が raw profile ID と tool 構成を固定すると、provider 内の改善が breaking change
になる。ユーザー向けの安定した preset と、実行 profile を分ける。

## 3. 目的

1. NightWorkers が登録済み Repository に対して安全に scan を開始できる。
2. quick / standard / deep の意味を provider 側で安定管理できる。
3. scan start、status、events、cancel、summary、findings を非同期に提供できる。
4. completed scan から LLM report を非同期生成・参照できる。
5. retry や process restart で重複 scan / report を作らない。
6. path、owner、scope、rate、revision、idempotency を server-side で検証する。
7. provider schema の変更を contract version で管理できる。

## 4. 固定する責務

| 責務 | provider での所有 |
| --- | --- |
| profile 定義 | vulnWorkbench |
| preset -> profile 解決 | vulnWorkbench |
| target preview / digest | vulnWorkbench |
| project path policy | vulnWorkbench |
| queue / process / cancel | vulnWorkbench |
| event ordering | vulnWorkbench |
| raw finding / artifact | vulnWorkbench |
| security outcome | vulnWorkbench |
| report generation / Markdown | vulnWorkbench |
| credential scope / revoke | vulnWorkbench |
| NightWorkers user authorization | NightWorkers |
| NightWorkers repository ID -> path | NightWorkers |
| Project detail UI | NightWorkers |

provider API は NightWorkers に「scanner の内部 DB を操作させる API」ではなく、
許可された use case の application boundary とする。

## 5. スコープ

### 5.1 MVP に含める

- v1 integration routes
- integration client の作成・一覧・失効 CLI
- token hash / scope / owner 永続化
- capability / preset registry
- canonical project path 解決
- working tree / full preview
- idempotent scan start
- run status / events / cancel
- summary / cursor-paginated findings
- async report start / status / Markdown content
- structured errors
- rate / concurrency limit
- audit log
- contract fixtures

### 5.2 MVP に含めない

- NightWorkers user ごとの vulnWorkbench browser session 発行
- arbitrary command / tool / environment の受け付け
- NightWorkers からの profile 作成・編集
- finding triage / false-positive 更新
- remediation / review / improvement request API
- task 作成
- scheduled scan
- scan comparison
- DAST environment の自動起動
- Static Intelligence preparation との統合

full security scan と structure-only Static Intelligence prepare は別 lifecycle のまま維持する。

## 6. preset registry

### 6.1 安定 ID

provider が公開する preset ID は次の 3 つとする。

- `quick`
- `standard`
- `deep`

NightWorkers の `custom` は UI mode であり、provider preset として登録しない。

### 6.2 初期 mapping

初期 mapping は次を推奨する。

| preset | `working_tree` | `full` |
| --- | --- | --- |
| `quick` | `diff-source-baseline` | `source-baseline` |
| `standard` | `diff-basic-security`（新規） | `basic-security` |
| `deep` | 未対応 | `detailed-security` |

理由:

- current change は diff target 対応済み profile を利用する。
- `diff-basic-security` は `diff-source-baseline` と同じ tool 種別を基本にしつつ、
  OSV / Trivy も required とする standard 用 profile として追加する。timeout は 900 秒、
  target は commit / range / working_tree を許可する。
- standard/full は `basic-security` で日常的な静的、secret、依存関係、filesystem 検査を行う。
- deep/full は `detailed-security` を使い、runtime / DAST 前提を暗黙に持ち込まない。
- `full-security-scan` は DAST、ZAP、Nuclei、Schemathesis 等の runtime 条件を伴うため、
  MVP の deep へ自動 mapping しない。

`full-security-scan` は custom profile として capability が満たされる場合だけ選択可能にする。
将来、runtime target と environment readiness を契約化した時点で deep の別 variant を検討する。

### 6.3 registry schema

```ts
type IntegrationScanPreset = {
	id: "quick" | "standard" | "deep";
	displayName: string;
	description: string;
	recommended: boolean;
	targets: Array<{
		kind: "working_tree" | "full";
		profileRef: string;
		estimatedDurationSeconds: {
			min: number;
			max: number;
		};
		toolCategories: string[];
		warnings: string[];
	}>;
};
```

registry は version control 下の code / data とし、route 内へ分散した if 文にしない。
profile registry に対する参照整合性 test を追加する。

表示文言を NightWorkers 側で固定し過ぎないよう display name、description、warning を返すが、
stable semantic ID は英字 enum とする。

### 6.4 selectable custom profiles

capabilities は integration policy で許可された profile だけを返す。

- internal / experimental profile は既定で非公開
- target kind が非対応の profile は selector から除外または disabled reason を返す
- runtime precondition を `requirements` として返す
- profileRef は opaque string として扱わせる
- NightWorkers request で渡された profileRef は allowlist に再照合する

## 7. integration authentication

### 7.1 `integration_clients`

service credential は新規 table で管理する。

| column | 意味 |
| --- | --- |
| `id` | integration client UUID |
| `name` | operator-facing name |
| `owner_user_id` | vulnWorkbench project owner と照合する user |
| `token_prefix` | operator 識別用の非秘密 prefix |
| `token_hash` | 強い one-way hash |
| `scopes_json` | granted scopes |
| `allowed_roots_json` | optional client-specific root 制約 |
| `rate_limit_policy_json` | bounded policy |
| `active` | revoke 状態 |
| `expires_at` | optional expiry |
| `last_used_at` | audit |
| `created_at` / `updated_at` | timestamp |

推奨 scope:

- `nightworkers:security-scan:read`
- `nightworkers:security-scan:write`
- `nightworkers:security-report:read`
- `nightworkers:security-report:write`

read/write を分離し、report scope を scan scope から分離する。

### 7.2 token 発行

CLI を追加する。

```text
bun run api/cli/integration-client.ts create \
  --name nightworkers-local \
  --owner-user <user-id> \
  --scope nightworkers:security-scan:read \
  --scope nightworkers:security-scan:write \
  --scope nightworkers:security-report:read \
  --scope nightworkers:security-report:write
```

- plaintext token は作成時に一度だけ表示する。
- DB には hash だけ保存する。
- list は prefix、scope、active、last used のみ表示する。
- revoke / rotate を提供する。
- CLI output と shell history への扱いを runbook に記載する。
- NightWorkers は plaintext を OS secret store に保存する。

### 7.3 middleware

integration route 専用 middleware は次を行う。

1. bearer token parse
2. constant-time 相当の token hash verify
3. active / expiry verify
4. operation scope verify
5. rate limit
6. request ID
7. audit context

既存 user cookie/JWT を service credential の代替にしない。

global CSRF middleware は integration bearer route だけを明示的に除外する。
除外は path prefix だけでなく、integration authentication が成立した route group に限定する。
通常の user-facing `/api/*` の CSRF を弱めない。

## 8. project path と owner authorization

NightWorkers は登録 Repository の canonical path を送るが、provider 側でも検証する。

1. request の `projectPath` が absolute であることを検証する。
2. filesystem の canonical path を取得する。
3. client-specific allowed roots が設定されている場合だけ、その scope を検証する。
4. symlink / `..` による越境を canonical path 比較で拒否する。
5. owner user が path に対応する vulnWorkbench project を利用可能か確認する。
6. 既存 project がなければ integration policy に従って作成する。

MVP の推奨 policy は次の通り。

- existing project があれば再利用
- client owner と project owner が一致しなければ拒否
- 自動作成は明示 config が有効な場合だけ許可
- 自動作成時も client-specific allowed roots（設定時）、real path、repository metadata を検証
- path だけで別 owner の project を横取りしない

request path を log / metric label に平文で残さない。必要なら hash または basename を用いる。

### 8.1 integration resource binding

scan start 時に、scan run と integration client の構造的 provenance を保存する。
既存 scan row に integration 固有 column を散らさない場合は、次の binding table を追加する。

| column | 意味 |
| --- | --- |
| `integration_client_id` | resource を作成した client |
| `resource_type` | `scan_run` / `scan_report` |
| `resource_id` | provider internal FK |
| `project_id` | 解決済み project FK |
| `owner_user_id` | start 時に確定した owner |
| `created_at` | timestamp |

unique:

```text
(resource_type, resource_id)
```

run detail、events、cancel、findings、report の全 endpoint は、opaque ref の存在だけでなく
current integration client と resource binding の一致を検証する。別 client が同じ owner を
指していても、MVP では他 client が作成した resource を読めない。credential rotation は
同じ integration client ID の token を更新するため、既存 binding を維持する。

## 9. versioned API

base path:

```text
/api/integrations/nightworkers/v1
```

全 response envelope:

```ts
type IntegrationEnvelope<T> = {
	contractVersion: 1;
	requestId: string;
	data: T;
};
```

全 error envelope:

```ts
type IntegrationErrorEnvelope = {
	contractVersion: 1;
	requestId: string;
	error: {
		code: string;
		message: string;
		retryable: boolean;
		details?: Record<string, unknown>;
	};
};
```

`details` は allowlisted field に限定し、absolute path、token、source、finding evidence、
tool stdout/stderr を含めない。

### 9.1 endpoint 一覧

| Method | Path | scope | 用途 |
| --- | --- | --- | --- |
| `POST` | `/capabilities` | `nightworkers:security-scan:read` | path に対する preset / profile / target 能力 |
| `POST` | `/scans/preview` | `nightworkers:security-scan:read` | target digest、profile 解決、warning |
| `POST` | `/scans` | `nightworkers:security-scan:write` | idempotent scan start |
| `GET` | `/scans/:scanRunRef` | `nightworkers:security-scan:read` | run status / summary |
| `GET` | `/scans/:scanRunRef/events` | `nightworkers:security-scan:read` | sequence pagination |
| `POST` | `/scans/:scanRunRef/cancel` | `nightworkers:security-scan:write` | cancel |
| `GET` | `/scans/:scanRunRef/findings` | `nightworkers:security-scan:read` | finding pagination / filter |
| `GET` | `/scans/:scanRunRef/reports` | `nightworkers:security-report:read` | report list |
| `POST` | `/scans/:scanRunRef/reports` | `nightworkers:security-report:write` | async report start |
| `GET` | `/scans/:scanRunRef/reports/:reportRef` | `nightworkers:security-report:read` | metadata |
| `GET` | `/scans/:scanRunRef/reports/:reportRef/content` | `nightworkers:security-report:read` | Markdown content |

NightWorkers が開始した scan 履歴の正本は NightWorkers の binding から辿れるため、
project path 全 scan の list endpoint は MVP 必須にしない。将来追加する場合は、
別 client が開始した scan の可視性と owner policy を先に定義する。

### 9.2 capabilities

request:

```json
{
  "projectPath": "/canonical/repository/path"
}
```

response data:

```ts
type Capabilities = {
	provider: { id: "vulnworkbench"; version: string };
	project: { ref: string; displayName: string };
	presets: IntegrationScanPreset[];
	selectableProfiles: Array<{
		ref: string;
		name: string;
		description: string;
		supportedTargets: Array<"working_tree" | "full">;
		requirements: string[];
		warnings: string[];
	}>;
	limits: {
		maxConcurrentScansForClient: number;
		maxFindingPageSize: number;
		maxEventPageSize: number;
		maxReportBytes: number;
	};
};
```

### 9.3 preview

request:

```ts
type PreviewRequest = {
	projectPath: string;
	selection:
		| { mode: "preset"; presetId: "quick" | "standard" | "deep" }
		| { mode: "custom"; profileRef: string };
	target: { kind: "working_tree" | "full" };
};
```

response data:

```ts
type PreviewResponse = {
	previewRef: string;
	resolvedProfileRef: string;
	target: {
		kind: "working_tree" | "full";
		digest: string;
		sourceRevision: string | null;
		fileCount: number | null;
	};
	estimatedDurationSeconds: { min: number; max: number };
	toolSteps: Array<{
		id: string;
		name: string;
		category: string;
		required: boolean;
		availability: "available" | "unavailable" | "conditional";
		reason?: string;
	}>;
	warnings: string[];
	expiresAt: string;
};
```

preview は side-effect free とし、scan row や project artifact を作らない。

### 9.4 scan start

header:

```text
Idempotency-Key: <uuid>
```

request:

```ts
type StartScanRequest = {
	projectPath: string;
	selection:
		| { mode: "preset"; presetId: "quick" | "standard" | "deep" }
		| { mode: "custom"; profileRef: string };
	target: { kind: "working_tree" | "full" };
	previewRef: string;
	expectedTargetDigest: string;
};
```

response:

- `202 Accepted`
- 既存 idempotent result の replay は同じ run ref を返す。

```ts
type StartScanResponse = {
	scanRunRef: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	resolvedProfileRef: string;
	target: {
		kind: "working_tree" | "full";
		digest: string;
		sourceRevision: string | null;
	};
	createdAt: string;
	replayed: boolean;
};
```

preview の expiry、project、selection、target digest が start 時に一致することを検証する。
不一致は `target_digest_mismatch` または `preview_expired` とし、scan を作らない。

### 9.5 run detail

```ts
type ScanRunDetail = {
	scanRunRef: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	outcome:
		| "findings_present"
		| "no_findings"
		| "inconclusive"
		| "unavailable"
		| null;
	presetId: "quick" | "standard" | "deep" | null;
	profileRef: string;
	target: {
		kind: "working_tree" | "full";
		digest: string;
		sourceRevision: string | null;
	};
	progress: {
		completedSteps: number;
		totalSteps: number;
		currentStep: string | null;
	};
	summary: {
		findingCount: number;
		severityCounts: {
			critical: number;
			high: number;
			medium: number;
			low: number;
			info: number;
			unknown: number;
		};
		coverage: {
			completed: number;
			skipped: number;
			failed: number;
			gaps: Array<{ code: string; message: string }>;
		};
	} | null;
	lastEventSeq: number;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
};
```

`no_findings` は全 required step が十分に完了した場合でも「安全」を意味しない。
required step failure / skip があれば、finding 0 件でも `inconclusive` を優先する。

### 9.6 events

```text
GET .../events?afterSeq=42&limit=100
```

```ts
type ScanEventPage = {
	items: Array<{
		seq: number;
		level: "debug" | "info" | "warning" | "error";
		type: string;
		message: string;
		stepRef: string | null;
		createdAt: string;
	}>;
	nextAfterSeq: number;
	hasMore: boolean;
};
```

- `seq` は scan run 内で 1 から単調増加する。
- 同じ run 内で unique。
- page は `seq ASC`。
- `afterSeq` は exclusive。
- message / data は integration-safe projection にし、raw stdout/stderr を返さない。

### 9.7 findings

```text
GET .../findings?cursor=...&limit=100&severity=high&tool=semgrep
```

```ts
type FindingPage = {
	items: Array<{
		ref: string;
		severity:
			| "critical"
			| "high"
			| "medium"
			| "low"
			| "info"
			| "unknown";
		title: string;
		category: string | null;
		tool: string;
		ruleId: string | null;
		location: {
			path: string | null;
			startLine: number | null;
			endLine: number | null;
		};
		description: string | null;
		evidence: string | null;
		recommendation: string | null;
		references: string[];
	}>;
	nextCursor: string | null;
};
```

- cursor は opaque かつ tamper-evident にする。
- page size に上限を設ける。
- absolute path は repository-relative path に変換する。
- raw secret finding の evidence は redact policy を通す。
- references は safe URL scheme だけを返す。

### 9.8 cancel

- terminal scan への cancel は current run detail を idempotent に返す。
- queued は queue から除去し `cancelled` にする。
- running は supervisor に signal し、runner が確定した terminal state を保存する。
- cancel と completion の競合時は repository の monotonic transition を用いる。

### 9.9 report

start request:

```ts
type StartReportRequest = {
	summaryMode: "deterministic_with_llm_summary";
};
```

header に `Idempotency-Key` を必須とし、`202` で直ちに返す。

report metadata:

```ts
type ReportDetail = {
	reportRef: string;
	scanRunRef: string;
	status: "queued" | "running" | "completed" | "failed";
	summaryMode: "deterministic_with_llm_summary";
	title: string | null;
	llm: {
		provider: string;
		model: string;
	} | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	content: {
		mediaType: "text/markdown";
		byteLength: number;
		sha256: string;
	} | null;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
};
```

content endpoint:

- completed report だけ取得可能
- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition` の filename を sanitize
- configured maximum bytes を超える場合は structured error
- content hash を metadata と照合可能

## 10. idempotency

### 10.1 永続化

`integration_idempotency_keys` を追加するか、scan / report row に client と key を保存する。
正本として最低限次を持つ。

| column | 意味 |
| --- | --- |
| `integration_client_id` | credential owner |
| `operation` | scan_start / report_start |
| `idempotency_key` | UUID |
| `request_hash` | canonical request hash |
| `resource_type` | scan / report |
| `resource_id` | provider internal ID |
| `created_at` / `expires_at` | retention |

unique:

```text
(integration_client_id, operation, idempotency_key)
```

### 10.2 規則

- 同一 key、同一 canonical request は同じ resource を返す。
- 同一 key、異なる request hash は `idempotency_conflict`。
- HTTP response を送る前に idempotency row と resource 作成を同一 transaction で確定する。
- process crash 後も replay できる。
- retention 中の row を cleanup しても、active resource の key は削除しない。
- token rotation 後も同一 integration client ID なら replay 可能にする。

## 11. event sequence migration

### 11.1 schema

`scan_events` に `seq` を追加する。

- type: non-negative integer / bigint
- unique: `(scan_run_id, seq)`
- index: `(scan_run_id, seq)`
- list ordering: `seq ASC`

既存 row の backfill は scan ごとに deterministic order
`created_at ASC, id ASC` で 1 から採番する。

### 11.2 append

event repository は transaction 内で次 sequence を割り当てる。

推奨:

- scan run row に `last_event_seq` を保持
- row lock または DB の atomic increment
- increment 結果を event insert に使う

`MAX(seq) + 1` の非同期 race に依存しない。

### 11.3 compatibility

- 既存 user-facing event response は必要に応じて `seq` を追加して backward compatible にする。
- migration 完了前は provider route を有効化しない。
- duplicate / gap detection test を追加する。

## 12. async report runner

### 12.1 lifecycle

```text
route
  -> validate scan / scope / idempotency
  -> create queued report
  -> enqueue
  -> 202

ScanReportRunner
  -> claim queued report
  -> running
  -> build deterministic report
  -> optional LLM summary
  -> store content / metadata
  -> completed | failed
```

### 12.2 recovery

- startup 時に stale `running` report を検出する。
- retry-safe な段階なら queued に戻す。
- external LLM call の完了有無が不明なら、request id / provider idempotency を利用する。
- 安全に再開できない場合は `report_interrupted` で failed にし、本文や元の provider response を
  失わない。
- retryable な一時障害だけ bounded retry する。
- shutdown で新規 claim を止め、実行中 job に bounded grace period を与える。

### 12.3 concurrency

- scan process と report generation の concurrency pool を分ける。
- integration client / owner / global の上限を設ける。
- queue position の厳密値を保証しない場合、API に虚偽の position を返さない。

## 13. security outcome と coverage

provider が outcome を決定する。

| 条件 | outcome |
| --- | --- |
| required coverage が満たされ finding > 0 | `findings_present` |
| required coverage が満たされ finding = 0 | `no_findings` |
| required tool failure / timeout / significant skip | `inconclusive` |
| result を復元・参照できない | `unavailable` |

execution `failed` と outcome `inconclusive` は同義ではない。
一部 tool が失敗しても scan lifecycle が `completed` となる設計なら、outcome で不完全性を示す。

coverage gap code は機械判定可能な安定値にする。

- `tool_unavailable`
- `tool_failed`
- `tool_timed_out`
- `target_unsupported`
- `runtime_not_configured`
- `result_incomplete`

人向け message だけを解析させない。

## 14. schema と module boundary

canonical wire schema:

```text
shared/schemas/nightworkers-security-scan-integration.schema.ts
```

想定 module:

```text
api/modules/integrations/nightworkers/
  index.ts
  nightworkers-integration.routes.ts
  nightworkers-integration.service.ts
  nightworkers-integration.schemas.ts
  nightworkers-integration.errors.ts
  nightworkers-integration-auth.middleware.ts
  nightworkers-integration-project-resolver.ts
  nightworkers-scan-preset-registry.ts
  nightworkers-integration-projection.ts

api/modules/integrationClients/
  integration-client.repository.ts
  integration-client.service.ts
  integration-client-token.ts

api/modules/reports/
  scan-report-runner.ts
```

既存 scan / finding / report repository の内部 row を route から直接返さない。
integration projection を通し、field allowlist、redaction、relative path 化を行う。

NightWorkers repository から runtime import しない。schema fixture は release artifact または
copy とし、contract version と fixture hash で互換性を検証する。

## 15. structured error

最低限次を安定 code とする。

| code | HTTP | retryable |
| --- | --- | --- |
| `integration_unauthorized` | 401 | false |
| `integration_scope_denied` | 403 | false |
| `project_path_denied` | 403 | false |
| `project_not_found` | 404 | false |
| `project_owner_mismatch` | 403 | false |
| `preset_not_found` | 422 | false |
| `profile_not_allowed` | 422 | false |
| `target_not_supported` | 422 | false |
| `preview_expired` | 409 | true |
| `target_digest_mismatch` | 409 | true |
| `idempotency_conflict` | 409 | false |
| `scan_capacity_exceeded` | 429 | true |
| `scan_not_found` | 404 | false |
| `scan_not_reportable` | 422 | false |
| `report_too_large` | 413 | false |
| `provider_temporarily_unavailable` | 503 | true |
| `internal_error` | 500 | depends |

予期しない error の stack、SQL、path、tool output を response に含めない。

## 16. audit と observability

### 16.1 audit

side effect operation で次を残す。

- timestamp
- integration client ID
- owner user ID
- scope
- operation
- request ID
- project ref
- path hash
- idempotency key hash
- resource ref
- outcome / error code

token、source、finding evidence、report Markdown は残さない。

### 16.2 metrics

- integration request count / latency / status
- auth / scope denial
- path policy denial
- idempotency replay / conflict
- scan queue / running / duration
- event append / duplicate failure
- finding page latency / size
- report queue / duration / retry / failure
- rate / concurrency rejection

client name、profile、target kind 程度の bounded dimension に限定する。
project path や arbitrary error message を label にしない。

## 17. 実装ゲート

### V0. contract と fixture

- v1 schema、enum、error、example fixture を追加する。
- NightWorkers companion plan と mapping を review する。
- integration routes feature flag を追加する。

完了条件:

- schema parse test がある。
- success / error / unknown enum / large payload fixture がある。
- feature off で既存 API が変わらない。

### V1. integration credential

- table / migration、hash、scope、expiry、revoke を実装する。
- create / list / revoke / rotate CLI を実装する。
- dedicated auth middleware と audit context を実装する。

完了条件:

- plaintext token は作成時以外に取得できない。
- scope 不足を route ごとに拒否する。
- 通常 user API の CSRF / auth が弱まらない。

### V2. project resolver と capability

- client-specific allowed roots / realpath / owner resolver を実装する。
- preset registry と custom profile allowlist を実装する。
- standard + working_tree 用の `diff-basic-security` profile と profile test を追加する。
- capabilities route を実装する。

完了条件:

- symlink、`..`、別 owner、root prefix collision を拒否する。
- registry の全 profile ref が存在する。
- `diff-basic-security` が OSV / Trivy を required とし、diff target だけを受け付ける。
- deep + working_tree を unsupported として返す。

### V3. preview と idempotent scan start

- side-effect-free preview、digest、expiry を実装する。
- integration idempotency persistence を実装する。
- existing scan application service を経由して start する。

完了条件:

- preview は scan / artifact row を作らない。
- digest mismatch 時に scan を作らない。
- concurrent duplicate request が一つの scan になる。

### V4. run projection、event sequence、cancel

- run detail projection を実装する。
- event sequence migration / append / pagination を実装する。
- integration-safe event projection を実装する。
- idempotent cancel を実装する。

完了条件:

- event に duplicate sequence と polling gap がない。
- raw stdout/stderr を integration response に返さない。
- cancel / completion race が terminal state を巻き戻さない。

### V5. findings と outcome

- outcome / coverage policy を実装する。
- cursor-paginated finding projection と filter を実装する。
- relative path / secret evidence / URL sanitization を実装する。

完了条件:

- 0 finding + tool failure が `no_findings` にならない。
- large result を bounded page で取得できる。
- cursor 改ざんを拒否する。

### V6. async report

- `ScanReportRunner`、queue、claim、recovery を実装する。
- report idempotency を実装する。
- metadata / content route を実装する。
- summary mode を `deterministic_with_llm_summary` に閉じる。

完了条件:

- report start が LLM 完了を待たず `202` を返す。
- restart 後に running report が recovery policy に従う。
- content hash / byte length が一致する。

### V7. hardening

- rate / concurrency limit
- request / response size limit
- audit / metrics
- load / security / failure injection test
- runbook

完了条件:

- slow consumer、provider restart、LLM timeout で resource leak がない。
- token revoke が新規 request に即時反映される。

### V8. canary と公開

- local NightWorkers client を作成する。
- internal project で quick / standard を canary する。
- deep / custom、report を段階的に有効化する。
- compatibility matrix を release notes に記載する。

完了条件:

- duplicate scan、event lag、report failure、resource usage が許容範囲。
- rollback / credential revoke drill を完了する。

## 18. 検証計画

### 18.1 schema / contract

- request / response parse
- required field
- unknown enum
- contract version
- timestamp / count bounds
- error details allowlist
- fixture compatibility with NightWorkers

### 18.2 authentication / authorization

- missing / malformed / invalid / expired / revoked token
- wrong scope
- token rotation
- 別 integration client の scan / report ref
- owner mismatch
- client-specific allowed root scope
- symlink escape
- prefix collision (`/repo/a` と `/repo/ab`)
- CSRF bypass が integration group 外へ波及しない

### 18.3 idempotency / concurrency

- sequential replay
- concurrent replay
- same key / different request
- response disconnect 後の replay
- process restart 後の replay
- token rotation 後の replay
- scan / report operation namespace 分離

### 18.4 target

- clean working tree
- staged / unstaged / untracked
- binary / deleted / renamed file
- digest mismatch
- preview expiry
- full snapshot revision
- unsupported preset / target
- runtime-dependent custom profile requirement

### 18.5 events

- concurrent append
- backfill ordering
- `afterSeq` exclusive
- limit
- no duplicate / no gap
- empty page
- terminal event
- raw output redaction

### 18.6 findings

- severity / tool filter
- stable cursor pagination
- large result
- path relative projection
- secret evidence redaction
- unsafe reference URL
- unavailable / partial result
- outcome / coverage matrix

### 18.7 reports

- async 202
- queued / running / completed / failed
- duplicate start
- LLM timeout / rate limit / malformed response
- runner restart recovery
- large content rejection
- media type / filename
- hash / byte length
- no report before reportable scan state

### 18.8 non-regression

- existing Web scan screen
- existing scan CLI
- `ScanProcessSupervisor`
- current user auth / CSRF
- reports / reviews / artifacts
- git diff target behavior
- Static Intelligence endpoints

## 19. end-to-end acceptance scenario

1. operator が NightWorkers 用 integration client を作成する。
2. token を NightWorkers OS secret store に登録する。
3. NightWorkers が capabilities を取得する。
4. `standard` + `working_tree` を preview する。
5. provider が `diff-basic-security`、digest、warning を返す。
6. 同じ digest と idempotency key で scan を start する。
7. NightWorkers が events を `afterSeq` で追跡する。
8. scan 完了後、outcome、severity、coverage、findings を取得する。
9. report を start し、即時 `202` を受ける。
10. report 完了後、metadata と Markdown content を取得する。
11. 両 process を restart し、同じ refs から結果を復元する。
12. token を revoke し、新規 request が拒否されることを確認する。

## 20. rollout と rollback

### 20.1 rollout

1. DB migration を適用する。
2. integration route feature flag off で deploy する。
3. event sequence backfill と invariant check を行う。
4. integration client を発行し、capabilities / preview の read-only canary を行う。
5. quick / standard scan write scope を有効化する。
6. deep / custom を有効化する。
7. report read/write scope を有効化する。
8. metrics と audit を確認し一般利用へ進める。

### 20.2 rollback

- route feature flag を off にする。
- integration token を revoke する。
- active scan は既存 vulnWorkbench UI / supervisor から管理可能にする。
- event `seq` と integration table は旧 binary が無視できる additive schema とする。
- report runner を止める場合、queued / running row を削除せず recovery 対象として保持する。
- rollback のために finding / report content を削除しない。

## 21. リスクと対策

| リスク | 対策 |
| --- | --- |
| service token が user 権限を迂回 | owner user、scope、allowed roots、audit を必須化 |
| CSRF 除外が広すぎる | dedicated authenticated route group だけ除外 |
| path による project 横取り | realpath、allowed roots、owner 一致 |
| preset mapping が暗黙に変化 | registry version control、capability fixture、release note |
| deep が DAST を実行し環境へ影響 | MVP は detailed-security、full-security-scan は custom + requirements |
| retry で scan / LLM cost が重複 | persistent idempotency と request hash |
| event polling の欠落 | transactionally assigned sequence |
| report request が長時間 block | dedicated async runner |
| 0 finding を安全と誤認 | outcome / coverage policy |
| finding で secret が流出 | integration projection と evidence redaction |
| consumer が内部 DB field に依存 | versioned allowlisted schema |
| NightWorkers 障害が scan を壊す | provider が lifecycle と正本を所有 |

## 22. PR 分割案

1. `feat(integrations): define NightWorkers security scan v1 contract`
2. `feat(integrations): add scoped integration clients`
3. `feat(integrations): resolve NightWorkers projects and expose capabilities`
4. `feat(integrations): add preview and idempotent scan start`
5. `feat(scans): add ordered event sequence and integration projection`
6. `feat(integrations): expose paginated findings and security outcome`
7. `feat(reports): run scan reports asynchronously`
8. `feat(integrations): expose report metadata and Markdown content`
9. `docs(integrations): add NightWorkers setup, rotation, and rollback runbook`

NightWorkers 側 PR には対応する contract fixture version / commit を渡す。

## 23. Definition of Done

- [ ] `/api/integrations/nightworkers/v1` が feature flag 下で提供される。
- [ ] integration token は hash 保存され、scope、owner、expiry、revoke を持つ。
- [ ] 通常 user API の auth / CSRF が弱まっていない。
- [ ] canonical path、allowed roots、symlink、owner を検証する。
- [ ] quick / standard / deep と target ごとの mapping が registry に一元化される。
- [ ] `full-security-scan` を deep へ暗黙 mapping しない。
- [ ] custom profile は allowlist と requirements を検証する。
- [ ] preview は side effect を作らない。
- [ ] scan / report start は restart をまたいで idempotent である。
- [ ] scan と report は `202` で非同期実行される。
- [ ] event は run 内で sequence 順に再開可能である。
- [ ] cancel / completion race で terminal state が巻き戻らない。
- [ ] execution status と security outcome が分離される。
- [ ] coverage 不足時に `no_findings` と断定しない。
- [ ] finding は bounded cursor pagination と redaction を通る。
- [ ] report Markdown の media type、size、hash が検証できる。
- [ ] raw internal row、stdout/stderr、token、absolute path を response / log に漏らさない。
- [ ] existing Web / CLI / scan / report / Static Intelligence の non-regression test が通る。
- [ ] NightWorkers fixture との contract test が通る。
- [ ] canary、monitoring、rollback、token rotation / revoke 手順が文書化される。
