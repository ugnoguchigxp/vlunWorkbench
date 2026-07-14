# Phase 41: CLI Security Scan Coverage Expansion Plan

## Purpose

この計画は、現在の vulnWorkbench のセキュリティスキャンに、対象プロジェクトを変更せず、vulnWorkbench 側から CLI または Docker command を実行するだけで利用できる診断を追加するための実装計画である。

追加対象は次の 5 つに限定する。

1. Nuclei safe web scan
2. ZAP Baseline passive scan
3. Trivy CycloneDX SBOM export
4. Schemathesis bounded API schema scan
5. Trivy existing-image scan

既存の Biome、Vitest、Bun audit、Playwright は対象プロジェクトの品質確認手段であり、この phase では追加・変更しない。既存の Semgrep、Gitleaks、OSV-Scanner、Trivy filesystem scan、HTTP baseline DAST は維持する。

## Decision Summary

| 診断 | 採用 | 実行方式 | 対象側の設定 | 適用条件 | 主な出力 | ライセンス判断 |
| --- | --- | --- | --- | --- | --- | --- |
| Nuclei safe | 採用 | vulnWorkbench CLI / Docker | 不要 | auto-start URL が得られる | JSONL + normalized findings | engine / templates とも MIT |
| ZAP Baseline | 採用 | 公式 Docker image | 不要 | auto-start URL が container から到達可能 | JSON + normalized findings | ZAP core は Apache-2.0 |
| Trivy SBOM | 採用 | 既存 Trivy CLI / Docker | 不要 | project filesystem が読める | CycloneDX JSON artifact | Apache-2.0 |
| Schemathesis | 条件付き採用 | vulnWorkbench CLI / Docker | 不要 | 既存 schema を自動検出できる | NDJSON + normalized findings | MIT |
| Trivy image | 条件付き採用 | 既存 Trivy CLI / Docker | 不要 | 既存 image ref または image tar が明示される | JSON + normalized findings | Apache-2.0 |

ここで「対象側の設定不要」とは、対象 repository に dependency、設定ファイル、script、CI job、test code を追加しないことを意味する。vulnWorkbench 自身が持つ安全ポリシー、tool version pin、normalizer、Docker image 定義は実装対象に含む。

## Current Baseline

現在の profile runner は次の構成である。

- `static_tool` step
  - Semgrep
  - Gitleaks
  - OSV-Scanner
  - Trivy filesystem
- `dast` step
  - `http-baseline`
  - `auto_project_start` で対象を一時起動
- persistence
  - `scan_runs`
  - `tool_runs`
  - `scan_artifacts`
  - `findings`
  - `finding_evidence`
  - `scan_events`
- profile result
  - `completed`
  - `failed`
  - `skipped`

現時点で Nuclei、ZAP、Schemathesis の adapter は存在しない。Trivy は `fs --format json` に固定され、SBOM export と image target を扱わない。既存 HTTP baseline は header、cookie、CORS、common path の低負荷観測であり、crawler、passive proxy scan、template-based vulnerability detection、API contract generation を行わない。

実装前に次を baseline evidence として保存する。

```bash
bun run scan:profile -- --profile basic-security --dry-run true
bun run scan:profile -- --profile web-app-baseline --dry-run true
bun run scan:profile -- --profile full-security-scan --dry-run true
bun test api/modules/scans/profile-runner.test.ts
bun test api/modules/scans/report-builder.test.ts
```

この出力を新 step 追加後の profile order、status、artifact、finding、coverage gap の比較基準にする。

## Scope Boundary

### In Scope

- vulnWorkbench が対象 project path、auto-start URL、既存 schema、明示された既存 image を入力として tool command を実行する。
- raw structured output を artifact として保存する。
- tool output を共通 finding / evidence へ正規化する。
- 適用不能と実行失敗を分離する。
- scan profile、CLI JSON stdout、report、UI step summary に統合する。
- tool、template、Docker image の version と digest を固定する。
- top-level license と配布物に含まれる third-party license を implementation gate で確認する。

### Non-Goals

- 対象 repository への dependency、config、workflow、CI、script の追加。
- 対象 container image の自動 build。
- ZAP active scan、authenticated scan、Ajax spider、context file。
- Nuclei fuzz / DAST、headless、code、JavaScript、OAST / Interactsh、AI、cloud upload。
- Schemathesis authenticated scan、stateful long-running fuzz、write method の自動実行。
- production / public URL の自動探索または無断診断。
- arbitrary shell command、target-provided scanner config、target-provided Nuclei template の実行。
- CodeQL、TruffleHog、Joern の追加。
- scan tool が出した件数だけで安全性を断定すること。

## License and Distribution Gate

採用候補の upstream project license は希望条件に合う。

| Component | Upstream license | 扱い |
| --- | --- | --- |
| Nuclei engine | MIT | 採用可 |
| nuclei-templates | MIT | 採用可。ただし release pin と template policy audit が必要 |
| ZAP core | Apache-2.0 | 採用可。ただし公式 image 内の add-on / dependency license inventory が必要 |
| Trivy | Apache-2.0 | 既存採用済み。SBOM / image target を拡張 |
| Schemathesis | MIT | 採用可。Python dependency license inventory が必要 |

実装開始時に次を必須 gate とする。

1. exact release version または container digest を固定する。
2. upstream `LICENSE`、必要な `NOTICE`、template license を保存または配布文書から参照できるようにする。
3. Docker image / Python package / bundled binary の third-party license inventory を出力する。
4. 組織ポリシー上許容されない license が含まれる場合、その tool の実装を止める。
5. license 確認結果、source URL、version、digest、確認日を `spec/third-party-scanners.md` に記録する。

この gate は top-level license だけを見て法的適合を断定しない。最終判断が必要な場合は法務確認へ渡せる材料を作る。

## Architecture

### Step Types

`shared/schemas/scan-profile.schema.ts` に用途別の step を追加する。

```ts
type RuntimeScannerStep = {
  kind: "runtime_scanner";
  adapter: "nuclei-safe" | "zap-baseline";
  target: { mode: "auto_project_start" };
  required: boolean;
  failurePolicy: "fail_profile" | "warn_and_continue";
  timeoutSec?: number;
  options?: Record<string, unknown>;
};

type SbomExportStep = {
  kind: "sbom_export";
  adapter: "trivy";
  target: { mode: "project_filesystem" };
  format: "cyclonedx";
  required: boolean;
  failurePolicy: "fail_profile" | "warn_and_continue";
  timeoutSec?: number;
};

type ApiSchemaScanStep = {
  kind: "api_schema_scan";
  adapter: "schemathesis";
  target: { mode: "auto_project_start" };
  schema: { mode: "auto_discover"; kind: "openapi" | "graphql" | "auto" };
  required: boolean;
  failurePolicy: "fail_profile" | "warn_and_continue";
  timeoutSec?: number;
  options?: Record<string, unknown>;
};

type ContainerImageScanStep = {
  kind: "container_image_scan";
  adapter: "trivy";
  target: { mode: "explicit_existing_image" };
  required: boolean;
  failurePolicy: "fail_profile" | "warn_and_continue";
  timeoutSec?: number;
};
```

`static_tool` に runtime や inventory の意味を押し込めない。tool ID と入力種別を型で分離し、dry-run、report、UI が step の適用条件を説明できるようにする。

### Shared Runtime Target Session

`full-security-scan` で HTTP baseline、Nuclei、ZAP、Schemathesis のたびに対象を再起動しない。

`runProfileScan` の実行中だけ有効な `RuntimeTargetSession` を追加する。

```text
first runtime step
  -> prepareDastTargetWorkspace once
  -> readiness confirmed
  -> keep origin and start plan in memory

HTTP baseline / Nuclei / ZAP / Schemathesis
  -> use the same origin
  -> each tool has separate timeout, artifact, and result

profile finally
  -> stop target once
  -> persist cleanup event
```

既存 `runDastStepIntoExistingScan` は prepared session を受け取れるようにする。session の start / stop ownership は profile runner に集約する。focused single-step profile でも同じ path を使う。

Docker scanner が `127.0.0.1` に直接接続しないよう、container 用 URL は既存 target validation の `host.docker.internal` rewrite を再利用する。container 内 preflight が失敗した場合、host network や `0.0.0.0` bind へ自動 fallback せず、`target_unreachable_from_container` coverage gap とする。

### Applicability and Coverage Contract

現在の `status + error string` だけでは、適用不能と故障を区別しにくい。全 step result に次を追加する。

```ts
type ScanStepApplicability = "applicable" | "not_applicable";

type ScanStepReasonCode =
  | "schema_not_found"
  | "authentication_required"
  | "image_input_not_provided"
  | "image_source_unreachable"
  | "target_start_not_supported"
  | "target_unreachable_from_container"
  | "tool_unavailable"
  | "policy_rejected"
  | "invalid_structured_output"
  | "timed_out"
  | "execution_failed";

type CoverageEffect = "covered" | "partial" | "gap";
```

Rules:

- `not_applicable` は tool failure ではなく `skipped` とする。
- `schema_not_found`、`image_input_not_provided` は `coverageEffect: "gap"` とする。
- 未認証 surface が全て 401 / 403 の場合は `authentication_required` として `partial` または `gap` を記録する。
- binary 不在、invalid output、timeout、container failure は execution failure であり、適用不能に偽装しない。
- optional step の gap / failure は profile を `completed_with_warnings` にする。
- required step の execution failure は profile を failed にする。
- finding 0 件でも coverage gap があれば report は「問題なし」と表現しない。

DB migration は行わず、step result を `scan_runs.metadata.stepResults`、reason を `scan_events.data`、tool-specific detail を `tool_runs.metadata` に保存する。artifact / finding / evidence は既存 table を使う。

## Tool Integration Design

### 1. Nuclei Safe Web Scan

#### Value

既存 HTTP baseline が見ない既知の公開状態、公開設定ミス、危険な endpoint pattern を template-based scan で補う。

#### Execution

vulnWorkbench が所有する pinned Nuclei binary と pinned nuclei-templates release を使う。host runner は明示的な vulnWorkbench tool setup で app-managed tool directory に配置し、Docker runner は pinned toolbox を使う。どちらも対象 repository には何も配置しない。scan 実行時の自動 update は禁止する。

command shape:

```bash
nuclei \
  -u <auto-target-origin> \
  -jsonl-export <output>/nuclei.jsonl \
  -silent \
  -no-color \
  -omit-raw \
  -disable-update-check \
  -no-interactsh \
  -rate-limit 5 \
  -concurrency 5 \
  -timeout 5 \
  -retries 0 \
  -templates <pinned-safe-template-root>
```

exact flags は pinned version の `nuclei -h` fixture で確認し、version change 時に command contract test を更新する。

runner environment には `DISABLE_NUCLEI_TEMPLATES_PUBLIC_DOWNLOAD=true` と custom template source の download-disable variables を設定する。明示的な maintenance command 以外では engine / template を更新しない。

#### Safe Template Policy

- template release を tag と checksum で固定する。
- vulnWorkbench-owned allowlist manifest だけを実行する。
- HTTP の exposure / misconfiguration / safe detection template に限定する。
- `headless`、`code`、`javascript`、`file`、network protocol、fuzz / DAST、OAST / Interactsh を禁止する。
- `-ai`、cloud result upload、target-provided template、unsigned custom template を禁止する。
- allowlist build 時に template protocol / tag / metadata を監査し、policy 外 template が 1 件でもあれば toolbox build を失敗させる。
- scan artifact metadata に engine version、template release、template set hash、allowlist hash を保存する。

#### Output

- raw sanitized JSONL artifact
- stdout / stderr artifact
- one normalized finding per template match
- fingerprint: `nuclei + templateId + normalizedHost + matchedPath + matcherName`
- severity は Nuclei severity を共通 severity に写像する。
- request / response body は初期実装では保存しない。

### 2. ZAP Baseline

#### Value

traditional spider と passive scan により、現在の fixed common-path HTTP baseline より広い URL surface と passive rule coverage を得る。active attack は行わない。

#### Execution

toolbox image に ZAP を混ぜず、official ZAP Docker image を immutable digest で固定して実行する。

command shape:

```bash
docker run --rm \
  --network <validated-network> \
  -v <output-dir>:/zap/wrk/:rw \
  <pinned-zap-image-digest> \
  zap-baseline.py \
  -t <container-reachable-target-origin> \
  -m 1 \
  -T 3 \
  -J zap-report.json
```

Rules:

- `zap-full-scan.py`、active scan、`-n` context、`-U` auth user、`-j` Ajax spider を使わない。
- target origin は auto-start session からのみ受け取る。
- output mount 以外を write mount しない。
- target repository を container に mount しない。
- exit code 0 / 1 / 2 で valid JSON report があれば scan result として扱い、alert を finding 化する。
- exit code 3、report 欠落、invalid JSON は execution failure とする。

#### Output

- ZAP JSON report artifact
- stdout / stderr artifact
- one normalized finding per alert + URL + parameter
- fingerprint: `zap + pluginId + normalizedUrl + parameter + evidenceHash`
- passive alert confidence / risk code を共通 severity / confidence に写像する。

### 3. Trivy CycloneDX SBOM

#### Value

既存 Trivy vulnerability finding と別に、「何を検査したか」を再利用可能な software inventory として残す。SBOM component を finding に変換しない。

#### Execution

既存 `TrivyRunner` を mode-aware に拡張する。

```bash
trivy fs \
  --format cyclonedx \
  --output <output>/sbom.cdx.json \
  <scoped-project-path>
```

既存 scope / mandatory exclude / Docker read-only mount を再利用する。初期 format は CycloneDX JSON に固定し、SPDX は future option とする。

#### Output

- `kind: "sbom"`, `format: "cyclonedx-json"` artifact
- component count、package type count、dependency relationship count を metadata に保存
- artifact SHA-256 を evidence identity として使う
- finding count は常に 0
- report では vulnerability finding section ではなく inventory / coverage section に表示

### 4. Schemathesis Bounded API Schema Scan

Schemathesis の詳細 module / normalizer / schema discovery 設計は Phase 26 を再利用する。ただし Phase 41 は安全性と適用不能 semantics を次のように上書きする。

#### Applicability

- repository root の既知候補だけを bounded lookup する。
- auto-start 後に `/openapi.json`、`/swagger.json`、`/v3/api-docs` などを bounded probe する。
- schema がなければ `schema_not_found` の coverage gap とし、tool crash または profile failure にしない。
- schema が認証を要求する場合は `authentication_required` とする。

#### Execution

continuous `st fuzz` ではなく bounded `st run` を使う。

```bash
st run <schema> \
  --url <auto-target-origin> \
  --workers 1 \
  --max-examples 20 \
  --max-failures 20 \
  --rate-limit 2/s \
  --generation-deterministic \
  --include-method GET \
  --include-method HEAD \
  --include-method OPTIONS \
  --report ndjson \
  --report-ndjson-path <output>/schemathesis.ndjson \
  --output-sanitize true \
  --output-truncate true
```

exact include-method flag は pinned version の CLI help で確認する。read-only method filtering が CLI で保証できなければこの adapter を有効化しない。

POST / PUT / PATCH / DELETE は initial scope では実行せず、report に `write_operations_not_scanned` coverage gap を残す。認証 header、cookie、token は渡さない。

#### Output

- sanitized NDJSON artifact
- optional JUnit artifact は normalizer の安定性が必要な場合だけ追加
- operation + check ごとの normalized finding
- reproducible curl 等に secret / body が含まれる場合は保存前に redact / truncate

### 5. Trivy Existing-Image Scan

#### Applicability

次のいずれかを明示した場合だけ実行する。

```text
--image-ref <existing-local-or-registry-ref>
--image-tar <existing-tar-path>
```

自動 `docker build`、Dockerfile 推測、registry credential 発見、image name 推測は行わない。入力がなければ `image_input_not_provided` coverage gap とする。

#### Execution

```bash
trivy image --format json --output <output>/trivy-image.json <image-ref>
```

tar input は pinned Trivy version の supported option を CLI contract test で確認して command builder を分ける。registry credential を clean environment から暗黙継承しない。remote registry access が必要な場合は future authenticated scope とし、initial scope では local image / local tar を優先する。

- local image ref は host Trivy runner だけで扱う。
- Docker runner は read-only mount できる local image tar だけを扱う。
- host Docker socket を scanner container に mount しない。
- runner から入力へ到達できなければ `image_source_unreachable` coverage gap とする。

#### Output

- raw sanitized Trivy JSON artifact
- existing Trivy normalizer を target kind-aware に再利用
- OS package / language package location を image layer / package metadata として保存
- fingerprint に image digest を含める

## Profile Design

既存の軽量 profile を重くしない。

### Unchanged

- `baseline`
- `source-baseline`
- `basic-security`
- `dependency-manifest`
- `artifact`
- `web-app-baseline`
- `runtime-http-check`

### New Focused Profiles

| Profile | Steps | Semantics |
| --- | --- | --- |
| `runtime-web-safe` | HTTP baseline -> Nuclei safe -> ZAP Baseline | auto-start できる Web project 用。3 step required |
| `sbom-inventory` | Trivy CycloneDX | filesystem inventory。finding 0 でも artifact success を返す |
| `api-schema-readonly` | Schemathesis bounded read-only | schema 不在は completed_with_warnings + coverage gap |
| `container-image-security` | Trivy existing-image | image input 必須。未指定は completed_with_warnings + coverage gap |

### Existing Comprehensive Profile

`full-security-scan` は次の order に更新する。

```text
Semgrep
Gitleaks
OSV
Trivy filesystem
Trivy CycloneDX SBOM
HTTP baseline
Nuclei safe
ZAP Baseline
Schemathesis bounded read-only when schema exists
```

- 既存 4 static tools は required のままにする。
- SBOM は required とする。既存 Trivy executable を再利用できるためである。
- HTTP baseline は既存どおり optional とする。
- Nuclei、ZAP、Schemathesis は `warn_and_continue` とする。
- container image scan は暗黙入力がないため `full-security-scan` に追加しない。
- optional runtime step の未実行を report から隠さない。

`detailed-security` は static-only の意味を維持し、runtime tool を追加しない。SBOM 追加は `full-security-scan` と `sbom-inventory` に限定する。

## CLI Contract

通常実行は既存 command を維持する。

```bash
bun run scan:profile -- \
  --project-path /path/to/target \
  --profile full-security-scan \
  --runner host \
  --json
```

追加する focused wrapper は thin wrapper とする。

```text
scan:nuclei
scan:zap-baseline
scan:sbom
scan:schemathesis
scan:trivy-image
```

wrapper は adapter を直接別経路で実行せず、必ず profile runner / shared step executor を通す。

`scan:profile` に image input を追加する。

```text
--image-ref <ref>
--image-tar <path>
```

stdout は JSON object 1 件だけにする。tool log は artifact または stderr に送り、human progress text を stdout に混ぜない。

dry-run は command secret や target content を読まず、次を返す。

- resolved step order
- applicability input source
- runner kind / Docker image ref
- network requirement
- timeout / rate limit
- expected artifact formats
- safe policy ID / hash
- image input の有無

## Persistence and Reporting

新しい DB table / migration は作らない。

| Data | Existing storage |
| --- | --- |
| tool execution | `tool_runs` |
| JSON / JSONL / NDJSON / CycloneDX | `scan_artifacts` |
| normalized issue | `findings` |
| matched URL / operation / package evidence | `finding_evidence` |
| applicability / coverage gap | `scan_runs.metadata.stepResults` + `scan_events` |
| version / digest / policy hash | `tool_runs.metadata` |

Report に次を追加する。

1. `Runtime scanner coverage`
   - HTTP baseline / Nuclei / ZAP の status、target、finding count、gap reason
2. `API schema coverage`
   - schema source、read-only operation coverage、write operation gap
3. `Software inventory`
   - SBOM artifact、component counts、hash
4. `Container image coverage`
   - image digest / input status / finding count / gap
5. `Zero-finding interpretation`
   - tool 未実行、schema 不在、認証要求、image 不在を明示

raw artifact が存在しない completed result は許可しない。finding 0 件は valid structured artifact と normalizer completion の両方が確認できた場合だけ completed とする。

## Security Boundaries

- target path は read-only で scanner に渡す。
- output / cache だけを read-write mount にする。
- LLM / provider / cloud / registry credential を scanner environment に渡さない。
- runtime scan は auto-start した loopback project に限定する。
- public / production URL の自動 scan を行わない。
- redirect が scope 外へ出る場合は追従しない。
- command argument は typed builder で作り、shell string を実行しない。
- scanner subcommand を Docker allowlist に追加する。
- timeout 後は process / container を cleanup する。
- target process は profile `finally` で必ず停止する。
- output size、response size、evidence snippet size を制限する。
- Nuclei template update、ZAP add-on update、Trivy DB update を scan 中に暗黙実行しない。
- tool data update は明示的な vulnWorkbench maintenance command として分離する。
- tool / template / database timestamp を artifact metadata に残す。

## Implementation Plan

### Task 1: Freeze Baseline and Tool Contracts

Files:

- `spec/third-party-scanners.md`
- `docker/toolbox/Dockerfile`
- tool-specific contract fixtures under `tests/fixtures/tools/`

Work:

1. current profile dry-run / report fixtures を保存する。
2. exact Nuclei、templates、ZAP image、Schemathesis version を選定する。
3. version / digest / checksum / license inventory を記録する。
4. pinned CLI help から使用 flag を contract fixture 化する。
5. license gate または safe flag contract を満たさない tool は後続 task を止める。

### Task 2: Add Step and Coverage Schemas

Files:

- `shared/schemas/scan-profile.schema.ts`
- new shared step-result schema if profile result is still local-only
- `api/modules/scans/profile-runner.ts`
- `api/cli/scan-profile.ts`

Work:

1. 4 step kinds を追加する。
2. structured applicability / reason / coverage effect を追加する。
3. step ID / dry-run handling を exhaustive switch にする。
4. optional gap と required execution failure の profile outcome を test する。

### Task 3: Share Runtime Target Lifecycle

Files:

- `api/modules/dast/target-preparer.ts`
- `api/modules/scans/profile-runner.ts`
- `api/modules/dast/dast-runner.ts`
- related tests

Work:

1. runtime target を profile ごとに一度だけ start する。
2. existing HTTP DAST に prepared session を渡す。
3. host / Docker target URL を分離する。
4. container reachability preflight を追加する。
5. success、failure、timeout、skip の全 path で target cleanup を確認する。

### Task 4: Add Nuclei Safe Adapter

Files:

- `api/modules/runtime-scans/nuclei-runner.ts`
- `api/modules/runtime-scans/nuclei-normalizer.ts`
- tests / fixtures
- `docker/toolbox/Dockerfile`
- `api/modules/scans/tools/tool-process-runner.ts`

Work:

1. engine / template release を pinned toolbox に追加する。
2. safe template audit を build step にする。
3. typed command builder と Docker allowlist を追加する。
4. JSONL artifact、normalizer、fingerprint、metadata を実装する。
5. forbidden option / template / protocol test を追加する。

### Task 5: Add ZAP Baseline Adapter

Files:

- `api/modules/runtime-scans/zap-baseline-runner.ts`
- `api/modules/runtime-scans/zap-normalizer.ts`
- tests / fixtures
- Docker image policy module

Work:

1. official image digest と output mount を固定する。
2. preflight 後に baseline command を実行する。
3. exit 0 / 1 / 2 + valid report と exit 3 / invalid report を分離する。
4. JSON alert を finding / evidence に正規化する。
5. active/auth/Ajax option が command に入らないことを test する。

### Task 6: Add Trivy SBOM Mode

Files:

- `api/modules/scans/tools/trivy-runner.ts`
- SBOM metadata parser / tests
- `api/modules/scans/profile-runner.ts`

Work:

1. `fs-vulnerability` と `fs-sbom` の command mode を分ける。
2. CycloneDX JSON を schema-light validation する。
3. inventory artifact と metadata を保存する。
4. component を finding 化しないことを test する。

### Task 7: Integrate the Safe Slice of Phase 26

Files:

- Phase 26 で定義済みの `api/modules/api-schema-fuzz/*`
- `shared/schemas/scan-profile.schema.ts`
- `api/modules/scans/profile-runner.ts`
- report tests

Work:

1. Phase 26 の discovery / NDJSON / normalizer design を再利用する。
2. result semantics を `schema_not_found` coverage gap に変更する。
3. read-only HTTP method filter を command contract test で保証する。
4. auth header を渡さない。
5. write operations 未検査を report に残す。

### Task 8: Add Existing-Image Trivy Mode

Files:

- `api/modules/scans/tools/trivy-runner.ts`
- `api/cli/scan-profile.ts`
- focused wrapper / tests

Work:

1. image ref / tar input を typed CLI input として追加する。
2. no-input を coverage gap にする。
3. existing normalizer を image metadata 対応にする。
4. auto build と credential inheritance がないことを test する。

### Task 9: Add Profiles, Reports, and UI Rendering

Files:

- `api/modules/scans/profiles.ts`
- `api/modules/scans/report-builder.ts`
- `web/src/domains/scans/*`
- profile / report / UI tests

Work:

1. 4 focused profiles を追加する。
2. `full-security-scan` を定義した順序で更新する。
3. inventory と finding を別 section で表示する。
4. reason code を日本語の coverage gap として表示する。
5. existing lightweight profile の order / timeout が変わらないことを regression test する。

### Task 10: Documentation and End-to-End Verification

Files:

- `README.md`
- `README.jp.md`
- `spec/third-party-scanners.md`
- end-to-end fixtures

Work:

1. command、license、対象側設定不要の範囲を記載する。
2. intentional coverage gaps と non-goals を記載する。
3. local fixture app で shared runtime target を実証する。
4. all-tool live check は deterministic unit gate と分離する。

## Verification Strategy

### Deterministic Tests

```bash
bun test api/modules/scans/profile-runner.test.ts
bun test api/modules/scans/report-builder.test.ts
bun test api/modules/scans/tools/trivy-runner.test.ts
bun test api/modules/runtime-scans/nuclei-runner.test.ts
bun test api/modules/runtime-scans/nuclei-normalizer.test.ts
bun test api/modules/runtime-scans/zap-baseline-runner.test.ts
bun test api/modules/runtime-scans/zap-normalizer.test.ts
bun test api/modules/api-schema-fuzz/schema-discovery.test.ts
bun test api/modules/api-schema-fuzz/schemathesis-runner.test.ts
bun test api/modules/api-schema-fuzz/schemathesis-normalizer.test.ts
bun run build:web
bun run verify
```

Test fixtures must cover:

- zero finding + valid artifact
- finding present
- valid report + non-zero finding exit code
- tool binary unavailable
- invalid / truncated structured output
- timeout and cleanup
- schema absent
- auth-only API
- image input absent
- container target unreachable
- forbidden Nuclei template / option
- ZAP active/auth/Ajax option absence
- SBOM component not converted to finding
- no target repository mutation

### CLI Dry Runs

```bash
bun run scan:profile -- --profile runtime-web-safe --dry-run true --json
bun run scan:profile -- --profile sbom-inventory --dry-run true --json
bun run scan:profile -- --profile api-schema-readonly --dry-run true --json
bun run scan:profile -- --profile container-image-security --dry-run true --json
bun run scan:profile -- --profile full-security-scan --dry-run true --json
```

### Live Fixture Checks

Live checks are explicit and do not run as part of every deterministic verify.

1. local fixture Web app を auto-start する。
2. HTTP baseline、Nuclei、ZAP が同じ origin を使うことを確認する。
3. OpenAPI fixture がある場合だけ Schemathesis が実行されることを確認する。
4. fixture filesystem から CycloneDX artifact が生成されることを確認する。
5. prebuilt local fixture image を明示した場合だけ image scan が実行されることを確認する。
6. scan 後に target process / scanner container が残らないことを確認する。
7. target fixture tree の before / after hash が同じであることを確認する。

## Acceptance Criteria

- 対象 project に file / dependency / config を追加せずに全 focused profile を起動できる。
- `full-security-scan` は既存 static findings に加え、SBOM、HTTP baseline、Nuclei、ZAP、conditional Schemathesis の step evidence を返す。
- Nuclei は pinned safe template set 以外を実行できない。
- ZAP は baseline passive scan 以外を実行できない。
- Schemathesis は read-only methods 以外を実行できない。
- image scan は既存 image input なしに build や推測を行わない。
- structured artifact 欠落時に completed にならない。
- `not_applicable`、coverage gap、tool failure、finding-present が JSON / DB / report で区別される。
- SBOM は inventory artifact であり vulnerability finding count を水増ししない。
- tool / template / image version、digest、license inventory が追跡できる。
- existing baseline / static-only profile の behavior が変わらない。
- repo-native `bun run verify` が通る。

## Implementation Order

1. license / version / CLI contract gate
2. step result / coverage semantics
3. shared runtime target lifecycle
4. Nuclei safe
5. ZAP Baseline
6. Trivy CycloneDX SBOM
7. Phase 26 の safe Schemathesis slice
8. Trivy existing-image scan
9. profile / report / UI integration
10. deterministic verify + explicit live fixture verification

Nuclei または ZAP の license / distribution gate が止まっても、Trivy SBOM と Schemathesis を独立して進められるよう adapter task を分離する。

## Stop Conditions

次のいずれかが判明した場合、その adapter の実装を止めて計画を更新する。

- pinned distribution に組織ポリシー上許容できない license が含まれる。
- tool が stable structured output を出せない。
- safe mode を CLI flags / pinned policy で強制できない。
- ZAP container から auto-start target へ到達するために broad host exposure が必要になる。
- Nuclei の safe template set を deterministic に固定・監査できない。
- Schemathesis が read-only method filter を保証できない。
- Trivy image scan に target image の自動 build または暗黙 credential が必要になる。
- target repository への書き込みなしでは実行できない。
- cleanup を deterministic test で証明できない。

## Relation to Phase 26

`phase-26-schemathesis-api-schema-fuzzing-plan.md` は Schemathesis module、schema discovery、normalizer、artifact の詳細設計資料として維持する。

Phase 41 は次の点で Phase 26 の rollout decision を上書きする。

- schema 不在は focused profile failure ではなく coverage gap。
- initial execution は未認証かつ read-only HTTP methods に限定。
- shared runtime target session を利用。
- comprehensive profile への追加は Nuclei / ZAP / SBOM と同じ coverage contract に従う。
- CLI flag は implementation 時の pinned Schemathesis version で再検証する。

Phase 26 を削除または全面改稿せず、実装時に矛盾する acceptance / profile semantics だけを Phase 41 の決定に合わせて更新する。

## References

- [Nuclei running and output flags](https://docs.projectdiscovery.io/opensource/nuclei/running)
- [Nuclei engine license](https://github.com/projectdiscovery/nuclei)
- [Nuclei templates license](https://github.com/projectdiscovery/nuclei-templates)
- [ZAP Baseline scan](https://www.zaproxy.org/docs/docker/baseline-scan/)
- [ZAP license](https://github.com/zaproxy/zaproxy)
- [Trivy SBOM](https://trivy.dev/docs/latest/supply-chain/sbom/)
- [Trivy license](https://github.com/aquasecurity/trivy)
- [Schemathesis CLI](https://schemathesis.readthedocs.io/en/stable/reference/cli/)
- [Schemathesis license](https://github.com/schemathesis/schemathesis)
