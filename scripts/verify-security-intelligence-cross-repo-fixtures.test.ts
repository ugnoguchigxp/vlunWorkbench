import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type RepositoryRoots,
	verifySecurityIntelligenceCrossRepositoryFixtures,
} from "./verify-security-intelligence-cross-repo-fixtures";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true });
	}
});

describe("Security Intelligence cross-repository fixture verifier", () => {
	test("accepts semantic equality and ignores the NightWorkers-only workspace grant extension", () => {
		const roots = fixtureRepositories();
		writeJson(
			roots.contextStill,
			"shared/fixtures/security-intelligence-identity-v1.json",
			{ nested: { stable: true }, fixtureVersion: 1 },
		);
		const results = verifySecurityIntelligenceCrossRepositoryFixtures(roots);

		expect(results.map((result) => result.key)).toEqual([
			"identityMapping",
			"assessmentBundle",
			"scanBindingCore",
			"candidateBatch",
			"feedbackBatch",
		]);
		expect(results.every((result) => /^sha256:[a-f0-9]{64}$/.test(result.digest))).toBe(
			true,
		);
	});

	test("fails closed when a shared fixture drifts", () => {
		const roots = fixtureRepositories();
		writeJson(
			roots.contextStill,
			"shared/fixtures/security-knowledge-feedback-batch-v1.json",
			{ fixtureVersion: 2 },
		);

		expect(() =>
			verifySecurityIntelligenceCrossRepositoryFixtures(roots),
		).toThrow(
			"security_intelligence:cross_repo_fixture_mismatch:feedbackBatch:nightWorkers:contextStill",
		);
	});
});

function fixtureRepositories(): RepositoryRoots {
	const base = mkdtempSync(path.join(os.tmpdir(), "security-intelligence-fixtures-"));
	temporaryRoots.push(base);
	const roots = {
		vulnWorkbench: path.join(base, "vulnWorkbench"),
		nightWorkers: path.join(base, "nightWorkers"),
		contextStill: path.join(base, "contextStill"),
	};
	const shared = { fixtureVersion: 1, nested: { stable: true } };
	writeShared(roots, "security-intelligence-identity-v1.json", shared, [
		"vulnWorkbench",
		"nightWorkers",
		"contextStill",
	]);
	writeShared(roots, "nightworkers-security-intelligence-v1.json", shared, [
		"vulnWorkbench",
		"nightWorkers",
	]);
	writeJson(
		roots.vulnWorkbench,
		"shared/fixtures/security-intelligence-scan-binding-v2.json",
		shared,
	);
	writeJson(
		roots.nightWorkers,
		"shared/fixtures/security-intelligence-scan-binding-v2.json",
		{ ...shared, workspaceTargetGrant: { available: true } },
	);
	for (const name of [
		"security-knowledge-candidate-batch-v1.json",
		"security-knowledge-feedback-batch-v1.json",
	]) {
		writeShared(roots, name, shared, ["nightWorkers", "contextStill"]);
	}
	return roots;
}

function writeShared(
	roots: RepositoryRoots,
	name: string,
	value: unknown,
	repositories: Array<keyof RepositoryRoots>,
): void {
	for (const repository of repositories) {
		writeJson(roots[repository], `shared/fixtures/${name}`, value);
	}
}

function writeJson(root: string, relativePath: string, value: unknown): void {
	const file = path.join(root, relativePath);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(value), "utf8");
}
