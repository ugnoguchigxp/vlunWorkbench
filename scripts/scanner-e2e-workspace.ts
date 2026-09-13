import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { createDbConnection } from "../api/db";
import type { RuntimeTargetProvider } from "../api/modules/dast/runtime-target-provider";
import type { DastTargetStartPlan } from "../api/modules/dast/target-preparer";
import { ScanReportRunner } from "../api/modules/reports/scan-report-runner";
import { ArtifactStorage } from "../api/modules/scans/execution/lifecycle/artifact-storage";
import { ScanDiagnosticRunner } from "../api/modules/scans/handoff/scan-diagnostic-runner";
import { ScanReviewRunner } from "../api/modules/scans/handoff/scan-review-runner";
import { ScanReportRepository } from "../api/modules/scans/reporting/report-repository";
import { finalizeScanAfterDiagnostic } from "../api/modules/scans/reporting/scan-finalization-service";
import {
	retainOnlyScannerE2EPinnedImage,
	scannerE2EPinnedTag,
} from "./docker-image-retention";
import { startTodolistRuntimeTarget } from "./todolist-runtime-target";

export async function command(command: string[], env: Record<string, string>) {
	const child = Bun.spawn(command, {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

export async function seedTrivyToolCache(params: {
	toolboxImage: string;
	toolCacheDir: string;
	env: Record<string, string>;
}) {
	const containerName = `vwb-e2e-trivy-cache-${Date.now()}`;
	const mountedCache = path.join(
		params.toolCacheDir,
		"vuln-workbench-toolbox-cache",
	);
	await fs.mkdir(mountedCache, { recursive: true });
	const created = await command(
		["docker", "create", "--name", containerName, params.toolboxImage],
		params.env,
	);
	if (created.exitCode !== 0) {
		throw new Error(`scanner_e2e_trivy_cache_create_failed:${created.stderr}`);
	}
	let copyFailure: Error | null = null;
	try {
		const copied = await command(
			[
				"docker",
				"cp",
				`${containerName}:/opt/vuln-workbench/scanner-data/trivy`,
				mountedCache,
			],
			params.env,
		);
		if (copied.exitCode !== 0) {
			throw new Error(`scanner_e2e_trivy_cache_copy_failed:${copied.stderr}`);
		}
		await fs.chmod(path.join(mountedCache, "trivy"), 0o777);
	} catch (error) {
		copyFailure = error instanceof Error ? error : new Error(String(error));
	}
	const removed = await command(
		["docker", "rm", "--force", containerName],
		params.env,
	);
	if (copyFailure) throw copyFailure;
	if (removed.exitCode !== 0) {
		throw new Error(`scanner_e2e_trivy_cache_cleanup_failed:${removed.stderr}`);
	}
}

export async function resolveImmutableDockerImage(params: {
	image: string;
	env: Record<string, string>;
}): Promise<{ reference: string; digest: string }> {
	const inspected = await command(
		["docker", "image", "inspect", "--format", "{{.Id}}", params.image],
		params.env,
	);
	const imageId = inspected.stdout.trim();
	if (inspected.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) {
		throw new Error(`scanner_e2e_toolbox_image_unavailable:${params.image}`);
	}
	const pinnedTag = scannerE2EPinnedTag(imageId);
	const tagged = await command(
		["docker", "image", "tag", imageId, pinnedTag],
		params.env,
	);
	if (tagged.exitCode !== 0) {
		throw new Error(`scanner_e2e_toolbox_image_pin_failed:${imageId}`);
	}
	await retainOnlyScannerE2EPinnedImage({
		keepTag: pinnedTag,
		env: params.env,
		command,
	});
	return { reference: pinnedTag, digest: imageId };
}

export async function resolveApplicationCommit() {
	const result = await command(["git", "rev-parse", "HEAD"], {});
	const commit = result.stdout.trim();
	if (result.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(commit)) {
		throw new Error("scanner_e2e_application_commit_unavailable");
	}
	return commit;
}

export async function addReadonlySchemaFixture(params: {
	sourcePath: string;
	env: Record<string, string>;
}) {
	await fs.copyFile(
		path.resolve(
			import.meta.dir,
			"../spec/security-capability/todolist-readonly-openapi.v1.yaml",
		),
		path.join(params.sourcePath, "openapi.yaml"),
	);
	const staged = await command(
		["git", "-C", params.sourcePath, "add", "--", "openapi.yaml"],
		params.env,
	);
	if (staged.exitCode !== 0) {
		throw new Error(`scanner_e2e_schema_fixture_stage_failed:${staged.stderr}`);
	}
	await commitDerivedFixture({
		...params,
		message: "scanner e2e readonly schema fixture",
	});
}

export async function removeApiSourceFixture(params: {
	sourcePath: string;
	env: Record<string, string>;
}) {
	const removed = await command(
		["git", "-C", params.sourcePath, "rm", "-r", "--", "api"],
		params.env,
	);
	if (removed.exitCode !== 0) {
		throw new Error(
			`scanner_e2e_no_api_fixture_remove_failed:${removed.stderr}`,
		);
	}
	await commitDerivedFixture({
		...params,
		message: "scanner e2e no api fixture",
	});
}

export async function commitDerivedFixture(params: {
	sourcePath: string;
	env: Record<string, string>;
	message: string;
}) {
	const committed = await command(
		[
			"git",
			"-C",
			params.sourcePath,
			"-c",
			"user.name=Scanner E2E Fixture",
			"-c",
			"user.email=scanner-e2e@example.invalid",
			"commit",
			"--no-gpg-sign",
			"--no-verify",
			"--date=2026-08-21T00:00:00Z",
			"-m",
			params.message,
		],
		{
			...params.env,
			GIT_COMMITTER_DATE: "2026-08-21T00:00:00Z",
		},
	);
	if (committed.exitCode !== 0) {
		throw new Error(
			`scanner_e2e_schema_fixture_commit_failed:${committed.stderr}`,
		);
	}
	const status = await command(
		["git", "-C", params.sourcePath, "status", "--porcelain=v1"],
		params.env,
	);
	if (status.exitCode !== 0 || status.stdout.trim()) {
		throw new Error("scanner_e2e_schema_fixture_worktree_dirty");
	}
}

export async function createDerivedFixtureWorkspace(params: {
	sourcePath: string;
	root: string;
	env: Record<string, string>;
	name: string;
	mutate: (params: {
		sourcePath: string;
		env: Record<string, string>;
	}) => Promise<void>;
}) {
	const sourcePath = path.join(params.root, params.name);
	const cloned = await command(
		[
			"git",
			"clone",
			"--no-local",
			"--no-checkout",
			params.sourcePath,
			sourcePath,
		],
		params.env,
	);
	if (cloned.exitCode !== 0) {
		throw new Error(`scanner_e2e_schema_fixture_clone_failed:${cloned.stderr}`);
	}
	const checkedOut = await command(
		["git", "-C", sourcePath, "checkout", "--detach", "HEAD"],
		params.env,
	);
	if (checkedOut.exitCode !== 0) {
		throw new Error(
			`scanner_e2e_schema_fixture_checkout_failed:${checkedOut.stderr}`,
		);
	}
	await params.mutate({ sourcePath, env: params.env });
	const archivePath = path.join(params.root, `${params.name}.tar`);
	const archived = await command(
		[
			"git",
			"-C",
			sourcePath,
			"archive",
			"--format=tar",
			"--output",
			archivePath,
			"HEAD",
		],
		params.env,
	);
	if (archived.exitCode !== 0) {
		throw new Error(
			`scanner_e2e_schema_fixture_archive_failed:${archived.stderr}`,
		);
	}
	return {
		sourcePath,
		sourceSnapshotDigest: createHash("sha256")
			.update(await fs.readFile(archivePath))
			.digest("hex"),
	};
}

export async function createReadonlySchemaFixtureWorkspace(params: {
	sourcePath: string;
	root: string;
	env: Record<string, string>;
}) {
	return await createDerivedFixtureWorkspace({
		...params,
		name: "readonly-schema-source",
		mutate: addReadonlySchemaFixture,
	});
}

export async function createNoApiFixtureWorkspace(params: {
	sourcePath: string;
	root: string;
	env: Record<string, string>;
}) {
	return await createDerivedFixtureWorkspace({
		...params,
		name: "no-api-source",
		mutate: removeApiSourceFixture,
	});
}

export function canonicalCaseId(id: string): string {
	return (
		{
			gitleaks: "gitleaks-source",
			osv: "osv-manifest",
			"osv-installed-tree": "osv-installed-tree",
			"trivy-fs": "trivy-filesystem",
			semgrep: "semgrep-source",
			zizmor: "zizmor-workflow",
			sbom: "trivy-sbom",
			"trivy-image": "trivy-image",
			"passive-dast": "passive-dast",
			"nuclei-safe": "nuclei-safe",
			"zap-baseline": "zap-baseline",
			"schemathesis-no-schema": "schemathesis-not-applicable",
			"schemathesis-readonly": "schemathesis-readonly",
		}[id] ?? id
	);
}

export function isolatedTargetProvider(
	repoPath: string,
	image: string,
): RuntimeTargetProvider {
	const plan: DastTargetStartPlan = {
		pluginId: "scanner-e2e.todolist-container",
		repoPath,
		scriptName: "isolated-container",
		script: "docker run isolated target",
		packageManager: "bun",
		command: ["docker", "run"],
		env: {},
		port: 5173,
		origin: "http://127.0.0.1:5173",
		readinessPaths: ["/api/health"],
		requiresProjectCodeConsent: false,
		warnings: [],
	};
	return {
		plan,
		prepare: async () => {
			const target = await startTodolistRuntimeTarget(image);
			return {
				plan: { ...plan, origin: target.origin },
				origin: target.origin,
				stop: target.stop,
				targetConfig: {
					name: "scanner e2e isolated todolist",
					origin: target.origin,
					allowLoopback: true,
					allowPrivateNetwork: false,
					allowedPathsJson: ["/", "/api/health"],
					excludedPathsJson: [],
					defaultHeadersJson: {},
					maxDepth: 2,
					maxRequests: 30,
					rateLimitPerSec: 2,
					timeoutSec: 600,
					metadata: { scannerE2E: true },
				},
			};
		},
	};
}

export async function finalizeScannerE2ECase(params: {
	db: ReturnType<typeof createDbConnection>["db"];
	scanRunId: string;
	artifactRoot: string;
	title: string;
}) {
	const storage = new ArtifactStorage(params.artifactRoot);
	const reportRepository = new ScanReportRepository(params.db);
	const reportRunner = new ScanReportRunner(params.db, {
		reportRepository,
		artifactStorage: storage,
	});
	const diagnosticRunner = new ScanDiagnosticRunner(params.db, {
		reviewRunner: new ScanReviewRunner(params.db),
		reportRunner,
		reportRepository,
	});
	try {
		const diagnostic = await diagnosticRunner.run(params.scanRunId);
		if (
			diagnostic.status !== "completed" &&
			diagnostic.status !== "completed_with_limitations"
		) {
			throw new Error(`scanner_e2e_diagnostic_failed:${diagnostic.status}`);
		}
		const final = await finalizeScanAfterDiagnostic({
			db: params.db,
			scanRunId: params.scanRunId,
			artifactStorage: storage,
			options: {
				enabled: true,
				title: params.title,
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
			},
		});
		if (
			!final.ok ||
			final.status !== "completed" ||
			!final.reportId ||
			!final.artifactId
		) {
			throw new Error(
				`scanner_e2e_finalization_failed:${final.error ?? final.status}`,
			);
		}
		return { diagnostic, final };
	} finally {
		await diagnosticRunner.shutdown();
		await reportRunner.shutdown();
	}
}
