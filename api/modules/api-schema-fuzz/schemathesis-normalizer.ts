import crypto from "node:crypto";
import type { NormalizedFinding } from "../scans/normalizers/fixture";
import { redactSecrets } from "../scans/normalizers/redaction";

export function normalizeSchemathesis(input: unknown): NormalizedFinding[] {
	const rows = Array.isArray(input)
		? input
		: String(input ?? "")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
	return rows
		.filter((row): row is Record<string, unknown> =>
			Boolean(
				row &&
					typeof row === "object" &&
					(row as Record<string, unknown>).status === "failure",
			),
		)
		.map((row) => {
			const operation = String(
				row.operation ?? row.endpoint ?? "unknown-operation",
			);
			const check = String(row.check ?? row.failure ?? "schemathesis-failure");
			return {
				ruleId: check,
				title: redactSecrets(`${check} at ${operation}`),
				description: redactSecrets(String(row.message ?? row.failure ?? check)),
				severity: "medium",
				confidence: "static",
				status: "open",
				primaryLocation: { path: operation, startLine: 1, endLine: 1 },
				fingerprint: crypto
					.createHash("sha256")
					.update(`schemathesis:${operation}:${check}`)
					.digest("hex"),
				evidences: [
					{
						kind: "tool-output",
						title: `Schemathesis ${check}`,
						location: null,
						snippet: redactSecrets(JSON.stringify(row)),
					},
				],
			};
		});
}
