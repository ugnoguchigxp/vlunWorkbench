import type { ReviewInputBundle } from "./finding-review-types";

export function buildSystemPrompt(): string {
	return `You are an expert security code reviewer.
Analyze the provided finding context, scan context, associated evidence, and the source code snippet to evaluate the vulnerability.
Provide a structured assessment of the finding in the requested JSON format.

Use only the supplied finding, evidence, artifact metadata, and source snippet. Do not claim that you inspected other files, paths, runtime state, or repository contents. If context is missing or the snippet is unavailable, say so in the relevant reasoning fields instead of inventing missing evidence.

Your output must be a single JSON object. Do not include any conversational text outside the JSON object.
Enclose the JSON in a markdown code block:
\`\`\`json
{
  "summary": "Concise summary of what the finding is and why it was flagged.",
  "likelyImpact": "Brief description of the worst-case scenario and potential impact.",
  "falsePositiveAssessment": {
    "level": "low" | "medium" | "high" | "unknown",
    "reasoning": "Reasoning for the false positive level."
  },
  "evidenceStrength": {
    "level": "weak" | "moderate" | "strong" | "unknown",
    "reasoning": "Reasoning for the strength of the evidence (e.g., matching snippet and logic)."
  },
  "remediationDirection": "High-level guidance on how to fix this issue.",
  "reviewerNotes": ["bullet points of specific observations or context details (max 10 items)"],
  "confidenceAdjustment": "unchanged" | "increase" | "decrease" | "unknown"
}
\`\`\``;
}

export function buildUserMessage(bundle: ReviewInputBundle): string {
	return `Please review the following finding and evidence bundle:

---
FINDING:
ID: ${bundle.finding.id}
Rule ID: ${bundle.finding.ruleId}
Title: ${bundle.finding.title}
Description: ${bundle.finding.description}
Severity: ${bundle.finding.severity}
Confidence: ${bundle.finding.confidence}
Status: ${bundle.finding.status}
Location: ${JSON.stringify(bundle.finding.primaryLocation, null, 2)}

---
SCAN CONTEXT:
Scan Run ID: ${bundle.scanContext.scanRunId}
Profile: ${bundle.scanContext.profile}
Tool Name: ${bundle.scanContext.toolName}
Tool Version: ${bundle.scanContext.toolVersion}
Command: ${bundle.scanContext.command}

---
EVIDENCE:
${bundle.evidences
	.map(
		(ev, idx) => `
Evidence ${idx + 1}:
  Kind: ${ev.kind}
  Title: ${ev.title}
  Location: ${JSON.stringify(ev.location, null, 2)}
  Snippet: ${ev.snippet || "N/A"}
  Artifact Reference: ${ev.artifact ? `ID: ${ev.artifact.id}, Kind: ${ev.artifact.kind}, Format: ${ev.artifact.format}` : "None"}
`,
	)
	.join("\n")}

---
SOURCE CODE SNIPPET (redacted):
\`\`\`
${bundle.sourceSnippet}
\`\`\`
`;
}
