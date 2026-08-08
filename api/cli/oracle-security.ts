import path from "node:path";
import { parseArgs } from "node:util";
import { scanImprovementRequestSchema } from "../../shared/schemas/scan.schema";
import {
	type SecurityOracleResult as OracleResult,
	securityOracleResultSchema,
} from "../../shared/schemas/security-oracle.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import {
	type ProfileScanResult,
	runProfileScan,
} from "../modules/scans/profile-runner";
import { getProfileById } from "../modules/scans/profiles";
import {
	ProjectResolutionError,
	resolveProjectByPath,
} from "../modules/scans/project-resolver";
import { FindingRepository } from "../modules/scans/repositories";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import { ScanReviewRepository } from "../modules/scans/scan-review-repository";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import { SettingsRepository } from "../modules/settings/settings.repository";
import { LlmRouter } from "../providers/llmRouter";
import { parseScanTargetOption } from "./scan-profile-options";

const DEFAULT_ORACLE_PROFILE = "agent-output";
const DEFAULT_FINDING_LIMIT = 10;
const MAX_FINDING_LIMIT = 1_000;

type OracleStatus =
	| "completed"
	| "security_action_required"
	| "inconclusive"
	| "config_error"
	| "runtime_error";

function writeResult(payload: OracleResult): void {
	console.log(JSON.stringify(securityOracleResultSchema.parse(payload)));
}

function failureResult(params: {
	status: Extract<OracleStatus, "config_error" | "runtime_error">;
	code: string;
	message: string;
	nextAction?: OracleResult["nextAction"];
	project?: OracleResult["project"];
	scan?: OracleResult["scan"];
	review?: OracleResult["review"];
}): OracleResult {
	return {
		ok: false,
		status: params.status,
		project: params.project ?? null,
		scan: params.scan ?? null,
		review: params.review ?? { status: "skipped" },
		nextAction:
			params.nextAction ??
			(params.status === "config_error"
				? "configure_provider"
				: "inspect_diagnostic_failure"),
		error: {
			code: params.code,
			message: params.message,
		},
	};
}

function exitCodeFor(result: OracleResult): number {
	if (result.status === "completed") return 0;
	if (result.status === "security_action_required") return 3;
	if (result.status === "inconclusive") return 4;
	if (result.status === "config_error") return 2;
	return 1;
}

async function main(): Promise<number> {
	let argsValues: Record<string, string | boolean | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-path": { type: "string" },
				profile: { type: "string", default: DEFAULT_ORACLE_PROFILE },
				target: { type: "string", default: "full" },
				"expected-target-digest": { type: "string" },
				"finding-limit": {
					type: "string",
					default: String(DEFAULT_FINDING_LIMIT),
				},
			},
			strict: true,
		});
		argsValues = parsed.values;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const result = failureResult({
			status: "config_error",
			code: "ARGUMENT_PARSE_FAILED",
			message: `Failed to parse arguments: ${message}`,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}

	const projectPath = argsValues["project-path"] as string | undefined;
	if (!projectPath) {
		const result = failureResult({
			status: "config_error",
			code: "PROJECT_PATH_REQUIRED",
			message: "Missing required argument: --project-path is required.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}
	const profileId = argsValues.profile as string;
	const profile = getProfileById(profileId);
	if (!profile) {
		const result = failureResult({
			status: "config_error",
			code: "PROFILE_NOT_FOUND",
			message: `Invalid profile: ${profileId}`,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}
	let scanTarget: ReturnType<typeof parseScanTargetOption>;
	try {
		scanTarget = parseScanTargetOption(argsValues);
	} catch (error) {
		const result = failureResult({
			status: "config_error",
			code: "TARGET_INVALID",
			message: error instanceof Error ? error.message : String(error),
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}
	if (!(profile.supportedTargets ?? ["full"]).includes(scanTarget.kind)) {
		const result = failureResult({
			status: "config_error",
			code: "TARGET_NOT_SUPPORTED",
			message: `Profile ${profileId} does not support target ${scanTarget.kind}.`,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}
	const expectedTargetDigest = argsValues["expected-target-digest"] as
		| string
		| undefined;
	if (expectedTargetDigest && !/^[0-9a-f]{64}$/i.test(expectedTargetDigest)) {
		const result = failureResult({
			status: "config_error",
			code: "TARGET_DIGEST_INVALID",
			message: "--expected-target-digest must be a 64-character SHA-256.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}
	const findingLimitInput = argsValues["finding-limit"] as string;
	const findingLimit = /^\d+$/.test(findingLimitInput)
		? Number.parseInt(findingLimitInput, 10)
		: Number.NaN;
	if (
		!Number.isSafeInteger(findingLimit) ||
		findingLimit < 1 ||
		findingLimit > MAX_FINDING_LIMIT
	) {
		const result = failureResult({
			status: "config_error",
			code: "FINDING_LIMIT_INVALID",
			message: `--finding-limit must be an integer from 1 to ${MAX_FINDING_LIMIT}.`,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	}

	let dbConnection: ReturnType<typeof createDbConnection> | null = null;
	let startupComplete = false;
	try {
		const startupEnv = readAppEnv();
		dbConnection = createDbConnection(startupEnv.databaseUrl);
		const env = await new SettingsRepository(dbConnection.db).resolveAppEnv(
			startupEnv,
		);
		const executionPolicy = resolveScanExecutionPolicy({
			env,
			surface: "security_oracle",
		});
		const execution = executionConfigFromPolicy(executionPolicy);
		startupComplete = true;
		const resolvedProject = await resolveProjectByPath(
			dbConnection.db,
			projectPath,
			{
				createProject: true,
			},
		);
		const projectPayload = {
			id: resolvedProject.project.id,
			repoPath: resolvedProject.repoPath,
			created: resolvedProject.created,
		};
		const scanResult = await runProfileScan({
			db: dbConnection.db,
			projectId: resolvedProject.project.id,
			profileId,
			repoPath: resolvedProject.repoPath,
			target: scanTarget,
			expectedTargetDigest,
			continueOnToolFailure: true,
			execution,
			executionPolicyMetadata: scanExecutionPolicyMetadata(executionPolicy),
			finalReport: {
				enabled: true,
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
			},
		});

		const findingRepo = new FindingRepository(dbConnection.db);
		const findings = await findingRepo.listFindings(scanResult.scanRunId);
		const highOrCriticalCount = findings.filter((finding) => {
			const severity = finding.severity.toLowerCase();
			return severity === "high" || severity === "critical";
		}).length;
		const severityCounts = {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			unknown: 0,
		};
		for (const finding of findings) {
			const severity = finding.severity.toLowerCase();
			if (severity in severityCounts) {
				severityCounts[severity as keyof typeof severityCounts] += 1;
			} else {
				severityCounts.unknown += 1;
			}
		}
		const scanPayload = {
			scanRunId: scanResult.scanRunId,
			profile: profileId,
			findingCount: findings.length,
			highOrCriticalCount,
			severityCounts,
			coverage: summarizeCoverage(scanResult.stepResults),
			findingsTruncated: findings.length > findingLimit,
			blockingFingerprints: findings
				.filter((finding) => {
					const severity = finding.severity.toLowerCase();
					return severity === "high" || severity === "critical";
				})
				.map((finding) => finding.fingerprint)
				.sort((a, b) => a.localeCompare(b)),
			findings: summarizeFindings(
				findings,
				resolvedProject.repoPath,
				findingLimit,
			),
		};

		if (!scanResult.ok && findings.length === 0) {
			const result = failureResult({
				status: "runtime_error",
				code: "SCAN_FAILED",
				message: scanResult.message ?? "Scan failed.",
				nextAction: "inspect_diagnostic_failure",
				project: projectPayload,
				scan: scanPayload,
				review: { status: "skipped" },
			});
			writeResult(result);
			return exitCodeFor(result);
		}

		const reviewRepository = new ScanReviewRepository(dbConnection.db);
		const reviewRunner = new ScanReviewRunner(dbConnection.db, {
			llmRouter: new LlmRouter(
				new LlmSettingsRepository(dbConnection.db, env),
				env,
			),
			reviewRepository,
		});
		const reviewResult = await reviewRunner.run(scanResult.scanRunId, {
			task: "scan_review",
			fixtureOutput:
				env.nodeEnv === "test"
					? process.env.VULN_WORKBENCH_SCAN_REVIEW_FIXTURE
					: undefined,
		});
		const persistedReview = await reviewRepository.findById(
			reviewResult.reviewId,
		);
		const improvementRequest = scanImprovementRequestSchema.safeParse(
			(persistedReview?.output as Record<string, unknown> | null | undefined)
				?.improvementRequest,
		);
		const reviewPayload: OracleResult["review"] = reviewResult.ok
			? {
					status: "completed",
					reviewId: reviewResult.reviewId,
					...(improvementRequest.success
						? { improvementRequest: improvementRequest.data.handoffPrompt }
						: {}),
				}
			: {
					status: "failed",
					reviewId: reviewResult.reviewId,
					error: reviewResult.error ?? "Scan review failed.",
				};

		const status: OracleStatus =
			highOrCriticalCount > 0
				? "security_action_required"
				: scanResult.profileOutcome === "completed_with_warnings" ||
						!scanResult.ok ||
						!reviewResult.ok
					? "inconclusive"
					: "completed";
		const providerConfigurationFailure =
			!reviewResult.ok &&
			/llm_route_|provider.*(?:missing|disabled|not found)|not configured/i.test(
				reviewResult.error ?? "",
			);
		const result: OracleResult = {
			ok: status === "completed",
			status,
			project: projectPayload,
			scan: scanPayload,
			review: reviewPayload,
			nextAction:
				status === "security_action_required"
					? "apply_security_fix"
					: status === "inconclusive"
						? providerConfigurationFailure
							? "configure_provider"
							: "run_scan_review"
						: "none",
			...(scanResult.ok
				? {}
				: {
						error: {
							code: "SCAN_COMPLETED_WITH_TOOL_FAILURE",
							message:
								scanResult.message ??
								"Scan returned findings but one or more tools reported failure.",
						},
					}),
		};
		writeResult(result);
		return exitCodeFor(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const configError =
			error instanceof ProjectResolutionError || !startupComplete;
		const result = failureResult({
			status: configError ? "config_error" : "runtime_error",
			code:
				error instanceof ProjectResolutionError
					? error.code
					: !startupComplete
						? "APP_CONFIG_ERROR"
						: "ORACLE_RUNTIME_ERROR",
			message,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		return exitCodeFor(result);
	} finally {
		if (dbConnection) {
			try {
				await dbConnection.writerClient?.close({ shutdownIfOwned: true });
			} finally {
				dbConnection.sqlite.close(false);
			}
		}
	}
}

function summarizeFindings(
	findings: Awaited<ReturnType<FindingRepository["listFindings"]>>,
	repoRoot: string,
	limit: number,
) {
	return [...findings]
		.sort((a, b) => {
			const severityDiff = severityRank(a.severity) - severityRank(b.severity);
			if (severityDiff !== 0) return severityDiff;
			return a.ruleId.localeCompare(b.ruleId);
		})
		.slice(0, limit)
		.map((finding) => {
			const location = locationSummary(finding.primaryLocation, repoRoot);
			return {
				id: finding.id,
				fingerprint: finding.fingerprint,
				severity: finding.severity,
				tool: finding.sourceTool,
				ruleId: finding.ruleId,
				title: compactText(finding.title, 180),
				location,
				recommendation: recommendationForFinding({
					ruleId: finding.ruleId,
					title: finding.title,
					location,
				}),
			};
		});
}

function severityRank(severity: string) {
	switch (severity.toLowerCase()) {
		case "critical":
			return 0;
		case "high":
			return 1;
		case "medium":
			return 2;
		case "low":
			return 3;
		case "info":
			return 4;
		default:
			return 5;
	}
}

function locationSummary(location: unknown, repoRoot: string) {
	if (!location || typeof location !== "object") return null;
	const record = location as Record<string, unknown>;
	const locationPath = typeof record.path === "string" ? record.path : null;
	if (!locationPath) return null;
	const normalizedRoot = path.resolve(repoRoot);
	const absoluteLocation = path.isAbsolute(locationPath)
		? path.resolve(locationPath)
		: path.resolve(normalizedRoot, locationPath);
	const relativeLocation = path.relative(normalizedRoot, absoluteLocation);
	if (
		!relativeLocation ||
		relativeLocation === ".." ||
		relativeLocation.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativeLocation)
	) {
		return null;
	}
	const line =
		typeof record.startLine === "number"
			? record.startLine
			: typeof record.line === "number"
				? record.line
				: null;
	return { path: relativeLocation.split(path.sep).join("/"), line };
}

function recommendationForFinding(params: {
	ruleId: string;
	title: string;
	location: { path: string; line: number | null } | null;
}) {
	const ruleId = params.ruleId.toLowerCase();
	if (ruleId.includes("dockerfile.security.missing-user")) {
		return "Dockerfile に non-root の user/group 作成を追加し、最後に USER でそのユーザーへ切り替えてください。";
	}
	if (ruleId.includes("github-actions-mutable-action-tag")) {
		return "uses: の action 参照を tag/branch ではなく full 40-character commit SHA に固定してください。";
	}
	if (ruleId.includes("bun-missing-minimum-release-age")) {
		return "bunfig.toml の [install] に minimumReleaseAge = 604800 を追加し、新規公開直後の package を避けてください。";
	}
	const target = params.location
		? `${params.location.path}${params.location.line ? `:${params.location.line}` : ""}`
		: "検出箇所";
	return `${target} で ${compactText(params.title, 120)} に対応する制御を追加してください。`;
}

function compactText(value: string, maxLength: number) {
	const compacted = value.replace(/\s+/g, " ").trim();
	if (compacted.length <= maxLength) return compacted;
	return `${compacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function summarizeCoverage(stepResults: ProfileScanResult["stepResults"]) {
	const coverage = { completed: 0, skipped: 0, failed: 0, gaps: [] } as {
		completed: number;
		skipped: number;
		failed: number;
		gaps: Array<{ code: string; message: string }>;
	};
	for (const step of stepResults) {
		coverage[step.status] += 1;
		if (step.status === "completed") continue;
		const id =
			step.kind === "static_tool"
				? step.toolId
				: step.kind === "dast"
					? step.profileId
					: step.stepId;
		const reasonCode = "reasonCode" in step ? step.reasonCode : null;
		coverage.gaps.push({
			code: compactText(`${step.status}:${id}`, 64),
			message: compactText(
				step.error ?? reasonCode ?? `${id} did not complete.`,
				512,
			),
		});
	}
	return coverage;
}

process.exitCode = await main();
