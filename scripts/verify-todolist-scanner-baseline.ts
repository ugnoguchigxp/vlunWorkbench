import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EEvidenceBundleV2Schema } from "../shared/schemas/scanner-e2e-v2.schema";
import { todolistScannerBaselineSchema } from "../shared/schemas/todolist-scanner-baseline.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";

export async function verifyTodolistScannerBaseline(params: {
	evidencePath: string;
	baselinePath?: string;
}) {
	const baselinePath = path.resolve(
		params.baselinePath ??
			path.resolve(
				import.meta.dir,
				"../spec/security-capability/todolist-scanner-baseline.v1.json",
			),
	);
	const [baselineRaw, evidenceRaw] = await Promise.all([
		fs.readFile(baselinePath, "utf8"),
		fs.readFile(params.evidencePath, "utf8"),
	]);
	const baseline = todolistScannerBaselineSchema.parse(JSON.parse(baselineRaw));
	const evidence = scannerE2EEvidenceBundleV2Schema.parse(
		JSON.parse(evidenceRaw),
	);
	assertTodolistScannerBaseline(baseline, evidence);
	return {
		baselineHash: sha256(canonicalJson(baseline)),
		candidateEvidenceHash: sha256(evidenceRaw),
		caseCount: baseline.cases.length,
	};
}

export function assertTodolistScannerBaseline(
	baseline: ReturnType<typeof todolistScannerBaselineSchema.parse>,
	evidence: ReturnType<typeof scannerE2EEvidenceBundleV2Schema.parse>,
) {
	if (canonicalJson(evidence.target) !== canonicalJson(baseline.target)) {
		throw new Error("todolist_scanner_baseline_target_mismatch");
	}
	const observed = new Map(
		evidence.evidence.map((entry) => {
			const success = entry.scenarios.find(
				(scenario) => scenario.kind === "success",
			);
			if (!success) {
				throw new Error(
					`todolist_scanner_baseline_success_missing:${entry.caseId}`,
				);
			}
			return [entry.caseId, success] as const;
		}),
	);
	if (observed.size !== baseline.cases.length) {
		throw new Error("todolist_scanner_baseline_case_set_mismatch");
	}
	for (const expected of baseline.cases) {
		const actual = observed.get(expected.caseId);
		if (!actual) {
			throw new Error(
				`todolist_scanner_baseline_case_missing:${expected.caseId}`,
			);
		}
		if (
			actual.normalizedFindingHashes.length !== expected.findingCount ||
			actual.normalizedEvidenceHash !== expected.normalizedEvidenceHash
		) {
			throw new Error(`todolist_scanner_baseline_delta:${expected.caseId}`);
		}
	}
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			evidence: { type: "string" },
			baseline: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.evidence)
		throw new Error("todolist_scanner_baseline_evidence_required");
	const verified = await verifyTodolistScannerBaseline({
		evidencePath: args.evidence,
		baselinePath: args.baseline,
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 7;
	});
}
