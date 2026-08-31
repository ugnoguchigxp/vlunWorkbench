import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDbConnection } from "../api/db";
import {
	dastRuns,
	findings,
	projects,
	scanArtifacts,
	scanExecutionPlans,
	scanReports,
	scanRuns,
	toolRuns,
	users,
} from "../api/db/schema";
import type { RuntimeTargetProvider } from "../api/modules/dast/runtime-target-provider";
import type { DastTargetStartPlan } from "../api/modules/dast/target-preparer";
import { ScanReportRunner } from "../api/modules/reports/scan-report-runner";
import { ArtifactStorage } from "../api/modules/scans/artifact-storage";
import { runProfileScan } from "../api/modules/scans/profile-runner";
import { ScanReportRepository } from "../api/modules/scans/report-repository";
import { ScanDiagnosticRunner } from "../api/modules/scans/scan-diagnostic-runner";
import { finalizeScanAfterDiagnostic } from "../api/modules/scans/scan-finalization-service";
import { ScanReviewRunner } from "../api/modules/scans/scan-review-runner";
import { scannerE2ECaseIdentityHash } from "../api/modules/scans/scanner-e2e-qualification";
import { scanPreflightResultSchema } from "../shared/schemas/scan-preflight.schema";
import { scannerE2EFullProfileEvidenceSchema } from "../shared/schemas/scanner-e2e-full-profile.schema";
import { scannerE2EEvidenceBundleV2Schema } from "../shared/schemas/scanner-e2e-v2.schema";
import {
	retainOnlyScannerE2EPinnedImage,
	scannerE2EPinnedTag,
} from "./docker-image-retention";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { normalizedFullProfileRun } from "./scanner-e2e-full-profile-lib";
import { loadScannerE2ECaseRegistryV2 } from "./scanner-e2e-v2-case-registry";
import { observeScannerE2EWork } from "./scanner-e2e-v2-work";
import { startTodolistRuntimeTarget } from "./todolist-runtime-target";
import {
	createTodolistSourceSnapshot,
	resolveTodolistAcceptanceTarget,
	selectTodolistAcceptanceProfiles,
} from "./todolist-scan-acceptance-lib";

const TOOLBOX_IMAGE = "vuln-workbench-toolbox:local";

async function command(command: string[], env: Record<string, string>) {
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

async function seedTrivyToolCache(params: {
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

async function resolveImmutableDockerImage(params: {
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

async function resolveApplicationCommit() {
	const result = await command(["git", "rev-parse", "HEAD"], {});
	const commit = result.stdout.trim();
	if (result.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(commit)) {
		throw new Error("scanner_e2e_application_commit_unavailable");
	}
	return commit;
}

/**
 * The read-only Schemathesis success fixture is source input, not a runtime
 * convenience file. Commit it with fixed identity and timestamps so strict
 * preflight receives a clean, immutable worktree rather than silently scanning
 * an untracked OpenAPI document.
 */
async function addReadonlySchemaFixture(params: {
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

async function removeApiSourceFixture(params: {
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

async function commitDerivedFixture(params: {
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

async function createDerivedFixtureWorkspace(params: {
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

async function createReadonlySchemaFixtureWorkspace(params: {
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

async function createNoApiFixtureWorkspace(params: {
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

function canonicalCaseId(id: string): string {
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

function isolatedTargetProvider(
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

/**
 * Scanner E2E deliberately leaves the optional LLM route unconfigured. The
 * production diagnostic pipeline records that limitation, still emits its
 * deterministic diagnostic, and then the same finalization service issues
 * the canonical final report. No scanner/target/repository dependency is
 * mocked here.
 */
async function finalizeScannerE2ECase(params: {
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

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			"repo-path": { type: "string" },
			"toolbox-image": { type: "string" },
			evidence: { type: "string" },
			"full-profile-evidence": { type: "string" },
			only: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.evidence && !args["full-profile-evidence"])
		throw new Error("scanner_e2e_evidence_path_required");
	if (args.evidence && args["full-profile-evidence"])
		throw new Error("scanner_e2e_evidence_mode_ambiguous");
	const { registry, contractHash } = await loadScannerE2ECaseRegistryV2();
	const selected = selectTodolistAcceptanceProfiles(
		args.only?.split(",").filter(Boolean) ?? [],
	);
	const target = await resolveTodolistAcceptanceTarget(args["repo-path"]);
	const requestedToolboxImage = args["toolbox-image"] ?? TOOLBOX_IMAGE;
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-scanner-e2e-"));
	const dbPath = path.join(root, "e2e.sqlite");
	const artifactRoot = path.join(root, "artifacts");
	const toolCacheDir = path.join(root, "tool-cache");
	const previousArtifactRoot = process.env.SCAN_ARTIFACT_ROOT;
	process.env.SCAN_ARTIFACT_ROOT = artifactRoot;
	const env = {
		DATABASE_URL: `file:${dbPath}`,
		SCAN_ARTIFACT_ROOT: artifactRoot,
	};
	try {
		const resolvedToolbox = await resolveImmutableDockerImage({
			image: requestedToolboxImage,
			env,
		});
		const toolboxImage = resolvedToolbox.reference;
		const toolboxImageDigest = resolvedToolbox.digest;
		const applicationCommit = await resolveApplicationCommit();
		const migrate = await command(["bun", "run", "api/cli/migrate.ts"], env);
		if (migrate.exitCode !== 0)
			throw new Error(`scanner_e2e_migration_failed:${migrate.stderr}`);
		const snapshot = await createTodolistSourceSnapshot(target, root);
		const targetImage = `vwb-scanner-e2e-todolist:${target.commit.slice(0, 12)}`;
		const imageBuild = await command(
			["docker", "build", "-t", targetImage, snapshot.sourcePath],
			env,
		);
		if (imageBuild.exitCode !== 0)
			throw new Error(
				`scanner_e2e_target_image_build_failed:${imageBuild.stderr}`,
			);
		const imageTar = path.join(root, "todolist-image.tar");
		const imageSave = await command(
			["docker", "save", "--output", imageTar, targetImage],
			env,
		);
		if (imageSave.exitCode !== 0)
			throw new Error(
				`scanner_e2e_target_image_save_failed:${imageSave.stderr}`,
			);
		if (selected.some((entry) => entry.id.includes("trivy"))) {
			await seedTrivyToolCache({ toolboxImage, toolCacheDir, env });
		}
		const connection = createDbConnection(env.DATABASE_URL, {
			shutdownWriterOnClose: true,
		});
		try {
			const now = new Date();
			await connection.db.insert(users).values({
				id: "00000000-0000-4000-8000-000000000001",
				email: "scanner-e2e@example.invalid",
				passwordHash: "e2e",
				displayName: "scanner E2E",
				role: "admin",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
			const [project] = await connection.db
				.insert(projects)
				.values({
					id: "00000000-0000-4000-8000-000000000002",
					ownerUserId: "00000000-0000-4000-8000-000000000001",
					name: "scanner E2E todolist",
					repoPath: snapshot.sourcePath,
					canonicalRepoPath: snapshot.sourcePath,
					createdAt: now,
					updatedAt: now,
				})
				.returning();
			if (!project) throw new Error("scanner_e2e_project_create_failed");
			if (args["full-profile-evidence"]) {
				// A strict profile must not turn detected API source without a
				// contract into an invented schema scan. Supply the reviewed
				// read-only fixture as immutable source input for this composite
				// qualification, while the original source remains covered by the
				// separate API-without-schema fail-closed case.
				const fixture = await createReadonlySchemaFixtureWorkspace({
					sourcePath: snapshot.sourcePath,
					root,
					env,
				});
				await runFullProfileRepeatE2E({
					db: connection.db,
					projectId: project.id,
					sourcePath: fixture.sourcePath,
					sourceSnapshotDigest: fixture.sourceSnapshotDigest,
					apiWithoutSchemaSourcePath: snapshot.sourcePath,
					apiWithoutSchemaSourceSnapshotDigest: snapshot.archiveSha256,
					targetCommit: target.commit,
					targetSnapshotSha256: asDigest(snapshot.archiveSha256),
					applicationCommit,
					toolboxImageDigest,
					targetImage,
					toolboxImage,
					toolCacheDir,
					artifactRoot,
					evidencePath: path.resolve(args["full-profile-evidence"]),
				});
				return;
			}
			const evidence = [];
			for (const selectedCase of selected) {
				let caseSourcePath = snapshot.sourcePath;
				let sourceSnapshotDigest = snapshot.archiveSha256;
				if (selectedCase.id === "schemathesis-readonly") {
					const fixture = await createReadonlySchemaFixtureWorkspace({
						sourcePath: snapshot.sourcePath,
						root,
						env,
					});
					caseSourcePath = fixture.sourcePath;
					sourceSnapshotDigest = fixture.sourceSnapshotDigest;
				} else if (selectedCase.id === "schemathesis-no-schema") {
					const fixture = await createNoApiFixtureWorkspace({
						sourcePath: snapshot.sourcePath,
						root,
						env,
					});
					caseSourcePath = fixture.sourcePath;
					sourceSnapshotDigest = fixture.sourceSnapshotDigest;
				}
				const runtime = selectedCase.requiresTarget
					? isolatedTargetProvider(caseSourcePath, targetImage)
					: undefined;
				const result = await runProfileScan({
					db: connection.db,
					projectId: project.id,
					profileId: selectedCase.profile,
					stepId: selectedCase.step ?? undefined,
					repoPath: caseSourcePath,
					execution: {
						runner: "docker",
						docker: {
							image: toolboxImage,
							// One execution identity is bound across the whole qualification suite.
							networkMode: "default",
							toolCacheDir,
						},
					},
					imageTar: selectedCase.id === "trivy-image" ? imageTar : undefined,
					sourceSnapshotDigest,
					runtimeTargetProvider: runtime,
				});
				const [scan] = await connection.db
					.select()
					.from(scanRuns)
					.where(eq(scanRuns.id, result.scanRunId));
				const artifacts = await connection.db
					.select()
					.from(scanArtifacts)
					.where(eq(scanArtifacts.scanRunId, result.scanRunId));
				const tools = await connection.db
					.select()
					.from(toolRuns)
					.where(eq(toolRuns.scanRunId, result.scanRunId));
				const canonical = canonicalCaseId(selectedCase.id);
				const contract = registry.cases.find((entry) => entry.id === canonical);
				if (
					!contract ||
					contract.profileId !== selectedCase.profile ||
					contract.stepId !== selectedCase.step ||
					contract.expectedArtifactRoles.join(",") !==
						selectedCase.expectedArtifactKinds.join(",")
				) {
					throw new Error(`scanner_e2e_harness_contract_mismatch:${canonical}`);
				}
				if (result.status !== "completed") {
					const stepFailureSummary = result.stepResults.map((step) => ({
						kind: step.kind,
						status: step.status,
						error: step.error,
						...(step.kind === "static_tool" || step.kind === "api_schema_scan"
							? { reasonCode: step.reasonCode ?? null }
							: {}),
					}));
					const storedMetadata = asRecord(scan?.metadata);
					const storedPreflight = asRecord(storedMetadata?.scanPreflight);
					const blockedPreflight = Array.isArray(storedPreflight?.checks)
						? storedPreflight.checks
								.filter(
									(check: { status?: unknown }) => check.status === "blocked",
								)
								.map((check: { id?: unknown; reasonCode?: unknown }) => ({
									id: check.id ?? null,
									reasonCode: check.reasonCode ?? null,
								}))
						: [];
					throw new Error(
						`scanner_e2e_case_failed:${selectedCase.id}:${result.message ?? "unknown"}:${JSON.stringify({ stepFailureSummary, blockedPreflight })}`,
					);
				}
				for (const expectedKind of contract.expectedArtifactRoles) {
					if (!artifacts.some((artifact) => artifact.kind === expectedKind)) {
						throw new Error(
							`scanner_e2e_artifact_missing:${selectedCase.id}:${expectedKind}`,
						);
					}
				}
				if (
					contract.expectedVerdict === "not_applicable" &&
					!result.stepResults.some(
						(step) =>
							step.kind === "api_schema_scan" &&
							step.applicability === "not_applicable" &&
							step.reasonCode === "schema_not_found",
					)
				) {
					throw new Error(
						`scanner_e2e_not_applicable_missing:${selectedCase.id}`,
					);
				}
				const metadata = asRecord(scan?.metadata);
				const preflight = asRecord(metadata?.scanPreflight);
				const binding = asRecord(preflight?.binding);
				const preflightHash = digestOrNull(preflight?.preflightHash);
				const executionHash = digestOrNull(binding?.executionHash);
				if (!preflight || !binding || !preflightHash || !executionHash)
					throw new Error(`scanner_e2e_preflight_missing:${selectedCase.id}`);
				const parsedPreflight = scanPreflightResultSchema.parse(preflight);
				const imageDigests = [
					...new Set(
						(preflight.checks as Array<Record<string, unknown>>)
							.filter((check) => check.kind === "docker_image")
							.map((check) => check.observedDigest)
							.filter(
								(digest): digest is string =>
									typeof digest === "string" &&
									/^sha256:[a-f0-9]{64}$/.test(digest),
							),
					),
				].sort();
				if (imageDigests.length === 0 && canonical !== "passive-dast") {
					throw new Error(
						`scanner_e2e_image_identity_missing:${selectedCase.id}`,
					);
				}
				const [executionPlan] = await connection.db
					.select({ planHash: scanExecutionPlans.planHash })
					.from(scanExecutionPlans)
					.where(eq(scanExecutionPlans.scanRunId, result.scanRunId));
				if (!executionPlan)
					throw new Error(`scanner_e2e_plan_missing:${selectedCase.id}`);
				const finalized = await finalizeScannerE2ECase({
					db: connection.db,
					scanRunId: result.scanRunId,
					artifactRoot,
					title: `Scanner E2E ${canonical}`,
				});
				const [allArtifacts, caseDastRuns, reports, caseFindings] =
					await Promise.all([
						connection.db
							.select()
							.from(scanArtifacts)
							.where(eq(scanArtifacts.scanRunId, result.scanRunId)),
						connection.db
							.select()
							.from(dastRuns)
							.where(eq(dastRuns.scanRunId, result.scanRunId)),
						connection.db
							.select()
							.from(scanReports)
							.where(eq(scanReports.scanRunId, result.scanRunId)),
						connection.db
							.select()
							.from(findings)
							.where(eq(findings.scanRunId, result.scanRunId)),
					]);
				const scannerArtifacts = allArtifacts.filter(
					(artifact) => artifact.kind !== "report",
				);
				const finalArtifact = allArtifacts.find(
					(artifact) => artifact.id === finalized.final.artifactId,
				);
				if (!finalArtifact) {
					throw new Error(`scanner_e2e_final_artifact_missing:${canonical}`);
				}
				const normalizedFindingHashes = [
					...new Set(
						caseFindings.map((finding) =>
							sha256(
								canonicalJson({
									sourceTool: finding.sourceTool,
									ruleId: finding.ruleId,
									title: finding.title,
									severity: finding.severity,
									confidence: finding.confidence,
									status: finding.status,
									primaryLocation:
										canonical === "zap-baseline"
											? null
											: normalizePrimaryLocation(finding.primaryLocation),
								}),
							),
						),
					),
				].sort();
				const work = await observeScannerE2EWork({
					caseId: canonical,
					sourcePath: caseSourcePath,
					artifactRoot,
					artifacts: scannerArtifacts,
					toolRuns: tools,
					dastRuns: caseDastRuns,
				});
				assertSuccessContract({
					caseId: canonical,
					contract,
					result,
					work,
					artifacts: scannerArtifacts,
					reports,
				});
				const failureResult = await runProfileScan({
					db: connection.db,
					projectId: project.id,
					profileId: selectedCase.profile,
					stepId: selectedCase.step ?? undefined,
					repoPath: caseSourcePath,
					expectedPlanHash: `sha256:${"0".repeat(64)}`,
					execution: {
						runner: "docker",
						docker: {
							image: toolboxImage,
							networkMode: "default",
							toolCacheDir,
						},
					},
					imageTar: selectedCase.id === "trivy-image" ? imageTar : undefined,
					sourceSnapshotDigest,
					runtimeTargetProvider: runtime,
				});
				const [failureTools, failureArtifacts, failureReports] =
					await Promise.all([
						connection.db
							.select()
							.from(toolRuns)
							.where(eq(toolRuns.scanRunId, failureResult.scanRunId)),
						connection.db
							.select()
							.from(scanArtifacts)
							.where(eq(scanArtifacts.scanRunId, failureResult.scanRunId)),
						connection.db
							.select()
							.from(scanReports)
							.where(eq(scanReports.scanRunId, failureResult.scanRunId)),
					]);
				assertFailClosedContract({
					caseId: canonical,
					result: failureResult,
					toolRunCount: failureTools.length,
					artifactCount: failureArtifacts.length,
					reportCount: failureReports.length,
				});
				evidence.push({
					schemaVersion: 2 as const,
					caseId: canonical,
					contractHash,
					executedAt: new Date().toISOString(),
					scenarios: [
						{
							kind: "success" as const,
							scenarioType:
								contract.expectedVerdict === "not_applicable"
									? ("not_applicable_success" as const)
									: ("executed_success" as const),
							scanRunId: result.scanRunId,
							profileOutcome: result.profileOutcome,
							executionPlanHash: executionPlan.planHash,
							preflightHash,
							sourceRevisionHash: digestOrNull(binding.sourceRevisionHash),
							scannerManifestHash: digestOrNull(binding.scannerManifestHash),
							executionHash,
							scannerIdentityHash: scannerE2ECaseIdentityHash({
								caseId: canonical,
								preflight: parsedPreflight,
							}),
							normalizedFindingHashes,
							normalizedEvidenceHash: sha256(
								canonicalJson(normalizedFindingHashes),
							),
							scannerProcessCount:
								canonical === "schemathesis-not-applicable"
									? 0
									: Math.max(tools.length, caseDastRuns.length),
							toolRunCount: tools.length,
							work,
							assertionIds: contract.requiredAssertionIds,
							artifacts: scannerArtifacts.map((artifact) => ({
								id: artifact.id,
								kind: artifact.kind,
								storageKey: artifact.storageKey ?? artifact.path,
								sha256: asDigest(artifact.sha256),
								sizeBytes: artifact.sizeBytes,
							})),
							canonicalFinalReportId: finalized.final.reportId,
							canonicalFinalArtifactId: finalized.final.artifactId,
							canonicalFinalReportStorageKey:
								finalArtifact.storageKey ?? finalArtifact.path,
							canonicalFinalReportSha256: asDigest(finalArtifact.sha256),
							canonicalFinalReportSizeBytes: finalArtifact.sizeBytes,
							canonicalFinalReportCount: reports.filter(
								(report) =>
									report.stage === "canonical_final" &&
									report.status === "completed",
							).length as 1,
							toolVersions: Object.fromEntries(
								tools.map((tool) => [
									tool.toolName,
									tool.toolVersion ?? "unknown",
								]),
							),
							imageDigests,
							reasonCodes: result.stepResults
								.flatMap((step) => {
									if (step.kind === "dast") {
										return step.limitationCodes ?? [];
									}
									return step.reasonCode ? [step.reasonCode] : [];
								})
								.filter((reasonCode): reasonCode is string =>
									Boolean(reasonCode),
								)
								.sort(),
						},
						{
							kind: "fail_closed" as const,
							scenarioType: "preflight_blocked" as const,
							scanRunId: failureResult.scanRunId,
							profileOutcome: "blocked" as const,
							terminationReason: "plan_changed" as const,
							scannerProcessCount: 0 as const,
							toolRunCount: 0 as const,
							canonicalFinalReportCount: 0 as const,
							artifactCount: 0 as const,
							assertionIds: ["FAIL-01"] as const,
							reasonCodes: ["plan_changed"],
						},
					],
				});
			}
			const bundle = scannerE2EEvidenceBundleV2Schema.parse({
				schemaVersion: 2,
				applicationCommit,
				target: {
					repository: "todolist",
					commit: target.commit,
					snapshotSha256: asDigest(snapshot.archiveSha256),
				},
				toolboxImageDigest,
				evidence,
			});
			if (!args.evidence) throw new Error("scanner_e2e_evidence_path_required");
			const evidencePath = path.resolve(args.evidence);
			const evidenceStorageRoot = path.join(
				path.dirname(evidencePath),
				`${path.basename(evidencePath, path.extname(evidencePath))}.storage`,
			);
			await fs.mkdir(path.dirname(evidencePath), { recursive: true });
			await fs.writeFile(evidencePath, `${JSON.stringify(bundle, null, 2)}\n`);
			await fs.rm(evidenceStorageRoot, {
				recursive: true,
				force: true,
			});
			await fs.cp(artifactRoot, evidenceStorageRoot, { recursive: true });
			console.log(
				JSON.stringify({
					ok: true,
					evidencePath,
					cases: evidence.map((entry) => entry.caseId),
				}),
			);
		} finally {
			connection.sqlite.close();
		}
	} finally {
		await fs.rm(root, { recursive: true, force: true });
		if (previousArtifactRoot === undefined) {
			delete process.env.SCAN_ARTIFACT_ROOT;
		} else {
			process.env.SCAN_ARTIFACT_ROOT = previousArtifactRoot;
		}
	}
}

/**
 * Runs the production composite profile twice against one immutable todolist
 * snapshot. Scanner-by-scanner qualification cannot prove profile orchestration,
 * shared target lifecycle, or repeatability at this boundary.
 */
async function runFullProfileRepeatE2E(params: {
	db: ReturnType<typeof createDbConnection>["db"];
	projectId: string;
	sourcePath: string;
	sourceSnapshotDigest: string;
	apiWithoutSchemaSourcePath: string;
	apiWithoutSchemaSourceSnapshotDigest: string;
	targetCommit: string;
	targetSnapshotSha256: string;
	applicationCommit: string;
	toolboxImageDigest: string;
	targetImage: string;
	toolboxImage: string;
	toolCacheDir: string;
	artifactRoot: string;
	evidencePath: string;
}) {
	const apiWithoutSchemaBlock = await runApiWithoutSchemaBlockedE2E({
		db: params.db,
		projectId: params.projectId,
		sourcePath: params.apiWithoutSchemaSourcePath,
		sourceSnapshotDigest: params.apiWithoutSchemaSourceSnapshotDigest,
		targetImage: params.targetImage,
		toolboxImage: params.toolboxImage,
		toolCacheDir: params.toolCacheDir,
	});
	const runs: Array<Record<string, unknown>> = [];
	for (let runNumber = 0; runNumber < 2; runNumber += 1) {
		let targetStartCount = 0;
		let activeTargetCount = 0;
		const baseTargetProvider = isolatedTargetProvider(
			params.sourcePath,
			params.targetImage,
		);
		const runtimeTargetProvider: RuntimeTargetProvider = {
			plan: baseTargetProvider.plan,
			prepare: async (input) => {
				targetStartCount += 1;
				const prepared = await baseTargetProvider.prepare(input);
				activeTargetCount += 1;
				let stopped = false;
				return {
					...prepared,
					stop: async () => {
						if (stopped) return;
						stopped = true;
						try {
							await prepared.stop();
						} finally {
							activeTargetCount -= 1;
						}
					},
				};
			},
		};
		const result = await runProfileScan({
			db: params.db,
			projectId: params.projectId,
			profileId: "full-security-scan",
			repoPath: params.sourcePath,
			execution: {
				runner: "docker",
				docker: {
					image: params.toolboxImage,
					networkMode: "default",
					toolCacheDir: params.toolCacheDir,
				},
			},
			sourceSnapshotDigest: params.sourceSnapshotDigest,
			runtimeTargetProvider,
		});
		if (
			result.status !== "completed" ||
			(result.profileOutcome !== "completed" &&
				result.profileOutcome !== "completed_with_warnings")
		) {
			const stepFailures = result.stepResults
				.filter((step) => step.status !== "completed")
				.map((step) => ({
					stepId:
						step.kind === "static_tool"
							? step.toolId
							: step.kind === "dast"
								? `dast:${step.profileId}`
								: step.stepId,
					kind: step.kind,
					status: step.status,
					error: step.error,
					reasonCode: step.kind === "dast" ? null : (step.reasonCode ?? null),
				}));
			await writeFullProfileFailure(params.evidencePath, {
				phase: "composite_run",
				runNumber,
				result,
				stepFailures,
			});
			throw new Error(
				`scanner_e2e_full_profile_failed:${runNumber}:${result.message ?? result.profileOutcome}:${JSON.stringify(stepFailures)}`,
			);
		}
		if (targetStartCount !== 1 || activeTargetCount !== 0) {
			await writeFullProfileFailure(params.evidencePath, {
				phase: "target_lifecycle",
				runNumber,
				targetStartCount,
				activeTargetCount,
			});
			throw new Error(
				`scanner_e2e_full_profile_target_lifecycle_invalid:${runNumber}:${targetStartCount}:${activeTargetCount}`,
			);
		}
		const finalized = await finalizeScannerE2ECase({
			db: params.db,
			scanRunId: result.scanRunId,
			artifactRoot: params.artifactRoot,
			title: `Scanner E2E full profile ${runNumber + 1}`,
		});
		const [scan, executionPlan, artifacts, tools, reports, scanFindings] =
			await Promise.all([
				params.db
					.select()
					.from(scanRuns)
					.where(eq(scanRuns.id, result.scanRunId))
					.then((rows) => rows.at(0)),
				params.db
					.select({ planHash: scanExecutionPlans.planHash })
					.from(scanExecutionPlans)
					.where(eq(scanExecutionPlans.scanRunId, result.scanRunId))
					.then((rows) => rows.at(0)),
				params.db
					.select()
					.from(scanArtifacts)
					.where(eq(scanArtifacts.scanRunId, result.scanRunId)),
				params.db
					.select()
					.from(toolRuns)
					.where(eq(toolRuns.scanRunId, result.scanRunId)),
				params.db
					.select()
					.from(scanReports)
					.where(eq(scanReports.scanRunId, result.scanRunId)),
				params.db
					.select()
					.from(findings)
					.where(eq(findings.scanRunId, result.scanRunId)),
			]);
		const preflight = asRecord(asRecord(scan?.metadata)?.scanPreflight);
		const binding = asRecord(preflight?.binding);
		const preflightHash = digestOrNull(preflight?.preflightHash);
		const sourceRevisionHash = digestOrNull(binding?.sourceRevisionHash);
		const scannerManifestHash = digestOrNull(binding?.scannerManifestHash);
		if (
			!executionPlan ||
			!preflightHash ||
			!sourceRevisionHash ||
			!scannerManifestHash
		) {
			throw new Error(
				`scanner_e2e_full_profile_preflight_missing:${runNumber}`,
			);
		}
		const steps = result.stepResults
			.map((step) => fullProfileStepObservation(step))
			.sort((left, right) => left.id.localeCompare(right.id));
		const runtimeRequestCount = steps.reduce(
			(total, step) => total + step.requestCount,
			0,
		);
		const normalizedFindingHashes = [
			...new Set(
				scanFindings.map((finding) =>
					sha256(
						canonicalJson({
							sourceTool: finding.sourceTool,
							ruleId: finding.ruleId,
							title: finding.title,
							severity: finding.severity,
							confidence: finding.confidence,
							status: finding.status,
							primaryLocation:
								finding.sourceTool === "zap-baseline"
									? null
									: normalizePrimaryLocation(finding.primaryLocation),
						}),
					),
				),
			),
		].sort();
		const scannerArtifacts = artifacts.filter(
			(artifact) => artifact.kind !== "report",
		);
		const finalArtifact = artifacts.find(
			(artifact) => artifact.id === finalized.final.artifactId,
		);
		if (!finalArtifact) {
			throw new Error(
				`scanner_e2e_full_profile_final_artifact_missing:${runNumber}`,
			);
		}
		const run = {
			scanRunId: result.scanRunId,
			profileOutcome: result.profileOutcome,
			executionPlanHash: executionPlan.planHash,
			preflightHash,
			sourceRevisionHash,
			scannerManifestHash,
			steps,
			scannerProcessCount: tools.length,
			runtimeRequestCount,
			normalizedFindingHashes,
			toolVersions: Object.fromEntries(
				tools.map((tool) => [tool.toolName, tool.toolVersion ?? "unknown"]),
			),
			artifacts: scannerArtifacts.map((artifact) => ({
				kind: artifact.kind,
				storageKey: artifact.storageKey ?? artifact.path,
				sha256: asDigest(artifact.sha256),
				sizeBytes: artifact.sizeBytes,
			})),
			canonicalFinalReportCount: reports.filter(
				(report) =>
					report.stage === "canonical_final" && report.status === "completed",
			).length,
			canonicalFinalReportStorageKey:
				finalArtifact.storageKey ?? finalArtifact.path,
			canonicalFinalReportSha256: asDigest(finalArtifact.sha256),
			canonicalFinalReportSizeBytes: finalArtifact.sizeBytes,
			targetStartCount,
			activeTargetCountAfterRun: activeTargetCount,
		};
		const normalizedEvidenceHash = sha256(
			canonicalJson(normalizedFullProfileRun(run)),
		);
		runs.push({ ...run, normalizedEvidenceHash });
		if (!finalized.final.reportId) {
			throw new Error(`scanner_e2e_full_profile_final_missing:${runNumber}`);
		}
	}
	const rawEvidence = {
		schemaVersion: 1,
		applicationCommit: params.applicationCommit,
		executedAt: new Date().toISOString(),
		target: {
			repository: "todolist",
			commit: params.targetCommit,
			snapshotSha256: params.targetSnapshotSha256,
		},
		toolboxImageDigest: params.toolboxImageDigest,
		apiWithoutSchemaBlock,
		runs,
	};
	let evidence: ReturnType<typeof scannerE2EFullProfileEvidenceSchema.parse>;
	try {
		evidence = scannerE2EFullProfileEvidenceSchema.parse(rawEvidence);
	} catch (error) {
		// Persist diagnostic inputs when the producer assertion fails. The normal
		// evidence path is never written on failure, so a
		// verifier cannot mistake this for a successful qualification.
		const failedEvidencePath = `${params.evidencePath}.failed`;
		await fs.mkdir(path.dirname(failedEvidencePath), { recursive: true });
		await fs.writeFile(
			failedEvidencePath,
			`${JSON.stringify(rawEvidence, null, 2)}\n`,
		);
		throw error;
	}
	const evidenceStorageRoot = path.join(
		path.dirname(params.evidencePath),
		`${path.basename(params.evidencePath, path.extname(params.evidencePath))}.storage`,
	);
	await fs.mkdir(path.dirname(params.evidencePath), { recursive: true });
	await fs.writeFile(
		params.evidencePath,
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	await fs.rm(evidenceStorageRoot, { recursive: true, force: true });
	await fs.cp(params.artifactRoot, evidenceStorageRoot, { recursive: true });
	console.log(
		JSON.stringify({
			ok: true,
			evidencePath: params.evidencePath,
			profile: "full-security-scan",
			runCount: evidence.runs.length,
		}),
	);
}

async function writeFullProfileFailure(
	evidencePath: string,
	payload: Record<string, unknown>,
) {
	const failedEvidencePath = `${evidencePath}.failed`;
	await fs.mkdir(path.dirname(failedEvidencePath), { recursive: true });
	await fs.writeFile(
		failedEvidencePath,
		`${JSON.stringify(payload, null, 2)}\n`,
	);
}

/** Strict API detection must block before it can start a target or scanner. */
async function runApiWithoutSchemaBlockedE2E(params: {
	db: ReturnType<typeof createDbConnection>["db"];
	projectId: string;
	sourcePath: string;
	sourceSnapshotDigest: string;
	targetImage: string;
	toolboxImage: string;
	toolCacheDir: string;
}) {
	let targetStartCount = 0;
	const baseTargetProvider = isolatedTargetProvider(
		params.sourcePath,
		params.targetImage,
	);
	const result = await runProfileScan({
		db: params.db,
		projectId: params.projectId,
		profileId: "full-security-scan",
		repoPath: params.sourcePath,
		execution: {
			runner: "docker",
			docker: {
				image: params.toolboxImage,
				networkMode: "default",
				toolCacheDir: params.toolCacheDir,
			},
		},
		sourceSnapshotDigest: params.sourceSnapshotDigest,
		runtimeTargetProvider: {
			plan: baseTargetProvider.plan,
			prepare: async () => {
				targetStartCount += 1;
				throw new Error("scanner_e2e_api_without_schema_target_started");
			},
		},
	});
	const [scan, tools, artifacts] = await Promise.all([
		params.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, result.scanRunId))
			.then((rows) => rows.at(0)),
		params.db
			.select()
			.from(toolRuns)
			.where(eq(toolRuns.scanRunId, result.scanRunId)),
		params.db
			.select()
			.from(scanArtifacts)
			.where(eq(scanArtifacts.scanRunId, result.scanRunId)),
	]);
	const preflight = asRecord(asRecord(scan?.metadata)?.scanPreflight);
	const binding = asRecord(preflight?.binding);
	const preflightHash = digestOrNull(preflight?.preflightHash);
	const sourceRevisionHash = digestOrNull(binding?.sourceRevisionHash);
	const reasonCodes = Array.isArray(preflight?.limitationCodes)
		? preflight.limitationCodes.filter(
				(code): code is string => typeof code === "string",
			)
		: [];
	if (
		result.status !== "failed" ||
		result.profileOutcome !== "blocked" ||
		result.stepResults.length !== 0 ||
		result.toolResults.length !== 0 ||
		tools.length !== 0 ||
		artifacts.length !== 0 ||
		targetStartCount !== 0 ||
		!preflightHash ||
		!sourceRevisionHash
	) {
		throw new Error("scanner_e2e_api_without_schema_fail_closed_invalid");
	}
	return {
		scanRunId: result.scanRunId,
		profileOutcome: "blocked" as const,
		preflightHash,
		sourceRevisionHash,
		reasonCodes: reasonCodes.sort(),
		scannerProcessCount: 0 as const,
		artifactCount: 0 as const,
		targetStartCount: 0 as const,
	};
}

function fullProfileStepObservation(
	step: Awaited<ReturnType<typeof runProfileScan>>["stepResults"][number],
) {
	const id =
		step.kind === "static_tool"
			? step.toolId
			: step.kind === "dast"
				? `dast:${step.profileId}`
				: step.stepId;
	const requestCount =
		step.kind === "dast"
			? numberAt(step.coverageSummary, "requestCount")
			: numberAt(asRecord(step.metadata)?.gatewayMetrics, "forwardedRequests");
	const reasonCodes =
		step.kind === "dast"
			? (step.limitationCodes ?? []).slice().sort()
			: step.reasonCode
				? [step.reasonCode]
				: [];
	return {
		id,
		status: step.status,
		applicability:
			step.kind === "dast"
				? step.status === "skipped"
					? ("not_applicable" as const)
					: ("applicable" as const)
				: (step.applicability ?? ("applicable" as const)),
		reasonCodes,
		requestCount,
	};
}

await main();

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberAt(value: unknown, key: string): number {
	const candidate = asRecord(value)?.[key];
	return typeof candidate === "number" &&
		Number.isInteger(candidate) &&
		candidate >= 0
		? candidate
		: 0;
}

function normalizePrimaryLocation(value: unknown): unknown {
	const location = asRecord(value);
	if (!location || typeof location.path !== "string") return value;
	let normalizedPath = location.path;
	try {
		const url = new URL(location.path);
		normalizedPath = `${url.pathname}${url.search}`;
	} catch {
		// Source paths are already normalized by their scanner adapters.
	}
	return { ...location, path: normalizedPath };
}

function digestOrNull(value: unknown): string | null {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
		? value
		: null;
}

function asDigest(value: string): `sha256:${string}` {
	return (
		value.startsWith("sha256:") ? value : `sha256:${value}`
	) as `sha256:${string}`;
}

function assertSuccessContract(params: {
	caseId: string;
	contract: {
		expectedVerdict: "passed" | "not_applicable";
		expectedArtifactRoles: string[];
		workCounters: Record<string, { minimum: number; maximum?: number }>;
	};
	result: Awaited<ReturnType<typeof runProfileScan>>;
	work: Record<string, number>;
	artifacts: Array<{ kind: string }>;
	reports: Array<{ stage: string; status: string }>;
}) {
	if (
		params.result.status !== "completed" ||
		(params.result.profileOutcome !== "completed" &&
			params.result.profileOutcome !== "completed_with_warnings") ||
		params.result.stepResults.length !== 1
	) {
		throw new Error(
			`scanner_e2e_v2_success_lifecycle_invalid:${params.caseId}`,
		);
	}
	const canonicalFinals = params.reports.filter(
		(report) =>
			report.stage === "canonical_final" && report.status === "completed",
	);
	if (canonicalFinals.length !== 1) {
		throw new Error(`scanner_e2e_v2_canonical_final_invalid:${params.caseId}`);
	}
	for (const role of params.contract.expectedArtifactRoles) {
		if (!params.artifacts.some((artifact) => artifact.kind === role)) {
			throw new Error(
				`scanner_e2e_v2_artifact_missing:${params.caseId}:${role}`,
			);
		}
	}
	for (const [name, bounds] of Object.entries(params.contract.workCounters)) {
		const observed = params.work[name];
		if (
			observed === undefined ||
			observed < bounds.minimum ||
			(bounds.maximum !== undefined && observed > bounds.maximum)
		) {
			throw new Error(
				`scanner_e2e_v2_work_counter_invalid:${params.caseId}:${name}:${JSON.stringify({ observed, ...bounds })}`,
			);
		}
	}
	if (params.contract.expectedVerdict === "not_applicable") {
		if (params.artifacts.length !== 0) {
			throw new Error(
				`scanner_e2e_v2_not_applicable_artifact:${params.caseId}`,
			);
		}
		if (
			!params.result.stepResults.some(
				(step) =>
					step.kind === "api_schema_scan" &&
					step.applicability === "not_applicable" &&
					step.reasonCode === "schema_not_found",
			)
		) {
			throw new Error(
				`scanner_e2e_v2_not_applicable_evidence_missing:${params.caseId}`,
			);
		}
		return;
	}
	if (params.result.stepResults[0]?.status !== "completed") {
		throw new Error(`scanner_e2e_v2_step_not_completed:${params.caseId}`);
	}
}

function assertFailClosedContract(params: {
	caseId: string;
	result: Awaited<ReturnType<typeof runProfileScan>>;
	toolRunCount: number;
	artifactCount: number;
	reportCount: number;
}) {
	if (
		params.result.status !== "failed" ||
		params.result.profileOutcome !== "blocked" ||
		params.result.toolResults.length !== 0 ||
		params.result.stepResults.length !== 0 ||
		params.toolRunCount !== 0 ||
		params.artifactCount !== 0 ||
		params.reportCount !== 0
	) {
		throw new Error(`scanner_e2e_v2_fail_closed_invalid:${params.caseId}`);
	}
}
