import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	assertRecordedCrossRepositoryFixtureDigests,
	assertRecordedRepositoryStates,
	readRepositoryStates,
	resolveCanonicalIntegrityEvidencePath,
	verifySecurityIntelligenceIntegrityEvidence,
} from "./verify-security-intelligence-integrity-evidence";

const template = JSON.parse(
	readFileSync(
		new URL(
			"../spec/evidence/security-intelligence-integrity-smoke-template.json",
			import.meta.url,
		),
		"utf8",
	),
);

describe("Security Intelligence integrity evidence verifier", () => {
	test("accepts the checked-in template only when incomplete evidence is allowed", () => {
		expect(
			verifySecurityIntelligenceIntegrityEvidence(template, {
				allowIncomplete: true,
			}).status,
		).toBe("not_started");
		expect(() =>
			verifySecurityIntelligenceIntegrityEvidence(template),
		).toThrow(
			"security_intelligence:integrity_evidence_terminal_status_required",
		);
	});

	test("rejects the deprecated paired evidence contract", () => {
		expect(() =>
			verifySecurityIntelligenceIntegrityEvidence(
				{
					...template,
					schemaVersion: "security-intelligence-nightworkers-pilot-evidence-v1",
				},
				{ allowIncomplete: true },
			),
		).toThrow();
	});

	test("rejects a recorded fixture digest that differs from the checked repositories", () => {
		const evidence = verifySecurityIntelligenceIntegrityEvidence(
			{
				...template,
				preflight: {
					...template.preflight,
					crossRepositoryFixtureDigests: {
						...template.preflight.crossRepositoryFixtureDigests,
						identityMapping: `sha256:${"a".repeat(64)}`,
					},
				},
			},
			{ allowIncomplete: true },
		);
		expect(() =>
			assertRecordedCrossRepositoryFixtureDigests(evidence, [
				{
					key: "identityMapping",
					label: "identity mapping",
					digest: `sha256:${"b".repeat(64)}`,
					repositories: ["vulnWorkbench", "nightWorkers", "contextStill"],
				},
			]),
		).toThrow(
			"security_intelligence:recorded_fixture_digest_mismatch:identityMapping",
		);
	});

	test("rejects repository commit drift and a falsely clean working tree", () => {
		const evidence = verifySecurityIntelligenceIntegrityEvidence(
			{
				...template,
				preflight: {
					...template.preflight,
					repositoryCommits: {
						...template.preflight.repositoryCommits,
						vulnWorkbench: "a".repeat(40),
					},
					cleanWorkingTrees: {
						...template.preflight.cleanWorkingTrees,
						nightWorkers: true,
					},
				},
			},
			{ allowIncomplete: true },
		);
		const states = {
			vulnWorkbench: { commit: "b".repeat(40), clean: true },
			nightWorkers: { commit: "c".repeat(40), clean: false },
			contextStill: { commit: "d".repeat(40), clean: true },
		};
		expect(() => assertRecordedRepositoryStates(evidence, states)).toThrow(
			"security_intelligence:recorded_repository_commit_mismatch:vulnWorkbench",
		);
		evidence.preflight.repositoryCommits.vulnWorkbench = states.vulnWorkbench.commit;
		expect(() => assertRecordedRepositoryStates(evidence, states)).toThrow(
			"security_intelligence:recorded_repository_not_clean:nightWorkers",
		);
	});

	test("ignores only the canonical evidence artifact while detecting other worktree drift", () => {
		const root = mkdtempSync(
			path.join(os.tmpdir(), "security-intelligence-repository-state-"),
		);
		try {
			const roots = {
				vulnWorkbench: path.join(root, "vulnWorkbench"),
				nightWorkers: path.join(root, "nightWorkers"),
				contextStill: path.join(root, "contextStill"),
			};
			for (const repository of Object.values(roots)) {
				initializeRepository(repository);
			}
			const evidencePath = path.join(
				roots.vulnWorkbench,
				"spec/evidence/security-intelligence-integrity-smoke-2026-08-17.json",
			);
			mkdirSync(path.dirname(evidencePath), { recursive: true });
			writeFileSync(evidencePath, "{}", "utf8");

			expect(
				readRepositoryStates(roots, {
					ignoredWorkingTreePaths: { vulnWorkbench: [evidencePath] },
				}),
			).toMatchObject({
				vulnWorkbench: { clean: true },
				nightWorkers: { clean: true },
				contextStill: { clean: true },
			});

			writeFileSync(
				path.join(roots.vulnWorkbench, "tracked.txt"),
				"changed with drift\n",
				"utf8",
			);
			expect(
				readRepositoryStates(roots, {
					ignoredWorkingTreePaths: { vulnWorkbench: [evidencePath] },
				}).vulnWorkbench.clean,
			).toBe(false);

			writeFileSync(path.join(roots.vulnWorkbench, "tracked.txt"), "baseline\n");
			rmSync(evidencePath);
			const wildcardEvidencePath = path.join(
				roots.vulnWorkbench,
				"spec/evidence/security-intelligence-*.json",
			);
			writeFileSync(wildcardEvidencePath, "{}", "utf8");
			writeFileSync(
				path.join(
					roots.vulnWorkbench,
					"spec/evidence/security-intelligence-other.json",
				),
				"{}",
				"utf8",
			);
			expect(
				readRepositoryStates(roots, {
					ignoredWorkingTreePaths: {
						vulnWorkbench: [wildcardEvidencePath],
					},
				}).vulnWorkbench.clean,
			).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("accepts only regular evidence files inside the canonical directory", () => {
		const root = mkdtempSync(
			path.join(os.tmpdir(), "security-intelligence-evidence-path-"),
		);
		try {
			const repository = path.join(root, "repository");
			const evidenceDirectory = path.join(repository, "spec/evidence");
			mkdirSync(evidenceDirectory, { recursive: true });
			const evidencePath = path.join(evidenceDirectory, "evidence.json");
			writeFileSync(evidencePath, "{}", "utf8");
			expect(
				resolveCanonicalIntegrityEvidencePath(repository, evidencePath),
			).toBe(evidencePath);

			const outsidePath = path.join(root, "outside.json");
			writeFileSync(outsidePath, "{}", "utf8");
			expect(() =>
				resolveCanonicalIntegrityEvidencePath(repository, outsidePath),
			).toThrow(
				"security_intelligence:integrity_evidence_path_outside_canonical_directory",
			);

			const linkedPath = path.join(evidenceDirectory, "linked.json");
			symlinkSync(outsidePath, linkedPath);
			expect(() =>
				resolveCanonicalIntegrityEvidencePath(repository, linkedPath),
			).toThrow(
				"security_intelligence:integrity_evidence_must_be_regular_file",
			);

			const outsideDirectory = path.join(root, "outside-directory");
			mkdirSync(outsideDirectory);
			const nestedEvidencePath = path.join(outsideDirectory, "evidence.json");
			writeFileSync(nestedEvidencePath, "{}", "utf8");
			const linkedDirectory = path.join(evidenceDirectory, "linked-directory");
			symlinkSync(outsideDirectory, linkedDirectory, "dir");
			expect(() =>
				resolveCanonicalIntegrityEvidencePath(
					repository,
					path.join(linkedDirectory, "evidence.json"),
				),
			).toThrow(
				"security_intelligence:integrity_evidence_must_be_regular_file",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

function initializeRepository(root: string): void {
	mkdirSync(root, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Security Intelligence Test"], {
		cwd: root,
	});
	execFileSync(
		"git",
		["config", "user.email", "security-intelligence@example.invalid"],
		{ cwd: root },
	);
	writeFileSync(path.join(root, "tracked.txt"), "baseline\n", "utf8");
	execFileSync("git", ["add", "tracked.txt"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
}
