import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { ArtifactStorage } from "../api/modules/scans/artifact-storage";

type Evidence = {
	ok: boolean;
	retained: boolean;
	artifactRoot: string;
	databasePath: string;
	target: {
		commit: string;
		sourceArchiveSha256: string;
		sourceArchivePath: string;
	};
	results: Array<{
		scanRunId: string;
		profileOutcome: string | null;
		artifactCount: number;
	}>;
};

const args = parseArgs({
	args: process.argv.slice(2),
	options: { evidence: { type: "string" } },
	strict: true,
}).values;
if (!args.evidence)
	throw new Error("verify_scan_run_integrity_evidence_required");
const evidence = JSON.parse(
	await fs.readFile(args.evidence, "utf8"),
) as Evidence;
if (
	!evidence.ok ||
	!evidence.retained ||
	!/^[a-f0-9]{64}$/.test(evidence.target.sourceArchiveSha256)
) {
	throw new Error("verify_scan_run_integrity_evidence_invalid");
}
const sourceArchiveSha256 = crypto
	.createHash("sha256")
	.update(await fs.readFile(evidence.target.sourceArchivePath))
	.digest("hex");
if (sourceArchiveSha256 !== evidence.target.sourceArchiveSha256) {
	throw new Error("verify_scan_run_integrity_source_archive_invalid");
}
const db = new Database(evidence.databasePath, { readonly: true });
const storage = new ArtifactStorage(evidence.artifactRoot);
try {
	const scanRunIds = new Set<string>();
	for (const result of evidence.results) {
		if (!result.profileOutcome || result.profileOutcome === "pending") {
			throw new Error(
				`verify_scan_run_integrity_nonterminal:${result.scanRunId}`,
			);
		}
		if (scanRunIds.has(result.scanRunId)) {
			throw new Error(
				`verify_scan_run_integrity_duplicate_scan:${result.scanRunId}`,
			);
		}
		scanRunIds.add(result.scanRunId);
		const scanRun = db
			.query("select status, profile_outcome from scan_runs where id = ?")
			.get(result.scanRunId) as {
			status: string;
			profile_outcome: string;
		} | null;
		if (
			scanRun?.status !== "completed" ||
			scanRun.profile_outcome !== result.profileOutcome
		) {
			throw new Error(
				`verify_scan_run_integrity_status_mismatch:${result.scanRunId}`,
			);
		}
		const artifacts = db
			.query(
				"select id, path, storage_key, sha256, size_bytes from scan_artifacts where scan_run_id = ?",
			)
			.all(result.scanRunId) as Array<{
			id: string;
			path: string;
			storage_key: string | null;
			sha256: string;
			size_bytes: number;
		}>;
		if (artifacts.length !== result.artifactCount) {
			throw new Error(
				`verify_scan_run_integrity_artifact_count_mismatch:${result.scanRunId}`,
			);
		}
		for (const artifact of artifacts) {
			if (!artifact.storage_key) {
				throw new Error(
					`verify_scan_run_integrity_storage_key_missing:${artifact.id}`,
				);
			}
			if (
				!(await storage.verifyArtifact(
					artifact.storage_key,
					{
						sha256: artifact.sha256,
						sizeBytes: artifact.size_bytes,
					},
					{ maxBytes: 64 * 1024 * 1024 },
				))
			) {
				throw new Error(
					`verify_scan_run_integrity_artifact_invalid:${artifact.id}`,
				);
			}
		}
	}
	console.log(
		JSON.stringify({ ok: true, verifiedRuns: evidence.results.length }),
	);
} finally {
	db.close();
}
