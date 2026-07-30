# Phase 49: Professional Web/API Assessment Capability Plan

Status: Proposed

Baseline commit: `21ac65967644543900d77312ccdd33e3f55a3bdc`

Baseline date: 2026-07-30

Owner: vulnWorkbench maintainers

Target: プロの Web/API 診断を置き換えるのではなく、診断担当者が再現可能な自動検査、証跡、手動判断、再診断を一つのワークベンチで管理できる状態にする

## 1. 結論

Phase 49 は、scanner の種類を無差別に増やす計画ではない。

次の順序で、現在弱い「診断能力の深さ」と「外部提出可能な結果の信頼性」を改善する。

1. 何を検査し、何を検査していないかを WSTG / ASVS / API Security control 単位で表現する。
2. scanner の binary、rule、template、脆弱性 DB を scan ごとに再現可能にする。
3. credential を平文の request header として保存しない認証コンテキストを作る。
4. 認証付き read-only browser/API 検査を追加する。
5. 明示的に許可された disposable environment に限り、active scan と複数 role の認可検査を追加する。
6. scanner の再実行と exploit reproduction を別の意味・状態として管理する。
7. 外部提出用 report に、記名 human review と peer approval を要求する。
8. CWE、CVSS、VEX、KEV、EPSS、reachability 等の判断材料を欠落させず保存する。
9. vulnerable / fixed fixture を使い、検出率と誤検知率を継続測定する。

Phase 49 完了時の製品表現は、引き続き次とする。

> vulnWorkbench は、source-available な Web/API に対する AppSec 証跡ワークベンチであり、認証付き自動検査と人間の診断判断を支援する。ネットワーク、クラウド、AD、モバイル、無線、ソーシャルエンジニアリングを含む総合診断や、専門家による手動診断を置き換えない。

## 2. 開始条件

現在の working tree には Phase 48 と NightWorkers provider の未コミット変更が含まれる。
Phase 49 の実装は、それらと同じ working tree で開始しない。

開始条件は次のすべてである。

1. Phase 48 の変更が review 可能な commit に整理されている。
2. NightWorkers provider の変更が merge、別 branch、または明示的な保留状態に分離されている。
3. `git status --short` が clean である。
4. `bun install --frozen-lockfile` が成功する。
5. `bun run verify:strict` が成功する。
6. migration `0017` までの適用と backup verification が成功する。
7. Phase 49 用の次の migration 番号が予約されている。

開始条件を満たさない場合、Phase 49 の production code や DB migration を作らない。
この計画書の追加だけを、既存変更と独立した planning change として扱う。

## 3. 現行能力と不足

### 3.1 既に存在し、再実装しないもの

- Semgrep、Gitleaks、OSV-Scanner、Trivy の static scan
- Trivy の filesystem、image、CycloneDX SBOM mode
- owned Nuclei safe template
- ZAP baseline passive scan
- Schemathesis read-only schema scan
- low-rate HTTP baseline DAST
- DAST target の path、rate、request、timeout、network scope
- scan / tool / artifact / finding / evidence の永続化
- artifact と log の SHA-256
- finding review、finding decision、scan review、report
- reproduction runner、dynamic runner
- scanner stdout/stderr 上限
- Docker memory、CPU、PIDs 上限
- real DB を通る critical-flow browser E2E
- `verify:strict`

### 3.2 Phase 49 で解消する不足

| 領域 | 現状 | Phase 49 の目標 |
| --- | --- | --- |
| Coverage 表現 | profile / step 中心 | WSTG / ASVS / API Security control と未検査理由を表示 |
| Scanner provenance | tool version と一部 image/template pin | rule、DB、template、image を digest 付きで保存 |
| 認証 | secret-bearing header を拒否 | encrypted auth context を参照して実行 |
| Browser | mock adapter、profile disabled | real Playwright adapter、認証付き read-only smoke |
| API | GET / HEAD / OPTIONS のみ | read-only auth と disposable environment の bounded write |
| 認可 | single identity | user A、user B、admin の access matrix |
| Active DAST | ZAP baseline のみ | explicit lab profile で ZAP active/API scan |
| Reproduction | scanner re-run も `reproduced` | recheck、runtime observation、exploit reproduction を分離 |
| Report governance | 生成後すぐ参照可能 | external report は human QA と approval 必須 |
| Finding metadata | tool metadata の一部を破棄 | CWE、CVSS vector、reference、risk context を保持 |
| 品質測定 | contract / fixture test 中心 | vulnerable / fixed corpus による recall / false-positive 測定 |

## 4. 固定する設計判断

### 4.1 実行 mode

診断 mode を次の 3 段階に固定する。

| Mode | 既定 | Credential | State change | 用途 |
| --- | --- | --- | --- | --- |
| `safe_unauthenticated` | 有効 | 不可 | 不可 | 現行の static、passive、read-only scan |
| `authenticated_readonly` | 明示 opt-in | 可 | 不可 | login 後の画面、GET 系 API、role 間差分 |
| `active_lab` | 既定無効 | 可 | allowlist のみ | disposable local / ephemeral / staging 環境 |

`full-security-scan` は `active_lab` を暗黙に有効化しない。
active scan は専用 profile としてのみ開始できる。

### 4.2 Active scan の許可境界

`active_lab` は、次のすべてを満たす場合だけ実行する。

1. target environment が `local`、`ephemeral`、または明示承認された `staging` である。
2. public internet address ではない。
3. project owner が Rules of Engagement を保存している。
4. allowed path と allowed method が空でない。
5. request、rate、timeout、concurrency、resource limit が server policy 以下である。
6. state-changing check には seed と cleanup contract がある。
7. cleanup が失敗した run は `completed` ではなく `inconclusive` または `failed_cleanup` になる。
8. production environment を示す target では server が fail-closed する。

ユーザー入力の shell command、JavaScript、Playwright script、ZAP script を実行しない。
login、seed、request、cleanup は versioned declarative schema から構築する。

### 4.3 Credential

- Authorization、Cookie、API key を `dast_targets.defaultHeadersJson` に保存しない。
- auth context の秘密部分は AES-256-GCM と AAD で project、target、identity に結び付ける。
- API response、audit log、scan event、artifact、exception に秘密を返さない。
- auth context は ID と redacted metadata だけを scan plan に渡す。
- credential の復号は request 送信直前に限定する。
- redirect 後の origin が scope 外なら credential を転送しない。
- credential canary を含む自動テストで artifact / DB / log 漏えいを検査する。
- authenticated profile の screenshot は既定で無効にする。
- screenshot を有効にする場合は masking selector と sensitivity label を必須にする。
- network evidence は既定で method、redacted URL、status、timing だけを保存し、request / response header と body を保存しない。

### 4.4 Scanner data

scan 中に rule、template、脆弱性 DB を自動更新しない。

toolbox build または明示的な update job が、次を versioned scanner data bundle として生成する。

- Semgrep ruleset
- Trivy vulnerability DB と checks bundle
- OSV offline database
- Nuclei owned template set
- ZAP image / add-on inventory
- tool binary inventory

各 bundle は manifest、SHA-256、生成時刻、source reference、license / NOTICE reference を持つ。
scan は manifest hash を `tool_runs.metadata` と report に保存する。

初期 freshness policy は次とする。

| Data | Default max age |
| --- | ---: |
| Trivy / OSV vulnerability data | 168 hours |
| Semgrep rules | 720 hours |
| Nuclei owned templates | 720 hours |
| ZAP image / add-on inventory | 720 hours |

期限切れ override を許す場合も `stale_override` を記録し、external report を approval-ready にしない。

### 4.5 Coverage

coverage status は次の列挙値だけを使う。

- `tested_passed`
- `tested_findings`
- `not_tested`
- `not_applicable`
- `inconclusive`
- `blocked`

tool が成功して finding がゼロだった場合と、tool を実行できなかった場合を同じ表示にしない。
profile が control を含むだけでは `tested_*` にしない。
実行済み step と evidence が存在する場合だけ `tested_*` にする。

### 4.6 Human QA

- deterministic / LLM report の初期状態は `draft` とする。
- `external` purpose の report は作成者以外の user が approve する。
- approve 時に report artifact hash、coverage snapshot hash、finding decision snapshot hash を固定する。
- approved report は上書きしない。変更時は新 revision を作る。
- LLM review は human approval の代わりにしない。
- `internal` purpose の report は従来どおり draft のまま利用できる。

### 4.7 Verification terminology

| Kind | 意味 | 許容する outcome |
| --- | --- | --- |
| `scanner_recheck` | 同じ scanner alert が再び検出された | `observed`, `not_observed`, `inconclusive`, `error` |
| `runtime_observation` | 実行時の現象を安全に観測した | `observed`, `not_observed`, `inconclusive`, `error` |
| `exploit_reproduction` | 許可された lab で影響まで確認した | `reproduced`, `not_reproduced`, `inconclusive`, `error` |

既存 reproduction row は migration で `scanner_recheck` として扱う。
旧 `reproduced` は `observed`、旧 `not_reproduced` は `not_observed` へ変換し、元の値を migration metadata に残す。
既存履歴を exploit 成功として再解釈しない。

## 5. 対象範囲

### 5.1 必須対象

- `shared/schemas/`
- `api/db/schema/`
- `drizzle/`
- `api/modules/scans/`
- `api/modules/dast/`
- `api/modules/runtime-scans/`
- `api/modules/reproductions/`
- `api/modules/decisions/`
- `api/modules/reports/`
- `api/routes/`
- `web/src/api/`
- `web/src/domains/scans/`
- project / scan UI の coverage、auth、approval surface
- `docker/toolbox/`
- `scripts/build-toolbox-image.ts`
- `scripts/verify-steps.ts`
- `tests/security-capability/`
- `tests/e2e/`
- `README.md`
- `README.jp.md`
- `docs/production-runbook.md`
- `spec/third-party-scanners.md`

### 5.2 Non-goals

- インターネット上の任意 target に対する active scan
- production target の破壊的診断
- Metasploit 等の exploit framework 統合
- 任意 shell / browser script の実行
- ネットワーク、クラウド、Kubernetes runtime、AD、mobile、wireless 診断
- social engineering
- external pentest の完全自動化
- scanner finding を human review なしで confirmed vulnerability と断定すること
- 商用 scanner の再実装
- Phase 49 内で全 ASVS control を自動化すること

## 6. 目標アーキテクチャ

```text
Assessment engagement
  -> target + environment classification + Rules of Engagement
  -> encrypted auth contexts + test identities
  -> versioned scan profile + WSTG/ASVS coverage contract
  -> immutable scanner data manifest
  -> safe / authenticated-readonly / active-lab execution
  -> findings + evidence + per-control coverage result
  -> scanner recheck / runtime observation / exploit reproduction
  -> finding decisions
  -> draft report
  -> named human review
  -> peer approval
  -> immutable external report revision
```

scan 実行時に保存する provenance は次の形を最低契約とする。

```ts
type ScannerProvenance = {
	tool: {
		name: string;
		version: string;
		binarySha256: string;
		imageDigest?: string;
	};
	data: Array<{
		kind: "ruleset" | "vulnerability_db" | "checks" | "templates" | "addons";
		version: string;
		sha256: string;
		generatedAt: string;
		sourceRef: string;
		freshness: "fresh" | "stale_override";
	}>;
	manifestSha256: string;
};
```

## 7. 実装順序と依存関係

| Slice | Priority | 内容 | 前提 | 目安 |
| --- | --- | --- | --- | ---: |
| 49.0 | P0 | clean baseline と capability benchmark の固定 | Phase 48 closeout | 2–3 人日 |
| 49.1 | P1 | assessment / coverage contract | 49.0 | 4–6 人日 |
| 49.2 | P1 | scanner data bundle と provenance | 49.0 | 7–10 人日 |
| 49.3 | P1 | encrypted auth context と Rules of Engagement | 49.1 | 8–12 人日 |
| 49.4 | P1 | authenticated read-only browser/API scan | 49.2、49.3 | 8–12 人日 |
| 49.5 | P1 | active lab、BOLA/BFLA、bounded write、ZAP active | 49.4 | 15–20 人日 |
| 49.6 | P2 | verification terminology と migration | 49.1 | 6–8 人日 |
| 49.7 | P1 | human QA、report revision、approval gate | 49.1、49.6 | 8–12 人日 |
| 49.8 | P2 | finding taxonomy、risk context、stable fingerprint | 49.2 | 8–12 人日 |
| 49.9 | P1 | vulnerable/fixed benchmark と capability gate | 49.4–49.8 | 10–15 人日 |
| 49.10 | P0 | clean-checkout closeout と文書同期 | 全 slice | 3–5 人日 |

49.1 と 49.2 は、同じ schema / profile file を同時変更しない範囲で並行できる。
49.6 と 49.8 は、49.3–49.5 と並行できる。
49.7 は report schema と reproduction migration が安定してから開始する。

## 8. Slice 49.0: Baseline と capability contract

### 8.1 実装

1. clean checkout から現在の scanner capability を採取する。
2. static、runtime、DAST、API、reproduction、report の profile 一覧を JSON 化する。
3. current toolbox を `--no-cache` 相当で build する。
4. network disabled の fresh toolbox で各 static scanner が実行可能か記録する。
5. Nuclei の true case と HTTP 200 catch-all false-positive case を fixture 化する。
6. Schemathesis の read-only method contract を fixture 化する。
7. current report が human approval を要求しないことを baseline として記録する。
8. baseline result と既知 gap を `spec/evidence/phase-49-baseline.json` に保存する。

### 8.2 成果物

- `spec/evidence/phase-49-baseline.json`
- `spec/evidence/phase-49-capability-matrix.json`
- `tests/security-capability/fixtures/nuclei/`
- `tests/security-capability/fixtures/api/`
- capability inventory script

### 8.3 受入条件

- baseline commit、toolbox digest、tool version、test command、result が記録されている。
- expected failure と unexpected failure が区別されている。
- Nuclei `/.env` template の 200 catch-all 挙動が再現可能である。
- Phase 49 の改善前後を同じ fixture で比較できる。

### 8.4 検証

```bash
bun install --frozen-lockfile
bun run verify:strict
bun run docker:toolbox:build
bun test tests/security-capability
```

期待結果:

- install と strict verification は pass。
- capability test は current gap を machine-readable expected result として出力する。
- baseline JSON に未分類の空欄がない。

失敗時:

- Phase 49.1 へ進まず、Phase 48 regression、toolbox build、fixture defect の順に切り分ける。

## 9. Slice 49.1: Assessment と coverage contract

### 9.1 実装

1. `assessment_engagements` を追加する。
2. engagement に次を保存する。
   - project
   - purpose: `internal` / `external`
   - environment classification
   - scope
   - Rules of Engagement reference
   - owner
   - start / expiry
   - status
3. WSTG / ASVS / OWASP API Security Top 10 の control ID と product check の mapping catalog を version control 下へ追加する。
4. `scan_coverage_results` を追加し、scan ごとの status、method、reason、evidence reference を保存する。
5. profile preview に automated / manual / unsupported control を表示する。
6. scan summary と report に「Coverage and Limitations」を追加する。
7. UI に control category 別の tested / not tested / inconclusive を表示する。

control の説明文全文は複製せず、framework、version、control ID、短い product-owned label、公式 URL を保存する。

### 9.2 主な変更先

- `shared/schemas/assessment.schema.ts`
- `api/db/schema/schema-assessment.ts`
- 次の利用可能な `drizzle/00xx_assessment_coverage.sql`
- `api/modules/assessments/coverage-catalog.ts`
- `api/modules/assessments/coverage-builder.ts`
- `api/routes/assessments.route.ts`
- `api/modules/scans/report-builder-coverage.ts`
- scan summary / report UI

### 9.3 受入条件

- skipped tool、schema missing、credential missing、cleanup failure は `tested_passed` にならない。
- zero finding と not tested が UI、API、Markdown で区別される。
- catalog の存在しない control ID を profile が参照すると test が失敗する。
- scan evidence がない coverage result は `tested_*` にできない。
- report に自動検査外の主要領域が明示される。

### 9.4 検証

```bash
bun test shared/schemas/assessment.schema.test.ts
bun test api/modules/assessments
bun test api/routes/assessments.route.test.ts
bun test api/modules/scans/report-builder.test.ts
bun run test:e2e
bun run verify
```

期待結果:

- catalog reference integrity、status transition、ownership、report rendering が pass。
- schema 不在 fixture は `not_tested` または `blocked` になる。

失敗時:

- profile mapping を増やさず、status derivation と evidence linkage を先に修正する。

## 10. Slice 49.2: Scanner data bundle と provenance

### 10.1 実装

1. toolbox build に scanner data preparation stage を追加する。
2. Semgrep `auto` を production default にしない。
3. owned Semgrep ruleset を fixed ref から取得し、local path と digest で実行する。
4. Trivy vulnerability DB / checks bundle を build artifact として準備する。
5. OSV offline database を build artifact として準備する。
6. Nuclei owned template tree 全体の digest を生成する。
7. ZAP image digest と add-on inventory を manifest に入れる。
8. `scanner-data-manifest.json` を toolbox にコピーする。
9. runner が manifest を読み、`tool_runs.metadata.provenance` に保存する。
10. missing / invalid / stale manifest を profile policy に従い fail-closed する。
11. readiness に scanner data freshness を追加する。
12. update と scan を別 command / lifecycle にする。

developer host の `--config auto` は明示的な exploratory flag の場合だけ残してよい。
その run は `reproducible=false` とし、external report の approval 対象外にする。

### 10.2 主な変更先

- `docker/toolbox/Dockerfile`
- `docker/toolbox/scanner-data/`
- `scripts/build-toolbox-image.ts`
- `scripts/prepare-scanner-data.ts`
- `scripts/verify-toolbox-provenance.ts`
- `api/modules/scans/tools/scanner-provenance.ts`
- Semgrep / OSV / Trivy / Nuclei / ZAP runner
- `api/modules/scans/scan-execution-policy.ts`
- readiness / production runbook

### 10.3 受入条件

- fresh toolbox は `networkMode=none` で Semgrep、OSV、Trivyを実行できる。
- 同一 image digest と target digest は同一 provenance manifest hash を持つ。
- rule / DB / template の一つを変更すると manifest hash が変わる。
- manifest がない run は success にならない。
- stale override は report と coverage に残る。
- scan 中に update endpoint への network request が発生しない。

### 10.4 検証

```bash
bun run docker:toolbox:build
bun run scripts/verify-toolbox-provenance.ts
bun test api/modules/scans/tools
bun test api/modules/runtime-scans
bun run verify
```

期待結果:

- offline scanner matrix が pass。
- manifest tamper、missing data、stale data test が fail-closed を確認する。

失敗時:

- broad network egress を有効化しない。
- missing data source、build cache、runner path rewrite、freshness policy の順に切り分ける。

## 11. Slice 49.3: Encrypted auth context と Rules of Engagement

### 11.1 実装

1. `dast_auth_contexts` と `dast_test_identities` を追加する。
2. auth kind は初期状態で次に限定する。
   - bearer token
   - named header token
   - basic auth
   - cookie set
   - Playwright storage state
3. secret payload を existing secret encryption pattern で暗号化する。
4. auth context を target と identity role に紐付ける。
5. secret を返さない create / list / rotate / revoke API を追加する。
6. declarative login flow schema を追加する。
7. login action は navigate、fill secret reference、click、wait for URL / selector に限定する。
8. Rules of Engagement schema を engagement に追加する。
9. allowed paths、methods、request budget、rate、cleanup contract、expiry、attestation を検証する。
10. credential use、rotation、revocation、active authorization を audit event に残す。

### 11.2 主な変更先

- `shared/schemas/dast-auth.schema.ts`
- `shared/schemas/assessment.schema.ts`
- `api/db/schema/schema-dast.ts`
- 次の migration
- `api/modules/dast/auth-context-crypto.ts`
- `api/modules/dast/auth-context-repository.ts`
- `api/modules/dast/rules-of-engagement.ts`
- `api/routes/dast-auth.route.ts`
- DAST settings UI

### 11.3 受入条件

- DB dump、API response、scan event、artifact、error log に credential canary が存在しない。
- AAD の project / target / identity が異なると復号できない。
- revoked / expired auth context は実行前に拒否される。
- redirect 先が scope 外なら credential を送らない。
- production environment の active permission を保存できない。
- arbitrary script、shell、URL credential を schema が拒否する。

### 11.4 検証

```bash
bun test shared/schemas/dast-auth.schema.test.ts
bun test api/modules/dast/auth-context-crypto.test.ts
bun test api/modules/dast/rules-of-engagement.test.ts
bun test api/routes/dast-auth.route.test.ts
bun run scripts/check-artifact-tracking.ts
bun run verify
```

期待結果:

- encryption、ownership、revocation、redaction、scope tests が pass。
- canary search が 0 件。

失敗時:

- browser/API integration へ進まず、保存、復号、redaction、redirect policy の境界を修正する。

## 12. Slice 49.4: Authenticated read-only browser/API scan

### 12.1 実装

1. `DastBrowserAdapter` の real Playwright implementation を追加する。
2. `browser-smoke` を real adapter が利用可能な環境で有効化する。
3. declarative login または encrypted storage state で session を作る。
4. configured route ごとに console、page error、failed request、final URL を保存し、明示有効時だけ masked screenshot を保存する。
5. authenticated screenshot は既定で無効とし、明示 opt-in 時は masking selector と sensitivity label を要求する。
6. screenshot と DOM evidence に redaction / exclusion option を適用する。
7. auth context を HTTP baseline と Schemathesis read-only scan に注入する。
8. identity role ごとに同じ route / operation を実行し、status、redirect、response shape の差を証跡化する。
9. session expiry 時は declarative login を一度だけ再実行し、無限 retry を禁止する。
10. auth failure は zero finding ではなく `blocked` coverage とする。
11. `authenticated-readonly` profile を追加する。

ZAP authenticated context はこの slice の必須条件にしない。
ZAP固有 session integration は 49.5 の active profile と合わせて扱う。

### 12.2 主な変更先

- `api/modules/dast/playwright-browser-adapter.ts`
- `api/modules/dast/browser-runner.ts`
- `api/modules/dast/http-runner.ts`
- `api/modules/dast/profiles.ts`
- `api/modules/runtime-scans/command-contracts.ts`
- Schemathesis runner
- DAST profile UI / evidence UI
- `tests/e2e/fixtures/authenticated-target/`

### 12.3 受入条件

- user A と user B の認証付き read-only route scan が完了する。
- unauthenticated redirect と authenticated page load を区別できる。
- session refresh は最大1回である。
- auth failure、browser unavailable、schema unavailable は coverage gap になる。
- secret canary が screenshot metadata、network log、artifact text に残らない。
- method は GET / HEAD / OPTIONS から増えていない。

### 12.4 検証

```bash
bun test api/modules/dast
bun test api/modules/runtime-scans
bun run test:e2e -- --grep "authenticated read-only"
bun run verify
```

期待結果:

- login、route visit、role evidence、expiry、redirect、redaction test が pass。

失敗時:

- active method を追加せず、session creation、scope enforcement、redaction を先に修正する。

## 13. Slice 49.5: Active lab と複数 role 認可検査

### 13.1 実装

1. `active_lab` execution policy を追加する。
2. user A、user B、admin と owned object A / B を表現する authorization matrix schema を追加する。
3. BOLA check を次の組み合わせで実行する。
   - A -> object A
   - A -> object B
   - B -> object A
   - B -> object B
   - admin -> object A / B
4. BFLA check を role と operation の allow / deny matrix で実行する。
5. state-changing API は declarative seed、request、assertion、cleanup で構築する。
6. cleanup は必ず finally 相当の lifecycle で実行する。
7. ZAP active/API scan を専用 Docker profile として追加する。
8. gateway を Rules of Engagement の method / path allowlist に従わせる。
9. Schemathesis write methods は同じ active policy の中だけで有効化する。
10. Nuclei owned templates を content-aware matcher へ修正する。
11. 新しい template は vulnerable / fixed fixture と同じ PR に追加する。
12. active profile は `full-security-scan` から独立させる。

初期 profile:

- `api-authorization-matrix`
- `api-active-lab`
- `runtime-zap-active-lab`
- `web-active-lab`

### 13.2 主な変更先

- `shared/schemas/active-assessment.schema.ts`
- `api/modules/dast/active-policy.ts`
- `api/modules/dast/authorization-matrix-runner.ts`
- `api/modules/dast/transaction-runner.ts`
- `api/modules/runtime-scans/zap-active-runner.ts`
- `api/modules/runtime-scans/command-contracts.ts`
- `api/modules/scans/profiles.ts`
- `api/modules/dast/container-target-gateway.ts`
- `docker/toolbox/nuclei-safe-templates/`
- `tests/security-capability/fixtures/authorization/`

### 13.3 受入条件

- vulnerable fixture の BOLA / BFLA を検出する。
- fixed fixture では同じ finding を生成しない。
- cleanup 後に fixture DB / state が baseline と一致する。
- cleanup failure は `failed_cleanup` または `inconclusive` になる。
- production-classified target、public address、expired RoE は実行前に拒否される。
- method / path allowlist 外の request を gateway が拒否する。
- active run は既定 profile や preview から暗黙に選択されない。
- `/.env` が generic 200 page を返す fixture で finding を生成しない。
- container resource、request、rate、timeout 上限が全 active runner に適用される。

### 13.4 検証

```bash
bun test shared/schemas/active-assessment.schema.test.ts
bun test api/modules/dast/authorization-matrix-runner.test.ts
bun test api/modules/dast/transaction-runner.test.ts
bun test api/modules/runtime-scans/zap-active-runner.test.ts
bun test tests/security-capability/authorization
bun run test:e2e -- --grep "active lab"
bun run verify
```

期待結果:

- vulnerable / fixed、allow / deny、cleanup success / failure、scope rejection がすべて pass。

失敗時:

- request scope または cleanup の失敗なら profile を disabled のままにする。
- false positive の場合、severity を下げて通さず matcher / assertion を修正する。

## 14. Slice 49.6: Verification terminology と migration

### 14.1 実装

1. verification kind を schema と DB に追加する。
2. existing reproduction row を `scanner_recheck` に migration する。
3. 既存 `reproduced` は `observed`、`not_reproduced` は `not_observed` に変換し、`metadata.legacyOutcome` に旧値を残す。
4. new run では kind ごとの outcome schema を強制する。
5. runtime observation と exploit reproduction の evidence contract を追加する。
6. request / response evidence は header / body redaction 後に保存する。
7. `/reproductions` API を compatibility alias とし、new `/verifications` API を追加する。
8. 少なくとも1 release cycle は old route と payload を維持する。
9. UI、CLI、Markdown から曖昧な「再現済み」を除去する。

### 14.2 主な変更先

- `shared/schemas/verification.schema.ts`
- `shared/schemas/reproduction.schema.ts`
- `api/db/schema/schema-reproduction.ts`
- 次の migration
- `api/modules/reproductions/`
- `api/modules/verifications/`
- `api/routes/reproductions.route.ts`
- `api/routes/verifications.route.ts`
- finding detail / report UI

### 14.3 受入条件

- 既存 DB backup を migration して履歴が欠落しない。
- legacy scanner re-run が exploit reproduced と表示されない。
- `exploit_reproduction` は `active_lab` と RoE なしで開始できない。
- kind と outcome の不正な組み合わせを schema / repository が拒否する。
- report に verification method と evidence strength が表示される。

### 14.4 検証

```bash
bun test shared/schemas/verification.schema.test.ts
bun test api/modules/reproductions
bun test api/modules/verifications
bun test api/routes/reproductions.route.test.ts
bun test api/routes/verifications.route.test.ts
bun test api/operations/database-backup.test.ts
bun run verify
```

期待結果:

- migration fixture、API compatibility、terminology snapshot が pass。

失敗時:

- old route を削除せず、migration と compatibility adapter を修正する。

## 15. Slice 49.7: Human QA と report approval

### 15.1 実装

1. report purpose と lifecycle status を追加する。
2. status は `draft`、`awaiting_review`、`approved`、`rejected`、`superseded` とする。
3. `report_revisions` と `report_approvals` を追加する。
4. submit 時に finding decisions、coverage、verification、artifact の snapshot hash を計算する。
5. external report は undecided high / critical finding、blocked critical coverage、stale scanner data がある場合 submit を拒否する。
6. reviewer は generator と別 user であることを要求する。
7. approve / reject に comment と user ID を必須化する。
8. approved artifact を immutable とし、再生成時は revision を増やす。
9. export API は external report の approved revision だけを返す。
10. internal report は current workflow を維持する。
11. UI に readiness checklist、review queue、approval history を追加する。
12. audit event に submit、approve、reject、supersede、export を保存する。

### 15.2 主な変更先

- `shared/schemas/report-governance.schema.ts`
- `api/db/schema/schema-reports.ts`
- 次の migration
- `api/modules/reports/report-readiness.ts`
- `api/modules/reports/report-approval-repository.ts`
- `api/routes/scan-reports.route.ts`
- report detail / action UI
- audit log

### 15.3 受入条件

- LLM completion だけでは report が approved にならない。
- generator と同じ user は external report を approve できない。
- approved artifact hash の file を変更すると export が拒否される。
- blocked coverage、stale provenance、undecided high finding が readiness に表示される。
- reject 後の修正は既存 revision を上書きせず new revision になる。
- internal report の既存生成経路は壊れない。

### 15.4 検証

```bash
bun test shared/schemas/report-governance.schema.test.ts
bun test api/modules/reports
bun test api/routes/scan-reports.route.test.ts
bun run test:e2e -- --grep "report approval"
bun run verify
```

期待結果:

- ownership、separation of duties、snapshot integrity、revision、export gate が pass。

失敗時:

- external export を disabled のままにし、internal report path だけを維持する。

## 16. Slice 49.8: Finding taxonomy と risk context

### 16.1 実装

1. normalized finding に次の typed metadata を追加する。
   - CWE IDs
   - CVE / advisory aliases
   - CVSS version、vector、base score
   - references
   - package coordinates / PURL
   - fixed versions
   - rule source / rule version
   - reachability status と根拠
   - VEX status と statement reference
   - KEV status
   - EPSS score / percentile / snapshot date
2. Semgrep metadata を正規化後も保持する。
3. OSV severity vector と aliases を保持する。
4. Trivy CVSS、reference、PURL、data source を保持する。
5. 外部 risk data は offline snapshot と provenance manifest から参照する。
6. scanner severity を上書きせず、derived priority を別 field にする。
7. deterministic priority formula と理由を report に表示する。
8. fingerprint v2 を追加し、line shift に耐える identity component を導入する。
9. old fingerprint を alias として保持し、scan comparison の履歴を切らない。

### 16.2 主な変更先

- normalized finding schema
- Semgrep / OSV / Trivy normalizer
- finding repository
- scan comparison / fingerprint resolver
- report builder
- finding detail UI
- scanner data / risk snapshot manifest

### 16.3 受入条件

- raw fixture にある CWE、CVSS vector、reference が normalized finding から欠落しない。
- EPSS / KEV / VEX snapshot date と digest が report に残る。
- priority の根拠を入力 field まで追跡できる。
- original severity と derived priority が別 field である。
- source line を前後へ移動した Semgrep fixture が同じ logical finding と比較される。
- 異なる rule / sink / dependency を誤って同一 finding に統合しない。

### 16.4 検証

```bash
bun test api/modules/scans/normalizers
bun test api/modules/scans/scan-review-bundle.test.ts
bun test api/modules/scans/scan-comparison.test.ts
bun test api/modules/scans/report-builder.test.ts
bun run verify
```

期待結果:

- metadata round-trip、priority explanation、fingerprint compatibility が pass。

失敗時:

- old fingerprint を削除せず、v2 matching を advisory mode に戻して collision fixture を追加する。

## 17. Slice 49.9: Security capability benchmark

### 17.1 実装

fast deterministic suite と heavy benchmark を分ける。

Fast suite:

- owned Semgrep rule fixtures
- Gitleaks secret positive / negative fixtures
- OSV / Trivy normalized positive / negative fixtures
- Nuclei exposed file true case / generic 200 false case
- authenticated browser success / session expiry / redirect scope
- BOLA / BFLA vulnerable and fixed variants
- active write cleanup success / failure
- report approval allowed / denied
- credential canary leakage search
- provenance missing / stale / tampered cases

Heavy suite:

- pinned OWASP Benchmark release
- pinned OWASP Juice Shop image
- 必要に応じて WebGoat を追加
- resource usage、duration、tool version、ruleset / DB digest を保存

new commands:

- `bun run test:security-capability`
- `bun run test:security-capability:heavy`
- `bun run verify:security-capability`

fast suite は `verify:strict` に追加する。
heavy suite は release、scheduled CI、scanner data update PR で実行する。

### 17.2 Metric

- true positives
- false negatives
- false positives
- true negatives
- precision
- recall
- category coverage
- runtime
- peak memory
- request count
- cleanup success
- credential leakage count

初回 baseline は metric を隠さず記録する。
以後、owned deterministic suite は regression 0 件を要求する。
external corpus は category ごとの ratchet とし、tool version / ruleset update で baseline を黙って下げない。

### 17.3 受入条件

- vulnerable BOLA / BFLA fixture は finding を生成する。
- fixed BOLA / BFLA fixture は同じ finding を生成しない。
- generic 200 `/.env` fixture は exposed secret finding を生成しない。
- credential canary leakage count は 0。
- active cleanup success rate は deterministic suite で100%。
- scanner data update 前後の metric diff が review artifact として生成される。
- heavy suite が利用不能でも fast suite は offline で実行できる。

### 17.4 検証

```bash
bun run test:security-capability
bun run verify:strict
bun run test:security-capability:heavy
bun run verify:security-capability
```

期待結果:

- fast suite と strict gate は pass。
- heavy suite は metric artifact と provenance を生成する。

失敗時:

- scanner update を merge せず、rule regression、fixture drift、data freshness、environment failure を区別する。
- external corpus download failure を detection regression として集計しない。

## 18. Slice 49.10: Closeout

### 18.1 実装

1. clean checkout を一時 directory へ展開する。
2. frozen install、migration、bootstrap、toolbox build、strict verification を実行する。
3. fast capability suite と heavy benchmark を実行する。
4. backup create / verify と migration rollback strategy を確認する。
5. README の product claim、profile説明、active safety boundary を更新する。
6. production runbook に scanner data update、credential rotation、RoE、cleanup incident、report approval を追加する。
7. third-party scanner record を binary / data bundle / license inventory と一致させる。
8. known unsupported WSTG / ASVS controls を公開する。
9. final evidence JSON と release report を保存する。

### 18.2 成果物

- `spec/evidence/phase-49-release-report.json`
- `spec/evidence/phase-49-capability-final.json`
- `spec/evidence/phase-49-heavy-benchmark.json`
- updated coverage catalog
- updated runbook

### 18.3 Definition of Done

- [ ] clean checkout から `bun install --frozen-lockfile` が成功する。
- [ ] migration `0017` から最新まで適用できる。
- [ ] backup verification が成功する。
- [ ] `bun run verify:strict` が成功する。
- [ ] `bun run verify:security-capability` が成功する。
- [ ] offline toolbox scanner matrix が成功する。
- [ ] scan ごとに rule / DB / template provenance を取得できる。
- [ ] unauthenticated safe mode が従来どおり既定である。
- [ ] authenticated read-only profile が real browser/API fixture で成功する。
- [ ] active profile が public / production target で fail-closed する。
- [ ] BOLA / BFLA vulnerable / fixed fixture を区別できる。
- [ ] active write 後の cleanup が検証される。
- [ ] legacy reproduction が exploit reproduced と表示されない。
- [ ] external report は peer approval なしで export できない。
- [ ] approved report と coverage snapshot の hash integrity が確認される。
- [ ] credential canary leakage count が 0 である。
- [ ] README と UI がプロ診断の完全代替を主張しない。

### 18.4 検証

```bash
bun run scripts/verify-clean-checkout.ts
bun run verify:strict
bun run verify:security-capability
bun run test:security-capability:heavy
```

期待結果:

- clean-checkout script が install、migration、bootstrap、toolbox provenance、strict gate を成功として記録する。
- fast / heavy capability result が同じ release commit と manifest hash を参照する。
- release report に未分類の failure、空の owner、空の residual risk がない。

失敗時:

- Phase 49 を完了扱いにせず、release report を `failed` として保存する。
- failure のある slice を再度 open にし、downstream evidence を再生成する。

## 19. Milestone

### Milestone A: Trustworthy automated baseline

対象: 49.0–49.2

完了状態:

- 何を検査したかを control 単位で説明できる。
- scanner binary だけでなく rule / DB / template を再現できる。
- fresh offline toolbox の実行可否が release gate で確認される。

目安: 13–19 人日

### Milestone B: Authenticated read-only assessment

対象: 49.3–49.4

完了状態:

- credential を安全に保存・参照できる。
- login 後の画面と read-only API を role ごとに検査できる。
- auth failure を coverage gap として表現できる。

目安: 16–24 人日

### Milestone C: Bounded active assessment and accountable reports

対象: 49.5–49.7

完了状態:

- disposable environment で BOLA / BFLA と bounded write を検査できる。
- scanner recheck と exploit reproduction が区別される。
- 外部提出 report に human QA と peer approval が必要になる。

目安: 29–40 人日

### Milestone D: Risk context and measurable quality

対象: 49.8–49.10

完了状態:

- finding taxonomy と優先度の根拠を保持する。
- vulnerable / fixed corpus で recall と false positive を測定する。
- clean checkout で capability gate を再現できる。

目安: 21–32 人日

## 20. 工数と進め方

合計見積りは 79–115 人日である。

- 1人の senior engineer が実装と一次検証を行う場合: 約16–23週
- 2人の engineer と独立 reviewer で並行する場合: 約10–15週

短縮する場合も、49.0、49.2、49.3、49.5 の safety boundary、49.7、49.9 を省略しない。

最小の実用リリースは Milestone B である。
この時点で「認証付き read-only AppSec assessment support」と表現できる。

プロ向け external report workflow を名乗る条件は Milestone C 完了後である。

## 21. PR 分割規則

- 1 PR は原則1 slice、49.5 と 49.9 は必要なら2–3 PRに分ける。
- migration PR と destructive behavior を含む active runner PR を同時にしない。
- schema、repository、route、UI、migration、test を一つの vertical slice として完了させる。
- profile を有効化する PR は、その runner、fixture、redaction、coverage mapping を同じ PR に含める。
- scanner rule / DB update PR は capability diff artifact を必須にする。
- active profile は code merge 後も feature flag disabled で入り、closeout 後に明示的に有効化する。
- compatibility route / schema の削除は Phase 49 の non-goal とする。

## 22. Cross-cutting verification

各 PR で最低限実行する。

```bash
bun run typecheck
bun run lint
bun run format:check
bun run test:inventory -- --assert-complete
bun run verify
```

各 slice closeout で実行する。

```bash
bun run verify:strict
```

scanner data、auth、active DAST、report approval を変更した PR では、追加で fast capability suite を実行する。

```bash
bun run test:security-capability
```

release candidate と scanner data update では heavy suite を実行する。

```bash
bun run test:security-capability:heavy
```

## 23. リスク管理

| Risk | 予防 | 検出 | 失敗時 |
| --- | --- | --- | --- |
| Credential leakage | encrypted ref、late decryption、central redaction | canary search | profile disabled、artifact quarantine、credential revoke |
| Active scan が target を壊す | non-production、RoE、allowlist、budget、cleanup | before/after state hash | run inconclusive、incident record、active flag disabled |
| Coverage が false assurance を生む | evidence-linked status、not tested 表示 | missing evidence test | report approval blocked |
| Rule / DB が mutable | offline bundle、digest、no update during scan | manifest verification | scan fail-closed |
| Stale vulnerability data | freshness policy | readiness / report gate | external approval blocked |
| Authorization fixture 依存 | declarative seed/object matrix | vulnerable/fixed pair | profile remains experimental |
| False positive 増加 | positive/negative fixture pair | precision / FP ratchet | rule update rejected |
| Fingerprint collision | v1 alias + v2 advisory rollout | collision fixtures | v2 matching disabled |
| Approved report 改ざん | artifact/snapshot hash | export-time verification | export denied |
| Heavy benchmark flaky | pinned corpus、separate fast suite | failure classification | release gate waits; fast CI remains deterministic |
| Toolbox image肥大化 | separate data layer、size budget | image inventory | bundle split、data artifact retained |
| Third-party license drift | manifest + NOTICE inventory | build verification | distribution blocked |

## 24. 成功指標

Phase 49 の成功は scanner 数では測らない。

最低限、次を計測する。

| Metric | Baseline | Target |
| --- | --- | --- |
| Scanner runs with complete data provenance | 49.0で測定 | 100% |
| External reports with named peer approval | 0% | 100% |
| Credential canary leaks | 未測定 | 0 |
| Active runs against production/public target | 0 | 0 |
| Active cleanup success in deterministic suite | 未測定 | 100% |
| Owned positive/negative fixture regression | 未測定 | 0件 |
| Coverage records backed by evidence | 未測定 | 100% of `tested_*` |
| Legacy scanner rechecks labeled as exploit reproduction | 現行では混同 | 0 |
| Authenticated read-only critical flow E2E | 0 | 1以上 |
| BOLA/BFLA vulnerable/fixed paired scenarios | 0 | 各1以上 |

## 25. 完了後の残課題

Phase 49 完了後も、次は別計画とする。

- manual threat modeling workspace
- full business-logic scenario authoring
- GraphQL subscription / WebSocket 専用診断
- mobile client と native API testing
- cloud / Kubernetes runtime posture
- network service discovery
- enterprise approval workflow、電子署名、PDF delivery
- commercial scanner import / orchestration
- multi-tenant remote scanner fleet
- external object storage と大規模 streaming parser

これらを未実装のまま general-purpose penetration testing platform と表現しない。

## 26. 参照標準

実装時は、次の一次資料の version と取得日を coverage catalog または scanner data manifest に記録する。
Phase 49.0 の初期候補は WSTG v4.2、ASVS v5.0.0、OWASP API Security Top 10 2023 とし、baseline 採取時に versioned release を再確認して固定する。

- [OWASP Web Security Testing Guide v4.2](https://owasp.org/www-project-web-security-testing-guide/)
- [OWASP Application Security Verification Standard v5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x00-header/)
- [OWASP Benchmark](https://owasp.org/www-project-benchmark/)
- [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/)
- [ZAP Docker scans](https://www.zaproxy.org/docs/docker/)
- [Trivy air-gapped environment](https://trivy.dev/docs/latest/guide/advanced/air-gap/)
- [OSV-Scanner usage](https://google.github.io/osv-scanner/usage/)

latest URL を固定 version の代わりに扱わない。
framework release、benchmark corpus、scanner documentation version を Phase 49.0 で pin する。
