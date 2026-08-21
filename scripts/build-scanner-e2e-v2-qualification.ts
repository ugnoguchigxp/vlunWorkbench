import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { verifyScannerE2EV2Evidence } from "./verify-scanner-e2e-v2-evidence";

export async function buildScannerE2EV2Qualification(params: {
	evidencePath: string;
	outputPath: string;
}) {
	const verified = await verifyScannerE2EV2Evidence({
		evidencePath: params.evidencePath,
	});
	const successes = verified.evidence.map((entry) => {
		const success = entry.scenarios.find(
			(scenario) => scenario.kind === "success",
		);
		if (!success)
			throw new Error(`scanner_e2e_v2_success_missing:${entry.caseId}`);
		return [entry.caseId, success] as const;
	});
	const first = successes.at(0)?.[1];
	if (!first) throw new Error("scanner_e2e_v2_evidence_empty");
	if (
		successes.some(
			([, success]) =>
				success.scannerManifestHash !== first.scannerManifestHash ||
				success.executionHash !== first.executionHash,
		)
	) {
		throw new Error("scanner_e2e_v2_evidence_binding_mismatch");
	}
	const unsigned = {
		schemaVersion: 2 as const,
		contractHash: verified.contractHash,
		qualifiedAt: new Date().toISOString(),
		scannerManifestHash: first.scannerManifestHash,
		executionHash: first.executionHash,
		caseEvidenceHashes: verified.evidenceHashes,
		caseScannerIdentityHashes: Object.fromEntries(
			successes.map(([caseId, success]) => [
				caseId,
				success.scannerIdentityHash,
			]),
		),
		caseAssertionIds: Object.fromEntries(
			successes.map(([caseId, success]) => [caseId, success.assertionIds]),
		),
		qualifiedCaseIds: Object.keys(verified.evidenceHashes).sort(),
	};
	const qualification = scannerE2EQualificationV2Schema.parse({
		...unsigned,
		qualificationHash: sha256(canonicalJson(unsigned)),
	});
	await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
	await fs.writeFile(
		params.outputPath,
		`${JSON.stringify(qualification, null, 2)}\n`,
	);
	return qualification;
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: { evidence: { type: "string" }, out: { type: "string" } },
		strict: true,
	}).values;
	if (!args.evidence || !args.out) {
		throw new Error("scanner_e2e_v2_qualification_args_required");
	}
	const qualification = await buildScannerE2EV2Qualification({
		evidencePath: args.evidence,
		outputPath: args.out,
	});
	console.log(
		JSON.stringify({
			ok: true,
			qualificationHash: qualification.qualificationHash,
		}),
	);
}

if (import.meta.main) await main();
