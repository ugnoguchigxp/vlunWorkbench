import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	scannerExecutionRemediationCloseoutSchema,
	scannerHardeningDodContractSchema,
} from "../shared/schemas/scanner-hardening-dod.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";

export async function verifyScannerHardeningDod(
	params: { dodPath?: string; remediationPath?: string } = {},
) {
	const dodPath = path.resolve(
		params.dodPath ??
			path.resolve(
				import.meta.dir,
				"../spec/security-capability/scanner-hardening-dod.v1.json",
			),
	);
	const remediationPath = path.resolve(
		params.remediationPath ??
			path.resolve(
				import.meta.dir,
				"../spec/security-capability/scan-execution-remediation-closeout.v1.json",
			),
	);
	const [dodRaw, remediationRaw] = await Promise.all([
		fs.readFile(dodPath, "utf8"),
		fs.readFile(remediationPath, "utf8"),
	]);
	const dod = scannerHardeningDodContractSchema.parse(JSON.parse(dodRaw));
	const remediation = scannerExecutionRemediationCloseoutSchema.parse(
		JSON.parse(remediationRaw),
	);
	for (const expected of dod.remediationCases) {
		const actual = remediation.cases.find((entry) => entry.id === expected.id);
		if (
			!actual ||
			actual.requiredDisposition !== expected.disposition ||
			actual.reason !== expected.reason ||
			actual.successorContract !== expected.successorContract
		) {
			throw new Error(
				`scanner_hardening_remediation_case_mismatch:${expected.id}`,
			);
		}
	}
	return {
		parentDodCount: dod.parentDod.length,
		parentCloseoutCount: dod.parentCloseout.length,
		remediationDodCount: remediation.dod.length,
		remediationCaseCount: remediation.cases.length,
		dodContractHash: sha256(canonicalJson(dod)),
		remediationContractHash: sha256(canonicalJson(remediation)),
	};
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			dod: { type: "string" },
			remediation: { type: "string" },
		},
		strict: true,
	}).values;
	const verified = await verifyScannerHardeningDod({
		dodPath: args.dod,
		remediationPath: args.remediation,
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
