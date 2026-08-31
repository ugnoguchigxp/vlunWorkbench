import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { canonicalJson } from "../shared/canonical-json";
import { scanProfileStabilityQualificationV1Schema } from "../shared/schemas/scan-profile-stability-qualification.schema";

const digest = (value: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
const execFileAsync = promisify(execFile);

async function requireCleanCandidateCheckout(params: {
	repositoryPath: string;
	candidateCommit: unknown;
}) {
	if (typeof params.candidateCommit !== "string")
		throw new Error("qualification_candidate_commit_missing");
	const options = {
		cwd: params.repositoryPath,
		encoding: "utf8" as const,
		maxBuffer: 1024 * 1024,
	};
	const [head, status] = await Promise.all([
		execFileAsync("git", ["rev-parse", "HEAD"], options),
		execFileAsync(
			"git",
			["status", "--porcelain=v1", "--untracked-files=all"],
			options,
		),
	]);
	if (head.stdout.trim() !== params.candidateCommit)
		throw new Error("qualification_candidate_commit_mismatch");
	if (status.stdout.trim())
		throw new Error("qualification_candidate_checkout_dirty");
}

export async function buildScanProfileStabilityQualification(params: {
	unsignedPath: string;
	artifactRoot: string;
	outputPath: string;
	requireCleanCandidate?: boolean;
	candidateRepositoryPath?: string;
}) {
	const unsigned = JSON.parse(
		await fs.readFile(params.unsignedPath, "utf8"),
	) as Record<string, unknown>;
	if ("qualificationId" in unsigned)
		throw new Error("qualification_builder_unsigned_receipt_required");
	if (params.requireCleanCandidate)
		await requireCleanCandidateCheckout({
			repositoryPath: params.candidateRepositoryPath ?? process.cwd(),
			candidateCommit: unsigned.candidateCommit,
		});
	const artifacts = Array.isArray(unsigned.artifacts) ? unsigned.artifacts : [];
	for (const artifact of artifacts) {
		if (!artifact || typeof artifact !== "object")
			throw new Error("qualification_artifact_invalid");
		const record = artifact as Record<string, unknown>;
		if (typeof record.relativePath !== "string")
			throw new Error("qualification_artifact_path_missing");
		const resolved = path.resolve(params.artifactRoot, record.relativePath);
		if (!resolved.startsWith(`${path.resolve(params.artifactRoot)}${path.sep}`))
			throw new Error("qualification_artifact_path_outside_root");
		const bytes = await fs.readFile(resolved);
		record.byteLength = bytes.byteLength;
		record.sha256 = digest(bytes);
	}
	const value = {
		...unsigned,
		qualificationId: digest(canonicalJson(unsigned)),
	};
	const receipt = scanProfileStabilityQualificationV1Schema.parse(value);
	await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
	await fs.writeFile(
		params.outputPath,
		`${JSON.stringify(receipt, null, 2)}\n`,
	);
	return receipt;
}

async function main() {
	const { values } = parseArgs({
		options: {
			unsigned: { type: "string" },
			artifactRoot: { type: "string" },
			out: { type: "string" },
			"require-clean-candidate": { type: "boolean", default: false },
			"candidate-repository": { type: "string" },
		},
	});
	if (!values.unsigned || !values.artifactRoot || !values.out)
		throw new Error("qualification_builder_args_required");
	const receipt = await buildScanProfileStabilityQualification({
		unsignedPath: values.unsigned,
		artifactRoot: values.artifactRoot,
		outputPath: values.out,
		requireCleanCandidate: values["require-clean-candidate"],
		candidateRepositoryPath: values["candidate-repository"],
	});
	console.log(
		JSON.stringify({
			qualificationId: receipt.qualificationId,
			profileId: receipt.profileId,
		}),
	);
}
if (import.meta.main) await main();
