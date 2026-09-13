import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sha256 } from "./benchmark/benchmark-input-provenance";

const manifestSchema = z.object({
	releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
	status: z.string(),
	artifacts: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
});

/** Verifies stored bytes and identity, not current-code capability or DB semantics. */
export async function verifySavedCapability(directory: string) {
	const root = await realpath(directory);
	const manifest = manifestSchema.parse(
		JSON.parse(await readFile(path.join(root, "report.json"), "utf8")),
	);
	if (Object.keys(manifest.artifacts).length === 0)
		throw new Error("capability_artifacts_missing");
	for (const [relative, expected] of Object.entries(manifest.artifacts)) {
		if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
			throw new Error("capability_artifact_path_invalid");
		const file = await realpath(path.join(root, relative));
		const resolvedRelative = path.relative(root, file);
		if (
			resolvedRelative.startsWith(`..${path.sep}`) ||
			resolvedRelative === ".." ||
			path.isAbsolute(resolvedRelative)
		)
			throw new Error("capability_artifact_path_invalid");
		if (sha256(await readFile(file)) !== expected)
			throw new Error(`capability_artifact_hash_mismatch:${relative}`);
	}
	const reportFile = "professional-capability-release-report.json";
	if (!manifest.artifacts[reportFile])
		throw new Error("capability_release_report_unbound");
	const report = JSON.parse(
		await readFile(path.join(root, reportFile), "utf8"),
	);
	if (report.releaseCommit !== manifest.releaseCommit)
		throw new Error("capability_commit_mismatch");
	return {
		ok: true,
		releaseCommit: manifest.releaseCommit,
		recordedStatus: manifest.status,
		verifiedArtifacts: Object.keys(manifest.artifacts).length,
		scope:
			"Stored artifact integrity; not a measurement of the current working tree.",
	};
}

if (import.meta.main) {
	const directory = process.argv.slice(2).find((arg) => arg !== "--");
	if (!directory)
		throw new Error("Usage: bun run evidence:verify -- <saved-run-directory>");
	console.log(JSON.stringify(await verifySavedCapability(directory)));
}
