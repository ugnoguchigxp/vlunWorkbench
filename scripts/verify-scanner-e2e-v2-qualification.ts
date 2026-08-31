import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { verifyScannerE2EFullProfileEvidence } from "./verify-scanner-e2e-full-profile-evidence";
import { verifyScannerE2ERepeatability } from "./verify-scanner-e2e-repeatability";
import { verifyScannerE2EV2Evidence } from "./verify-scanner-e2e-v2-evidence";

export async function verifyScannerE2EV2Qualification(params: {
	qualificationPath: string;
	evidencePath: string;
	repeatEvidencePath: string;
	fullProfileEvidencePath: string;
	expectedApplicationCommit?: string;
}) {
	const [qualificationRaw, evidenceRaw, repeatRaw, fullProfileRaw] =
		await Promise.all([
			fs.readFile(params.qualificationPath, "utf8"),
			fs.readFile(params.evidencePath, "utf8"),
			fs.readFile(params.repeatEvidencePath, "utf8"),
			fs.readFile(params.fullProfileEvidencePath, "utf8"),
		]);
	const qualification = scannerE2EQualificationV2Schema.parse(
		JSON.parse(qualificationRaw),
	);
	const { qualificationHash, ...unsigned } = qualification;
	if (qualificationHash !== sha256(canonicalJson(unsigned))) {
		throw new Error("scanner_e2e_v2_qualification_hash_invalid");
	}
	const [individual, repeatability, fullProfile] = await Promise.all([
		verifyScannerE2EV2Evidence({
			evidencePath: params.evidencePath,
			expectedApplicationCommit: params.expectedApplicationCommit,
		}),
		verifyScannerE2ERepeatability({
			firstEvidencePath: params.evidencePath,
			repeatEvidencePath: params.repeatEvidencePath,
		}),
		verifyScannerE2EFullProfileEvidence({
			evidencePath: params.fullProfileEvidencePath,
			expectedApplicationCommit: params.expectedApplicationCommit,
		}),
	]);
	const successes = individual.evidence.map((entry) => {
		const success = entry.scenarios.find(
			(scenario) => scenario.kind === "success",
		);
		if (!success)
			throw new Error(`scanner_e2e_v2_success_missing:${entry.caseId}`);
		return [entry.caseId, success] as const;
	});
	const first = successes[0]?.[1];
	if (!first) throw new Error("scanner_e2e_v2_evidence_empty");
	const expectedBindings = {
		contractHash: individual.contractHash,
		applicationCommit: individual.applicationCommit,
		target: individual.target,
		toolboxImageDigest: individual.toolboxImageDigest,
		scannerManifestHash: first.scannerManifestHash,
		executionHash: first.executionHash,
		caseEvidenceHashes: individual.evidenceHashes,
		caseScannerIdentityHashes: Object.fromEntries(
			successes.map(([caseId, success]) => [
				caseId,
				success.scannerIdentityHash,
			]),
		),
		caseAssertionIds: Object.fromEntries(
			successes.map(([caseId, success]) => [caseId, success.assertionIds]),
		),
		qualifiedCaseIds: Object.keys(individual.evidenceHashes).sort(),
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
	const actualBindings = {
		contractHash: qualification.contractHash,
		applicationCommit: qualification.applicationCommit,
		target: qualification.target,
		toolboxImageDigest: qualification.toolboxImageDigest,
		scannerManifestHash: qualification.scannerManifestHash,
		executionHash: qualification.executionHash,
		caseEvidenceHashes: qualification.caseEvidenceHashes,
		caseScannerIdentityHashes: qualification.caseScannerIdentityHashes,
		caseAssertionIds: qualification.caseAssertionIds,
		qualifiedCaseIds: qualification.qualifiedCaseIds,
		individualEvidenceSha256: qualification.individualEvidenceSha256,
		repeatEvidenceSha256: qualification.repeatEvidenceSha256,
		fullProfileEvidenceSha256: qualification.fullProfileEvidenceSha256,
		fullProfileExecutionPlanHash: qualification.fullProfileExecutionPlanHash,
		fullProfileNormalizedEvidenceHash:
			qualification.fullProfileNormalizedEvidenceHash,
		canonicalFinalReportHashes: qualification.canonicalFinalReportHashes,
	};
	if (canonicalJson(actualBindings) !== canonicalJson(expectedBindings)) {
		throw new Error("scanner_e2e_v2_qualification_binding_mismatch");
	}
	if (
		repeatability.applicationCommit !== qualification.applicationCommit ||
		fullProfile.applicationCommit !== qualification.applicationCommit
	) {
		throw new Error("scanner_e2e_v2_qualification_application_commit_mismatch");
	}
	return {
		qualificationHash,
		applicationCommit: qualification.applicationCommit,
		qualifiedCaseCount: qualification.qualifiedCaseIds.length,
	};
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			qualification: { type: "string" },
			evidence: { type: "string" },
			"repeat-evidence": { type: "string" },
			"full-profile-evidence": { type: "string" },
			"expected-commit": { type: "string" },
		},
		strict: true,
	}).values;
	if (
		!args.qualification ||
		!args.evidence ||
		!args["repeat-evidence"] ||
		!args["full-profile-evidence"]
	) {
		throw new Error("scanner_e2e_v2_qualification_verify_args_required");
	}
	const verified = await verifyScannerE2EV2Qualification({
		qualificationPath: args.qualification,
		evidencePath: args.evidence,
		repeatEvidencePath: args["repeat-evidence"],
		fullProfileEvidencePath: args["full-profile-evidence"],
		expectedApplicationCommit: args["expected-commit"],
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
