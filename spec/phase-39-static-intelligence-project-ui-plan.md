# Phase 39: Static Intelligence Project UI Plan

## Purpose

この計画は、Static Intelligence の成果物を CLI / MCP だけでなく、登録済みプロジェクト単位で確認できる読み取り専用 UI として公開する。

中心に置く画面は scanner 実行画面ではなく、すでに取り込まれた project / scan / evidence / code structure / agent bundle を確認する Project Intelligence view である。

```text
registered project
  -> latest scan runs
  -> Static Intelligence read models
  -> Project Intelligence UI
  -> Scans drilldown / CLI-MCP source reference
```

この phase では、Static Intelligence を Scans に完全同化させない。Scans は実行履歴と finding 作業面として維持し、Projects を登録済みプロジェクトと分析結果閲覧の入口にする。

## Product Boundary

vulnWorkbench が担当すること:

- 登録済みプロジェクトを一覧できる top-level Projects UI を追加する。
- 既存 project registration API を UI から使える形で整理する。
- Project detail に Static Intelligence の読み取り専用タブを追加する。
- 最新 scan と scan-specific export を区別して表示する。
- Static Intelligence export / file risk / evidence graph / code structure status / agent query preview の availability を表示する。
- Scans 画面へ scanRunId scoped drilldown できる導線を追加する。
- degraded reasons、source ids、snapshot refs、hashes を UI 上で確認できるようにする。

vulnWorkbench が担当しないこと:

- Static Intelligence 画面から scan を開始すること。
- Static Intelligence 画面から contextStill へ直接登録すること。
- Static Intelligence 画面から NightWorkers task を作成すること。
- finding の真偽、decision、remediation status を Static Intelligence 画面で変更すること。
- patch 生成または適用。
- raw source body、secret、絶対パスの広範表示。
- Scans UI の全面刷新。

## Current Baseline

既存の状態:

- `api/routes/projects.route.ts` は project list / create / folder picker / project scan start を持つ。
- `web/src/domains/scans` は project selection、project registration modal、scan history、finding detail、review、verification、report を持つ。
- `web/src/router.tsx` と `web/src/app-header.tsx` は top-level `Projects` route を持たない。
- Static Intelligence export schema は `shared/schemas/static-intelligence.schema.ts` にあり、`scanSummary`、`fileRiskIndex`、`graph`、`codeStructure` を表現できる。
- Static Intelligence CLI / MCP surface は read-only source surface として整備済みである。

この phase の UI 追加は、既存 Scans controller の責務を無理に広げない。Project-centric view は新しい domain として作り、Scans は必要なリンク先として接続する。

## Target Navigation

Add:

```text
/projects
/projects/:projectId
/projects/:projectId/intelligence
```

Top navigation:

```text
Knowledge | Chat | Search | Projects | Scans | Settings | Showcase
```

Project detail tabs:

```text
Overview | Static Intelligence | Scans
```

Static Intelligence inner sections:

```text
Summary | Files | Evidence | Code Structure | Agent Bundle | Source Health
```

MVP can render these as one page with section bands instead of deep nested tabs if that is simpler and keeps the first implementation small.

## API Contract

Add read-only API routes. These routes should wrap existing Static Intelligence services and must not execute scanners.

```http
GET /api/projects/:projectId/intelligence
```

Returns project-level intelligence availability and the latest usable scan summary.

```ts
type ProjectIntelligenceOverview = {
  project: Project;
  latestScan: ScanRun | null;
  latestExport: StaticIntelligenceExportV1 | null;
  availability: {
    export: "available" | "missing" | "failed";
    fileRiskIndex: "available" | "missing";
    evidenceGraph: "available" | "missing";
    codeStructure: "available" | "missing" | "degraded";
    agentBundle: "available" | "missing" | "degraded";
  };
  degradedReasons: string[];
};
```

```http
GET /api/scans/:scanRunId/intelligence/export
```

Returns `StaticIntelligenceExportV1` for one scan run.

```http
GET /api/scans/:scanRunId/intelligence/agent-query?mode=overview|risk|evidence|verification|export
```

Returns the existing agent-query bundle for preview. It should keep the current candidate/read-only semantics.

```http
GET /api/scans/:scanRunId/intelligence/code-structure
```

Returns code structure enrichment if available. If a snapshot has to be generated live, that must be explicit in a later phase; MVP should prefer export-attached or already available data.

Route rules:

- Every route must verify project ownership through the scan's project or `projectId`.
- Routes must return structured degraded reasons instead of silent empty success.
- Routes must not accept arbitrary filesystem paths from the browser.
- Routes must not include raw source body by default.

## UI Contract

### Projects List

The list shows:

- project name
- repository basename or short path
- default branch
- latest scan status
- latest scan completed time
- finding count
- risk band
- evidence quality
- code structure status
- degraded indicator

Primary actions:

- open project
- open Static Intelligence
- open Scans

### Project Registration

Registration uses the existing API:

- `POST /api/projects`
- `POST /api/projects/folder-picker`

Expected behavior:

- duplicate repo path surfaces the existing API error clearly.
- registration does not start a scan automatically.
- after successful registration, navigate to `/projects/:projectId`.
- empty project state explains that analysis appears after a scan/import exists.

### Project Overview

Overview shows:

- latest scan run
- latest Static Intelligence availability
- risk / evidence summary
- scan history count
- latest degraded reasons
- links to Static Intelligence and Scans

This is a landing surface, not a dense diagnostic screen.

### Static Intelligence View

Summary section:

- risk band
- evidence quality
- finding count
- tool run count
- artifact count
- review status
- generatedAt
- scanRunId
- export availability
- degraded reasons

Files section:

- file path
- max severity
- finding count
- evidence quality
- scanners
- rule ids
- latest seen time

Evidence section:

- graph node / edge counts
- counts by node kind
- counts by edge kind
- selected finding to evidence refs if available

Code Structure section:

- status
- snapshotRef
- summary counts
- degraded reasons
- top tagged files by route / handler / schema / worker / config

Agent Bundle section:

- mode selector for overview / risk / evidence / verification / export
- preview of bundle metadata, source refs, degraded reasons, and recommended verification commands
- no mutation action

Source Health section:

- export hash or content hash if available
- code structure snapshotRef
- rootRef visibility without root path by default
- MCP tool names and CLI commands as copyable references

## Implementation Phases

### Phase 39.1: Baseline and API Read Layer

Tasks:

- Add static intelligence read-only route module.
- Add `fetchProjectIntelligenceOverview`, `fetchScanIntelligenceExport`, `fetchScanIntelligenceAgentQuery`, and optional `fetchScanCodeStructure` to `web/src/api.ts`.
- Add route tests for ownership, missing scan, missing export, degraded response, and no arbitrary path input.
- Reuse existing export builder / agent query services instead of duplicating model construction.

Acceptance:

- API returns project-owned latest intelligence overview.
- Missing Static Intelligence data is visible as `missing` with degraded reasons.
- Browser-facing API cannot trigger scanner execution or filesystem traversal from user-provided path.

### Phase 39.2: Projects Domain Shell

Tasks:

- Add `web/src/domains/projects`.
- Add `/projects` and `/projects/:projectId` router entries.
- Add `Projects` top navigation item.
- Implement projects list and registration panel using existing project APIs.
- Keep scan execution controls out of this domain in MVP.

Acceptance:

- User can register a project and land on project detail.
- User can open existing projects without entering Scans first.
- Empty and missing-analysis states are explicit.

### Phase 39.3: Project Intelligence View

Tasks:

- Add Project detail tabs or segmented navigation for Overview / Static Intelligence / Scans.
- Render Static Intelligence summary, files, evidence counts, code structure status, and degraded reasons.
- Add links from project scan rows to scan-specific Scans detail where possible.
- Use stable layout constraints and tables suitable for repeated operational use.

Acceptance:

- Existing imported project can show analysis results without starting a new scan.
- Latest scan and selected scan are visually distinct.
- Degraded code structure or missing export is visible and not treated as success.

### Phase 39.4: Agent Bundle and Source Health Preview

Tasks:

- Add read-only agent-query preview.
- Add source health / CLI / MCP reference section.
- Add copy buttons for CLI commands only; do not execute commands from UI.
- Add tests for redaction and no raw source body display.

Acceptance:

- User can inspect what external agents would consume.
- UI keeps source provenance visible: scanRunId, projectId, snapshotRef, generatedAt.
- UI does not expose raw secrets, raw source body, or absolute root path by default.

### Phase 39.5: Scans Connection Hardening

Tasks:

- Add Scans-to-Project Intelligence link for selected scan.
- Add Project Intelligence-to-Scans link for scan drilldown.
- Avoid moving existing review / verification / report controls into Static Intelligence.
- Keep selection behavior latest-first.

Acceptance:

- Scans remains the working surface for finding operations.
- Projects remains the browsing surface for imported project analysis.
- Navigation between the two preserves projectId and scanRunId context.

## Data Flow

```text
Projects UI
  -> fetchProjects()
  -> project selection
  -> fetchProjectIntelligenceOverview(projectId)
  -> latest scan summary + availability
  -> optional scan-specific fetches

Static Intelligence View
  -> fetchScanIntelligenceExport(scanRunId)
  -> render summary / file risk / graph / code structure
  -> fetchScanIntelligenceAgentQuery(scanRunId, mode)
  -> render agent-facing bundle preview

Scans UI
  -> existing scan/finding/review/report flows
  -> link to /projects/:projectId/intelligence?scanRunId=<id>
```

## Non-Goals for MVP

- Persisting new UI-specific intelligence tables.
- Live background generation of missing intelligence bundles.
- Real-time filesystem watchers.
- Graph canvas visualization.
- Full-text source code browsing.
- Cross-project comparison.
- contextStill registration workflow.
- NightWorkers handoff workflow.

## Verification Plan

Targeted tests:

```bash
bun run test run api/routes/*intelligence*.test.ts
bun run test run web/src/domains/projects/**/*.test.tsx
```

Repo gates:

```bash
bun run typecheck
bun run verify
```

Manual UI checks:

- `/projects` shows registered projects.
- registering a project does not start a scan.
- project detail shows explicit empty analysis state when there is no scan/export.
- a project with Static Intelligence export shows summary, file risk, evidence counts, and code structure status.
- `scanRunId` drilldown preserves the selected scan context.
- Scans still supports existing review / verification / report workflows.

Security checks:

- browser API requests cannot pass arbitrary project paths.
- Static Intelligence UI does not show raw source body.
- root path is hidden unless a backend contract explicitly marks it safe.
- degraded reasons are shown for partial or missing data.

## Completion Criteria

- Top-level Projects route exists.
- Project registration is accessible outside Scans.
- Registered project detail can show Static Intelligence analysis results.
- Scans and Project Intelligence link to each other without merging responsibilities.
- Static Intelligence UI remains read-only.
- Route tests and frontend tests cover missing/degraded data.
- `bun run verify` passes.
