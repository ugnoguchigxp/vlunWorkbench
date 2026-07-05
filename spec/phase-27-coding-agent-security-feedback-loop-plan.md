# Phase 27: Coding Agent Security Feedback Loop Plan

## Purpose

この計画は、vulnWorkbench を NightWorkers / coding agent が生成した成果物に対する Security Feedback Engine として使えるようにするための実装計画である。

中心に置く成果物は、通常の人間向け finding 一覧ではなく、次の agent が修正判断に使える `Improvement Request` とする。

目標は次の 4 つ。

1. NightWorkers から常駐サービスなしで実行できる CLI-first contract を固定する。
2. SQLite / artifacts は vulnWorkbench 内部の storage truth とし、外部 agent には安定した JSON / Markdown handoff を返す。
3. Coding agent 生成物向けの軽量 scan profile と agent-actionability 評価を追加する。
4. 修正後に同じ security request を再検証できる rerun loop を作る。

この phase では、vulnWorkbench を常時起動する MCP server にしない。MCP は後続で、CLI contract を呼ぶ thin wrapper として扱う。

## Product Positioning

vulnWorkbench の NightWorkers 向け役割は Security Oracle である。

```text
NightWorkers / Coding Agent
  -> generated code, config, dependencies, API, UI
  -> vulnWorkbench CLI
    -> Semgrep / Gitleaks / OSV / Trivy / DAST / dynamic verification
    -> SQLite findings / evidence / artifacts / reviews
    -> improvementRequest
  <- strict JSON / Markdown security handoff
  -> Coding Agent fixes the next prioritized item
  -> rerun verification
```

重要な境界:

- Scanner / runtime checks が evidence producer である。
- LLM は保存済み scan bundle を review し、実装改善 request を作る。
- NightWorkers は SQLite schema を直接読まない。
- NightWorkers は CLI stdout の stable JSON / Markdown だけを contract として扱う。
- MCP は optional discovery / interactive access であり、primary automation path ではない。

## CLI vs MCP Decision

Primary path は CLI とする。

理由:

- vulnWorkbench は常時起動アプリではない。
- NightWorkers の自律ループでは process execution、exit code、stdout JSON、stderr diagnostics、artifact path が扱いやすい。
- SQLite はローカルファイルであり、CLI が起動時に migration / read / write / artifact lookup を完結できる。
- MCP server の起動状態、接続状態、tool schema version を NightWorkers の必須依存にしない。

MCP は後続の optional layer とする。

MCP が向く用途:

- Codex / interactive agent から最近の scan run を探す。
- 最新 handoff を読む。
- report / evidence summary を取得する。
- CLI の存在確認や profile 一覧を discovery する。

MCP が初期実装で持たない責務:

- Scanner 実行の primary path。
- SQLite schema 直読み API。
- 常駐前提の queue worker。
- LLM が repository を自由探索して finding を作る path。

## Current Baseline

既存の主導線:

```text
Project
  -> ScanProfile / static tool / DAST
  -> findings / evidence / artifacts
  -> scan_review
  -> scan_reviews.output.improvementRequest
  -> UI / report / copyable handoff
```

既存の関連責務:

- `api/modules/scans/profiles.ts`
  - `baseline`, `source-baseline`, `basic-security`, `dependency-manifest`, `artifact`, `full-deep` などを定義する。
- `api/cli/scan-profile.ts`
  - profile scan を CLI から実行する。
- `api/cli/review-scan.ts`
  - saved scan context から scan-level LLM review を実行する。
- `shared/schemas/scan.schema.ts`
  - `scanReviewOutputSchema` と `improvementRequest` contract を持つ。
- `api/modules/scans/scan-review-prompt.ts`
  - `improvementRequest.handoffPrompt` を standalone 依頼文として生成させる。
- `web/src/domains/scans/scan-improvement-request.ts`
  - UI 側で `improvementRequest` を型安全に取り出し、quality check と Markdown 化を行う。
- `api/modules/scans/report-builder.ts`
  - deterministic Markdown report に handoff を含める。

既存の原則:

- CLI stdout は machine-readable JSON だけにする。
- progress / warning / diagnostics は stderr または artifact に出す。
- LLM review は保存済み context だけを使い、raw repository / runtime state を見たかのように書かせない。

## Non-Goals

- NightWorkers が SQLite table を直接 query すること。
- vulnWorkbench MCP server を常時起動必須にすること。
- LLM が scanner の代わりに repository を自由探索すること。
- 自動 patch application を vulnWorkbench に持たせること。
- CI / remote SaaS integration。
- multi-agent orchestration を vulnWorkbench 側に持つこと。
- 既存 `improvementRequest` を破壊的に置き換えること。

## Target User Flow

NightWorkers からの通常 flow:

```bash
bun run scan:profile -- \
  --project-path /path/to/repo \
  --profile agent-output \
  --json

bun run review:scan -- \
  --scan-run-id <scan-run-id> \
  --task scan_review \
  --json

bun run handoff:scan -- \
  --scan-run-id <scan-run-id> \
  --format json
```

修正後の再検証 flow:

```bash
bun run rerun:scan -- \
  --previous-scan-run-id <scan-run-id> \
  --profile agent-output \
  --json

bun run handoff:scan -- \
  --scan-run-id <new-scan-run-id> \
  --compare-to <scan-run-id> \
  --format markdown
```

NightWorkers から見る成功条件:

- stdout は parse 可能な JSON だけである。
- `scanRunId`, `findingCount`, `reviewId`, `handoff.available`, `handoff.readiness`, `nextAction` が機械判定できる。
- finding が残る場合でも process failure と security action required を区別できる。
- handoff prompt は別 agent にそのまま渡せる。

## CLI Contract

### Exit Codes

NightWorkers 向け CLI は exit code を明示的に分類する。

| Code | Meaning | Use |
| ---: | --- | --- |
| 0 | usable result, no blocking security action | scan/review/handoff が利用可能 |
| 1 | tool/runtime failure | scanner crash, DB failure, unexpected exception |
| 2 | policy/config error | missing profile, invalid target, provider route not configured |
| 3 | security action required | scan/review は成功し、修正対象 handoff が存在する |
| 4 | inconclusive coverage | zero finding だが required diagnostics が不足 |

既存 CLI との互換性を壊す場合は、NightWorkers 用 command だけに exit code 3/4 を導入する。既存 scanner CLI の挙動は段階的に合わせる。

### stdout / stderr

stdout:

- JSON object 1 件のみ。
- Markdown format の場合も、JSON wrapper の中に `markdown` field として入れるか、明示的な `--output` file を使う。
- progress log、provider log、stack trace、human text を混ぜない。

stderr:

- progress。
- warning。
- failed command details。
- stderr tail。

### Handoff JSON Shape

Initial shape:

```ts
type AgentSecurityHandoff = {
  version: "v1";
  project: {
    id: string;
    name: string;
    repoPath: string;
  };
  scan: {
    scanRunId: string;
    profile: string;
    status: "completed" | "failed" | "cancelled";
    createdAt: string;
    completedAt: string | null;
    findingCount: number;
    toolRunCount: number;
  };
  review: {
    reviewId: string | null;
    status: "completed" | "failed" | "missing";
    provider: string | null;
    model: string | null;
  };
  handoff: {
    available: boolean;
    readiness: "ready" | "partial" | "missing";
    title: string;
    objective: string;
    prompt: string;
    markdown: string | null;
    qualityChecks: Array<{
      id: string;
      status: "ready" | "partial" | "missing";
      reason: string;
    }>;
  };
  agentScores: {
    riskSeverity: "critical" | "high" | "medium" | "low" | "info" | "unknown";
    agentActionability: "high" | "medium" | "low" | "unknown";
    evidenceQuality: "high" | "medium" | "low" | "unknown";
    verificationClarity: "high" | "medium" | "low" | "unknown";
    blastRadius: "high" | "medium" | "low" | "unknown";
  };
  nextAction:
    | "fix_security_findings"
    | "run_scan_review"
    | "improve_coverage"
    | "generate_report"
    | "no_action";
  commands: {
    rerun: string;
    review: string;
    report: string;
  };
};
```

Rules:

- `version` を必ず入れる。
- `nextAction` は NightWorkers が分岐できる enum にする。
- `agentScores` は deterministic helper で算出する。LLM 出力を使う場合も schema validation 後に normalize する。
- `markdown` は `--include-markdown true` の時だけ返してよい。
- DB row の raw JSON をそのまま外部 contract にしない。

## Agent Output Scan Profile

新しい profile:

```text
id: agent-output
name: Agent生成物スキャン
category: basic
purpose: NightWorkers / coding agent が生成・変更した成果物を短時間で確認し、次の修正依頼を作る。
```

Initial steps:

- `semgrep`
  - required: true
  - failurePolicy: `fail_profile`
  - options: `{ config: "auto", scanners: ["vuln", "secret", "config"] }`
- `gitleaks`
  - required: true
  - failurePolicy: `fail_profile`
- `osv`
  - required: true
  - failurePolicy: `fail_profile`
  - options: `{ dependencyMode: "manifest" }`
- `trivy`
  - required: false
  - failurePolicy: `warn_and_continue`
  - options: `{ scanners: ["vuln", "secret", "misconfig"] }`
- `dast:http-baseline`
  - required: false
  - failurePolicy: `warn_and_continue`
  - target: `auto_project_start`
  - options: bounded request budget

Scope:

- first-party source。
- configuration。
- manifests / lockfiles。
- generated build output は初期 profile では対象外。
- installed dependency tree は対象外。

Rationale:

- Agent feedback loop では速度と actionability を優先する。
- 深い網羅診断は `full-deep` / `detailed-security` / `full-security-scan` 側に残す。
- DAST は auto target が解決できた時だけ runtime coverage signal として付加する。

## Agent-Actionability Scoring

`improvementRequest` の主役は finding ではなく、次に agent が直すべき作業である。

新しい derived score:

```ts
type AgentActionabilityScores = {
  riskSeverity: "critical" | "high" | "medium" | "low" | "info" | "unknown";
  agentActionability: "high" | "medium" | "low" | "unknown";
  evidenceQuality: "high" | "medium" | "low" | "unknown";
  verificationClarity: "high" | "medium" | "low" | "unknown";
  blastRadius: "high" | "medium" | "low" | "unknown";
};
```

Initial deterministic rules:

- `riskSeverity`
  - max finding severity を基本にする。
  - zero-finding では `info` または `unknown`。
- `agentActionability`
  - implementation task があり、finding IDs または coverage scope があり、acceptance criteria がある場合は上げる。
  - file/path/rule/evidence refs が不足する場合は下げる。
- `evidenceQuality`
  - source location、tool output、reproduction/dynamic/DAST evidence があるほど上げる。
  - tool failure や missing artifact が多い場合は下げる。
- `verificationClarity`
  - verification commands が具体的で、profile rerun command が生成できる場合は上げる。
- `blastRadius`
  - touched tool families、finding count、severity、scope breadth から算出する。

初期実装では DB column を追加しない。`handoff:scan` の response と UI helper の derived model として算出する。

## Implementation Phases

### Phase 0: Baseline Contract Audit

Files:

- `api/cli/scan-profile.ts`
- `api/cli/review-scan.ts`
- `api/modules/scans/scan-review-runner.ts`
- `shared/schemas/scan.schema.ts`
- `web/src/domains/scans/scan-improvement-request.ts`
- `api/modules/scans/report-builder.ts`
- `package.json`

Tasks:

- Existing CLI stdout が JSON only であることを確認する。
- `review:scan` が `improvementRequest` を保存する経路を確認する。
- 最新 completed scan review から handoff を取得する既存 helper を確認する。
- 既存 report export と UI export の contract を確認する。
- NightWorkers 用に再利用できる parser / Markdown builder を UI から server/shared 側へ移せるか確認する。

Verification:

```bash
rg -n "improvementRequest|handoffPrompt|JSON stdout|scan_reviews|review:scan|scan:profile" README.md spec api web/src package.json
bun test api/modules/scans/scan-review-runner.test.ts api/modules/scans/report-builder.test.ts
bunx vitest run web/src/domains/scans/scan-improvement-request.test.ts
```

Completion criteria:

- CLI contract の現状差分が説明できる。
- `improvementRequest` extraction を server-side CLI で再利用する方針が決まっている。

Stop conditions:

- CLI stdout に human log が混ざっている command がある場合、handoff CLI 実装前に修正する。
- `improvementRequest` parser が UI 専用の React state に依存している場合、shared helper 抽出を先に行う。

### Phase 1: Shared Handoff Helper

Files:

- `api/modules/scans/scan-improvement-request.ts` または `shared/scan-improvement-request.ts`
- `web/src/domains/scans/scan-improvement-request.ts`
- `web/src/domains/scans/scan-improvement-request.test.ts`
- `api/modules/scans/scan-improvement-request.test.ts`

Tasks:

- `getScanImprovementRequest`, quality checks, Markdown builder を shared/server-safe helper に分離する。
- UI は shared helper を import するだけにする。
- React / DOM 依存を入れない。
- malformed legacy rows には `missing` view を返す。

Verification:

```bash
bun test api/modules/scans/scan-improvement-request.test.ts
bunx vitest run web/src/domains/scans/scan-improvement-request.test.ts
bun run typecheck
```

Completion criteria:

- CLI と UI が同じ handoff extraction / quality check を使う。
- 旧 row / malformed output で crash しない。

### Phase 2: `agent-output` Scan Profile

Files:

- `api/modules/scans/profiles.ts`
- `api/modules/scans/profile-runner.test.ts`
- `web/src/domains/scans/scan-profile-display.ts`
- `web/src/domains/scans/scan-display-copy.ts`
- `README.md`

Tasks:

- `agent-output` profile を追加する。
- profile display copy に NightWorkers / coding agent 生成物向けであることを追加する。
- dry-run output に steps, required flags, failurePolicy, scope が出ることを確認する。
- DAST auto step は optional / warn とする。

Verification:

```bash
bun test api/modules/scans/profile-runner.test.ts
bun run scan:profile -- --profile agent-output --dry-run true
bun run typecheck
```

Completion criteria:

- `agent-output` profile が CLI / UI で選べる。
- dry-run JSON が NightWorkers から parse できる。
- optional DAST failure が scan 全体を不要に failed にしない。

### Phase 3: Agent Handoff CLI

New command:

```bash
bun run handoff:scan -- \
  --scan-run-id <scan-run-id> \
  --format json \
  --include-markdown true
```

Files:

- `api/cli/handoff-scan.ts`
- `package.json`
- `api/modules/scans/agent-handoff.ts`
- `api/modules/scans/agent-handoff.test.ts`
- `README.md`

Tasks:

- scan run / project / latest completed scan review / findings / tool runs を SQLite から読む。
- shared handoff helper で `improvementRequest` を取り出す。
- `AgentSecurityHandoff` JSON を stdout に返す。
- `--format json`, `--format markdown`, `--output <path>`, `--include-markdown true|false` を追加する。
- `--latest true` で project の latest completed scan を対象にできるようにするか検討する。
- no review の場合は `nextAction: "run_scan_review"` を返す。
- security action が必要な場合は NightWorkers 用 mode で exit code 3 を返せるようにする。

Verification:

```bash
bun test api/modules/scans/agent-handoff.test.ts
bun run handoff:scan -- --scan-run-id <scan-run-id> --format json
bun run handoff:scan -- --scan-run-id <scan-run-id> --format markdown --output /tmp/vulnworkbench-handoff.md
bun run typecheck
```

Completion criteria:

- stdout JSON は single object である。
- latest completed review の `improvementRequest` が response に入る。
- review missing / malformed request / failed scan が machine-readable に分岐できる。
- Markdown は file output か JSON field として扱われ、stdout contract を壊さない。

### Phase 4: Agent-Actionability Scores

Files:

- `api/modules/scans/agent-actionability.ts`
- `api/modules/scans/agent-actionability.test.ts`
- `api/modules/scans/agent-handoff.ts`
- `web/src/domains/scans/decision-grade-view.ts`
- `web/src/domains/scans/components/scan-improvement-request-panel.tsx`

Tasks:

- deterministic scoring helper を追加する。
- `handoff:scan` response に `agentScores` を追加する。
- UI では `agentActionability`, `evidenceQuality`, `verificationClarity` を handoff panel に表示する。
- score は LLM の自由文を parse せず、保存済み finding / evidence / request fields から算出する。

Verification:

```bash
bun test api/modules/scans/agent-actionability.test.ts
bun test api/modules/scans/agent-handoff.test.ts
bunx vitest run web/src/domains/scans/decision-grade-view.test.ts web/src/domains/scans/scan-improvement-request.test.ts
bun run typecheck
```

Completion criteria:

- 同じ scan data から deterministic に同じ score が出る。
- evidence 不足と verification 不足が別々に表現される。
- finding 0 件でも coverage-oriented score が返る。

### Phase 5: Security Oracle CLI Wrapper

New command:

```bash
bun run oracle:security -- \
  --project-path /path/to/repo \
  --profile agent-output \
  --review true \
  --format json
```

Files:

- `api/cli/oracle-security.ts`
- `package.json`
- `api/modules/scans/security-oracle-runner.ts`
- `api/modules/scans/security-oracle-runner.test.ts`

Tasks:

- project path から existing project を探すか、必要なら作成する。
- `agent-output` scan を実行する。
- `--review true` の時だけ scan review を実行する。
- `handoff:scan` と同じ contract を返す。
- scanner failure、provider failure、security action required、coverage inconclusive を exit code で区別する。
- `--no-review` の場合は scan result と `nextAction: "run_scan_review"` を返す。

Verification:

```bash
bun test api/modules/scans/security-oracle-runner.test.ts
bun run oracle:security -- --project-path /path/to/repo --profile agent-output --review false --format json
bun run oracle:security -- --project-path /path/to/repo --profile agent-output --review true --format json
bun run typecheck
```

Completion criteria:

- NightWorkers が 1 command で scan -> optional review -> handoff まで取得できる。
- provider 未設定時は scan result を捨てず、`review.status: "failed"` と `nextAction` を返す。
- stdout が JSON only である。

### Phase 6: Rerun Verification Loop

New command:

```bash
bun run rerun:scan -- \
  --previous-scan-run-id <scan-run-id> \
  --profile agent-output \
  --format json
```

Files:

- `api/cli/rerun-scan.ts`
- `api/modules/scans/rerun-runner.ts`
- `api/modules/scans/scan-comparison.ts`
- `api/modules/scans/rerun-runner.test.ts`
- `web/src/domains/scans/scan-comparison.ts`

Tasks:

- previous scan run の project / profile / finding fingerprints を読む。
- 同じ project で新しい scan を実行する。
- finding fingerprint / sourceTool / ruleId / primaryLocation を使って resolved / persisted / new を比較する。
- latest handoff に comparison summary を含める。
- NightWorkers 用に `nextAction` を更新する。

Response additions:

```ts
comparison: {
  previousScanRunId: string;
  currentScanRunId: string;
  resolvedFindingCount: number;
  persistedFindingCount: number;
  newFindingCount: number;
  verificationOutcome:
    | "improved"
    | "unchanged"
    | "regressed"
    | "inconclusive";
};
```

Verification:

```bash
bun test api/modules/scans/rerun-runner.test.ts
bun run rerun:scan -- --previous-scan-run-id <scan-run-id> --profile agent-output --format json
bun run typecheck
```

Completion criteria:

- 修正前後で finding が消えたかを machine-readable に返せる。
- new findings と persisted findings を区別できる。
- comparison confidence が低い場合は `inconclusive` にする。

### Phase 7: Optional MCP Thin Wrapper

Files:

- future plugin / MCP package location
- `README.md`
- `docs/project-maintenance.md`

Tasks:

- CLI contract が安定してから MCP tools を追加する。
- MCP tool は CLI を呼び、stdout JSON を parse して返す。
- MCP tool names は最小限にする。

Initial tools:

- `list_recent_security_scans`
- `get_security_handoff`
- `run_security_oracle`
- `rerun_security_scan`

Rules:

- MCP は SQLite を直接 query しない。
- MCP は CLI stdout contract を破らない。
- MCP server 未起動でも NightWorkers の primary flow は動く。

Verification:

```bash
bun run handoff:scan -- --scan-run-id <scan-run-id> --format json
```

Completion criteria:

- MCP は CLI primary path の補助 layer として説明できる。
- MCP がなくても NightWorkers integration は成立する。

## Documentation Updates

Files:

- `README.md`
- `README.jp.md`
- `docs/project-maintenance.md`
- `spec/vuln-workbench-concept.md`

README positioning:

```text
vulnWorkbench is a local-first security feedback engine for coding-agent outputs.

It turns scanner evidence from agent-generated code into actionable improvement requests for LLMs, coding agents, and human reviewers.
```

日本語:

```text
vulnWorkbench は、NightWorkers やコーディングエージェントが生成した成果物を素早くセキュリティ診断し、LLM が次に修正すべき作業を判断できる改善依頼へ変換するローカルファーストのセキュリティワークベンチです。
```

Docs must explain:

- CLI is primary for NightWorkers.
- SQLite is internal storage truth, not external direct-read API.
- `handoff:scan` is the stable agent contract.
- MCP is optional and thin.
- `agent-output` profile is the recommended default for coding-agent feedback loops.
- `oracle:security` is the one-command automation path once implemented.

## End-to-End Acceptance

Run from a clean local checkout with a configured LLM route:

```bash
bun run bootstrap
bun run scan:profile -- --project-path /path/to/repo --profile agent-output --json
bun run review:scan -- --scan-run-id <scan-run-id> --task scan_review --json
bun run handoff:scan -- --scan-run-id <scan-run-id> --format json --include-markdown true
```

Expected:

- scan creates `scan_runs`, `tool_runs`, artifacts, findings / zero-finding coverage context.
- review creates completed `scan_reviews.output.improvementRequest`.
- handoff returns `AgentSecurityHandoff` v1.
- stdout is JSON only.
- `nextAction` tells NightWorkers what to do next.
- `agentScores.agentActionability` is present.

Then after a fix:

```bash
bun run rerun:scan -- --previous-scan-run-id <scan-run-id> --profile agent-output --format json
```

Expected:

- response contains comparison outcome.
- resolved / persisted / new finding counts are explicit.
- verification is `improved`, `unchanged`, `regressed`, or `inconclusive`.

## Final Verification Gate

```bash
git diff --check
bun run typecheck
bun run verify
```

If global `bun run verify` fails due to unrelated existing failures, record:

- command.
- failure summary.
- narrower passing gates.
- why the failure is unrelated.

## Rollout Order

Recommended order:

1. Shared handoff helper.
2. `agent-output` profile.
3. `handoff:scan` CLI.
4. agent-actionability scores.
5. `oracle:security` one-command wrapper.
6. rerun comparison loop.
7. README / README.jp positioning update.
8. optional MCP wrapper.

Do not start with MCP. The stable CLI contract is the product boundary NightWorkers needs.
