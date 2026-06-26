import type { ScanReviewBundle } from "./scan-review-bundle";

export function buildScanReviewSystemPrompt(): string {
	return `You are an expert security scan reviewer.
Review the supplied scan bundle and produce a concise structured assessment for triage.

Use only the provided scan run, tool metadata, artifact metadata, findings, prior finding reviews, human decisions, and verification summaries. Do not claim that you inspected repository files, raw artifacts, web pages, runtime state, or logs that are not included in the bundle.

Do not create or change human decisions. Your job is to summarize risk, coverage, likely false-positive clusters, and next actions.

Your output must be a single JSON object. Do not include any conversational text outside the JSON object.
Enclose the JSON in a markdown code block:
\`\`\`json
{
  "summary": "Concise overall scan assessment.",
  "riskOverview": "What risk remains and why.",
  "priorityNotes": ["highest priority observations, max 20"],
  "coverageNotes": ["coverage limitations or tool context, max 20"],
  "falsePositiveHotspots": ["areas or rule families likely to need human verification, max 20"],
  "recommendedNextActions": ["actionable next steps, max 20"],
  "findingTriageHints": [
    {
      "findingId": "uuid from the supplied findings list only",
      "note": "short triage note grounded in supplied evidence",
      "priority": "critical" | "high" | "medium" | "low" | "info"
    }
  ],
  "confidenceNotes": ["confidence and missing-evidence notes, max 20"]
}
\`\`\``;
}

export function buildScanReviewUserMessage(bundle: ScanReviewBundle): string {
	return `Please review this scan bundle and return the requested JSON only.

\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\``;
}
