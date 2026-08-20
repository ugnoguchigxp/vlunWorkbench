import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EQualificationHash } from "../api/modules/scans/scanner-e2e-qualification";
import { scannerE2EQualificationSchema } from "../shared/schemas/scanner-e2e-qualification.schema";
import { verifyScannerE2EEvidence } from "./verify-scanner-e2e-evidence";

export async function buildScannerE2EQualification(params: {
	evidencePath: string;
	outputPath: string;
}) {
	const verified = await verifyScannerE2EEvidence({
		evidencePath: params.evidencePath,
	});
	const first = verified.evidence.at(0);
	if (!first) throw new Error("scanner_e2e_evidence_empty");
	const bindings = {
		scannerManifestHash: first.scannerManifestHash,
		executionHash: first.executionHash,
	};
	if (
		verified.evidence.some(
			(entry) =>
				entry.scannerManifestHash !== bindings.scannerManifestHash ||
				entry.executionHash !== bindings.executionHash,
		)
	) {
		throw new Error("scanner_e2e_evidence_binding_mismatch");
	}
	const unsigned = {
		schemaVersion: 1 as const,
		contractHash: verified.contractHash,
		qualifiedAt: new Date().toISOString(),
		...bindings,
		caseEvidenceHashes: verified.evidenceHashes,
		caseScannerIdentityHashes: Object.fromEntries(
			verified.evidence.map((entry) => [
				entry.caseId,
				entry.scannerIdentityHash,
			]),
		),
		qualifiedCaseIds: Object.keys(verified.evidenceHashes).sort(),
	};
	const qualification = scannerE2EQualificationSchema.parse({
		...unsigned,
		qualificationHash: scannerE2EQualificationHash(unsigned),
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
	if (!args.evidence || !args.out)
		throw new Error("scanner_e2e_qualification_args_required");
	const qualification = await buildScannerE2EQualification({
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
