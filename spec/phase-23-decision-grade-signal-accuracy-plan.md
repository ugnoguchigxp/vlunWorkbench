# Phase 23: Decision-Grade Signal Accuracy Plan

## Purpose

この計画は、Phase 20 で追加した decision-grade signals の精度と説明力を高めるためのもの。

到達点は、自動診断後にユーザーまたは後続 LLM が UI / handoff 上の signal を見た時に、次を誤解なく判断できる状態である。

- scan comparison はどの強さの matching key に基づいているか。
- evidence quality は完全評価か、未ロードデータに基づく暫定評価か。
- workflow completion の percent は何によって決まっているか。
- scan-level 情報と finding-level 情報が混ざっていないか。
- decision-grade signal が、人間による途中レビューや直接 Decision 書き込みを通常経路として要求していないか。

## Source Baseline

現在の状態:

- `scan-comparison.ts` は stable id / fingerprint / fallback key で比較する。
- fallback key は title-only match を避ける修正が入っている。
- `evidence-quality.ts` は選択中 finding の詳細・verification data を使えるが、未選択 finding は一覧データ中心になる。
- `workflow-completion.ts` は checklist と percent を表示する。
- `ScanResultOverview` と finding drawer に一部情報が重複する。
- Phase 21 方針では、人力 Decision は必須作業ではなく、自動診断結果から作る LLM handoff / improvement request が主成果物である。

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
- 人間の途中レビューや Decision 未入力を挟まなくても、LLM への修正依頼または再レビュー要求が主導線として読めるか。

## Scope

Phase 23 で実装するもの。

- Comparison matching confidence
- Evidence quality data freshness / completeness indicator
- Workflow completion explanation
- Scan-level / finding-level information separation
- LLM correction-request path as the preferred follow-up signal when review output is insufficient
- Automation-first diagnostic signals that can be handed to an LLM without intermediate human input

Phase 23 で実装しないもの。

- scan comparison のための新テーブル
- historical scan API の大幅変更
- verification runner の追加
- report builder の変更
- LLM handoff prompt schema の大幅変更
- Decision persistence schema の変更
- 新しい人間 Decision 書き込み経路の追加
- 新しい人間レビュー checkpoint や手入力 gate の追加

## Automation Direction

Phase 23 では、人間が途中で finding をレビューしたり finding decision を直接書き込んだりすることを、workflow completion の通常経路にしない。
Decision が既に存在する場合は過去の audit metadata として表示してよいが、未入力状態を「人間が決めて保存すべき未完了作業」として扱わない。

主経路は、CLI / runner / deterministic helper が保存した evidence / review / verification から不足点を自動で説明し、次の LLM review または実装修正へ渡す correction request / handoff を作ることである。
そのため、signal copy と checklist explanation は次の優先順位で表現する。

1. 既存の scan-level handoff / improvement request があれば、それを次アクションとして表示する。
2. handoff が不十分な場合は、どの evidence freshness / comparison confidence / workflow item が不足しているかを、自動生成された LLM 再レビュー依頼として示す。
3. 人間 Decision は既存履歴の監査表示に留め、直接書き込みフォームや人間レビュー依頼を主 CTA / completion prerequisite として扱わない。

LLM へ渡す内容は、保存済み診断結果、正規化済み finding、verification / DAST / comparison signal、既存 review output に限定する。
LLM は repo を自由探索して証拠を生成する主体ではなく、受け取った診断結果を整理し、修正依頼・再レビュー・リスク低減の優先順位を作る後段である。

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
- `web/src/domains/scans/components/decision-section.tsx`
- `web/src/domains/scans/use-scans-controller.ts`
- `web/src/styles-scans.css`

## File Responsibilities

- `web/src/domains/scans/scan-comparison.ts`
  - Own match key derivation, confidence, and delta reason text.
- `web/src/domains/scans/evidence-quality.ts`
  - Own evidence quality level and data completeness.
- `web/src/domains/scans/workflow-completion.ts`
  - Own percent, checklist status, weights, and explanation text.
- `web/src/domains/scans/components/scan-comparison-panel.tsx`
  - Render comparison confidence without changing matching logic.
- `web/src/domains/scans/components/workflow-completion-panel.tsx`
  - Render percent explanation and checklist reasons.
- `web/src/domains/scans/components/finding-detail-panel.tsx`
  - Render finding-level evidence completeness and correction-request context in table/drawer.
- `web/src/domains/scans/components/scan-result-overview.tsx`
  - Keep scan-level panels and scan-level LLM handoff / correction-request signals only.
- `web/src/domains/scans/components/decision-section.tsx`
  - Keep existing Decision history visible as audit metadata, but do not solicit human input in the normal automated diagnostic flow.
- `web/src/domains/scans/use-scans-controller.ts`
  - Pass data completeness flags into pure helpers.

## Implementation Gates

1. **Gate A: Comparison confidence model**
   - Pure helper and tests only.
2. **Gate B: Evidence completeness model**
   - Pure helper, controller input, and tests.
3. **Gate C: Workflow explanation**
   - Pure helper and panel rendering, with LLM correction request as the preferred unresolved-state action.
4. **Gate D: UI separation**
   - Remove normal-flow prominence for duplicate scan-level content, human review prompts, and direct Decision entry.
5. **Gate E: Automated signal audit**
   - Use deterministic fixtures for one scan with baseline, one without baseline, and one selected finding; confirm unresolved states point to LLM follow-up rather than human review or Decision persistence.

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
6. Suggested output shape:

```ts
type ScanComparisonDelta = {
  id: string;
  kind: FindingDeltaKind;
  title: string;
  severity: string;
  currentFindingId?: string;
  baselineFindingId?: string;
  reason: string;
  matchConfidence: ComparisonMatchConfidence;
  matchReason: string;
};
```

7. `resolved` deltas should use the confidence of the baseline key when available.
8. `new` deltas with no usable key should show `insufficient`, not `rule_location`.

Acceptance:

- User can tell whether comparison is exact or heuristic.
- Title-only similarity never produces `unchanged` or `regressed`.

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
5. Suggested input:

```ts
type EvidenceDataCompletenessInput = {
  hasFindingDetails: boolean;
  hasVerificationData: boolean;
  hasDastEvidenceLoaded: boolean;
};
```

6. Mapping:
   - `complete`: details loaded and verification loaded
   - `partial`: details loaded but verification not loaded
   - `summary_only`: details not loaded
7. If DAST evidence is not loaded, do not downgrade complete unless DAST is the only verification path visible for that finding.
8. UI copy:
   - complete: "完全評価"
   - partial: "詳細のみ"
   - summary_only: "一覧データのみ"

Acceptance:

- Weak/missing evidence is not misread as final if data is summary-only.
- Evidence table rows clearly mark provisional quality when only list data is available.

### Slice 3: Workflow Percent Explanation

1. Extend checklist entries with:

```ts
weight?: number;
explanation?: string;
```

2. Show explanation in `WorkflowCompletionPanel`.
3. Percent should remain deterministic and simple.
4. Add tests for percent and checklist explanation.
5. Suggested weights:
   - scan completed: 10
   - LLM finding review output or scan handoff: 20
   - LLM correction request / scan handoff: 20
   - evidence confidence: 20
   - remediation/handoff readiness: 15
   - report generated/readiness: 15
6. Percent should be computed from completed weight / total applicable weight.
7. If a checklist item is `not_applicable`, remove it from denominator.
8. Explanations must be one sentence and should include the blocking count when available.

Acceptance:

- User can tell why workflow is blocked or partial.
- Percent changes are covered by tests and remain deterministic.
- Missing human review or Decision alone does not make the workflow look incomplete when an actionable LLM correction request or scan handoff exists.

### Slice 4: Scan vs Finding Information Separation

1. Keep scan-level panels in `ScanResultOverview`:
   - risk summary
   - workflow completion
   - comparison
   - scan-level handoff / correction request
2. Keep finding-level panels in drawer:
   - evidence quality for selected finding
   - existing decision history as audit metadata
   - verification
   - finding remediation context
3. Remove duplicated scan-level content from `ReviewSection` if it already appears in overview.
4. Do not remove existing data; remove or hide normal-flow prompts for human review / direct Decision entry.
5. Concrete rule:
   - `ReviewSection` inside finding drawer should not render `ScanResultOverview`.
   - Scan-level handoff / correction request remains in overview.
   - Finding-level LLM review remains in drawer.
   - Scan review history can be shown in overview or sidebar, not inside selected finding body unless clearly labelled as scan-level.
   - If a legacy direct Decision form remains available, it must be outside the normal diagnostic path, collapsed or audit-only, and never required to progress the workflow.

Acceptance:

- Overview answers scan-level questions.
- Drawer answers selected-finding questions.
- Selecting a finding does not duplicate the full scan overview inside the drawer.
- The UI does not imply that humans should resolve ambiguous findings by intermediate review or final decision entry; it should steer unresolved cases toward automatically generated LLM correction request or scan handoff.

## Verification

Run:

```bash
bunx vitest run web/src/domains/scans/scan-comparison.test.ts
bunx vitest run web/src/domains/scans/evidence-quality.test.ts
bunx vitest run web/src/domains/scans/workflow-completion.test.ts
bun run typecheck
bun run verify
```

Expected:

- comparison tests cover stable/fingerprint/rule_location/insufficient confidence
- evidence tests cover complete/partial/summary_only
- workflow tests cover weighted percent and explanation text
- `bun run verify` passes

Implementation smoke verification:

- Open a scan with a baseline and confirm match confidence labels.
- Open a scan without baseline and confirm no false improvement.
- Select a finding and confirm evidence completeness changes from summary-only to complete/partial.
- Confirm workflow panel explains incomplete items.
- Confirm scan overview and drawer no longer duplicate major scan-level sections.
- Confirm a finding without human review or saved Decision still shows the LLM correction request / handoff path as the primary follow-up.
- Confirm any remaining Decision entry UI is outside the normal flow, collapsed or audit-oriented.
- Confirm the handoff payload is derived from saved scan/review/evidence signals and does not ask the LLM to freely inspect the repository.

## Definition of Done

Phase 23 is complete only when:

- every comparison delta has confidence and match reason
- evidence quality visually distinguishes complete, partial, and summary-only data
- workflow percent has explanatory checklist text
- scan overview and finding drawer have distinct responsibilities
- missing human review or Decision is not treated as a blocker when LLM correction request / scan handoff is available
- direct Decision entry and human review are not presented as the primary path for unresolved findings
- LLM handoff is generated from saved automated diagnostic output, not from ad hoc human input
- targeted tests and `bun run verify` pass

## Stop Conditions

Stop and update this plan if:

- evidence completeness requires loading all verification data eagerly.
- comparison confidence cannot be derived from existing finding fields.
- scan/finding separation requires major layout redesign.
- workflow percent changes break existing action queue semantics.
- de-emphasizing direct Decision entry would require removing existing persisted decision history or changing the decision schema.
- removing human review/input from the normal path would require allowing LLM free repository exploration or LLM-generated primary evidence.
