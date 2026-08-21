import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerHardeningBranchProtectionEvidenceSchema } from "../shared/schemas/scanner-hardening-receipt.schema";

type JsonObject = Record<string, unknown>;

export function buildBranchProtectionEvidence(params: {
	repository: string;
	branchName: string;
	branchResponse: unknown;
	rulesResponse: unknown;
	capturedAt: string;
}) {
	const branch = objectValue(params.branchResponse);
	if (branch.name !== params.branchName || branch.protected !== true) {
		throw new Error("scanner_hardening_branch_not_protected");
	}
	const contexts = new Set<string>();
	const protection = optionalObject(branch.protection);
	const requiredStatusChecks = optionalObject(
		protection?.required_status_checks,
	);
	for (const context of optionalStringArray(requiredStatusChecks?.contexts)) {
		contexts.add(context);
	}
	if (!Array.isArray(params.rulesResponse)) {
		throw new Error("scanner_hardening_branch_rules_response_invalid");
	}
	for (const rawRule of params.rulesResponse) {
		const rule = optionalObject(rawRule);
		if (rule?.type !== "required_status_checks") continue;
		const parameters = optionalObject(rule.parameters);
		const checks = parameters?.required_status_checks;
		if (!Array.isArray(checks)) continue;
		for (const rawCheck of checks) {
			const check = optionalObject(rawCheck);
			if (typeof check?.context === "string" && check.context.length > 0) {
				contexts.add(check.context);
			}
		}
	}
	return scannerHardeningBranchProtectionEvidenceSchema.parse({
		schemaVersion: 1,
		source: "github-api",
		repository: params.repository,
		ref: `refs/heads/${params.branchName}`,
		branchProtected: true,
		requiredStatusChecks: [...contexts].sort(),
		capturedAt: params.capturedAt,
	});
}

async function capture(params: {
	repository: string;
	branchName: string;
	outputPath: string;
	token?: string;
}) {
	const encodedBranch = encodeURIComponent(params.branchName);
	const [branchResponse, rulesResponse] = await Promise.all([
		githubJson(
			`https://api.github.com/repos/${params.repository}/branches/${encodedBranch}`,
			params.token,
		),
		githubJson(
			`https://api.github.com/repos/${params.repository}/rules/branches/${encodedBranch}`,
			params.token,
		),
	]);
	const evidence = buildBranchProtectionEvidence({
		repository: params.repository,
		branchName: params.branchName,
		branchResponse,
		rulesResponse,
		capturedAt: new Date().toISOString(),
	});
	await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
	await fs.writeFile(
		params.outputPath,
		`${JSON.stringify(evidence, null, 2)}\n`,
		{ flag: "wx" },
	);
}

async function githubJson(url: string, token?: string): Promise<unknown> {
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});
	if (!response.ok) {
		throw new Error(`scanner_hardening_github_api_failed:${response.status}`);
	}
	return await response.json();
}

function objectValue(value: unknown): JsonObject {
	const result = optionalObject(value);
	if (!result) throw new Error("scanner_hardening_github_response_invalid");
	return result;
}

function optionalObject(value: unknown): JsonObject | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function optionalStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			repository: { type: "string" },
			branch: { type: "string", default: "main" },
			out: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.repository || !args.out) {
		throw new Error("scanner_hardening_branch_protection_args_required");
	}
	await capture({
		repository: args.repository,
		branchName: args.branch,
		outputPath: path.resolve(args.out),
		token: process.env.GITHUB_TOKEN,
	});
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
