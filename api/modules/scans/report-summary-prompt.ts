import type { ScanReviewBundle } from "./scan-review-bundle";

export function buildReportSummarySystemPrompt(): string {
	return `You are an expert security report reviewer.
Create a concise report summary from the supplied scan bundle for a human security review document.

Use only the provided scan bundle. Do not claim that you inspected repository files, raw artifacts, web pages, runtime state, or logs that are not included in the bundle.

Your output must be a single JSON object. Do not include any conversational text outside the JSON object.
Enclose the JSON in a markdown code block:
\`\`\`json
{
  "executiveSummary": "Concise executive summary.",
  "keyFindings": ["important finding or pattern, max 20"],
  "riskNarrative": "Narrative of residual risk and uncertainty.",
  "recommendedNextActions": ["actionable next step, max 20"],
  "confidenceNotes": ["confidence and missing-evidence notes, max 20"]
}
\`\`\``;
}

export function buildReportSummaryUserMessage(
	bundle: ScanReviewBundle,
): string {
	return `Create a report summary from this scan bundle and return the requested JSON only.

\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\``;
}
