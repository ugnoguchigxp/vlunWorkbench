import crypto from "node:crypto";
import type { NormalizedFinding } from "../scans/normalizers/fixture";
import { redactSecrets } from "../scans/normalizers/redaction";

export function normalizeZap(input: unknown): NormalizedFinding[] {
	const alerts =
		(
			input as { site?: Array<{ alerts?: Array<Record<string, unknown>> }> }
		)?.site?.flatMap((site) => site.alerts ?? []) ?? [];
	return alerts.map((alert) => {
		const url = String(alert.url ?? "unknown");
		const pluginId = String(alert.pluginid ?? "unknown");
		const risk = String(alert.riskcode ?? "0");
		const severity =
			risk === "3"
				? "high"
				: risk === "2"
					? "medium"
					: risk === "1"
						? "low"
						: "info";
		const fingerprint = crypto
			.createHash("sha256")
			.update(
				`zap:${pluginId}:${url}:${String(alert.param ?? "")}:${String(alert.evidence ?? "")}`,
			)
			.digest("hex");
		return {
			ruleId: pluginId,
			title: redactSecrets(String(alert.name ?? pluginId)),
			description: redactSecrets(String(alert.desc ?? alert.name ?? pluginId)),
			severity,
			confidence: "static",
			status: "open",
			primaryLocation: { path: url, startLine: 1, endLine: 1 },
			fingerprint,
			evidences: [
				{
					kind: "tool-output",
					title: `ZAP ${pluginId}`,
					location: null,
					snippet: redactSecrets(JSON.stringify(alert)),
				},
			],
		};
	});
}
