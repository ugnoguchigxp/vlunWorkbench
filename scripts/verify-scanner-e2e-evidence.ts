import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { scannerE2EEvidenceBundleSchema } from "../shared/schemas/scanner-e2e-evidence.schema";
import {
	canonicalJson,
	loadScannerE2ECaseRegistry,
	sha256,
} from "./scanner-e2e-case-registry";

export async function verifyScannerE2EEvidence(params: {
	evidencePath: string;
}) {
	const [{ registry, contractHash }, raw] = await Promise.all([
		loadScannerE2ECaseRegistry(),
		fs.readFile(params.evidencePath, "utf8"),
	]);
	const bundle = scannerE2EEvidenceBundleSchema.parse(JSON.parse(raw));
	const byId = new Map(
		bundle.evidence.map((evidence) => [evidence.caseId, evidence]),
	);
	if (byId.size !== bundle.evidence.length) {
		throw new Error("scanner_e2e_evidence_duplicate_case");
	}
	if (byId.size !== registry.cases.length) {
		throw new Error("scanner_e2e_evidence_case_set_mismatch");
	}
	for (const entry of registry.cases) {
		const evidence = byId.get(entry.id);
		if (!evidence) throw new Error(`scanner_e2e_evidence_missing:${entry.id}`);
		if (evidence.contractHash !== contractHash) {
			throw new Error(`scanner_e2e_evidence_contract_mismatch:${entry.id}`);
		}
		if (
			evidence.status !== "passed" ||
			evidence.verdict !== entry.expectedVerdict
		) {
			throw new Error(`scanner_e2e_evidence_not_passing:${entry.id}`);
		}
		const evidenceArtifactIds = new Set(evidence.artifactIds);
		const describedArtifacts = new Map(
			evidence.artifacts.map((artifact) => [artifact.id, artifact]),
		);
		if (
			evidenceArtifactIds.size !== evidence.artifactIds.length ||
			describedArtifacts.size !== evidence.artifacts.length ||
			evidenceArtifactIds.size !== describedArtifacts.size ||
			[...evidenceArtifactIds].some((id) => !describedArtifacts.has(id))
		) {
			throw new Error(
				`scanner_e2e_evidence_artifact_identity_mismatch:${entry.id}`,
			);
		}
		for (const requiredRole of entry.expectedArtifactRoles) {
			if (
				![...describedArtifacts.values()].some(
					(artifact) => artifact.kind === requiredRole,
				)
			) {
				throw new Error(
					`scanner_e2e_evidence_artifact_role_missing:${entry.id}:${requiredRole}`,
				);
			}
		}
	}
	return {
		contractHash,
		evidence: bundle.evidence,
		evidenceHashes: Object.fromEntries(
			bundle.evidence.map((entry) => [
				entry.caseId,
				sha256(canonicalJson(entry)),
			]),
		),
	};
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: { evidence: { type: "string" } },
		strict: true,
	}).values;
	if (!args.evidence) throw new Error("scanner_e2e_evidence_path_required");
	const verified = await verifyScannerE2EEvidence({
		evidencePath: args.evidence,
	});
	console.log(
		JSON.stringify({ ok: true, contractHash: verified.contractHash }),
	);
}

if (import.meta.main) await main();
