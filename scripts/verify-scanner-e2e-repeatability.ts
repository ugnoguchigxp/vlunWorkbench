import { parseArgs } from "node:util";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { verifyScannerE2EV2Evidence } from "./verify-scanner-e2e-v2-evidence";

type VerifiedBundle = Awaited<ReturnType<typeof verifyScannerE2EV2Evidence>>;

/**
 * Excludes run identifiers, timestamps and artifact byte identities. Those are
 * already verified per run; this projection tests that the same immutable
 * inputs compile to the same execution decision and observed scanner shape.
 */
export function normalizedScannerE2EEvidence(bundle: VerifiedBundle) {
	return bundle.evidence.map((entry) => {
		const success = entry.scenarios.find(
			(scenario) => scenario.kind === "success",
		);
		const failClosed = entry.scenarios.find(
			(scenario) => scenario.kind === "fail_closed",
		);
		if (!success || !failClosed) {
			throw new Error(
				`scanner_e2e_repeatability_scenario_missing:${entry.caseId}`,
			);
		}
		return {
			caseId: entry.caseId,
			success: {
				scenarioType: success.scenarioType,
				profileOutcome: success.profileOutcome,
				executionPlanHash: success.executionPlanHash,
				sourceRevisionHash: success.sourceRevisionHash,
				scannerManifestHash: success.scannerManifestHash,
				executionHash: success.executionHash,
				scannerIdentityHash: success.scannerIdentityHash,
				normalizedEvidenceHash: success.normalizedEvidenceHash,
				scannerProcessCount: success.scannerProcessCount,
				toolRunCount: success.toolRunCount,
				work: success.work,
				assertionIds: success.assertionIds.slice().sort(),
				artifactRoles: success.artifacts
					.map((artifact) => artifact.kind)
					.sort(),
				toolVersions: Object.fromEntries(
					Object.entries(success.toolVersions).sort(([left], [right]) =>
						left.localeCompare(right),
					),
				),
				imageDigests: success.imageDigests.slice().sort(),
				reasonCodes: success.reasonCodes.slice().sort(),
			},
			failClosed: {
				profileOutcome: failClosed.profileOutcome,
				terminationReason: failClosed.terminationReason,
				scannerProcessCount: failClosed.scannerProcessCount,
				toolRunCount: failClosed.toolRunCount,
				canonicalFinalReportCount: failClosed.canonicalFinalReportCount,
				artifactCount: failClosed.artifactCount,
				assertionIds: failClosed.assertionIds.slice().sort(),
				reasonCodes: failClosed.reasonCodes.slice().sort(),
			},
		};
	});
}

export async function verifyScannerE2ERepeatability(params: {
	firstEvidencePath: string;
	repeatEvidencePath: string;
}) {
	const [first, repeat] = await Promise.all([
		verifyScannerE2EV2Evidence({ evidencePath: params.firstEvidencePath }),
		verifyScannerE2EV2Evidence({ evidencePath: params.repeatEvidencePath }),
	]);
	if (first.contractHash !== repeat.contractHash) {
		throw new Error("scanner_e2e_repeatability_contract_mismatch");
	}
	const firstNormalized = normalizedScannerE2EEvidence(first);
	const repeatNormalized = normalizedScannerE2EEvidence(repeat);
	const firstHash = sha256(canonicalJson(firstNormalized));
	const repeatHash = sha256(canonicalJson(repeatNormalized));
	if (firstHash !== repeatHash) {
		throw new Error("scanner_e2e_repeatability_evidence_mismatch");
	}
	return {
		contractHash: first.contractHash,
		normalizedEvidenceHash: firstHash,
	};
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: { first: { type: "string" }, repeat: { type: "string" } },
		strict: true,
	}).values;
	if (!args.first || !args.repeat) {
		throw new Error("scanner_e2e_repeatability_args_required");
	}
	const verified = await verifyScannerE2ERepeatability({
		firstEvidencePath: args.first,
		repeatEvidencePath: args.repeat,
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) await main();
