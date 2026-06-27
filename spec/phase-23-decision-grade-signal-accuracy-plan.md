# Phase 23: Decision-Grade Signal Accuracy Plan

## Purpose

この計画は、Phase 20 で追加した decision-grade signals の精度と説明力を高めるためのもの。

到達点は、ユーザーが UI 上の signal を見た時に、次を誤解なく判断できる状態である。

- scan comparison はどの強さの matching key に基づいているか。
- evidence quality は完全評価か、未ロードデータに基づく暫定評価か。
- workflow completion の percent は何によって決まっているか。
- scan-level 情報と finding-level 情報が混ざっていないか。

## Source Baseline

現在の状態:

- `scan-comparison.ts` は stable id / fingerprint / fallback key で比較する。
- fallback key は title-only match を避ける修正が入っている。
- `evidence-quality.ts` は選択中 finding の詳細・verification data を使えるが、未選択 finding は一覧データ中心になる。
- `workflow-completion.ts` は checklist と percent を表示する。
- `ScanResultOverview` と finding drawer に一部情報が重複する。

実装前に採取する baseline:

```bash
git status --short
bun run verify
```

UI で確認すること:

- comparison panel の delta が信頼できる根拠を表示しているか。
- evidence quality が未ロード由来の暫定評価か分かるか。
- workflow percent の意味が分かるか。
- scan overview と drawer の役割が分かれているか。

## Scope

Phase 23 で実装するもの。

- Comparison matching confidence
- Evidence quality data freshness / completeness indicator
- Workflow completion explanation
- Scan-level / finding-level information separation

Phase 23 で実装しないもの。

- scan comparison のための新テーブル
- historical scan API の大幅変更
- verification runner の追加
- report builder の変更
- LLM handoff prompt の変更
- Decision persistence の変更

## Target Files

Primary files:

- `web/src/domains/scans/scan-comparison.ts`
- `web/src/domains/scans/scan-comparison.test.ts`
- `web/src/domains/scans/evidence-quality.ts`
- `web/src/domains/scans/evidence-quality.test.ts`
- `web/src/domains/scans/workflow-completion.ts`
- `web/src/domains/scans/workflow-completion.test.ts`
- `web/src/domains/scans/components/scan-comparison-panel.tsx`
- `web/src/domains/scans/components/workflow-completion-panel.tsx`
- `web/src/domains/scans/components/finding-detail-panel.tsx`
- `web/src/domains/scans/components/scan-result-overview.tsx`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/styles-scans.css`

## Implementation Tasks

### Slice 1: Comparison Confidence

1. Extend comparison delta model:

```ts
type ComparisonMatchConfidence = "stable" | "fingerprint" | "rule_location" | "insufficient";
```

2. Include confidence and match reason per delta.
3. Matching rules:
   - metadata stable id -> `stable`
   - fingerprint -> `fingerprint`
   - sourceTool + ruleId + location path -> `rule_location`
   - otherwise no match and confidence `insufficient`
4. Display confidence in `ScanComparisonPanel`.
5. Add tests for each confidence level.

Acceptance:

- User can tell whether comparison is exact or heuristic.

### Slice 2: Evidence Data Freshness

1. Extend evidence quality view with:

```ts
type EvidenceDataCompleteness = "complete" | "partial" | "summary_only";
```

2. Mark:
   - selected finding with loaded details and verification -> complete
   - selected finding with details but no verification -> partial
   - list row only -> summary_only
3. Show badge/tooltip in findings table and drawer.
4. Do not auto-load verification for every finding in this phase.

Acceptance:

- Weak/missing evidence is not misread as final if data is summary-only.

### Slice 3: Workflow Percent Explanation

1. Extend checklist entries with:

```ts
weight?: number;
explanation?: string;
```

2. Show explanation in `WorkflowCompletionPanel`.
3. Percent should remain deterministic and simple.
4. Add tests for percent and checklist explanation.

Acceptance:

- User can tell why workflow is blocked or partial.

### Slice 4: Scan vs Finding Information Separation

1. Keep scan-level panels in `ScanResultOverview`:
   - risk summary
   - workflow completion
   - comparison
   - scan-level handoff
2. Keep finding-level panels in drawer:
   - evidence quality for selected finding
   - decision audit
   - verification
   - finding remediation context
3. Remove duplicated scan-level content from `ReviewSection` if it already appears in overview.
4. Do not remove data; only move or de-emphasize duplicate rendering.

Acceptance:

- Overview answers scan-level questions.
- Drawer answers selected-finding questions.

## Verification

Run:

```bash
bunx vitest run web/src/domains/scans/scan-comparison.test.ts
bunx vitest run web/src/domains/scans/evidence-quality.test.ts
bunx vitest run web/src/domains/scans/workflow-completion.test.ts
bun run typecheck
bun run verify
```

Manual verification:

- Open a scan with a baseline and confirm match confidence labels.
- Open a scan without baseline and confirm no false improvement.
- Select a finding and confirm evidence completeness changes from summary-only to complete/partial.
- Confirm workflow panel explains incomplete items.
- Confirm scan overview and drawer no longer duplicate major scan-level sections.

## Stop Conditions

Stop and update this plan if:

- evidence completeness requires loading all verification data eagerly.
- comparison confidence cannot be derived from existing finding fields.
- scan/finding separation requires major layout redesign.
- workflow percent changes break existing action queue semantics.

