import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { NightworkersSecurityIntelligenceIntegrityEvidence } from "../shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema";
import { nightworkersSecurityIntelligenceIntegrityEvidenceSchema } from "../shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema";
import {
	type CrossRepositoryFixtureCheckResult,
	type RepositoryRoots,
	verifySecurityIntelligenceCrossRepositoryFixtures,
} from "./verify-security-intelligence-cross-repo-fixtures";

export type RepositoryState = { commit: string; clean: boolean };

type RepositoryStateOptions = {
	ignoredWorkingTreePaths?: Partial<
		Record<keyof RepositoryRoots, readonly string[]>
	>;
};

export function verifySecurityIntelligenceIntegrityEvidence(
	input: unknown,
	options: { allowIncomplete?: boolean } = {},
) {
	const evidence =
		nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(input);
	if (
		!options.allowIncomplete &&
		evidence.status !== "completed" &&
		evidence.status !== "stopped"
	) {
		throw new Error(
			"security_intelligence:integrity_evidence_terminal_status_required",
		);
	}
	return evidence;
}

export function assertRecordedCrossRepositoryFixtureDigests(
	evidence: NightworkersSecurityIntelligenceIntegrityEvidence,
	results: CrossRepositoryFixtureCheckResult[],
): void {
	for (const result of results) {
		const recorded =
			evidence.preflight.crossRepositoryFixtureDigests[result.key];
		if (recorded !== null && recorded !== result.digest) {
			throw new Error(
				`security_intelligence:recorded_fixture_digest_mismatch:${result.key}`,
			);
		}
	}
}

export function readRepositoryStates(
	roots: RepositoryRoots,
	options: RepositoryStateOptions = {},
): Record<keyof RepositoryRoots, RepositoryState> {
	return Object.fromEntries(
		Object.entries(roots).map(([name, root]) => {
			const repository = name as keyof RepositoryRoots;
			const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
				encoding: "utf8",
			}).trim();
			const ignoredPaths = (
				options.ignoredWorkingTreePaths?.[repository] ?? []
			).map((item) => repositoryRelativePath(root, item));
			const status = execFileSync(
				"git",
				[
					"-C",
					root,
					"status",
					"--porcelain=v1",
					"--untracked-files=all",
					"--",
					".",
					...ignoredPaths.map((item) => `:(exclude)${item}`),
				],
				{ encoding: "utf8" },
			).trim();
			return [name, { commit, clean: status.length === 0 }];
		}),
	) as Record<keyof RepositoryRoots, RepositoryState>;
}

function repositoryRelativePath(root: string, input: string): string {
	const relative = path.relative(path.resolve(root), path.resolve(input));
	if (
		relative.length === 0 ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error(
			"security_intelligence:ignored_worktree_path_outside_repository",
		);
	}
	return relative.split(path.sep).join("/");
}

export function assertRecordedRepositoryStates(
	evidence: NightworkersSecurityIntelligenceIntegrityEvidence,
	states: Record<keyof RepositoryRoots, RepositoryState>,
): void {
	for (const name of [
		"vulnWorkbench",
		"nightWorkers",
		"contextStill",
	] as const) {
		const recordedCommit = evidence.preflight.repositoryCommits[name];
		if (recordedCommit !== null && recordedCommit !== states[name].commit) {
			throw new Error(
				`security_intelligence:recorded_repository_commit_mismatch:${name}`,
			);
		}
		if (evidence.preflight.cleanWorkingTrees[name] && !states[name].clean) {
			throw new Error(
				`security_intelligence:recorded_repository_not_clean:${name}`,
			);
		}
	}
}

function main(): void {
	const parsed = parseArgs({
		args: process.argv.slice(2).filter((argument) => argument !== "--"),
		options: {
			evidence: { type: "string" },
			"allow-incomplete": { type: "boolean", default: false },
			"nightworkers-root": { type: "string" },
			"context-still-root": { type: "string" },
		},
		strict: true,
	});
	const evidencePath = parsed.values.evidence;
	if (!evidencePath) {
		throw new Error("security_intelligence:integrity_evidence_path_required");
	}
	const absoluteEvidencePath = path.resolve(evidencePath);
	const evidence = verifySecurityIntelligenceIntegrityEvidence(
		JSON.parse(readFileSync(absoluteEvidencePath, "utf8")),
		{ allowIncomplete: parsed.values["allow-incomplete"] },
	);
	const repositoryRoot = path.resolve(import.meta.dir, "..");
	const evidenceDirectory = path.join(repositoryRoot, "spec", "evidence");
	const evidenceRelativeToDirectory = path.relative(
		evidenceDirectory,
		absoluteEvidencePath,
	);
	if (
		evidenceRelativeToDirectory.length === 0 ||
		evidenceRelativeToDirectory === ".." ||
		evidenceRelativeToDirectory.startsWith(`..${path.sep}`) ||
		path.isAbsolute(evidenceRelativeToDirectory)
	) {
		throw new Error(
			"security_intelligence:integrity_evidence_path_outside_canonical_directory",
		);
	}
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
	const fixtureResults =
		verifySecurityIntelligenceCrossRepositoryFixtures(roots);
	assertRecordedCrossRepositoryFixtureDigests(evidence, fixtureResults);
	const repositoryStates = readRepositoryStates(roots, {
		ignoredWorkingTreePaths: {
			vulnWorkbench: [absoluteEvidencePath],
		},
	});
	assertRecordedRepositoryStates(evidence, repositoryStates);
	console.log(
		JSON.stringify({
			ok: true,
			schemaVersion: evidence.schemaVersion,
			smokeId: evidence.smokeId,
			status: evidence.status,
			defaultActivationAuthorized: evidence.defaultActivationAuthorized,
			verifiedCrossRepositoryFixtureDigests: Object.fromEntries(
				fixtureResults.map((result) => [result.key, result.digest]),
			),
			verifiedRepositoryStates: repositoryStates,
			capabilityDecisions: Object.fromEntries(
				Object.entries(evidence.capabilityDecisions).map(([name, value]) => [
					name,
					value.decision,
				]),
			),
		}),
	);
}

if (import.meta.main) {
	main();
}
