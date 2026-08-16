import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

async function readRepositoryFile(relativePath: string): Promise<string> {
	return await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function jobBlock(workflow: string, jobId: string): string {
	const match = workflow.match(
		new RegExp(
			`^  ${jobId}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|(?![\\s\\S]))`,
			"m",
		),
	);
	if (!match) throw new Error(`workflow_job_missing:${jobId}`);
	return match[0];
}

describe("workflow supply-chain policy", () => {
	test("runs secret scanning independently from strict verification", async () => {
		const workflow = await readRepositoryFile(".github/workflows/verify.yml");
		const verify = jobBlock(workflow, "verify");
		const secretScan = jobBlock(workflow, "secret-scan");

		expect(verify).not.toContain("gitleaks/gitleaks-action");
		expect(secretScan).not.toMatch(/^    needs:/m);
		expect(secretScan).toContain("gitleaks/gitleaks-action@");
		expect(secretScan).toContain("actions/checkout@");
		expect(workflow).toContain("cancel-in-progress: true");
	});

	test("updates and scans every maintained Docker build context", async () => {
		const [dependabot, workflow] = await Promise.all([
			readRepositoryFile(".github/dependabot.yml"),
			readRepositoryFile(".github/workflows/container-security.yml"),
		]);
		for (const directory of [
			"/docker/toolbox",
			"/docker/dynamic",
			"/docker/plugins/semgrep",
		]) {
			expect(dependabot).toContain(`directory: ${directory}`);
		}
		for (const dockerfile of [
			"docker/toolbox/Dockerfile",
			"docker/dynamic/Dockerfile",
			"docker/plugins/semgrep/Dockerfile",
		]) {
			expect(workflow).toContain(`dockerfile: ${dockerfile}`);
		}
		expect(workflow).toContain("format: cyclonedx");
		expect(workflow).toContain("severity: HIGH,CRITICAL");
	});

	test("runs the Phase 54 closeout with pinned benchmark images and persisted evidence", async () => {
		const workflow = await readRepositoryFile(".github/workflows/verify.yml");
		const closeout = jobBlock(workflow, "juice-shop-benchmark");
		expect(closeout).toContain("needs: [verify, secret-scan]");
		expect(closeout).toContain(
			"VULN_WORKBENCH_OWASP_SEMGREP_IMAGE: docker.io/semgrep/semgrep@sha256:",
		);
		expect(closeout).toContain(
			'docker pull "$VULN_WORKBENCH_OWASP_SEMGREP_IMAGE"',
		);
		expect(closeout).toContain(
			"docker pull docker.io/bkimminich/juice-shop@sha256:",
		);
		expect(closeout).toContain("bun run db:migrate");
		expect(closeout).toContain("bun run phase-54:closeout");
		expect(closeout).toContain("phase-54-closeout-backup.sqlite");
		expect(closeout).toContain("phase-54-same-commit-closeout");
		expect(closeout).toContain(
			"VULN_WORKBENCH_PHASE54_REGRESSION_VERIFIED_COMMIT: ${{ github.sha }}",
		);
		expect(closeout).toContain(
			".artifacts/benchmark/owasp-semgrep-raw.json",
		);
		expect(closeout).not.toMatch(/^\s+\.artifacts\/benchmark\/$/m);
		expect(closeout.indexOf("bun run db:migrate")).toBeLessThan(
			closeout.indexOf("bun run phase-54:closeout"),
		);
	});
});
