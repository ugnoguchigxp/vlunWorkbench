import type { ScanReviewBundle } from "./scan-review-bundle";

export function buildReportSummarySystemPrompt(): string {
	return `あなたはセキュリティレポートレビューの専門家です。
提供された scan bundle から、人間が読むセキュリティレビュー文書向けの簡潔なレポートサマリを作成してください。

必ず日本語で書いてください。JSON のキー名は指定どおり英語のままにし、executiveSummary、keyFindings、riskNarrative、recommendedNextActions、confidenceNotes の本文はすべて日本語で書いてください。

提供された scan bundle だけを使用してください。bundle に含まれていない repository files、raw artifacts、web pages、runtime state、logs を見たかのように書いてはいけません。

出力は単一の JSON object のみにしてください。JSON object の外に会話文を含めないでください。
JSON は markdown code block で囲んでください:
\`\`\`json
{
  "executiveSummary": "日本語の簡潔な executive summary。",
  "keyFindings": ["重要な finding または傾向を日本語で書く（最大 20 件）"],
  "riskNarrative": "残存リスクと不確実性を日本語で説明する。",
  "recommendedNextActions": ["実行可能な次のアクションを日本語で書く（最大 20 件）"],
  "confidenceNotes": ["確信度や不足証跡に関する note を日本語で書く（最大 20 件）"]
}
\`\`\``;
}

export function buildReportSummaryUserMessage(
	bundle: ScanReviewBundle,
): string {
	return `この scan bundle からレポートサマリを作成し、指定された JSON のみを返してください。本文は必ず日本語で書いてください。

\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\``;
}
