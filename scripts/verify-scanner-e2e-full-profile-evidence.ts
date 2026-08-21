import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EFullProfileEvidenceSchema } from "../shared/schemas/scanner-e2e-full-profile.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { normalizedFullProfileRun } from "./scanner-e2e-full-profile-lib";

/** Rechecks immutable output bytes and both composite-run equivalence claims. */
export async function verifyScannerE2EFullProfileEvidence(params: {
	evidencePath: string;
	artifactRoot?: string;
}) {
	const raw = await fs.readFile(params.evidencePath, "utf8");
	const evidence = scannerE2EFullProfileEvidenceSchema.parse(JSON.parse(raw));
	const artifactRoot =
		params.artifactRoot ??
		path.join(
			path.dirname(params.evidencePath),
			`${path.basename(params.evidencePath, path.extname(params.evidencePath))}.storage`,
		);
	for (const [index, run] of evidence.runs.entries()) {
		const normalizedEvidenceHash = sha256(
			canonicalJson(normalizedFullProfileRun(run)),
		);
		if (normalizedEvidenceHash !== run.normalizedEvidenceHash) {
			throw new Error(`scanner_e2e_full_profile_normalized_invalid:${index}`);
		}
		const roles = new Set(run.artifacts.map((artifact) => artifact.kind));
		for (const requiredRole of ["raw_result", "sbom", "dast_raw_result"]) {
			if (!roles.has(requiredRole)) {
				throw new Error(
					`scanner_e2e_full_profile_artifact_role_missing:${index}:${requiredRole}`,
				);
			}
		}
		for (const artifact of run.artifacts) {
			assertArtifactStorageKey(index, artifact.storageKey);
			const artifactPath = path.resolve(artifactRoot, artifact.storageKey);
			const relative = path.relative(path.resolve(artifactRoot), artifactPath);
			if (relative.startsWith("..") || path.isAbsolute(relative)) {
				throw new Error(
					`scanner_e2e_full_profile_artifact_path_invalid:${index}`,
				);
			}
			const bytes = await fs.readFile(artifactPath).catch(() => null);
			if (!bytes) {
				throw new Error(
					`scanner_e2e_full_profile_artifact_missing:${index}:${artifact.storageKey}`,
				);
			}
			const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
			if (digest !== artifact.sha256 || bytes.length !== artifact.sizeBytes) {
				throw new Error(
					`scanner_e2e_full_profile_artifact_integrity_invalid:${index}:${artifact.storageKey}`,
				);
			}
		}
	}
	const [first, repeat] = evidence.runs;
	if (first.sourceRevisionHash !== repeat.sourceRevisionHash) {
		throw new Error("scanner_e2e_full_profile_source_revision_mismatch");
	}
	if (first.executionPlanHash !== repeat.executionPlanHash) {
		throw new Error("scanner_e2e_full_profile_plan_mismatch");
	}
	if (first.normalizedEvidenceHash !== repeat.normalizedEvidenceHash) {
		throw new Error("scanner_e2e_full_profile_repeatability_mismatch");
	}
	return {
		targetCommit: evidence.target.commit,
		executionPlanHash: evidence.runs[0].executionPlanHash,
		normalizedEvidenceHash: evidence.runs[0].normalizedEvidenceHash,
	};
}

function assertArtifactStorageKey(runIndex: number, storageKey: string) {
	const normalized = storageKey.replaceAll("\\", "/");
	if (
		!/^[0-9a-f-]+\/owners\/(?:tool-run|dast|report|scan|diagnostic)\/[0-9a-z-]+\//.test(
			normalized,
		)
	) {
		throw new Error(
			`scanner_e2e_full_profile_artifact_storage_key_invalid:${runIndex}`,
		);
	}
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: { evidence: { type: "string" } },
		strict: true,
	}).values;
	if (!args.evidence)
		throw new Error("scanner_e2e_full_profile_evidence_required");
	const verified = await verifyScannerE2EFullProfileEvidence({
		evidencePath: args.evidence,
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) await main();
