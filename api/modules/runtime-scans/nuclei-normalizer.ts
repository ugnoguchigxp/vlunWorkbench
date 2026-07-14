import crypto from "node:crypto";
import type { NormalizedFinding } from "../scans/normalizers/fixture";
import { redactSecrets } from "../scans/normalizers/redaction";

export function normalizeNuclei(input: unknown): NormalizedFinding[] {
	const rows = Array.isArray(input)
		? input
		: String(input ?? "")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
	return rows.map((row: Record<string, unknown>) => {
		const templateId = String(
			row["template-id"] ?? row.templateID ?? "unknown",
		);
		const host = String(row.host ?? row.matched ?? "unknown");
		const info = (row.info ?? {}) as Record<string, unknown>;
		const severity = String(info.severity ?? "unknown").toLowerCase();
		const fingerprint = crypto
			.createHash("sha256")
			.update(`nuclei:${templateId}:${host}:${String(row.matcher_name ?? "")}`)
			.digest("hex");
		return {
			ruleId: templateId,
			title: redactSecrets(String(info.name ?? templateId)),
			description: redactSecrets(
				String(info.description ?? info.name ?? templateId),
			),
			severity: ["info", "low", "medium", "high", "critical"].includes(severity)
				? (severity as NormalizedFinding["severity"])
				: "unknown",
			confidence: "static",
			status: "open",
			primaryLocation: { path: host, startLine: 1, endLine: 1 },
			fingerprint,
			evidences: [
				{
					kind: "tool-output",
					title: `Nuclei ${templateId}`,
					location: null,
					snippet: redactSecrets(JSON.stringify(row)),
				},
			],
		};
	});
}
