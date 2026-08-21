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
	expectedApplicationCommit?: string;
	targetRepoPath?: string;
	verifyTargetSnapshot?: boolean;
}) {
	const raw = await fs.readFile(params.evidencePath, "utf8");
	const evidence = scannerE2EFullProfileEvidenceSchema.parse(JSON.parse(raw));
	if (
		params.expectedApplicationCommit &&
		evidence.applicationCommit !== params.expectedApplicationCommit
	) {
		throw new Error("scanner_e2e_full_profile_application_commit_mismatch");
	}
	const targetContract = JSON.parse(
		await fs.readFile(
			path.resolve(
				import.meta.dir,
				"../spec/security-capability/todolist-scan-target.v1.json",
			),
			"utf8",
		),
	) as { repository?: unknown; commit?: unknown };
	if (
		evidence.target.repository !== targetContract.repository ||
		evidence.target.commit !== targetContract.commit
	) {
		throw new Error("scanner_e2e_full_profile_target_contract_mismatch");
	}
	if (params.verifyTargetSnapshot !== false) {
		const observedSnapshot = await gitArchiveDigest(
			params.targetRepoPath ??
				process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH ??
				path.resolve(import.meta.dir, "../../todolist"),
			evidence.target.commit,
		);
		if (observedSnapshot !== evidence.target.snapshotSha256) {
			throw new Error("scanner_e2e_full_profile_target_snapshot_mismatch");
		}
	}
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
		assertArtifactStorageKey(index, run.canonicalFinalReportStorageKey);
		const finalPath = path.resolve(
			artifactRoot,
			run.canonicalFinalReportStorageKey,
		);
		const finalRelative = path.relative(path.resolve(artifactRoot), finalPath);
		if (finalRelative.startsWith("..") || path.isAbsolute(finalRelative)) {
			throw new Error(
				`scanner_e2e_full_profile_final_report_path_invalid:${index}`,
			);
		}
		const finalBytes = await fs.readFile(finalPath).catch(() => null);
		const finalDigest = finalBytes
			? `sha256:${crypto.createHash("sha256").update(finalBytes).digest("hex")}`
			: null;
		if (
			!finalBytes ||
			finalDigest !== run.canonicalFinalReportSha256 ||
			finalBytes.length !== run.canonicalFinalReportSizeBytes
		) {
			throw new Error(`scanner_e2e_full_profile_final_report_invalid:${index}`);
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
		applicationCommit: evidence.applicationCommit,
		target: evidence.target,
		toolboxImageDigest: evidence.toolboxImageDigest,
		targetCommit: evidence.target.commit,
		executionPlanHash: evidence.runs[0].executionPlanHash,
		normalizedEvidenceHash: evidence.runs[0].normalizedEvidenceHash,
		evidence,
	};
}

async function gitArchiveDigest(repoPath: string, commit: string) {
	const child = Bun.spawn(
		["git", "-C", path.resolve(repoPath), "archive", "--format=tar", commit],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [bytes, exitCode] = await Promise.all([
		new Response(child.stdout).arrayBuffer(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error("scanner_e2e_full_profile_target_snapshot_unavailable");
	}
	return `sha256:${crypto
		.createHash("sha256")
		.update(new Uint8Array(bytes))
		.digest("hex")}`;
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
		options: {
			evidence: { type: "string" },
			"expected-commit": { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.evidence)
		throw new Error("scanner_e2e_full_profile_evidence_required");
	const verified = await verifyScannerE2EFullProfileEvidence({
		evidencePath: args.evidence,
		expectedApplicationCommit: args["expected-commit"],
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) await main();
