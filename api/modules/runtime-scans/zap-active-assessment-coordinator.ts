import crypto from "node:crypto";
import type {
	ActiveRequest,
	ZapActiveRunRequest,
} from "../../../shared/schemas/active-assessment.schema";
import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import type { AppDatabase } from "../../db";
import { ActiveAssessmentRepository } from "../dast/active-assessment-repository";
import { executeActiveRequest } from "../dast/active-request-executor";
import type { DastAuthContextRepository } from "../dast/auth-context-repository";
import type { DastFetch } from "../dast/http-runner";
import type { ActiveAuthorization } from "../dast/rules-of-engagement";
import type { ValidatedDastTarget } from "../dast/types";
import { ArtifactStorage } from "../scans/artifact-storage";
import { canonicalJson } from "../scans/diff-scan-plan";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "../scans/repositories";
import { buildZapAutomationPlan } from "./zap-automation-plan";
import { authorizeZapActivePlan } from "./zap-active-policy";
import { type ActiveResetExecutor, ZapActiveRunner } from "./zap-active-runner";
import { createContainerFixtureResetExecutor } from "./container-fixture-reset";

type Engagement = ActiveAuthorization & { purpose: string };

export class ZapActiveAssessmentCoordinator {
	private readonly active: ActiveAssessmentRepository;
	private readonly artifacts: ArtifactRepository;
	private readonly findings: FindingRepository;
	private readonly scans: ScanRepository;

	constructor(
		db: AppDatabase,
		private readonly deps: {
			featureEnabled: boolean;
			authContextRepository?: DastAuthContextRepository;
			fetchImpl?: DastFetch;
			artifactStorage?: ArtifactStorage;
		},
	) {
		this.active = new ActiveAssessmentRepository(db);
		this.artifacts = new ArtifactRepository(db);
		this.findings = new FindingRepository(db);
		this.scans = new ScanRepository(db);
	}

	async run(params: {
		projectId: string;
		createdByUserId: string;
		scanRunId: string;
		activeAssessmentRunId: string;
		request: ZapActiveRunRequest;
		engagement: Engagement;
		target: ValidatedDastTarget;
		initialRequestCount: number;
		plannedRequestCount: number;
	}) {
		const authorization = authorizeZapActivePlan({
			engagement: params.engagement,
			target: params.target,
			methods: params.request.allowedMethods,
			paths: params.request.allowedPaths,
			plannedRequests: params.plannedRequestCount,
			alreadyUsedRequests: params.initialRequestCount,
			resetStrategy: params.request.resetStrategy,
			featureEnabled: this.deps.featureEnabled,
		});
		buildZapAutomationPlan({
			contextName: "preflight",
			targetOrigin: "http://gateway.invalid",
			allowedPaths: params.request.allowedPaths,
			rules: params.request.ruleIds.map((id) => ({ id })),
			maxDurationMinutes: Math.ceil(params.request.durationSec / 60),
			reportFilename: "zap-active-report.json",
		});
		const authSecret = await this.decryptAuth(params);
		const runtime = {
			activeAssessmentRunId: params.activeAssessmentRunId,
			engagement: params.engagement,
			target: params.target,
			repository: this.active,
			fetchImpl: this.deps.fetchImpl,
			requestCount: params.initialRequestCount,
			lastRequestAt: 0,
		};
		const resetExecutor = this.createResetExecutor({
			request: params.request,
			runtime,
			target: params.target,
			authSecret,
			identityRole: params.request.identityRole ?? null,
		});
		const storage = this.deps.artifactStorage ?? new ArtifactStorage();
		const toolRun = await this.scans.createToolRun({
			scanRunId: params.scanRunId,
			toolName: "zap-active",
			toolVersion: null,
			status: "running",
			command: "typed-zap-automation-plan",
			metadata: {
				profileId: params.request.profileId,
				policyId: authorization.policyId,
				ruleIds: params.request.ruleIds,
				executableEvidenceRequired: true,
			},
		});
		const runner = new ZapActiveRunner(storage, resetExecutor);
		const result = await runner.run({
			scanRunId: params.scanRunId,
			upstreamOrigin: params.target.runnerOrigin,
			allowedMethods: params.request.allowedMethods,
			allowedPaths: params.request.allowedPaths,
			excludedPaths: params.target.excludedPaths,
			requestBudget: params.request.requestBudget,
			rateLimitPerSec: authorization.rateLimitPerSec,
			durationSec: params.request.durationSec,
			rules: params.request.ruleIds.map((id) => ({ id })),
			resetStrategy: params.request.resetStrategy,
			authSecret,
			openApiPath: params.request.openApiPath,
			onGatewayEvidence: async (evidence) => {
				runtime.requestCount++;
				await this.active.createEvidence({
					activeAssessmentRunId: params.activeAssessmentRunId,
					method: evidence.method,
					path: evidence.path,
					statusCode: evidence.statusCode,
					identityRole: params.request.identityRole ?? null,
					stage: "zap-active",
					requestSha256: evidence.requestSha256,
					durationMs: evidence.durationMs,
					errorCode: evidence.errorCode,
				});
			},
		});
		const artifactIds = await this.registerArtifacts(
			params.scanRunId,
			toolRun.id,
			result,
		);
		let findingCount = 0;
		if (result.status === "completed") {
			for (const finding of result.findings) {
				const created = await this.findings.createFinding({
					scanRunId: params.scanRunId,
					projectId: params.projectId,
					sourceTool: "zap-active",
					ruleId: finding.ruleId,
					title: finding.title,
					description: finding.description,
					severity: finding.severity,
					confidence: finding.confidence,
					status: finding.status,
					primaryLocation: finding.primaryLocation,
					fingerprint: finding.fingerprint,
					metadata: {
						...finding.metadata,
						activeAssessmentRunId: params.activeAssessmentRunId,
						executableEvidence: true,
					},
				});
				for (const evidence of finding.evidences)
					await this.findings.createEvidence({
						findingId: created.id,
						kind: evidence.kind,
						title: evidence.title,
						artifactId: artifactIds[0] ?? null,
						location: evidence.location,
						snippet: evidence.snippet,
					});
				findingCount++;
			}
		}
		await this.scans.updateToolRunStatus(
			toolRun.id,
			result.status === "completed" ? "completed" : "failed",
			{
				exitCode: result.exitCode,
				metadata: {
					...result.metadata,
					artifactIds,
					errorCode: result.errorCode,
				},
			},
		);
		return {
			status: result.status,
			requestCount: runtime.requestCount - params.initialRequestCount,
			findingCount,
			summary: `ZAP active assessment ${result.status}.`,
			result: {
				...result.metadata,
				artifactIds,
				cleanupSucceeded: result.cleanupSucceeded,
				credentialLeakage: result.credentialLeakage,
				limitationCodes: result.errorCode ? [result.errorCode] : [],
			},
			errorMessage: result.errorCode ?? null,
		};
	}

	private async decryptAuth(params: {
		projectId: string;
		createdByUserId: string;
		request: ZapActiveRunRequest;
	}): Promise<DastAuthSecretPayload | undefined> {
		if (!params.request.authContextId) return undefined;
		if (!this.deps.authContextRepository)
			throw new Error("dast_auth_context_repository_unavailable");
		return (
			await this.deps.authContextRepository.decryptForUse({
				id: params.request.authContextId,
				projectId: params.projectId,
				targetConfigId: params.request.targetConfigId,
				identityRole: params.request.identityRole as string,
				actorUserId: params.createdByUserId,
			})
		).secret;
	}

	private createResetExecutor(params: {
		request: ZapActiveRunRequest;
		runtime: Parameters<typeof executeActiveRequest>[0]["runtime"];
		target: ValidatedDastTarget;
		authSecret?: DastAuthSecretPayload;
		identityRole: string | null;
	}): ActiveResetExecutor {
		const strategy = params.request.resetStrategy;
		if (strategy.kind === "container_recreate")
			return createContainerFixtureResetExecutor({
				strategy,
				targetOrigin: params.target.runnerOrigin,
				fetchImpl: this.deps.fetchImpl,
			});
		if (strategy.kind !== "http_transaction")
			throw new Error("zap_active_reset_strategy_unsupported");
		const execute = async (request: ActiveRequest, stage: string) => {
			const result = await executeActiveRequest({
				runtime: params.runtime,
				request,
				stage,
				identityRole: params.identityRole,
				authSecret: params.authSecret,
			});
			if (!request.expectedStatus.includes(result.status))
				throw new Error(`zap_active_reset_unexpected_status:${stage}`);
			return result;
		};
		const assertBaseline = async () => {
			const observations = [];
			for (const [index, assertion] of strategy.baselineAssertions.entries()) {
				const result = await executeActiveRequest({
					runtime: params.runtime,
					request: {
						method: "GET",
						path: assertion.path,
						headers: {},
						body: null,
						expectedStatus: [assertion.expectedStatus],
					},
					stage: `reset-assertion:${index}`,
					identityRole: params.identityRole,
					authSecret: params.authSecret,
				});
				if (
					result.status !== assertion.expectedStatus ||
					(assertion.expectedBodySha256 &&
						result.responseBodySha256 !== assertion.expectedBodySha256)
				)
					throw new Error("zap_active_baseline_assertion_failed");
				observations.push({
					path: assertion.path,
					status: result.status,
					bodySha256: result.responseBodySha256,
				});
			}
			return digest(observations);
		};
		return {
			prepare: async () => {
				for (const [index, request] of strategy.seedRequests.entries())
					await execute(request, `reset-seed:${index}`);
				return { baselineHash: await assertBaseline() };
			},
			reset: async () => {
				try {
					for (const [index, request] of strategy.cleanupRequests.entries())
						await execute(request, `reset-cleanup:${index}`);
					return { ok: true, baselineHash: await assertBaseline() };
				} catch (error) {
					return {
						ok: false,
						baselineHash: null,
						errorCode: error instanceof Error ? error.message : "reset_failed",
					};
				}
			},
		};
	}

	private async registerArtifacts(
		scanRunId: string,
		toolRunId: string,
		result: Awaited<ReturnType<ZapActiveRunner["run"]>>,
	): Promise<string[]> {
		const entries = [
			[result.rawArtifact, "raw_result", "json"],
			[result.stdoutArtifact, "stdout", "text"],
			[result.stderrArtifact, "stderr", "text"],
		] as const;
		const ids: string[] = [];
		for (const [artifact, kind, format] of entries) {
			if (!artifact) continue;
			ids.push(
				(
					await this.artifacts.createArtifact({
						scanRunId,
						toolRunId,
						kind,
						format,
						path: artifact.path,
						sha256: artifact.sha256,
						sizeBytes: artifact.sizeBytes,
					})
				).id,
			);
		}
		return ids;
	}
}

function digest(value: unknown): string {
	return `sha256:${crypto
		.createHash("sha256")
		.update(canonicalJson(value))
		.digest("hex")}`;
}
