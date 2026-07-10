# NightWorkers CLI Diagnostic Contract Instructions

## Purpose

NightWorkers など別DBの orchestration system から、vulnWorkbench を CLI 経由の Security Oracle として呼び出せるようにする。

今回固定する前提は、呼び出し元と vulnWorkbench が別プロジェクト・別DBであること。
そのため、呼び出し元DBの repository id と vulnWorkbench DB の project id を事前に対応づける方式を contract にしない。

## Problem To Avoid

次の形は採用しない。

```text
NightWorkers repositoryId
  -> env JSON map
  -> vulnWorkbench projectId
  -> scan
```

理由:

- NightWorkers の repository id は NightWorkers DB の内部IDであり、vulnWorkbench から見て意味がない。
- vulnWorkbench の project id も vulnWorkbench DB の内部IDであり、外部 orchestrator が永続的に知るべき値ではない。
- CLI integration なのに、別DB同士の内部ID同期が必要になる。
- project が既に vulnWorkbench に存在していても、map がないだけで `not configured` になってしまう。

この状態は「vulnWorkbench が未設定」ではなく、CLI 境界の設計不備として扱う。

## Required Contract

外部呼び出し元は repo path を渡す。
vulnWorkbench CLI は repo path から project を解決し、必要なら作成してから scan を実行する。
呼び出し元から渡してよいのは対象 repository path だけにする。
profile、review policy、format、timeout、provider 設定、DB 接続情報、外部 project id などは NightWorkers primary flow の入力にしない。

```text
NightWorkers / external agent
  -> vulnWorkbench CLI with --project-path /path/to/repo
  -> vulnWorkbench resolves or creates project
  -> scan profile runs
  -> vulnWorkbench-owned reporting/review policy runs if enabled internally
  -> stable JSON result is returned
```

必須原則:

- `--project-path` を primary input にする。
- `oracle:security` の外部入力は `--project-path` だけにする。
- `--project-id` は内部利用・既存互換用に残してよいが、NightWorkers 向け primary flow の必須入力にしない。
- 外部DBの内部IDを必須入力にしない。
- `DATABASE_URL`、API key、provider 設定、profile/review/format/timeout tuning を呼び出し元から受け取る contract にしない。
- project resolve / create は vulnWorkbench 側の責務にする。
- stdout は JSON object 1 件だけにする。
- progress、warning、stack trace、human-readable log は stderr または artifact に出す。
- scan が実行された場合は `scanRunId` を必ず返す。
- review を実行した場合は `reviewId` または review status を返す。
- provider 未設定や review 失敗時も、scan result を捨てずに JSON 内で degraded state として返す。
- finding 本文は stdout JSON の `scan.findings[]` に含め、呼び出し元に report artifact を読ませない。
- `reportPath` は外部 contract に含めない。
- finding の location は `--project-path` で指定された repository 内の相対 path だけを返す。repository 外を指す location は `null` にする。

## Target CLI Shape

最終的には 1 command で NightWorkers が使える形を持つ。

```bash
bun run oracle:security -- --project-path /path/to/repo
```

`oracle:security` は外部 orchestrator からの profile/review/format/timeout 指定を受け付けない。
それらは vulnWorkbench 側の内部 policy として管理する。

互換的な分割 flow を残す場合も、最初の scan command は repo path を受けられる必要がある。

```bash
bun run scan:profile -- \
  --project-path /path/to/repo \
  --create-project true \
  --profile agent-output \
  --json

bun run review:scan -- \
  --scan-run-id <scan-run-id> \
  --task scan_review \
  --json
```

`scan:profile --project-id ...` は既存UI/APIや手動運用向けの互換 path として扱う。
NightWorkers 向けには `--project-path` または `oracle:security --project-path` を正本にする。

## Project Resolution Rules

`--project-path` を受けた CLI は次の順で処理する。

1. path を絶対パスへ正規化する。
2. symlink や `..` を解決し、同じ repo が別表記で重複登録されないようにする。
3. vulnWorkbench DB の `projects.repo_path` と照合する。
4. 一致する project があればそれを使う。
5. 見つからず `--create-project true` または oracle command の auto-create policy が有効なら project を作成する。
6. 見つからず auto-create が無効なら exit code 2 で stable JSON failure を返す。

project name は path basename を初期値にしてよい。
default branch は git から解決できる場合だけ使い、失敗しても scan 実行可否を不必要に止めない。

## JSON Result Shape

NightWorkers が最低限読める shape を固定する。

```ts
type SecurityOracleResult = {
  ok: boolean;
  status:
    | "completed"
    | "security_action_required"
    | "inconclusive"
    | "config_error"
    | "runtime_error";
  project: {
    id: string;
    repoPath: string;
    created: boolean;
  } | null;
  scan: {
    scanRunId: string;
    profile: string;
		findingCount: number;
		highOrCriticalCount: number;
		findings: Array<{
			id: string;
			severity: string;
			tool: string;
			ruleId: string;
			title: string;
			location: { path: string; line: number | null } | null;
			recommendation: string;
		}>;
  } | null;
  review: {
    status: "not_requested" | "completed" | "failed" | "skipped";
    reviewId?: string;
    improvementRequest?: string;
    error?: string;
  };
  nextAction:
    | "none"
    | "apply_security_fix"
    | "run_scan_review"
    | "configure_provider"
    | "inspect_diagnostic_failure";
  error?: {
    code: string;
    message: string;
  };
};
```

Notes:

- `project.id` は返してよいが、呼び出し元が次回の primary key として保存する前提にしない。
- 次回も `--project-path` で呼べることを contract にする。
- `ok=false` でも `scan` が存在する場合がある。scan success と review/provider failure を分ける。
- 警告内容は `scan.findings[]` だけで判断できる。呼び出し元は vulnWorkbench の artifact path や report file を開かない。
- `scan.findings[].location.path` は対象 repository からの相対 path であり、対象外 path は公開しない。

## Exit Codes

NightWorkers 向け command は次の分類を維持する。

| Code | Meaning |
| ---: | --- |
| 0 | usable result, no blocking security action |
| 1 | tool/runtime failure |
| 2 | policy/config error, including missing project with auto-create disabled |
| 3 | scan/review succeeded and security action is required |
| 4 | scan result is usable but coverage is inconclusive |

exit code 3 は process failure ではない。
NightWorkers は JSON を読んで修正依頼へ進む。

## Implementation Notes

優先して追加するもの:

- `api/modules/scans/project-resolver.ts`
  - `resolveProjectByPath(db, projectPath, options)` を持つ。
  - path normalization と create policy を集約する。
- `api/cli/oracle-security.ts`
  - `--project-path` primary input。
  - 外部引数は `--project-path` だけにする。
  - scan -> vulnWorkbench-owned reporting/review policy -> JSON output をまとめる。
- `api/cli/scan-profile.ts`
  - 互換維持しつつ `--project-path` と `--create-project` を受ける。
- tests
  - 別DB内部IDなしで repo path だけから scan まで到達する fixture。
  - project 未存在 + create enabled で project 作成される fixture。
  - project 未存在 + create disabled で exit code 2 + JSON failure。
  - `oracle:security` に profile/review/format/timeout を渡すと exit code 2 + JSON failure になる fixture。

実装時にやらないこと:

- NightWorkers DB を読まない。
- NightWorkers repository id を受け取らない。
- `NIGHTWORKERS_*_PROJECTS` のような外部DB id map を vulnWorkbench 側の contract にしない。
- `DATABASE_URL` や provider secret を NightWorkers から受け取る integration にしない。
- `oracle:security` の primary flow で profile/review/format/timeout を外部入力にしない。
- MCP を primary path にしない。
- LLM に repository を自由探索させて finding を作らせない。

## Verification Checklist

- `bun run oracle:security -- --project-path <repo>` が stdout JSON only で返る。
- stdout JSON に `reportPath` がなく、finding 本文・根拠・対応が `scan.findings[]` に含まれる。
- stdout JSON の finding location が対象 repository 内の相対 pathだけで、対象外 path を公開しない。
- `bun run oracle:security -- --project-path <repo> --profile agent-output` が exit code 2 + JSON failure で拒否される。
- project が未登録でも auto-create policy により scan へ進める。
- 同じ repo path の2回目実行で project が重複作成されない。
- `bun run scan:profile -- --project-path <repo> --create-project true --profile agent-output --json` が `scanRunId` を返す。
- 外部DBの内部IDを要求するテスト・ドキュメント・README 例が NightWorkers primary flow に残っていない。
