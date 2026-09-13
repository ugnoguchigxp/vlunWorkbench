import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { createDbConnection } from "../api/db";
import {
	findings,
	scanArtifacts,
	scanExecutionPlans,
	scanReports,
	scanRuns,
	toolRuns,
} from "../api/db/schema";
import type { RuntimeTargetProvider } from "../api/modules/dast/runtime-target-provider";
import { runProfileScan } from "../api/modules/scans/profile-runner";
import { scannerE2EFullProfileEvidenceSchema } from "../shared/schemas/scanner-e2e-full-profile.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { normalizedFullProfileRun } from "./scanner-e2e-full-profile-lib";
import {
	finalizeScannerE2ECase,
	isolatedTargetProvider,
} from "./scanner-e2e-workspace";

export async function runFullProfileRepeatE2E(params: {
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
			consentProjectCodeExecution: true,
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

export async function writeFullProfileFailure(
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

export async function runApiWithoutSchemaBlockedE2E(params: {
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
		consentProjectCodeExecution: true,
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

export function fullProfileStepObservation(
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

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function numberAt(value: unknown, key: string): number {
	const candidate = asRecord(value)?.[key];
	return typeof candidate === "number" &&
		Number.isInteger(candidate) &&
		candidate >= 0
		? candidate
		: 0;
}

export function normalizePrimaryLocation(value: unknown): unknown {
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

export function digestOrNull(value: unknown): string | null {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
		? value
		: null;
}

export function asDigest(value: string): `sha256:${string}` {
	return (
		value.startsWith("sha256:") ? value : `sha256:${value}`
	) as `sha256:${string}`;
}

export function assertSuccessContract(params: {
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

export function assertFailClosedContract(params: {
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

export async function readFailureStderrArtifacts(
	artifactRoot: string,
	artifacts: Array<{ kind: string; path: string; sizeBytes: number }>,
) {
	return await Promise.all(
		artifacts
			.filter((artifact) => artifact.kind === "stderr")
			.map(async (artifact) => {
				const text = await fs
					.readFile(path.resolve(artifactRoot, artifact.path), "utf8")
					.catch(() => "stderr_artifact_unreadable");
				return {
					path: artifact.path,
					sizeBytes: artifact.sizeBytes,
					// Scanner runners redact log artifacts before storage. Keep this
					// bounded so a failed qualification remains readable in CI logs.
					excerpt: text.slice(-4_096),
				};
			}),
	);
}
