# Git Diff Target Scan Implementation Plan

## 1. Status

2026-07-29時点:

```text
planning: complete
implementation: complete
code review hardening: complete
baseline branch: main
baseline commit: a0ed3224928ea51497cac9138b6906f55b1138a3
working tree: dirty; unrelated user changes exist and must not be included
```

実装完了時のverification:

```text
API tests: 146 files, 0 failures
Web tests: 22 files / 135 tests, 0 failures
TypeScript typecheck: passed
Biome lint: passed (warnings only)
Web production build: passed
git diff --check: passed
Project verify (tests/build/audit/artifact tracking): passed
```

実装後レビューでは、literal pathspecと厳格なUTF-8 path解析、project境界を跨ぐ
rename、symlinkのscope bypass、working treeのpreview/launch間変更、非scan対象の
snapshot残留、scanner出力のtemporary path漏洩、OSVのmanifest-only実行、
unmapped findingのcoverage表示、Web previewの競合、Git子processの終了処理を
追加でhardeningした。

この計画は、vulnWorkbenchの既存スキャナーをGit差分に対して実行できるようにする。
LLMやCodex Securityを新しいscannerとして追加する計画ではない。

実装は以下の7 sliceに分ける。

```text
Slice 0  baselineと契約固定
  -> Slice 1  ScanTarget schema / Git diff resolver
  -> Slice 2  immutable snapshot / diff workspace
  -> Slice 3  profile orchestration / persistence
  -> Slice 4  Semgrep / Gitleaks / OSV / Trivy integration
  -> Slice 5  CLI / Web API preview and launch
  -> Slice 6  Web UI / report and coverage
  -> Slice 7  end-to-end verification / rollout
```

各sliceは独立してレビュー可能にする。後続sliceを先行実装せず、各sliceの
acceptanceとverificationが通ってから次へ進む。

## 2. Purpose

利用者が次の対象だけをscanner-backed evidenceとして確認できるようにする。

- 特定commitで変更されたファイル
- base branchとhead branchの間で変更されたファイル
- 現在のworking treeで変更されたファイル
- staged、unstaged、untrackedを含むcommit前の変更

差分解決、snapshot固定、scanner実行、artifact保存、coverage表示は
vulnWorkbenchが所有する。scanner固有のGit機能へ差分解決を分散させない。

この機能の実行経路はLLMを呼び出さない。finding review、scan review、
report summaryなど既存の明示的なLLM操作は別操作のまま維持し、
diff scan完了を理由に自動起動しない。

## 3. Fixed Product Semantics

### 3.1 V1の意味

V1のdiff scanは次の意味とする。

> Git差分に含まれるファイルを、変更後snapshotの内容でファイル単位に検査する。

V1は「この変更で新規に発生したfindingだけ」を保証しない。
変更されたファイルに以前から存在するfindingも返り得る。

表示とAPIでは次の用語を使用する。

```text
allowed:
  差分対象
  変更ファイル
  差分関連finding
  target-state dependency finding

not allowed:
  新規脆弱性
  このcommitが導入した脆弱性
  regression confirmed
```

base/head双方をscanして`introduced` / `unchanged` / `resolved`を判定する機能は
V2候補とし、この計画には含めない。

### 3.2 Path scope

- diffはhunk単位ではなくfile単位で適用する。
- modified fileはファイル全体をscanする。
- added、modified、renamed、copied、type-changedをscan候補にする。
- deleted pathはscanせず、coverage recordとして保持する。
- rename/copyはold pathとnew pathをmanifestに保持し、new pathをscanする。
- binary、gitlink、symlink escape、size limit超過は黙って無視せず、
  dispositionとreason codeをmanifestに残す。
- profileの既存include/exclude policyとmandatory excludesを適用する。
- `.git/**`と`artifacts/**`をscan対象にしない。

### 3.3 Target modes

```ts
type ScanTarget =
	| { kind: "full" }
	| {
			kind: "commit";
			head: string;
			base?: string;
	  }
	| {
			kind: "range";
			base: string;
			head: string;
	  }
	| {
			kind: "working_tree";
			base?: string;
			includeUntracked: boolean;
	  };
```

Target解決規則:

| kind | base | target state | changed paths |
| --- | --- | --- | --- |
| `full` | none | current project path | existing full scan |
| `commit` | explicit base、またはsingle parent | resolved head commit | base tree → head tree |
| `range` | merge-base(base, head) | resolved head commit | merge-base → head tree |
| `working_tree` | explicit base、既定`HEAD` | frozen worktree snapshot | base tree → index/worktree/untracked |

追加規則:

- refは`git rev-parse --verify <ref>^{commit}`相当でcommit SHAへ解決する。
- 自動`git fetch`を行わない。
- refがlocal repositoryに存在しなければfail closedにする。
- root commitのimplicit baseにはGit empty treeを使用する。
- merge commitの`commit` targetでbase未指定の場合は、
  parentを推測せず`ambiguous_commit_parent`で拒否する。
- `range`は文字列上の`base..head`ではなくmerge-baseを使用する。
- `working_tree`はtracked staged/unstagedに加えて、
  `includeUntracked=true`の場合のみuntracked non-ignored fileを含める。
- conflict/unmerged pathがあればpreviewは返せるが、launchは
  `unmerged_worktree`で拒否する。

### 3.4 Existing scan comparisonとの境界

既存のscan comparisonは、完了済みscan run間のfindingをfingerprint等で比較する。
Git diff targetはscanner実行前の入力範囲を決める機能であり、両者を統合しない。

```text
Git diff target:
  source input selection
  before scanner execution

Scan comparison:
  finding comparison
  after scanner execution
```

diff scanを通常scanのbaseline comparisonへ自動選択しない。

## 4. Current Baseline

現在の実装:

- `ScanProfile`にはsource / dependency manifest / artifact / full deepの
  scope policyがあるが、Git targetはない。
- `profile-orchestrator.ts`がscopeを解決し、同じ`repoPath`を各stepへ渡す。
- Semgrepは単一のrepository pathをtargetとして実行する。
- Gitleaksはsource scopeでtemporary scoped workspaceを作り`--no-git`を使う。
- OSVはrepository pathを常にrecursive scanする。
- Trivyはmodeとscopeに応じてrepositoryまたはscoped workspaceをscanする。
- `scan_runs.metadata`と`scan_artifacts`で追加provenanceを保存できる。
- Webのscan開始APIはprofileとrunner optionsを受け取るがtargetを持たない。
- Static Intelligenceにはdirty state hashの実装があるが、
  scan input snapshotを生成する責務はない。

実装開始時に次を実行し、既存failureと今回のfailureを分離する。

```bash
git status --short
git rev-parse HEAD
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run build
```

baseline取得時に既存のdirty fileを整形、修正、stageしない。

## 5. Non-goals

- LLM scanner、Codex Security、agentic scannerの統合
- diff scan後のLLM review自動起動
- hunk単位だけへのfinding filter
- base/head両方のscanner実行によるintroduced/resolved判定
- Git history全体のsecret audit
- range中に追加され、headでは削除済みのsecret検出
- remote refの自動fetch
- pull request provider APIとの統合
- repository checkoutのbranch切り替え
- source repositoryへのtemporary worktree追加
- DAST、Nuclei、ZAP、Schemathesisのdiff target実行
- container image scanのdiff target実行
- submoduleの自動clone/update
- existing finding fingerprintの全面再設計
- diff scanと無関係なprofile、runner、UIのリファクタリング

## 6. Target Architecture

```text
ScanTarget request
  -> GitDiffResolver
       -> resolve refs
       -> determine merge-base / parent
       -> parse NUL-delimited name-status
       -> add untracked entries
       -> apply project/profile scope
  -> DiffScanPlan
       -> normalized target
       -> deterministic DiffManifest
       -> per-tool applicability
       -> target digest
  -> DiffSnapshotBuilder
       -> immutable target tree
       -> overlay working-tree changes
       -> changed-files workspace
       -> verify snapshot digest
  -> ProfileOrchestrator
       -> persist target metadata and manifest artifact
       -> run applicable static steps
       -> record explicit skips/gaps
  -> Existing tool runners
       -> normalized findings
       -> target provenance metadata
  -> API / UI / reports
       -> target badge
       -> changed-file coverage
       -> limitations
```

新規module:

```text
shared/schemas/scan-target.schema.ts
api/modules/scans/git-command.ts
api/modules/scans/git-diff-resolver.ts
api/modules/scans/git-diff-resolver.test.ts
api/modules/scans/diff-scan-plan.ts
api/modules/scans/diff-scan-plan.test.ts
api/modules/scans/diff-snapshot.ts
api/modules/scans/diff-snapshot.test.ts
```

責務境界:

- `git-command.ts`はstructured args、timeout、maxBuffer、error mappingだけを持つ。
- `git-diff-resolver.ts`はGit stateをread-onlyで解決する。
- `diff-scan-plan.ts`はscope、disposition、tool applicability、digestを決める。
- `diff-snapshot.ts`はtemporary filesystem materializationとcleanupを所有する。
- scanner runnerはref、merge-base、working treeの意味を解釈しない。
- orchestratorは一つのresolved planとsnapshotを全stepで共有する。

## 7. Contracts

### 7.1 Resolved target

```ts
type ResolvedScanTarget = {
	kind: "commit" | "range" | "working_tree";
	requested: ScanTarget;
	gitRoot: string;
	projectPrefix: string;
	baseSha: string;
	headSha: string | null;
	mergeBaseSha: string | null;
	includeUntracked: boolean;
	targetDigest: string;
	snapshotDigest: string | null;
	changedFileCount: number;
	scannableFileCount: number;
};
```

- API、DB、artifactへabsolute `gitRoot`を保存しない。
- `projectPrefix`はrepository-relative POSIX pathとして保存できる。
- `requested`にraw user pathを持たせない。
- ref名は保存可能だが、実行identityにはresolved SHAを使う。
- working treeはhead SHAを持たず、base SHAとsnapshot digestで識別する。

### 7.2 Diff manifest

```ts
type DiffManifestEntry = {
	status:
		| "added"
		| "modified"
		| "deleted"
		| "renamed"
		| "copied"
		| "type_changed"
		| "unmerged"
		| "untracked"
		| "gitlink";
	path: string;
	oldPath?: string;
	contentSha256?: string;
	sizeBytes?: number;
	binary: boolean;
	inProfileScope: boolean;
	disposition:
		| "scan"
		| "deleted"
		| "excluded"
		| "unsupported"
		| "too_large";
	reasonCode: string | null;
};
```

manifest全体:

```ts
type DiffManifest = {
	schemaVersion: 1;
	target: Omit<ResolvedScanTarget, "gitRoot">;
	limits: {
		maxFiles: number;
		maxTotalBytes: number;
		maxSingleFileBytes: number;
	};
	coverage: {
		changed: number;
		scannable: number;
		deleted: number;
		excluded: number;
		unsupported: number;
		tooLarge: number;
	};
	entries: DiffManifestEntry[];
};
```

manifest rules:

- entriesは`path`, `oldPath`, `status`の順で安定sortする。
- JSON serializationは同じkey orderを使用する。
- target digestはresolved targetとentriesのcanonical JSONから計算する。
- manifestにfile content、diff hunk、secret値、absolute pathを保存しない。
- working treeのcontent identityはSHA-256だけを保存する。
- scanner用temporary pathを保存しない。

### 7.3 Reason codes

Target resolution error:

```text
not_a_git_repository
git_ref_not_found
ambiguous_commit_parent
merge_base_not_found
unmerged_worktree
target_changed
diff_target_too_large
snapshot_materialization_failed
snapshot_digest_mismatch
```

Coverage / applicability:

```text
no_changed_files
no_relevant_files
no_dependency_manifest_changed
deleted_path
profile_excluded
binary_not_supported
gitlink_not_materialized
symlink_escape
file_too_large
diff_target_not_supported
```

errorとcoverage gapを同じstatusにしない。
ref failureやsnapshot mismatchはscan failure、
deleted/excluded/binaryはmanifest coverageとして扱う。

### 7.4 Static step result

static toolにもruntime coverage stepと同じapplicability情報を持たせる。

```ts
type DiffAwareToolResult = ToolResult & {
	applicability: "applicable" | "not_applicable";
	reasonCode: string | null;
	coverageEffect: "covered" | "partial" | "gap";
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
};
```

既存full scanでは次をdefaultにする。

```text
applicability=applicable
reasonCode=null
coverageEffect=completedならcovered、failedならgap
```

diff scanでのmapping:

| Condition | status | applicability | coverageEffect |
| --- | --- | --- | --- |
| applicable tool completed | completed | applicable | covered |
| no changed/relevant file | skipped | not_applicable | covered |
| no dependency manifest changed | skipped | not_applicable | covered |
| unsupported/too-large fileが一部存在 | completed/skipped | applicableまたはnot_applicable | partial |
| applicable tool failed/unavailable | failed | applicable | gap |

`required`はapplicable toolのfailure policyにだけ適用する。
not-applicable required toolをprofile failureにしない。

### 7.5 Resource limits

V1の固定default:

```text
max changed entries: 5,000
max copied bytes: 512 MiB
max single changed file: 20 MiB
Git command timeout: 30 seconds
Git stdout/stderr maxBuffer: 32 MiB
```

- limit超過時に対象をtruncateしてcompletedにしない。
- changed entryまたはtotal bytes上限超過はlaunch前に
  `diff_target_too_large`で拒否する。
- single file上限超過はmanifestへ`too_large`として残し、
  profile outcomeを`completed_with_warnings`にする。
- binary fileはscannerへ渡さずcoverage gapにする。
- limit override用のWeb入力やCLI flagはV1に追加しない。

## 8. Profile and Tool Policy

### 8.1 Dedicated profile

既存profileの意味を変更せず、次を追加する。

```text
id: diff-source-baseline
category: focused
supportedTargets:
  - commit
  - range
  - working_tree
tools:
  - semgrep, required when applicable
  - gitleaks, required when applicable
  - osv, optional and conditional
  - trivy, optional and conditional
```

`ScanProfile`へoptional `supportedTargets`を追加する。
未指定profileは`["full"]`として扱う。

- `diff-source-baseline`に`full`を指定した場合はrejectする。
- 他profileにnon-full targetを指定した場合は
  `diff_target_not_supported`でrejectする。
- DAST/runtime/image stepを含むprofileはV1でnon-full targetを許可しない。
- toolがapplicableでない場合はfailureではなくstructured skipを記録する。
- required toolがapplicableだが実行失敗した場合は従来どおりprofile failureにする。

### 8.2 Tool applicability

| Tool | Applicable condition | Input |
| --- | --- | --- |
| Semgrep | scoped text sourceが1件以上 | immutable full snapshot + explicit changed paths |
| Gitleaks | scoped text fileが1件以上 | changed-files workspace + `--no-git` |
| OSV | dependency manifest/lockfile変更あり | immutable full target snapshot |
| Trivy | scoped text fileが1件以上 | changed-files workspace |

dependency manifest/lockfile classifierは既存の
`DEPENDENCY_MANIFEST_SCOPE`と同じsource of truthを使う。
別の拡張子一覧をdiff moduleへ複製しない。

dependency manifest/lockfileが変更された場合、Trivy用workspaceには
同じpackage rootの認識済みmanifest/lockfileをcontext-only fileとして補う。
context-only fileはchanged countに含めず、tool run metadataの
`contextFileCount`へ記録する。

### 8.3 Semgrep

`SemgrepRunnerOptions`へrepository-relative `targetPaths`を追加する。

- commandはsnapshot rootをcwd/repoPathにし、target pathをstructured argsで渡す。
- `--include` / `--exclude` policyは維持する。
- path数がOSのargv limitに近づく場合、勝手に複数tool runへ分割せず、
  changed-files workspaceを単一targetとして使用する。
- normalizerがtemporary snapshot pathをfindingへ残さないことをtestする。
- whole-file scanであり、added line filterは行わない。

### 8.4 Gitleaks

- changed-files workspaceだけを`--source`へ渡す。
- 常に`--no-git`を使用する。
- raw artifact redactionを維持する。
- deleted file、range途中で削除済みのsecret、Git historyは対象外と明記する。
- changed fileの既存secretがfindingになることを許容する。

### 8.5 OSV

- manifest/lockfile変更がない場合は実行せず、
  `no_dependency_manifest_changed`でnot applicableにする。
- manifest/lockfile変更がある場合は変更後のfull snapshotをrecursive scanする。
- findingは`target-state dependency finding`として扱い、
  introduced findingとは表示しない。
- `dependencyMode=installed_tree`はdiff profileで使用しない。
- base snapshotとの自動比較は行わない。

### 8.6 Trivy

- changed-files workspaceを1回だけscanする。
- profileの`scanners=["vuln", "secret", "misconfig"]`を維持する。
- dependency manifest/lockfile変更時は同じpackage rootのdependency companionを
  context-onlyでworkspaceへ追加する。
- context-only dependency file由来のfindingは
  `diffRelation.kind="target_state_dependency"`として扱う。
- source repository全体へfallbackしない。
- tool run metadataにchanged file count、context file count、
  target digestを保存する。

## 9. Persistence and Provenance

V1ではDB migrationを追加しない。

`scan_runs.metadata`:

```json
{
  "target": {
    "schemaVersion": 1,
    "kind": "working_tree",
    "baseSha": "...",
    "headSha": null,
    "mergeBaseSha": null,
    "targetDigest": "...",
    "snapshotDigest": "...",
    "includeUntracked": true
  },
  "diffCoverage": {
    "changed": 4,
    "scannable": 3,
    "deleted": 1,
    "excluded": 0,
    "unsupported": 0,
    "tooLarge": 0
  }
}
```

artifact:

```text
kind: diff_manifest
format: json
filename: diff-manifest.json
toolRunId: null
```

必要な変更:

- `shared/schemas/scan.schema.ts`のartifact kindへ`diff_manifest`を追加する。
- `web/src/api/scans.ts`のartifact unionへ同じkindを追加する。
- `ArtifactStorage.saveTextArtifact()`でcanonical JSONを保存する。
- `ArtifactRepository.createArtifact()`でscan-level artifactとして登録する。

各finding metadataへ次を追加する。

```json
{
  "scanTarget": {
    "kind": "commit",
    "baseSha": "...",
    "headSha": "...",
    "targetDigest": "..."
  },
  "diffRelation": {
    "kind": "changed_file",
    "pathStatus": "modified"
  }
}
```

- scannerがmanifest外のpathを返した場合はfindingを黙って保存しない。
- OSV/Trivy dependency findingはlocationがmanifest fileへ直接対応しない場合があるため、
  `diffRelation.kind="target_state_dependency"`を許可する。
- unknown external pathはnormalization gapとしてtool metadataへ記録する。

## 10. Snapshot and Security Decisions

### 10.1 Committed target

- source repositoryのcheckout、index、refsを変更しない。
- system temporary directoryにlocal shared cloneを作る。
- `git clone --shared --no-checkout -- <gitRoot> <temporaryPath>`相当を
  structured argsで実行する。
- resolved head SHAをdetached checkoutする。
- scanner rootはsnapshot内のproject prefixとする。
- source repositoryへ`git worktree add`しない。
- submoduleをinit/updateしない。

### 10.2 Working-tree target

1. base SHAをdetached snapshotへcheckoutする。
2. normalized manifest順にworking treeのcurrent fileをoverlayする。
3. deleted/renamed old pathをsnapshotから削除する。
4. enabledなuntracked fileをoverlayする。
5. file content hashとsizeを再計算する。
6. preview時の`expectedTargetDigest`がある場合は一致を確認する。
7. snapshot完成後にsnapshot digestを計算し、manifestへ固定する。

copy中にsource fileが変わった場合:

- copy前後のstatだけで成功判定しない。
- copied bytesのSHA-256とplan content SHA-256を比較する。
- mismatchは`target_changed`としてsnapshotを破棄する。
- scannerを開始しない。

### 10.3 Filesystem safety

- Git commandはshell文字列ではなく`spawn` / `execFile` structured argsを使う。
- refをcommand optionとして補間せず、検証後にargsへ渡す。
- pathspec前に`--`を使う。
- diff/name-statusは`-z`で取得し、改行、tab、quoteを含むpathを安全にparseする。
- output pathはproject-relative POSIX pathへ正規化する。
- `..`、absolute path、NULを含むnormalized pathを拒否する。
- symlinkはlink自体を再現し、resolved targetがsnapshot外へ出るものをscanしない。
- temporary directoryはscanのfinallyで削除する。
- cleanup failureはscan artifactへpathを保存せずwarn eventだけを記録する。
- diff manifestにdiff本文やsource bodyを保存しない。

## 11. CLI and API Contract

### 11.1 CLI

追加option:

```text
--target full|commit|range|working-tree
--base <ref>
--head <ref>
--include-untracked true|false
--expected-target-digest <sha256>
--preview true|false
```

Examples:

```bash
# commit
bun run scan:profile -- \
  --project-path . \
  --profile diff-source-baseline \
  --target commit \
  --head abc123 \
  --base abc123^

# branch / PR-like range
bun run scan:profile -- \
  --project-path . \
  --profile diff-source-baseline \
  --target range \
  --base origin/main \
  --head HEAD

# current working tree
bun run scan:profile -- \
  --project-path . \
  --profile diff-source-baseline \
  --target working-tree \
  --base HEAD \
  --include-untracked true

# resolve only
bun run scan:profile -- \
  --project-path . \
  --profile diff-source-baseline \
  --target working-tree \
  --preview true \
  --json
```

Validation:

- `commit`はhead必須、base optional。
- `range`はbase/head必須。
- `working-tree`はhead禁止、base optional。
- `full`はbase/head/include-untracked/expected-target-digest禁止。
- incompatible optionはscan row作成前にexit code 2で返す。
- previewはDB scan run、artifact、tool runを作らない。
- preview JSONはresolved target、coverage、entries、tool applicabilityを返す。

### 11.2 Web API

追加endpoint:

```http
POST /api/projects/:projectId/scans/preview
```

request:

```json
{
  "profile": "diff-source-baseline",
  "target": {
    "kind": "working_tree",
    "base": "HEAD",
    "includeUntracked": true
  }
}
```

response:

```json
{
  "target": {
    "kind": "working_tree",
    "baseSha": "...",
    "headSha": null,
    "targetDigest": "..."
  },
  "coverage": {
    "changed": 4,
    "scannable": 3,
    "deleted": 1,
    "excluded": 0,
    "unsupported": 0,
    "tooLarge": 0
  },
  "entries": [],
  "tools": []
}
```

既存scan start requestへ追加:

```json
{
  "profile": "diff-source-baseline",
  "target": {
    "kind": "working_tree",
    "base": "HEAD",
    "includeUntracked": true
  },
  "expectedTargetDigest": "..."
}
```

- preview/start双方でproject ownershipとallowed-root policyを再利用する。
- previewはread-onlyだが任意host path探索を許さない。
- queued scan metadataにrequested targetとexpected digestを保存する。
- workerはtargetを再解決し、digest不一致ならscanを開始せずfailedにする。
- CLI argsへtarget fieldを個別structured argsとして渡す。
- request body全体をcommand line JSONとして渡さない。
- API responseはabsolute repository pathとtemporary pathを返さない。
- preview responseはcontent SHA-256を返さず、path、status、disposition、
  reason codeだけを返す。

## 12. Web UI and Report Contract

### 12.1 Launch UI

`ScansToolbar`にprofile選択後のtarget selectorを追加する。

```text
通常スキャン
作業ツリー
コミット
ブランチ差分
```

- `diff-source-baseline`選択時だけnon-full targetを選択できる。
- working treeのdefault baseは`HEAD`、untrackedはdefault true。
- commitはhead入力、base optional。
- rangeはbase default `project.defaultBranch`、head default `HEAD`。
- start前にpreviewを実行する。
- preview完了前はstart buttonを無効化する。
- working treeが変わった場合は`target_changed`を表示し、再previewを要求する。
- changed file pathを最大100件表示し、残り件数を要約する。
- excluded/deleted/unsupportedは別countとして表示する。
- secret値、diff本文、source snippetをpreview表示しない。

### 12.2 Scan history/detail

diff scanにはtarget badgeを表示する。

```text
WORKTREE @ base a0ed322
COMMIT abc1234
RANGE origin/main...HEAD
```

- raw refだけでなくresolved short SHAを表示する。
- target digestを詳細欄で確認できる。
- findingには「変更ファイルに関連」を表示する。
- OSV/Trivy dependency findingには「変更後依存状態」を表示する。
- 「新規」と表示しない。

### 12.3 Report and zero-finding behavior

reportへ`Diff Target and Coverage` sectionを追加する。

- target kind
- resolved base/head/merge-base
- changed/scannable/deleted/excluded/unsupported/too-large count
- tool applicabilityとskip reason
- whole-file scan semantics
- V1ではintroduced-onlyを保証しない旨

zero finding時:

- `scannable > 0`かつapplicable tool completedなら
  「対象範囲ではfindingなし」とする。
- `changed = 0`は「変更なし」とし、security clean claimにしない。
- `scannable = 0`は「検査可能な変更なし」とする。
- required applicable tool failureがある場合はzero-finding successにしない。
- coverage gapがある場合はpartial coverageとして残す。

## 13. Implementation Slices

### Slice 0: Baseline and Contract Freeze

Priority: P0
Dependencies: none

Changes:

1. implementation開始commitとdirty filesを記録する。
2. current full scan dry-run outputをfixtureとして固定する。
3. existing `baseline` profileのtool orderとmetadata shapeをtestで固定する。
4. diff scan terminologyとV1 limitationをこのspecから変更しない。
5. unrelated working-tree changesを実装commitに含めない。

Primary files:

- `api/modules/scans/profile-runner.test.ts`
- `api/modules/scans/profile-orchestrator.ts`
- `api/cli/scan-profile.ts`

Acceptance:

- target未指定時の既存scan behaviorが変わらない。
- full scan dry-run outputに不要なdiff fieldを追加しない。
- baseline failureがある場合はimplementation failureと混同しない。

Verification:

```bash
bun test api/modules/scans/profile-runner.test.ts
bun run typecheck
git diff --check
```

Failure handling:

- existing test failureは修正せずbaselineとして記録する。
- unrelated formatter差分をSlice 0へ混ぜない。

### Slice 1: ScanTarget Schema and Git Diff Resolver

Priority: P0
Dependencies: Slice 0

New files:

- `shared/schemas/scan-target.schema.ts`
- `api/modules/scans/git-command.ts`
- `api/modules/scans/git-diff-resolver.ts`
- `api/modules/scans/git-diff-resolver.test.ts`

Changes:

1. request、resolved target、manifest entry、coverage schemaを追加する。
2. ref、parent、merge-base、empty treeを解決する。
3. `git diff --name-status -z --find-renames --find-copies`をparseする。
4. working treeでは`git diff <base> --`と
   `git ls-files --others --exclude-standard -z`を統合する。
5. project scope外pathを除外する。
6. deterministic orderingとtarget digestを実装する。
7. Git errorをstable reason codeへmappingする。
8. preview用tool-neutral planを返す。

Required tests:

- normal single-parent commit
- root commit
- merge commit with/without explicit base
- range with merge-base
- diverged branch
- staged only
- unstaged only
- staged + later unstaged edit
- untracked included/excluded
- ignored untracked excluded
- added/modified/deleted/renamed/copied/type-changed
- unmerged path
- gitlink
- path containing space/tab/newline/non-ASCII
- invalid/missing ref
- non-Git directory
- nested project prefix
- empty diff
- stable ordering and digest

Acceptance:

- resolverはsource repositoryを変更しない。
- 同じGit stateからbyte-identical canonical manifestを生成する。
- ref解決失敗をempty diffとして返さない。
- working treeのuntracked fileを設定どおり扱う。

Verification:

```bash
bun test api/modules/scans/git-diff-resolver.test.ts
bun run typecheck
bun run lint
```

Failure handling:

- Git version差でoutputが不安定な場合、human-readable parseへfallbackせず
  supported Git versionを明示する。
- nested project prefixを安全に解決できない場合、root全体へ拡張せずrejectする。

### Slice 2: Immutable Snapshot and Changed-files Workspace

Priority: P0
Dependencies: Slice 1

New files:

- `api/modules/scans/diff-snapshot.ts`
- `api/modules/scans/diff-snapshot.test.ts`

Modified files:

- `api/modules/scans/target-scope.ts`
- `api/modules/scans/target-scope.test.ts`

Changes:

1. committed targetをtemporary detached shared cloneへmaterializeする。
2. working tree overlay、delete、rename、untracked copyを実装する。
3. profile scopeとmanifest dispositionからchanged-files workspaceを作る。
4. copy前後のcontent hashを確認する。
5. full snapshotとchanged-files workspaceを同じlifecycleでcleanupする。
6. repository-relative scanner path mappingを提供する。
7. snapshot digestとcopied byte countを返す。
8. symlink/gitlink/binary/large fileのpolicyを適用する。

Required tests:

- source checkout branch/index/statusが変わらない
- committed target content matches head
- working overlay includes staged/unstaged/untracked
- deleted/rename old path removed
- file mutation during copy returns target_changed
- symlink inside snapshot
- symlink escape excluded
- gitlink not materialized
- temporary path cleanup on success/failure/cancel
- no absolute temporary path in returned metadata
- resource limit enforcement

Acceptance:

- 全scannerが同じimmutable snapshot generationを使用できる。
- working treeをscannerが直接読む経路がない。
- cleanup失敗を理由にsource repositoryを削除・変更しない。

Verification:

```bash
bun test api/modules/scans/diff-snapshot.test.ts
bun test api/modules/scans/target-scope.test.ts
bun run typecheck
bun run lint
```

Failure handling:

- shared cloneがsupported environmentで利用できない場合、
  source checkoutを使わず、safe archive materializerを別実装する。
- snapshot mismatch時はscannerを起動せずscanをfailedにする。

### Slice 3: Profile Orchestration and Persistence

Priority: P0
Dependencies: Slice 2

New files:

- `api/modules/scans/diff-scan-plan.ts`
- `api/modules/scans/diff-scan-plan.test.ts`

Modified files:

- `shared/schemas/scan-profile.schema.ts`
- `shared/schemas/scan.schema.ts`
- `api/modules/scans/profiles.ts`
- `api/modules/scans/profile-orchestrator.ts`
- `api/modules/scans/profile-runner.ts`
- `api/modules/scans/repositories.ts`
- `api/modules/scans/artifact-storage.ts`
- related tests

Changes:

1. `supportedTargets`と`diff-source-baseline` profileを追加する。
2. target resolutionをscan row claim後、tool run開始前に行う。
3. resolved targetとcoverageをscan metadataへ保存する。
4. canonical `diff-manifest.json`をscan-level artifactとして保存する。
5. tool applicabilityをstep execution前に決める。
6. static `ToolResult`へapplicability、reason、coverage effectを追加する。
7. not-applicable stepをstructured skipとして保存する。
8. findingへtarget/diff relation metadataを付与する。
9. finallyでsnapshot lifecycleを閉じる。
10. cancel時にもsnapshot cleanupを行う。
11. full target pathは従来挙動を維持する。

Required tests:

- unsupported profile + diff target rejected
- diff profile + full target rejected
- empty diff completes with explicit no_changed_files
- no manifest change skips OSV/dependency Trivy
- deleted-only diff creates coverage but no tool input
- manifest artifact registration
- queued scan target metadata preserved
- required applicable tool failure still fails profile
- not-applicable required tool does not fail profile
- full baseline behavior unchanged
- cleanup after tool failure/cancel

Acceptance:

- scan runからtarget identityとcoverageを再構成できる。
- manifest artifactとmetadataのtarget digestが一致する。
- not applicableをsuccessfully scannedとして集計しない。
- full scanにsnapshot作成costを追加しない。

Verification:

```bash
bun test api/modules/scans/profile-runner.test.ts
bun test api/modules/scans/diff-scan-plan.test.ts
bun test api/modules/scans/repositories.test.ts
bun test api/modules/scans/artifact-storage.test.ts
bun run typecheck
```

Failure handling:

- metadataだけ保存されartifact登録が失敗した場合はscanを開始しない。
- partial persistenceをcompleted scanとして残さない。

### Slice 4: Static Scanner Integration

Priority: P0
Dependencies: Slice 3

Modified files:

- `api/modules/scans/tools/semgrep-runner.ts`
- `api/modules/scans/tools/semgrep-runner.test.ts`
- `api/modules/scans/tools/gitleaks-runner.ts`
- `api/modules/scans/tools/gitleaks-runner.test.ts`
- `api/modules/scans/tools/osv-runner.ts`
- `api/modules/scans/tools/osv-runner.test.ts`
- `api/modules/scans/tools/trivy-runner.ts`
- `api/modules/scans/tools/trivy-runner.test.ts`
- `api/modules/scans/profile-runner.ts`
- normalizer tests as needed

Changes:

1. Semgrepへexplicit changed pathまたはchanged workspaceを渡す。
2. Gitleaksをchanged workspace + `--no-git`へ固定する。
3. OSVをmanifest change時だけfull snapshotへ実行する。
4. Trivyをchanged workspaceへ実行し、dependency companionを補う。
5. scanner output pathをproject-relative pathへremapする。
6. manifest外findingをgapとして処理する。
7. tool run metadataへinput kind、target digest、file countを保存する。
8. Docker runnerでもsnapshot path mountが正しく置換されることを確認する。

Required tests:

- exact command args and cwd for every tool
- no source repository path passed as diff scan target
- no secret-bearing environment variables
- tool output contains no temporary absolute path
- Semgrep modified-file finding
- Gitleaks changed-file secret
- OSV skipped/no manifest and executed/manifest changed
- Trivy changed/context workspace and metadata
- Docker path mapping
- invalid JSON/tool unavailable/timeout behavior unchanged

Acceptance:

- Semgrep/Gitleaksのwork量がchanged file scopeへ縮小する。
- OSV/Trivy dependency resultをintroducedと誤表示しない。
- existing raw artifact redactionを維持する。
- tool commandにuser-controlled shell fragmentを追加しない。

Verification:

```bash
bun test api/modules/scans/tools/semgrep-runner.test.ts
bun test api/modules/scans/tools/gitleaks-runner.test.ts
bun test api/modules/scans/tools/osv-runner.test.ts
bun test api/modules/scans/tools/trivy-runner.test.ts
bun test api/modules/scans/profile-runner.test.ts
bun run typecheck
bun run lint
```

Failure handling:

- scannerが複数pathを安定して扱えない場合、source repository全体へfallbackせず
  changed-files workspaceを使用する。
- dependency resultのpath relationが不明な場合、source file findingへ偽装せず
  target-state dependency relationを使用する。

### Slice 5: CLI and Web API

Priority: P1
Dependencies: Slice 4

Modified files:

- `api/cli/scan-profile.ts`
- `api/modules/scans/profile-runner.test.ts`
- `api/routes/projects.route.ts`
- `api/routes/projects.route.test.ts`
- `api/routes/scan-profiles.route.ts`
- `api/routes/scan-profiles.route.test.ts`
- `web/src/api/scans.ts`

Changes:

1. CLI target options、validation、preview JSONを追加する。
2. scan profile APIへsupported targetsを返す。
3. project scan preview routeを追加する。
4. scan start bodyへtargetとexpected digestを追加する。
5. queued metadataへrequested targetを保存する。
6. supervisor argsへvalidated fieldを個別追加する。
7. preview/start双方へownership/path policyを適用する。
8. API errorへstable reason codeを返す。

Required tests:

- every valid CLI mode
- incompatible/missing CLI flags
- preview creates no DB records
- preview ownership rejection
- preview path-policy rejection
- preview output omits absolute paths
- queued args contain resolved target options
- target changed between preview and worker launch
- legacy start body defaults to full
- profile response exposes supported target modes

Acceptance:

- CLIだけでcommit/range/working-tree scanを完了できる。
- Web APIはpreview digestなしのworking-tree launchを拒否する。
- legacy Web/API full scanが互換動作する。

Verification:

```bash
bun test api/modules/scans/security-oracle-cli.test.ts
bun test api/routes/projects.route.test.ts
bun test api/routes/scan-profiles.route.test.ts
bun run typecheck
bun run lint
```

Failure handling:

- supervisor command生成に曖昧なserialized blobを使わない。
- worker再解決のfailureをqueuedのまま残さずfailed eventへ確定する。

### Slice 6: Web UI, Coverage, and Report

Priority: P1
Dependencies: Slice 5

Modified files:

- `web/src/domains/scans/components/scans-sidebar.tsx`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/domains/scans/scans-context.tsx`
- `web/src/domains/scans/components/run-card-list.tsx`
- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/coverage-summary.ts`
- `api/modules/scans/report-builder.ts`
- related tests and styles

New files:

- `web/src/domains/scans/diff-target-display.ts`
- `web/src/domains/scans/diff-target-display.test.ts`
- `web/src/domains/scans/components/diff-target-preview.tsx`

Changes:

1. target mode/ref/untracked stateをcontrollerへ追加する。
2. selected profile capabilityでtarget UIを制御する。
3. preview loading/error/stale stateを実装する。
4. start requestへpreview digestを渡す。
5. changed file/coverage previewを表示する。
6. scan history/detailへtarget badgeを表示する。
7. finding relation labelを表示する。
8. reportとzero-finding copyへdiff semanticsを反映する。
9. existing scan comparisonの「新規」とdiff relation表示を混同しない。

Required tests:

- profile switch resets incompatible target
- worktree default and untracked default
- commit/range field validation
- preview loading/error/success
- target_changed requires refresh
- start disabled without valid preview
- changed entry truncation display
- coverage copy for empty/deleted/excluded/partial
- finding relation labels
- legacy full scan UI unchanged
- keyboard/label/accessibility behavior

Acceptance:

- 利用者が実行前に対象とgapを確認できる。
- UIがdiff findingをnew findingと表示しない。
- source/diff本文やsecretをpreviewへ表示しない。
- target変更後に古いdigestで実行できない。

Verification:

```bash
bun run test:web -- web/src/domains/scans/diff-target-display.test.ts
bun run test:web -- web/src/domains/scans/coverage-summary.test.ts
bun run typecheck
bun run lint
bun run build
```

Failure handling:

- preview failure時にfull scanへ自動fallbackしない。
- stale previewでstart buttonを有効化しない。

### Slice 7: End-to-end Verification and Rollout

Priority: P0 release gate
Dependencies: Slice 6

New files:

- `api/modules/scans/scan-diff.e2e.test.ts`
- optional deterministic fixtures under existing test fixture conventions

Changes:

1. temporary Git repositoryをtest内で構築する。
2. commit/range/working-treeのknown findingsを実scanner mockで検証する。
3. host/docker execution metadataを検証する。
4. repeated executionのdeterminismを検証する。
5. cancellation/cleanup/failure recoveryを検証する。
6. READMEへの利用例追加は全gate通過後だけ行う。

Required scenarios:

```text
A: clean base commit
B: source issue + secret added
C: dependency manifest changed
D: source issue fixed, file renamed, another file deleted
working tree:
  staged source edit
  unstaged secret
  untracked manifest
  ignored file
```

Acceptance matrix:

| Scenario | Expected |
| --- | --- |
| commit A→B | changed source/secret files scanned |
| range A...C | merge-base used; dependency scanners applicable |
| commit C→D | renamed new path scanned; deleted path coverage only |
| working tree | staged/unstaged/untracked included; ignored excluded |
| same commit twice | same target/manifest digest and deterministic finding order |
| edit after preview | launch fails with target_changed |
| no changes | completed with no_changed_files, not security-clean claim |
| tool unavailable | existing required/optional failure policy preserved |
| cancel | worker and temporary snapshot cleaned |
| full baseline | behavior and output contract remain compatible |

Verification:

```bash
bun test api/modules/scans/scan-diff.e2e.test.ts
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run verify
git diff --check
```

Release gate:

- `bun run verify`がclean checkoutで成功する。
- known limitationがREADMEとUI/reportに一致する。
- diff scan経路でLLM requestが発生しない。
- temporary snapshotとmanifestにsecret bodyが残らない。
- source repositoryのbranch/index/worktreeが変更されない。
- target/gap/tool provenanceをscan runから追跡できる。

Failure handling:

- full scan regressionがあればdiff featureを有効化しない。
- deterministic digest failureがあればWeb target previewを有効化しない。
- real scanner version差で契約が崩れる場合、silent fallbackせずsupported versionと
  readiness failureを明示する。

## 14. Rollout

専用profileとsliceのmerge順をrollout boundaryとして使用し、
V1専用のfeature flagは追加しない。

段階:

1. Slice 1のresolverとpreview data contractを内部moduleとしてmergeする。
2. Slice 2から4でCLI test fixtureからだけscanner integrationを検証する。
3. Slice 5でCLI preview、commit/range、working-tree scanを公開する。
4. Slice 5のAPI preview/start contract合格後にWeb clientから利用可能にする。
5. Slice 6のUIを公開する。
6. Slice 7 release gate合格後にREADMEへ一般利用手順を追加する。

公開条件:

- Slice 7 release gate合格
- host runnerとDocker runnerの双方でpath mapping確認
- resource limitとcleanupのoperational evidence確認
- preview/start TOCTOU test合格
- full scan regressionなし

rollback:

- `diff-source-baseline`をAPI profile listから一時的に非表示にし、
  non-full target startを明示的に拒否する。
- existing diff scan history、findings、artifactは削除しない。
- full scan profileとexisting report閲覧は継続する。

## 15. Definition of Done

すべて満たした場合だけimplementation completeとする。

- commit、range、working-treeを明示的なtargetとして選べる。
- rangeはmerge-base semanticsを使用する。
- working treeはstaged、unstaged、optional untrackedを固定snapshot化する。
- source repositoryのcheckout、index、refsを変更しない。
- 全toolが同じresolved target generationを見る。
- Semgrep/Gitleaksはchanged file scopeへ限定される。
- OSV/Trivy dependency scanはmanifest変更時だけ実行される。
- deleted/excluded/unsupported/too-largeがcoverageに残る。
- diff manifestはcanonical、redacted、repository-relativeである。
- preview/start間のtarget mutationを拒否する。
- existing full scan behaviorを維持する。
- UI/reportがintroduced findingを主張しない。
- diff scanによってLLM処理を自動起動しない。
- cleanup、cancel、timeout、tool unavailableを検証している。
- targeted tests、full tests、typecheck、lint、format、build、verifyが成功する。

## 16. Deferred Follow-ups

この計画の完了後に別specとして判断する。

- base/head双方をscanするfinding delta engine
- line移動に強いfinding identity V2
- introduced / unchanged / resolved / regressed classification
- Gitleaks Git history range mode
- pull request provider integration
- changed-module dependency graphによるcontext expansion
- submodule materialization policy
- large diff operator override
- indexed `scan_targets` table

Deferred項目をV1 implementationへ混ぜない。
