import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { todolistScannerBaselineSchema } from "../shared/schemas/todolist-scanner-baseline.schema";
import { assertTodolistScannerBaseline } from "./verify-todolist-scanner-baseline";

async function baseline() {
	return todolistScannerBaselineSchema.parse(
		JSON.parse(
			await fs.readFile(
				path.resolve(
					import.meta.dir,
					"../spec/security-capability/todolist-scanner-baseline.v1.json",
				),
				"utf8",
			),
		),
	);
}

function evidenceFrom(
	value: Awaited<ReturnType<typeof baseline>>,
	mutate?: (success: { normalizedFindingHashes: string[] }) => void,
) {
	const evidence = value.cases.map((entry) => {
		const success = {
			kind: "success" as const,
			normalizedFindingHashes: Array.from(
				{ length: entry.findingCount },
				() => entry.normalizedEvidenceHash,
			),
			normalizedEvidenceHash: entry.normalizedEvidenceHash,
		};
		if (entry.caseId === "gitleaks-source") mutate?.(success);
		return { caseId: entry.caseId, scenarios: [success] };
	});
	return { target: value.target, evidence } as never;
}

test("accepts the reviewed exact finding baseline", async () => {
	const value = await baseline();
	expect(() => assertTodolistScannerBaseline(value, evidenceFrom(value))).not.toThrow();
});

test("rejects finding decreases as well as increases", async () => {
	const value = await baseline();
	expect(() =>
		assertTodolistScannerBaseline(
			value,
			evidenceFrom(value, (success) => success.normalizedFindingHashes.push(value.cases[0]!.normalizedEvidenceHash)),
		),
	).toThrow("todolist_scanner_baseline_delta:gitleaks-source");
});
