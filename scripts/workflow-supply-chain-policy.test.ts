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
		expect(verify).toContain("fetch-depth: 0");
		expect(secretScan).not.toMatch(/^    needs:/m);
		expect(secretScan).toContain("gitleaks/gitleaks-action@");
		expect(secretScan).toContain("actions/checkout@");
		expect(secretScan).toContain("fetch-depth: 0");
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
		expect(workflow).not.toContain("docker/setup-buildx-action@");
		expect(workflow).toContain(
			"matrix.name == 'toolbox' || matrix.name == 'semgrep'",
		);
		expect(workflow).toContain(
			"--build-arg BASE_IMAGE=vuln-workbench-toolbox:ci",
		);
		expect(workflow).toContain("aquasecurity/setup-trivy@");
		expect(workflow).toContain("version: v0.72.0");
		expect(workflow.match(/skip-setup-trivy: true/g)).toHaveLength(2);
		expect(workflow).toContain("format: cyclonedx");
		expect(workflow).toContain("severity: HIGH,CRITICAL");
		expect(workflow).toContain("TRIVY_IGNOREFILE: .trivyignore.yaml");
		expect(workflow).not.toContain("trivyignores:");
		expect(workflow).toContain('VULN_WORKBENCH_DYNAMIC_INTEGRATION: "1"');
		expect(workflow).toContain(
			"bun test api/modules/dynamic/dynamic-security-recipe.integration.test.ts",
		);
		expect(workflow).toContain('- "api/modules/dynamic/**"');
	});

	test("refreshes dependency and offline scanner data on a bounded schedule", async () => {
		const [dependabot, refresh] = await Promise.all([
			readRepositoryFile(".github/dependabot.yml"),
			readRepositoryFile(".github/workflows/scanner-data-refresh.yml"),
		]);
		expect(dependabot).toMatch(
			/package-ecosystem: npm[\s\S]*?directory: \/[\s\S]*?interval: daily[\s\S]*?open-pull-requests-limit: 10/,
		);
		expect(refresh).toContain('cron: "17 3 * * *"');
		expect(refresh).toContain("timeout-minutes: 30");
		expect(refresh).toContain("bun install --frozen-lockfile");
		expect(refresh).toContain("bun run scanner-data:refresh-lock");
		expect(refresh).toContain("bun run verify:toolbox-provenance");
		expect(refresh).toContain(
			"git add docker/toolbox/scanner-data/scanner-data-manifest.json",
		);
		for (const action of refresh.matchAll(/uses: ([^\s]+)/g)) {
			expect(action[1]).toMatch(/@[a-f0-9]{40}$/);
		}
	});

	test("builds patched Cosign and the compatible SLSA verifier into the core toolbox", async () => {
		const [toolbox, semgrepPlugin, slsaPatch] = await Promise.all([
			readRepositoryFile("docker/toolbox/Dockerfile"),
			readRepositoryFile("docker/plugins/semgrep/Dockerfile"),
			readRepositoryFile(
				"docker/toolbox/patches/slsa-verifier-sigstore-go-v1.patch",
			),
		]);
		expect(toolbox).toContain("ARG COSIGN_VERSION=3.1.3");
		expect(toolbox).toContain(
			"ARG COSIGN_SOURCE_COMMIT=11926fa5bbbbde47e88fc006b625a17769b743b2",
		);
		expect(toolbox).toContain(
			"ARG COSIGN_SOURCE_SHA256=3a718446bac51466efff6853639e1ca108b456ecbf07cd92938f548715d22d6b",
		);
		expect(toolbox).toContain(
			'vuln-workbench.scanner.cosign.license="Apache-2.0"',
		);
		expect(toolbox).not.toContain("semgrep==");
		expect(semgrepPlugin).toContain("semgrep==${SEMGREP_VERSION}");
		for (const requirement of [
			'"setuptools==80.9.0"',
			'"mcp==1.28.1"',
			'"msgpack==1.2.1"',
		])
			expect(semgrepPlugin).toContain(requirement);
		expect(semgrepPlugin).toContain("patch-wheel-mcp.py");
		expect(semgrepPlugin).toContain("/opt/semgrep/bin/pip check");
		expect(toolbox).toContain("github.com/sigstore/cosign/v2@v2.6.5");
		expect(toolbox).toContain(
			"git apply --check /tmp/slsa-verifier-sigstore-go-v1.patch",
		);
		expect(slsaPatch).toContain(
			"chains, err := sigstoreVerify.VerifyLeafCertificate",
		);
		expect(slsaPatch).toContain(
			"sigstoreVerify.VerifySignedCertificateTimestamp(chains, 1, trustedRoot)",
		);
	});

	test("runs fresh capability measurements with pinned scanners and persisted evidence", async () => {
		const [workflow, runner] = await Promise.all([
			readRepositoryFile(".github/workflows/verify.yml"),
			readRepositoryFile("scripts/run-capability-benchmarks.ts"),
		]);
		const closeout = jobBlock(workflow, "juice-shop-benchmark");
		expect(closeout).toContain("needs: [verify, secret-scan]");
		expect(closeout).toContain("fetch-depth: 0");
		for (const variable of [
			"VULN_WORKBENCH_OWASP_SEMGREP_IMAGE",
			"VULN_WORKBENCH_OSV_FIXTURE_IMAGE",
		]) {
			expect(closeout).toMatch(
				new RegExp(`${variable}: .*@sha256:[a-f0-9]{64}`),
			);
			expect(closeout).toContain(`docker pull "$${variable}"`);
		}
		expect(closeout).toContain(
			"docker pull docker.io/bkimminich/juice-shop@sha256:",
		);
		expect(closeout).toContain("bun run osv-fixtures:prepare");
		expect(closeout).toContain("bun run verify:capability:full");
		expect(closeout).toContain(".artifacts/capability/");
		expect(closeout).toContain("if-no-files-found: error");
		expect(runner).toContain('path.join(runRoot, "benchmark.sqlite")');
		expect(runner).toContain("capability_benchmarks_require_fresh_scan");
		expect(runner).toContain("capability_benchmarks_source_changed");
		expect(runner).toContain("receipt.gitCommit !== releaseCommit");
		expect(runner).toContain('flag: "wx"');
		const lifecycle = [
			'["bun", "run", "db:migrate"]',
			'["bun", "run", "benchmark:all"]',
			'["bun", "run", "verify:professional-capability"]',
		];
		for (const command of lifecycle) expect(runner).toContain(command);
		expect(runner.indexOf(lifecycle[0]!)).toBeLessThan(
			runner.indexOf(lifecycle[1]!),
		);
		expect(runner.indexOf(lifecycle[1]!)).toBeLessThan(
			runner.indexOf(lifecycle[2]!),
		);
		for (const artifact of [
			"owasp-semgrep-raw.json",
			"java-taint-holdouts.json",
			"java-taint-holdouts-raw.json",
			"osv-offline-fixtures.json",
		])
			expect(runner).toContain(artifact);
	});

	test("binds the real scanner and API-confirmed closeout receipt to the caller commit", async () => {
		const [workflow, scannerWorkflow] = await Promise.all([
			readRepositoryFile(".github/workflows/verify.yml"),
			readRepositoryFile(".github/workflows/scanner-e2e-real.yml"),
		]);
		expect(workflow.match(/^  scanner-hardening-receipt:$/gm)).toHaveLength(1);
		const scanner = jobBlock(workflow, "scanner-e2e-real");
		const receipt = jobBlock(workflow, "scanner-hardening-receipt");
		expect(scanner).toContain("needs: [verify]");
		expect(scanner).toContain(
			"target_repository: ${{ vars.TODOLIST_E2E_REPOSITORY }}",
		);
		expect(scanner).toContain(
			"target_ref: d87bfdd9f29aa64e484a0c4d1ad02956136dc6b0",
		);
		expect(receipt).toContain("needs: [verify, scanner-e2e-real]");
		expect(receipt).toContain("capture-scanner-hardening-branch-protection.ts");
		expect(receipt).toContain("github.ref_protected");
		expect(receipt).toContain("--require-protected");
		expect(receipt).not.toContain("VWB_BRANCH_PROTECTION_CONFIRMED");
		expect(scannerWorkflow).toContain(
			'[[ "$TARGET_REF" == "d87bfdd9f29aa64e484a0c4d1ad02956136dc6b0" ]]',
		);
		expect(scannerWorkflow).toContain("bun run scanner-e2e:failure:verify");
	});

	test("builds the Semgrep toolbox prerequisite in clean E2E runners", async () => {
		const packageJson = JSON.parse(await readRepositoryFile("package.json")) as {
			scripts: Record<string, string>;
		};
		const build = packageJson.scripts["docker:plugin:semgrep:build"];
		expect(build).toBeDefined();
		expect(build!.indexOf("bun run docker:toolbox:build")).toBeLessThan(
			build!.indexOf("docker build -f docker/plugins/semgrep/Dockerfile"),
		);
	});
});
