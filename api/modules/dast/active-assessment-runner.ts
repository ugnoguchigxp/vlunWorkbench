import crypto from "node:crypto";
import type { RunActiveAssessmentRequest } from "../../../shared/schemas/active-assessment.schema";
import { rulesOfEngagementSchema } from "../../../shared/schemas/assessment.schema";
import type { AppDatabase } from "../../db";
import { AssessmentRepository } from "../assessments/assessment-repository";
import { FindingRepository, ScanRepository } from "../scans/repositories";
import { ActiveAssessmentRepository } from "./active-assessment-repository";
import {
	type ActiveRequestRuntime,
	executeActiveRequest,
} from "./active-request-executor";
import type { DastAuthContextRepository } from "./auth-context-repository";
import { runAuthorizationMatrix } from "./authorization-matrix-runner";
import { DastRepository } from "./dast-repository";
import type { DastFetch } from "./http-runner";
import { validateDastTargetConfig } from "./target-validator";
import { runActiveTransaction } from "./transaction-runner";
import type { ArtifactStorage } from "../scans/artifact-storage";
import { ZapActiveAssessmentCoordinator } from "../runtime-scans/zap-active-assessment-coordinator";

export class ActiveAssessmentRunner {
	private readonly assessmentRepository: AssessmentRepository;
	private readonly activeRepository: ActiveAssessmentRepository;
	private readonly dastRepository: DastRepository;
	private readonly scanRepository: ScanRepository;
	private readonly findingRepository: FindingRepository;
	private readonly zapActiveCoordinator: ZapActiveAssessmentCoordinator;
	private readonly activeProjects = new Set<string>();
	private readonly inFlight = new Set<Promise<unknown>>();
	private shuttingDown = false;

	constructor(
		db: AppDatabase,
		private readonly deps: {
			authContextRepository?: DastAuthContextRepository;
			fetchImpl?: DastFetch;
			zapActiveEnabled?: boolean;
			artifactStorage?: ArtifactStorage;
		} = {},
	) {
		this.assessmentRepository = new AssessmentRepository(db);
		this.activeRepository = new ActiveAssessmentRepository(db);
		this.dastRepository = new DastRepository(db);
		this.scanRepository = new ScanRepository(db);
		this.findingRepository = new FindingRepository(db);
		this.zapActiveCoordinator = new ZapActiveAssessmentCoordinator(db, {
			featureEnabled: deps.zapActiveEnabled === true,
			authContextRepository: deps.authContextRepository,
			fetchImpl: deps.fetchImpl,
			artifactStorage: deps.artifactStorage,
		});
	}

	async run(params: {
		projectId: string;
		createdByUserId: string;
		request: RunActiveAssessmentRequest;
	}) {
		if (this.shuttingDown) {
			throw new Error("active_assessment_runner_shutting_down");
		}
		if (this.activeProjects.has(params.projectId)) {
			throw new Error("active_assessment_project_busy");
		}
		this.activeProjects.add(params.projectId);
		const completion = this.runClaimed(params);
		this.inFlight.add(completion);
		try {
			return await completion;
		} finally {
			this.inFlight.delete(completion);
			this.activeProjects.delete(params.projectId);
		}
	}

	async recover(): Promise<number> {
		return await this.activeRepository.failInterruptedRuns();
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		await Promise.allSettled([...this.inFlight]);
	}

	private async runClaimed(params: {
		projectId: string;
		createdByUserId: string;
		request: RunActiveAssessmentRequest;
	}) {
		const engagement = await this.assessmentRepository.findEngagement(
			params.request.engagementId,
		);
		if (
			!engagement ||
			engagement.projectId !== params.projectId ||
			engagement.ownerUserId !== params.createdByUserId
		) {
			throw new Error("active_assessment_engagement_not_found");
		}
		const target = await this.dastRepository.getTargetConfig(
			params.request.targetConfigId,
		);
		if (!target || target.projectId !== params.projectId) {
			throw new Error("active_assessment_target_not_found");
		}
		const validatedTarget = await validateDastTargetConfig(target, {
			runner: "host",
		});
		if (!validatedTarget.ok) throw new Error(validatedTarget.message);
		const initialRequestCount =
			await this.activeRepository.sumEngagementRequestCount(engagement.id);
		const plannedRequestCount =
			params.request.kind === "transaction"
				? params.request.transaction.seed.length +
					1 +
					params.request.transaction.cleanup.length
				: params.request.kind === "authorization_matrix"
					? params.request.matrix.actors.length *
						params.request.matrix.objects.length *
						params.request.matrix.operations.length
					: zapActivePlannedRequests(params.request);
		const roe = rulesOfEngagementSchema.parse(engagement.rulesOfEngagement);
		if (initialRequestCount + plannedRequestCount > roe.requestBudget) {
			throw new Error("roe_request_budget_insufficient_for_plan");
		}
		if (plannedRequestCount > validatedTarget.maxRequests) {
			throw new Error("target_request_budget_insufficient_for_plan");
		}
		const scanRun = await this.scanRepository.createScanRun({
			projectId: params.projectId,
			profile:
				params.request.kind === "zap_active"
					? params.request.profileId
					: `active-lab:${params.request.kind}`,
			status: "running",
			createdByUserId: params.createdByUserId,
			metadata: {
				engagementId: engagement.id,
				targetConfigId: target.id,
				activeAssessmentKind: params.request.kind,
				automaticDiagnosticRequested: true,
			},
		});
		const activeRun = await this.activeRepository.createRun({
			projectId: params.projectId,
			scanRunId: scanRun.id,
			engagementId: engagement.id,
			targetConfigId: target.id,
			kind: params.request.kind,
			createdByUserId: params.createdByUserId,
		});
		const runtime: ActiveRequestRuntime = {
			activeAssessmentRunId: activeRun.id,
			engagement: {
				engagementId: engagement.id,
				projectId: engagement.projectId,
				status: engagement.status,
				environment: engagement.environment as never,
				startsAt: engagement.startsAt,
				expiresAt: engagement.expiresAt,
				scope: engagement.scope,
				rulesOfEngagement: engagement.rulesOfEngagement,
			},
			target: validatedTarget,
			repository: this.activeRepository,
			fetchImpl: this.deps.fetchImpl,
			requestCount: initialRequestCount,
			lastRequestAt: 0,
		};
		try {
			const result =
				params.request.kind === "transaction"
					? await this.runTransaction({
							params: { ...params, request: params.request },
							runtime,
							initialRequestCount,
						})
					: params.request.kind === "authorization_matrix"
						? await this.runMatrix({
								params: { ...params, request: params.request },
								runtime,
								scanRunId: scanRun.id,
							})
						: {
								run: await this.zapActiveCoordinator.run({
									projectId: params.projectId,
									createdByUserId: params.createdByUserId,
									scanRunId: scanRun.id,
									activeAssessmentRunId: activeRun.id,
									request: params.request,
									engagement: {
										...runtime.engagement,
										purpose: engagement.purpose,
									},
									target: validatedTarget,
									initialRequestCount,
									plannedRequestCount,
								}),
							};
			await this.activeRepository.completeRun(activeRun.id, result.run);
			await this.scanRepository.updateScanRunStatus(
				scanRun.id,
				result.run.status === "failed_cleanup" ? "failed" : "completed",
				{
					summary: result.run.summary,
					metadata: {
						activeAssessmentRunId: activeRun.id,
						activeAssessmentStatus: result.run.status,
						requestCount: result.run.requestCount,
						findingCount: result.run.findingCount,
					},
				},
			);
			return {
				activeAssessmentRunId: activeRun.id,
				scanRunId: scanRun.id,
				...result.run,
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "active_assessment_failed";
			await this.activeRepository.completeRun(activeRun.id, {
				status: "failed",
				requestCount: runtime.requestCount - initialRequestCount,
				findingCount: 0,
				summary: "Active assessment failed.",
				result: { limitationCodes: [message] },
				errorMessage: message,
			});
			await this.scanRepository.updateScanRunStatus(scanRun.id, "failed", {
				summary: message,
				metadata: {
					activeAssessmentRunId: activeRun.id,
					activeAssessmentStatus: "failed",
				},
			});
			throw error;
		}
	}

	private async runTransaction(input: {
		params: {
			projectId: string;
			createdByUserId: string;
			request: Extract<RunActiveAssessmentRequest, { kind: "transaction" }>;
		};
		runtime: ActiveRequestRuntime;
		initialRequestCount: number;
	}) {
		const authMaterial = input.params.request.authContextId
			? await this.decryptAuth({
					id: input.params.request.authContextId,
					projectId: input.params.projectId,
					targetConfigId: input.params.request.targetConfigId,
					identityRole: input.params.request.identityRole as string,
					actorUserId: input.params.createdByUserId,
				})
			: undefined;
		const result = await runActiveTransaction({
			transaction: input.params.request.transaction,
			execute: async (request, context) =>
				await executeActiveRequest({
					runtime: input.runtime,
					request,
					stage: `${context.stage}:${context.index}`,
					identityRole: input.params.request.identityRole ?? null,
					authSecret: authMaterial?.secret,
				}),
		});
		return {
			run: {
				status: result.status,
				requestCount: input.runtime.requestCount - input.initialRequestCount,
				findingCount: 0,
				summary: `Bounded active transaction ${result.status}.`,
				result: {
					transactionId: input.params.request.transaction.id,
					seedEvidenceRefs: result.seedEvidenceRefs,
					requestEvidenceRef: result.requestEvidenceRef,
					cleanupEvidenceRefs: result.cleanupEvidenceRefs,
					limitationCodes: result.errors,
				},
				errorMessage:
					result.errors.length > 0 ? result.errors.join("; ") : null,
			},
		};
	}

	private async runMatrix(input: {
		params: {
			projectId: string;
			createdByUserId: string;
			request: Extract<
				RunActiveAssessmentRequest,
				{ kind: "authorization_matrix" }
			>;
		};
		runtime: ActiveRequestRuntime;
		scanRunId: string;
	}) {
		const authByRole = new Map<
			string,
			Awaited<ReturnType<typeof this.decryptAuth>>
		>();
		for (const actor of input.params.request.matrix.actors) {
			authByRole.set(
				actor.identityRole,
				await this.decryptAuth({
					id: actor.authContextId,
					projectId: input.params.projectId,
					targetConfigId: input.params.request.targetConfigId,
					identityRole: actor.identityRole,
					actorUserId: input.params.createdByUserId,
				}),
			);
		}
		const result = await runAuthorizationMatrix({
			matrix: input.params.request.matrix,
			maxRequests: input.params.request.maxRequests,
			execute: async ({ actor, operation, path }) =>
				await executeActiveRequest({
					runtime: input.runtime,
					request: {
						method: operation.method,
						path,
						headers: {},
						body: null,
						expectedStatus: [200, 201, 202, 204, 401, 403, 404],
					},
					stage: `authorization_matrix:${operation.id}`,
					identityRole: actor.identityRole,
					authSecret: authByRole.get(actor.identityRole)?.secret,
					requireStateChanging: false,
				}),
		});
		for (const finding of result.findings) {
			const created = await this.findingRepository.createFinding({
				scanRunId: input.scanRunId,
				projectId: input.params.projectId,
				sourceTool: "authorization-matrix",
				ruleId: finding.ruleId,
				title: finding.title,
				description:
					finding.expected === "denied"
						? "A declaratively unauthorized identity received a successful response."
						: "A declaratively authorized identity was denied.",
				severity:
					finding.ruleId === "AUTHORIZATION_FALSE_DENY" ? "medium" : "high",
				confidence: "runtime",
				status: "open",
				primaryLocation: { path: finding.operationId },
				fingerprint: matrixFingerprint(input.params.projectId, finding),
				metadata: {
					evidenceStrength: "runtime_observed",
					actorRole: finding.actorRole,
					objectId: finding.objectId,
					operationId: finding.operationId,
					expected: finding.expected,
					observed: finding.observed,
					statusCode: finding.status,
					activeEvidenceId: finding.evidenceRef,
				},
			});
			await this.findingRepository.createEvidence({
				findingId: created.id,
				kind: "tool-output",
				title: "Authorization matrix HTTP observation",
				artifactId: null,
				location: { operationId: finding.operationId },
				metadata: {
					activeAssessmentEvidenceId: finding.evidenceRef,
					statusCode: finding.status,
				},
			});
		}
		return {
			run: {
				status:
					result.inconclusiveCount > 0
						? ("inconclusive" as const)
						: ("completed" as const),
				requestCount: result.requestCount,
				findingCount: result.findings.length,
				summary:
					result.inconclusiveCount > 0
						? `Authorization matrix was inconclusive for ${result.inconclusiveCount} response(s).`
						: `Authorization matrix completed with ${result.findings.length} finding(s).`,
				result: {
					evidenceRefs: result.evidenceRefs,
					findingSummaries: result.findings,
					inconclusiveCount: result.inconclusiveCount,
					limitationCodes: [
						"configured_actor_object_operation_matrix_only",
						...(result.inconclusiveCount > 0
							? ["authorization_response_inconclusive"]
							: []),
					],
				},
				errorMessage:
					result.inconclusiveCount > 0
						? "authorization_response_inconclusive"
						: null,
			},
		};
	}

	private async decryptAuth(params: {
		id: string;
		projectId: string;
		targetConfigId: string;
		identityRole: string;
		actorUserId: string;
	}) {
		if (!this.deps.authContextRepository) {
			throw new Error("dast_auth_context_repository_unavailable");
		}
		return await this.deps.authContextRepository.decryptForUse(params);
	}
}

function zapActivePlannedRequests(
	request: Extract<RunActiveAssessmentRequest, { kind: "zap_active" }>,
): number {
	const reset = request.resetStrategy;
	return (
		request.requestBudget +
		(reset.kind === "http_transaction"
			? reset.seedRequests.length +
				reset.cleanupRequests.length +
				reset.baselineAssertions.length * 2
			: 2)
	);
}

function matrixFingerprint(
	projectId: string,
	finding: {
		ruleId: string;
		actorRole: string;
		objectId: string;
		operationId: string;
	},
) {
	return crypto
		.createHash("sha256")
		.update(
			[
				"authorization-matrix-v1",
				projectId,
				finding.ruleId,
				finding.actorRole,
				finding.objectId,
				finding.operationId,
			].join("\0"),
		)
		.digest("hex");
}
