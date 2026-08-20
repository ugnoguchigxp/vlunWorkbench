import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { canonicalStringifySecurityIntelligenceValue } from "../shared/security-intelligence-assessment-contract";

export type RepositoryRoots = {
	vulnWorkbench: string;
	nightWorkers: string;
	contextStill: string;
};

type FixtureCheck = {
	key: CrossRepositoryFixtureKey;
	label: string;
	files: Array<{ repository: keyof RepositoryRoots; relativePath: string }>;
	project?: (value: unknown, repository: keyof RepositoryRoots) => unknown;
};

export type CrossRepositoryFixtureKey =
	| "identityMapping"
	| "assessmentBundle"
	| "scanBindingCore"
	| "candidateBatch"
	| "feedbackBatch";

export type CrossRepositoryFixtureCheckResult = {
	key: CrossRepositoryFixtureKey;
	label: string;
	digest: `sha256:${string}`;
	repositories: Array<keyof RepositoryRoots>;
};

const fixtureChecks: FixtureCheck[] = [
	{
		key: "identityMapping",
		label: "identity mapping",
		files: [
			{
				repository: "vulnWorkbench",
				relativePath: "shared/fixtures/security-intelligence-identity-v1.json",
			},
			{
				repository: "nightWorkers",
				relativePath: "shared/fixtures/security-intelligence-identity-v1.json",
			},
			{
				repository: "contextStill",
				relativePath: "shared/fixtures/security-intelligence-identity-v1.json",
			},
		],
	},
	{
		key: "assessmentBundle",
		label: "assessment bundle",
		files: [
			{
				repository: "vulnWorkbench",
				relativePath:
					"shared/fixtures/nightworkers-security-intelligence-v1.json",
			},
			{
				repository: "nightWorkers",
				relativePath:
					"shared/fixtures/nightworkers-security-intelligence-v1.json",
			},
		],
	},
	{
		key: "scanBindingCore",
		label: "scan binding core",
		files: [
			{
				repository: "vulnWorkbench",
				relativePath:
					"shared/fixtures/security-intelligence-scan-binding-v2.json",
			},
			{
				repository: "nightWorkers",
				relativePath:
					"shared/fixtures/security-intelligence-scan-binding-v2.json",
			},
		],
		project: scanBindingCore,
	},
	{
		key: "candidateBatch",
		label: "candidate batch",
		files: [
			{
				repository: "nightWorkers",
				relativePath:
					"shared/fixtures/security-knowledge-candidate-batch-v1.json",
			},
			{
				repository: "contextStill",
				relativePath:
					"shared/fixtures/security-knowledge-candidate-batch-v1.json",
			},
		],
	},
	{
		key: "feedbackBatch",
		label: "feedback batch",
		files: [
			{
				repository: "nightWorkers",
				relativePath:
					"shared/fixtures/security-knowledge-feedback-batch-v1.json",
			},
			{
				repository: "contextStill",
				relativePath:
					"shared/fixtures/security-knowledge-feedback-batch-v1.json",
			},
		],
	},
];

export function verifySecurityIntelligenceCrossRepositoryFixtures(
	roots: RepositoryRoots,
): CrossRepositoryFixtureCheckResult[] {
	return fixtureChecks.map((check) => {
		const values = check.files.map((file) => {
			const repositoryRoot = roots[file.repository];
			const absolutePath = assertRegularRepositoryFixture(
				repositoryRoot,
				file.relativePath,
				check.key,
				file.repository,
			);
			const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
			return {
				repository: file.repository,
				canonical: canonicalStringifySecurityIntelligenceValue(
					check.project ? check.project(parsed, file.repository) : parsed,
				),
			};
		});
		const expected = values[0];
		if (!expected) {
			throw new Error(`security_intelligence:fixture_check_empty:${check.key}`);
		}
		const mismatch = values.find(
			(value) => value.canonical !== expected.canonical,
		);
		if (mismatch) {
			throw new Error(
				`security_intelligence:cross_repo_fixture_mismatch:${check.key}:${expected.repository}:${mismatch.repository}`,
			);
		}
		return {
			key: check.key,
			label: check.label,
			digest: `sha256:${createHash("sha256")
				.update(expected.canonical)
				.digest("hex")}`,
			repositories: values.map((value) => value.repository),
		};
	});
}

function assertRegularRepositoryFixture(
	repositoryRoot: string,
	relativePath: string,
	key: CrossRepositoryFixtureKey,
	repository: keyof RepositoryRoots,
): string {
	let currentPath = repositoryRoot;
	for (const segment of relativePath.split("/")) {
		currentPath = path.join(currentPath, segment);
		if (lstatSync(currentPath).isSymbolicLink()) {
			throw new Error(
				`security_intelligence:fixture_not_regular_file:${key}:${repository}`,
			);
		}
	}
	if (!lstatSync(currentPath).isFile()) {
		throw new Error(
			`security_intelligence:fixture_not_regular_file:${key}:${repository}`,
		);
	}
	const relativeRealPath = path.relative(
		realpathSync(repositoryRoot),
		realpathSync(currentPath),
	);
	if (
		relativeRealPath.length === 0 ||
		relativeRealPath === ".." ||
		relativeRealPath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativeRealPath)
	) {
		throw new Error(
			`security_intelligence:fixture_outside_repository:${key}:${repository}`,
		);
	}
	return currentPath;
}

function scanBindingCore(
	value: unknown,
	repository: keyof RepositoryRoots,
): unknown {
	if (!isRecord(value)) {
		throw new Error("security_intelligence:scan_binding_fixture_not_object");
	}
	if (repository !== "nightWorkers") {
		return value;
	}
	const { workspaceTargetGrant: _workspaceTargetGrant, ...core } = value;
	return core;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(): void {
	const repositoryRoot = path.resolve(import.meta.dir, "..");
	const parsed = parseArgs({
		args: process.argv.slice(2).filter((argument) => argument !== "--"),
		options: {
			"nightworkers-root": { type: "string" },
			"context-still-root": { type: "string" },
		},
		strict: true,
	});
	const roots: RepositoryRoots = {
		vulnWorkbench: repositoryRoot,
		nightWorkers: path.resolve(
			parsed.values["nightworkers-root"] ??
				path.join(repositoryRoot, "..", "nightWorkers"),
		),
		contextStill: path.resolve(
			parsed.values["context-still-root"] ??
				path.join(repositoryRoot, "..", "contextStill"),
		),
	};
	const results = verifySecurityIntelligenceCrossRepositoryFixtures(roots);
	for (const result of results) {
		console.log(
			`PASS ${result.key}: ${result.digest} (${result.repositories.join(", ")})`,
		);
	}
}

if (import.meta.main) {
	main();
}
