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
import { runProfileScan } from "../api/modules/scans/profile-runner";
import { scannerE2ECaseIdentityHash } from "../api/modules/scans/scanner-e2e-qualification";
import { scanPreflightResultSchema } from "../shared/schemas/scan-preflight.schema";
import { scannerE2EEvidenceBundleV2Schema } from "../shared/schemas/scanner-e2e-v2.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { cleanupScannerE2ETemporaryRoot } from "./scanner-e2e-cleanup";
import {
	asDigest,
	asRecord,
	assertFailClosedContract,
	assertSuccessContract,
	digestOrNull,
	normalizePrimaryLocation,
	readFailureStderrArtifacts,
	runFullProfileRepeatE2E,
} from "./scanner-e2e-full-profile-runner";
import { loadScannerE2ECaseRegistryV2 } from "./scanner-e2e-v2-case-registry";
import { observeScannerE2EWork } from "./scanner-e2e-v2-work";
import {
	canonicalCaseId,
	command,
	createNoApiFixtureWorkspace,
	createReadonlySchemaFixtureWorkspace,
	finalizeScannerE2ECase,
	isolatedTargetProvider,
	resolveApplicationCommit,
	resolveImmutableDockerImage,
	seedTrivyToolCache,
} from "./scanner-e2e-workspace";
import {
	createTodolistSourceSnapshot,
	resolveTodolistAcceptanceTarget,
	selectTodolistAcceptanceProfiles,
} from "./todolist-scan-acceptance-lib";

const TOOLBOX_IMAGE = "vuln-workbench-toolbox:local";

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
	let cleanupToolboxImage = requestedToolboxImage;
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
	let primaryError: unknown;
	let cleanupError: unknown;
	const run = async () => {
		const resolvedToolbox = await resolveImmutableDockerImage({
			image: requestedToolboxImage,
			env,
		});
		const toolboxImage = resolvedToolbox.reference;
		cleanupToolboxImage = toolboxImage;
		const toolboxImageDigest = resolvedToolbox.digest;
		const applicationCommit = await resolveApplicationCommit();
		const migrate = await command(["bun", "run", "api/cli/migrate.ts"], env);
		if (migrate.exitCode !== 0)
			throw new Error(`scanner_e2e_migration_failed:${migrate.stderr}`);
		const snapshot = await createTodolistSourceSnapshot(target, root);
		const targetImage = `vwb-scanner-e2e-todolist:${target.commit.slice(0, 12)}`;
		const imageBuild = await command(
			[
				"docker",
				"build",
				"--provenance=false",
				"-t",
				targetImage,
				snapshot.sourcePath,
			],
			env,
		);
		if (imageBuild.exitCode !== 0)
			throw new Error(
				`scanner_e2e_target_image_build_failed:${imageBuild.stderr}`,
			);
		const imageTar = ".vuln-workbench-inputs/todolist-image.tar";
		const imageTarPath = path.join(snapshot.sourcePath, imageTar);
		await fs.mkdir(path.dirname(imageTarPath), { recursive: true });
		await fs.appendFile(
			path.join(snapshot.sourcePath, ".git", "info", "exclude"),
			"\n/.vuln-workbench-inputs/\n",
		);
		const imageSave = await command(
			["docker", "save", "--output", imageTarPath, targetImage],
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
					consentProjectCodeExecution: true,
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
					const failureDiagnostics = await readFailureStderrArtifacts(
						artifactRoot,
						artifacts,
					);
					throw new Error(
						`scanner_e2e_case_failed:${selectedCase.id}:${result.message ?? "unknown"}:${JSON.stringify({ stepFailureSummary, blockedPreflight, failureDiagnostics })}`,
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
				if (
					imageDigests.length === 0 &&
					canonical !== "passive-dast" &&
					contract.expectedVerdict !== "not_applicable"
				) {
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
					consentProjectCodeExecution: true,
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
	};
	try {
		await run();
	} catch (error) {
		primaryError = error;
	} finally {
		try {
			await cleanupScannerE2ETemporaryRoot({
				root,
				toolCacheDir,
				toolboxImage: cleanupToolboxImage,
			});
		} catch (error) {
			cleanupError = error;
		}
		if (previousArtifactRoot === undefined) {
			delete process.env.SCAN_ARTIFACT_ROOT;
		} else {
			process.env.SCAN_ARTIFACT_ROOT = previousArtifactRoot;
		}
		if (cleanupError !== undefined && primaryError !== undefined) {
			console.error("scanner_e2e_secondary_cleanup_failed", cleanupError);
		}
	}
	if (primaryError !== undefined) throw primaryError;
	if (cleanupError !== undefined) throw cleanupError;
}

await main();
