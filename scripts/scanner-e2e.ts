import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDbConnection } from "../api/db";
import {
	projects,
	scanArtifacts,
	scanExecutionPlans,
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
import { scannerE2EEvidenceBundleSchema } from "../shared/schemas/scanner-e2e-evidence.schema";
import { loadScannerE2ECaseRegistry } from "./scanner-e2e-case-registry";
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

function canonicalCaseId(id: string): string {
	return (
		{
			gitleaks: "gitleaks-source",
			osv: "osv-manifest",
			"osv-installed-tree": "osv-installed-tree",
			"trivy-fs": "trivy-filesystem",
			semgrep: "semgrep-source",
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
			only: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.evidence) throw new Error("scanner_e2e_evidence_path_required");
	const { registry, contractHash } = await loadScannerE2ECaseRegistry();
	const selected = selectTodolistAcceptanceProfiles(
		args.only?.split(",").filter(Boolean) ?? [],
	);
	const target = await resolveTodolistAcceptanceTarget(args["repo-path"]);
	const toolboxImage = args["toolbox-image"] ?? TOOLBOX_IMAGE;
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-scanner-e2e-"));
	const dbPath = path.join(root, "e2e.sqlite");
	const artifactRoot = path.join(root, "artifacts");
	const toolCacheDir = path.join(root, "tool-cache");
	const env = {
		DATABASE_URL: `file:${dbPath}`,
		SCAN_ARTIFACT_ROOT: artifactRoot,
	};
	try {
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
					ownerUserId: "00000000-0000-4000-8000-000000000001",
					name: "scanner E2E todolist",
					repoPath: snapshot.sourcePath,
					canonicalRepoPath: snapshot.sourcePath,
					createdAt: now,
					updatedAt: now,
				})
				.returning();
			if (!project) throw new Error("scanner_e2e_project_create_failed");
			const evidence = [];
			for (const selectedCase of selected) {
				if (selectedCase.id === "schemathesis-readonly") {
					await fs.copyFile(
						path.resolve(
							import.meta.dir,
							"../spec/security-capability/todolist-readonly-openapi.v1.yaml",
						),
						path.join(snapshot.sourcePath, "openapi.yaml"),
					);
				}
				const runtime = selectedCase.requiresTarget
					? isolatedTargetProvider(snapshot.sourcePath, targetImage)
					: undefined;
				const result = await runProfileScan({
					db: connection.db,
					projectId: project.id,
					profileId: selectedCase.profile,
					stepId: selectedCase.step ?? undefined,
					repoPath: snapshot.sourcePath,
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
				evidence.push({
					schemaVersion: 1 as const,
					caseId: canonical,
					contractHash,
					status: "passed" as const,
					verdict: contract.expectedVerdict,
					executedAt: new Date().toISOString(),
					scanRunId: result.scanRunId,
					executionSurface: "profile_orchestrator" as const,
					executionPlanHash: executionPlan.planHash,
					preflightHash,
					sourceRevisionHash: digestOrNull(binding.sourceRevisionHash),
					scannerManifestHash: digestOrNull(binding.scannerManifestHash),
					executionHash,
					scannerIdentityHash: scannerE2ECaseIdentityHash({
						caseId: canonical,
						preflight: parsedPreflight,
					}),
					diagnosticRunId: finalized.diagnostic.diagnosticRunId,
					diagnosticStatus: finalized.diagnostic.status,
					canonicalFinalReportId: finalized.final.reportId,
					canonicalFinalArtifactId: finalized.final.artifactId,
					artifactIds: artifacts.map((artifact) => artifact.id),
					artifacts: artifacts.map((artifact) => ({
						id: artifact.id,
						kind: artifact.kind,
					})),
					toolVersions: Object.fromEntries(
						tools.map((tool) => [tool.toolName, tool.toolVersion ?? "unknown"]),
					),
					imageDigests,
					reasonCodes: [],
				});
			}
			const bundle = scannerE2EEvidenceBundleSchema.parse({
				schemaVersion: 1,
				evidence,
			});
			const evidencePath = path.resolve(args.evidence);
			await fs.mkdir(path.dirname(evidencePath), { recursive: true });
			await fs.writeFile(evidencePath, `${JSON.stringify(bundle, null, 2)}\n`);
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
	}
}

await main();

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function digestOrNull(value: unknown): string | null {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
		? value
		: null;
}
