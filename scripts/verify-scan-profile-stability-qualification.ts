import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import {
	getCatalogEntry,
	hashCatalogEntry,
} from "../api/modules/scans/profile-catalog";
import { evaluateProfileStabilityQualification } from "../api/modules/scans/qualification/profile-stability-policy";
import { canonicalJson } from "../shared/canonical-json";
import {
	type ScanProfileStabilityQualificationV1,
	scanProfileStabilityQualificationV1Schema,
} from "../shared/schemas/scan-profile-stability-qualification.schema";

const sha256 = (value: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
const execFileAsync = promisify(execFile);

async function gitText(args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd: process.cwd(),
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
		});
		return stdout;
	} catch {
		throw new Error(`qualification_git_failed:${args[0]}`);
	}
}

export async function sourceTreeDigest(
	candidateCommit: string,
): Promise<string> {
	const rows = (
		await gitText(["ls-tree", "-r", "--full-tree", candidateCommit])
	)
		.trimEnd()
		.split("\n")
		.filter(Boolean)
		.map((row) => {
			const match = /^(\d+)\s+\w+\s+([a-f0-9]+)\t(.+)$/.exec(row);
			if (!match) throw new Error("qualification_git_tree_row_invalid");
			return `${match[3]}\u0000${match[1]}\u0000${match[2]}\n`;
		})
		.sort();
	return sha256(rows.join(""));
}

export async function verifyScanProfileStabilityQualification(params: {
	receiptPath: string;
	artifactRoot: string;
}): Promise<ScanProfileStabilityQualificationV1> {
	const receipt = scanProfileStabilityQualificationV1Schema.parse(
		JSON.parse(await fs.readFile(params.receiptPath, "utf8")),
	);
	const { qualificationId, ...unsigned } = receipt;
	if (qualificationId !== sha256(canonicalJson(unsigned)))
		throw new Error("qualification_hash_invalid");
	if (
		receipt.sourceTreeDigest !==
		(await sourceTreeDigest(receipt.candidateCommit))
	)
		throw new Error("qualification_source_tree_mismatch");
	const catalogEntry = getCatalogEntry(receipt.profileId);
	if (
		!catalogEntry ||
		hashCatalogEntry(catalogEntry) !== receipt.catalogEntryHash
	)
		throw new Error("qualification_catalog_entry_mismatch");
	for (const artifact of receipt.artifacts) {
		const artifactPath = path.resolve(
			params.artifactRoot,
			artifact.relativePath,
		);
		const expectedRoot = `${path.resolve(params.artifactRoot)}${path.sep}`;
		if (!artifactPath.startsWith(expectedRoot))
			throw new Error("qualification_artifact_path_outside_root");
		const bytes = await fs.readFile(artifactPath);
		if (
			bytes.byteLength !== artifact.byteLength ||
			sha256(bytes) !== artifact.sha256
		)
			throw new Error(
				`qualification_artifact_hash_mismatch:${artifact.artifactId}`,
			);
	}
	const policyResult = evaluateProfileStabilityQualification(receipt);
	if (!policyResult.ok)
		throw new Error(
			`${policyResult.reason}:${"caseId" in policyResult ? policyResult.caseId : receipt.profileId}`,
		);
	return receipt;
}

async function main() {
	const { values } = parseArgs({
		options: { receipt: { type: "string" }, artifactRoot: { type: "string" } },
	});
	if (!values.receipt || !values.artifactRoot)
		throw new Error("qualification_verify_args_required");
	const receipt = await verifyScanProfileStabilityQualification({
		receiptPath: values.receipt,
		artifactRoot: values.artifactRoot,
	});
	console.log(
		JSON.stringify({
			ok: true,
			qualificationId: receipt.qualificationId,
			profileId: receipt.profileId,
		}),
	);
}

if (import.meta.main) await main();
