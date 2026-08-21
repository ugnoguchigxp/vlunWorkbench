import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EEvidenceBundleV2Schema } from "../shared/schemas/scanner-e2e-v2.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { loadScannerE2ECaseRegistryV2 } from "./scanner-e2e-v2-case-registry";

export async function verifyScannerE2EV2Evidence(params: {
	evidencePath: string;
	/** The harness preserves this directory so the verifier can recompute every recorded digest. */
	artifactRoot?: string;
	expectedApplicationCommit?: string;
	targetRepoPath?: string;
	verifyTargetSnapshot?: boolean;
}) {
	const [{ registry, contractHash }, raw] = await Promise.all([
		loadScannerE2ECaseRegistryV2(),
		fs.readFile(params.evidencePath, "utf8"),
	]);
	const bundle = scannerE2EEvidenceBundleV2Schema.parse(JSON.parse(raw));
	if (
		params.expectedApplicationCommit &&
		bundle.applicationCommit !== params.expectedApplicationCommit
	) {
		throw new Error("scanner_e2e_v2_application_commit_mismatch");
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
		bundle.target.repository !== targetContract.repository ||
		bundle.target.commit !== targetContract.commit
	) {
		throw new Error("scanner_e2e_v2_target_contract_mismatch");
	}
	if (params.verifyTargetSnapshot !== false) {
		const observedSnapshot = await gitArchiveDigest(
			params.targetRepoPath ??
				process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH ??
				path.resolve(import.meta.dir, "../../todolist"),
			bundle.target.commit,
		);
		if (observedSnapshot !== bundle.target.snapshotSha256) {
			throw new Error("scanner_e2e_v2_target_snapshot_mismatch");
		}
	}
	const byId = new Map(bundle.evidence.map((entry) => [entry.caseId, entry]));
	if (byId.size !== bundle.evidence.length) {
		throw new Error("scanner_e2e_v2_evidence_duplicate_case");
	}
	if (byId.size !== registry.cases.length) {
		throw new Error("scanner_e2e_v2_evidence_case_set_mismatch");
	}
	const artifactRoot =
		params.artifactRoot ??
		path.join(
			path.dirname(params.evidencePath),
			`${path.basename(params.evidencePath, path.extname(params.evidencePath))}.storage`,
		);
	for (const contract of registry.cases) {
		const entry = byId.get(contract.id);
		if (!entry)
			throw new Error(`scanner_e2e_v2_evidence_missing:${contract.id}`);
		if (entry.contractHash !== contractHash) {
			throw new Error(`scanner_e2e_v2_contract_mismatch:${contract.id}`);
		}
		const success = entry.scenarios.find(
			(scenario) => scenario.kind === "success",
		);
		const failed = entry.scenarios.find(
			(scenario) => scenario.kind === "fail_closed",
		);
		if (!success || !failed) {
			throw new Error(`scanner_e2e_v2_scenario_set_mismatch:${contract.id}`);
		}
		assertExactAssertions(
			contract.id,
			success.assertionIds,
			contract.requiredAssertionIds,
		);
		assertExactAssertions(contract.id, failed.assertionIds, ["FAIL-01"]);
		if (
			success.normalizedEvidenceHash !==
			sha256(canonicalJson(success.normalizedFindingHashes))
		) {
			throw new Error(
				`scanner_e2e_v2_normalized_evidence_invalid:${contract.id}`,
			);
		}
		if (
			failed.profileOutcome !== "blocked" ||
			failed.terminationReason !== "plan_changed" ||
			failed.scannerProcessCount !== 0 ||
			failed.toolRunCount !== 0 ||
			failed.canonicalFinalReportCount !== 0 ||
			failed.artifactCount !== 0 ||
			!failed.reasonCodes.includes("plan_changed")
		) {
			throw new Error(`scanner_e2e_v2_fail_closed_invalid:${contract.id}`);
		}
		if (contract.expectedVerdict === "not_applicable") {
			if (
				success.scenarioType !== "not_applicable_success" ||
				success.scannerProcessCount !== 0 ||
				success.toolRunCount !== 0 ||
				success.artifacts.length !== 0 ||
				!success.reasonCodes.includes("schema_not_found")
			) {
				throw new Error(`scanner_e2e_v2_not_applicable_invalid:${contract.id}`);
			}
		} else if (
			success.scenarioType !== "executed_success" ||
			success.scannerProcessCount < 1
		) {
			throw new Error(`scanner_e2e_v2_execution_missing:${contract.id}`);
		}
		for (const [name, bounds] of Object.entries(contract.workCounters)) {
			const observed = success.work[name as keyof typeof success.work];
			if (
				observed === undefined ||
				observed < bounds.minimum ||
				(bounds.maximum !== undefined && observed > bounds.maximum)
			) {
				throw new Error(
					`scanner_e2e_v2_work_counter_invalid:${contract.id}:${name}`,
				);
			}
		}
		const artifactRoles = new Set(
			success.artifacts.map((artifact) => artifact.kind),
		);
		for (const role of contract.expectedArtifactRoles) {
			if (!artifactRoles.has(role)) {
				throw new Error(
					`scanner_e2e_v2_artifact_role_missing:${contract.id}:${role}`,
				);
			}
		}
		for (const artifact of success.artifacts) {
			assertArtifactStorageKey(contract.id, artifact.storageKey);
			const artifactPath = path.resolve(artifactRoot, artifact.storageKey);
			const relative = path.relative(path.resolve(artifactRoot), artifactPath);
			if (relative.startsWith("..") || path.isAbsolute(relative)) {
				throw new Error(`scanner_e2e_v2_artifact_path_invalid:${contract.id}`);
			}
			const bytes = await fs.readFile(artifactPath).catch(() => null);
			if (!bytes)
				throw new Error(
					`scanner_e2e_v2_artifact_missing:${contract.id}:${artifact.id}`,
				);
			const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
			if (digest !== artifact.sha256 || bytes.length !== artifact.sizeBytes) {
				throw new Error(
					`scanner_e2e_v2_artifact_integrity_invalid:${contract.id}:${artifact.id}`,
				);
			}
		}
		assertArtifactStorageKey(
			contract.id,
			success.canonicalFinalReportStorageKey,
		);
		const finalPath = path.resolve(
			artifactRoot,
			success.canonicalFinalReportStorageKey,
		);
		const finalRelative = path.relative(path.resolve(artifactRoot), finalPath);
		if (finalRelative.startsWith("..") || path.isAbsolute(finalRelative)) {
			throw new Error(
				`scanner_e2e_v2_final_report_path_invalid:${contract.id}`,
			);
		}
		const finalBytes = await fs.readFile(finalPath).catch(() => null);
		if (!finalBytes) {
			throw new Error(`scanner_e2e_v2_final_report_missing:${contract.id}`);
		}
		const finalDigest = `sha256:${crypto
			.createHash("sha256")
			.update(finalBytes)
			.digest("hex")}`;
		if (
			finalDigest !== success.canonicalFinalReportSha256 ||
			finalBytes.length !== success.canonicalFinalReportSizeBytes
		) {
			throw new Error(`scanner_e2e_v2_final_report_invalid:${contract.id}`);
		}
	}
	return {
		contractHash,
		applicationCommit: bundle.applicationCommit,
		target: bundle.target,
		toolboxImageDigest: bundle.toolboxImageDigest,
		evidence: bundle.evidence,
		evidenceHashes: Object.fromEntries(
			bundle.evidence.map((entry) => [
				entry.caseId,
				sha256(canonicalJson(entry)),
			]),
		),
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
	if (exitCode !== 0)
		throw new Error("scanner_e2e_v2_target_snapshot_unavailable");
	return `sha256:${crypto
		.createHash("sha256")
		.update(new Uint8Array(bytes))
		.digest("hex")}`;
}

function assertExactAssertions(
	caseId: string,
	actual: readonly string[],
	expected: readonly string[],
) {
	if (
		new Set(actual).size !== actual.length ||
		actual.length !== expected.length ||
		expected.some((id) => !actual.includes(id))
	) {
		throw new Error(`scanner_e2e_v2_assertion_set_mismatch:${caseId}`);
	}
}

function assertArtifactStorageKey(caseId: string, storageKey: string) {
	const normalized = storageKey.replaceAll("\\\\", "/");
	if (
		!/^[0-9a-f-]+\/owners\/(?:tool-run|dast|report|scan|diagnostic)\/[0-9a-z-]+\//.test(
			normalized,
		)
	) {
		throw new Error(`scanner_e2e_v2_artifact_storage_key_invalid:${caseId}`);
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
	if (!args.evidence) throw new Error("scanner_e2e_evidence_path_required");
	const verified = await verifyScannerE2EV2Evidence({
		evidencePath: args.evidence,
		expectedApplicationCommit: args["expected-commit"],
	});
	console.log(
		JSON.stringify({ ok: true, contractHash: verified.contractHash }),
	);
}

if (import.meta.main) await main();
