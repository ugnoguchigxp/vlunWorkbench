import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { verifyScannerE2EFullProfileEvidence } from "./verify-scanner-e2e-full-profile-evidence";
import { verifyScannerE2ERepeatability } from "./verify-scanner-e2e-repeatability";
import { verifyScannerE2EV2Evidence } from "./verify-scanner-e2e-v2-evidence";

export async function buildScannerE2EV2Qualification(params: {
	evidencePath: string;
	repeatEvidencePath: string;
	fullProfileEvidencePath: string;
	outputPath: string;
}) {
	const [
		verified,
		repeatability,
		fullProfile,
		evidenceRaw,
		repeatRaw,
		fullProfileRaw,
	] = await Promise.all([
		verifyScannerE2EV2Evidence({ evidencePath: params.evidencePath }),
		verifyScannerE2ERepeatability({
			firstEvidencePath: params.evidencePath,
			repeatEvidencePath: params.repeatEvidencePath,
		}),
		verifyScannerE2EFullProfileEvidence({
			evidencePath: params.fullProfileEvidencePath,
		}),
		fs.readFile(params.evidencePath, "utf8"),
		fs.readFile(params.repeatEvidencePath, "utf8"),
		fs.readFile(params.fullProfileEvidencePath, "utf8"),
	]);
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
	if (
		verified.applicationCommit !== fullProfile.applicationCommit ||
		verified.applicationCommit !== repeatability.applicationCommit ||
		canonicalJson(verified.target) !== canonicalJson(fullProfile.target) ||
		canonicalJson(verified.target) !== canonicalJson(repeatability.target) ||
		verified.toolboxImageDigest !== fullProfile.toolboxImageDigest ||
		verified.toolboxImageDigest !== repeatability.toolboxImageDigest ||
		fullProfile.evidence.runs.some(
			(run) => run.scannerManifestHash !== first.scannerManifestHash,
		)
	) {
		throw new Error("scanner_e2e_v2_full_profile_binding_mismatch");
	}
	const unsigned = {
		schemaVersion: 2 as const,
		contractHash: verified.contractHash,
		qualifiedAt: new Date().toISOString(),
		applicationCommit: verified.applicationCommit,
		target: verified.target,
		toolboxImageDigest: verified.toolboxImageDigest,
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
		individualEvidenceSha256: sha256(evidenceRaw),
		repeatEvidenceSha256: sha256(repeatRaw),
		fullProfileEvidenceSha256: sha256(fullProfileRaw),
		fullProfileExecutionPlanHash: fullProfile.executionPlanHash,
		fullProfileNormalizedEvidenceHash: fullProfile.normalizedEvidenceHash,
		canonicalFinalReportHashes: Object.fromEntries([
			...successes.map(([caseId, success]) => [
				caseId,
				success.canonicalFinalReportSha256,
			]),
			...fullProfile.evidence.runs.map((run, index) => [
				`full-profile-${index + 1}`,
				run.canonicalFinalReportSha256,
			]),
		]),
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
		options: {
			evidence: { type: "string" },
			"repeat-evidence": { type: "string" },
			"full-profile-evidence": { type: "string" },
			out: { type: "string" },
		},
		strict: true,
	}).values;
	if (
		!args.evidence ||
		!args["repeat-evidence"] ||
		!args["full-profile-evidence"] ||
		!args.out
	) {
		throw new Error("scanner_e2e_v2_qualification_args_required");
	}
	const qualification = await buildScannerE2EV2Qualification({
		evidencePath: args.evidence,
		repeatEvidencePath: args["repeat-evidence"],
		fullProfileEvidencePath: args["full-profile-evidence"],
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
