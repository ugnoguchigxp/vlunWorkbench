import crypto from "node:crypto";
import type { ScenarioRequest } from "../../../shared/schemas/business-logic.schema";
import { rulesOfEngagementSchema } from "../../../shared/schemas/assessment.schema";
import type { AppDatabase } from "../../db";
import { AssessmentRepository } from "../assessments/assessment-repository";
import { authHeadersFor } from "../dast/auth-material";
import type { DastAuthContextRepository } from "../dast/auth-context-repository";
import { DastRepository } from "../dast/dast-repository";
import type { DastFetch } from "../dast/http-runner";
import { pinnedDastFetch } from "../dast/pinned-fetch";
import { authorizeRulesOfEngagement } from "../dast/rules-of-engagement";
import {
	isUrlInDastScope,
	validateDastTargetConfig,
} from "../dast/target-validator";
import { canonicalJson } from "../scans/diff-scan-plan";
import { FindingRepository, ScanRepository } from "../scans/repositories";
import {
	executeBusinessLogicScenario,
	type ScenarioStateObserver,
} from "./business-logic-scenario-executor";
import { BusinessLogicRepository } from "./business-logic-repository";

export class BusinessLogicRunner {
	private readonly assessments: AssessmentRepository;
	private readonly business: BusinessLogicRepository;
	private readonly dast: DastRepository;
	private readonly scans: ScanRepository;
	private readonly findings: FindingRepository;
	private readonly activeProjects = new Set<string>();

	constructor(
		db: AppDatabase,
		private readonly deps: {
			authContextRepository?: DastAuthContextRepository;
			fetchImpl?: DastFetch;
			stateObserver?: ScenarioStateObserver;
		} = {},
	) {
		this.assessments = new AssessmentRepository(db);
		this.business = new BusinessLogicRepository(db);
		this.dast = new DastRepository(db);
		this.scans = new ScanRepository(db);
		this.findings = new FindingRepository(db);
	}

	async run(params: {
		scenarioId: string;
		projectId: string;
		ownerUserId: string;
	}) {
		if (this.activeProjects.has(params.projectId))
			throw new Error("business_logic_project_busy");
		if (await this.business.hasUnresolvedCleanup(params.projectId))
			throw new Error("business_logic_cleanup_resolution_required");
		this.activeProjects.add(params.projectId);
		try {
			return await this.runClaimed(params);
		} finally {
			this.activeProjects.delete(params.projectId);
		}
	}

	async recover(): Promise<number> {
		return await this.business.failInterruptedRuns();
	}

	private async runClaimed(params: {
		scenarioId: string;
		projectId: string;
		ownerUserId: string;
	}) {
		const saved = await this.business.findOwnedScenario(
			params.scenarioId,
			params.ownerUserId,
		);
		if (!saved || saved.projectId !== params.projectId)
			throw new Error("business_logic_scenario_not_found");
		const scenario = saved.scenario;
		const [engagement, targetConfig] = await Promise.all([
			this.assessments.findEngagement(scenario.engagementId),
			this.dast.getTargetConfig(scenario.targetConfigId),
		]);
		if (
			!engagement ||
			engagement.ownerUserId !== params.ownerUserId ||
			engagement.projectId !== params.projectId
		)
			throw new Error("business_logic_engagement_not_found");
		if (
			engagement.purpose !== "internal" ||
			!["local", "ephemeral"].includes(engagement.environment)
		)
			throw new Error("business_logic_disposable_internal_target_required");
		if (!targetConfig || targetConfig.projectId !== params.projectId)
			throw new Error("business_logic_target_not_found");
		const target = await validateDastTargetConfig(targetConfig, {
			runner: "host",
		});
		if (!target.ok) throw new Error(target.message);
		const usedRequests = await this.business.sumEngagementRequests(
			engagement.id,
		);
		const roe = rulesOfEngagementSchema.parse(engagement.rulesOfEngagement);
		if (usedRequests + scenario.maxRequests > roe.requestBudget)
			throw new Error("roe_request_budget_insufficient_for_plan");
		const authByActor = new Map();
		for (const actor of scenario.actors) {
			if (!this.deps.authContextRepository)
				throw new Error("dast_auth_context_repository_unavailable");
			authByActor.set(
				actor.actorId,
				await this.deps.authContextRepository.decryptForUse({
					id: actor.authContextId,
					projectId: params.projectId,
					targetConfigId: scenario.targetConfigId,
					identityRole: actor.actorId,
					actorUserId: params.ownerUserId,
				}),
			);
		}
		const scan = await this.scans.createScanRun({
			projectId: params.projectId,
			profile: "active-lab:business-logic",
			status: "running",
			createdByUserId: params.ownerUserId,
			metadata: {
				scenarioId: saved.id,
				controlId: saved.controlId,
				executableEvidenceRequired: true,
			},
		});
		const run = await this.business.createRun({
			scenarioId: saved.id,
			projectId: params.projectId,
			scanRunId: scan.id,
		});
		let executedRequestCount = 0;
		try {
			let requestCount = usedRequests;
			let lastRequestAt = 0;
			const deadline = Date.now() + scenario.timeoutSec * 1000;
			const result = await executeBusinessLogicScenario({
				scenario,
				observe: this.deps.stateObserver,
				execute: async (request, context) => {
					if (Date.now() >= deadline)
						throw new Error("business_logic_scenario_timeout");
					const authorization = authorizeRulesOfEngagement({
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
						target,
						method: request.method,
						path: request.path,
						requestCount,
						requireStateChanging: false,
					});
					requestCount++;
					executedRequestCount++;
					const waitMs = Math.max(
						0,
						1000 /
							Math.min(authorization.rateLimitPerSec, target.rateLimitPerSec) -
							(performance.now() - lastRequestAt),
					);
					if (lastRequestAt > 0 && waitMs > 0)
						await new Promise((resolve) => setTimeout(resolve, waitMs));
					const startedAt = performance.now();
					let statusCode: number | null = null;
					let errorCode: string | null = null;
					let json: unknown;
					const controller = new AbortController();
					const requestTimer = setTimeout(
						() => controller.abort(),
						Math.max(
							1,
							Math.min(target.timeoutSec * 1000, deadline - Date.now()),
						),
					);
					try {
						const response = await (
							this.deps.fetchImpl ??
							((input, init) => pinnedDastFetch(target, input, init))
						)(new URL(request.path, target.runnerOrigin).toString(), {
							method: request.method,
							headers: {
								...target.defaultHeaders,
								...request.headers,
								...authHeadersFor(authByActor.get(request.actorId)?.secret),
								...(request.body && typeof request.body !== "string"
									? { "content-type": "application/json" }
									: {}),
							},
							body: bodyFor(request),
							redirect: "manual",
							signal: controller.signal,
						});
						statusCode = response.status;
						const location = response.headers.get("location");
						if (
							location &&
							response.status >= 300 &&
							response.status < 400 &&
							!isUrlInDastScope(
								new URL(
									location,
									new URL(request.path, target.runnerOrigin),
								).toString(),
								target,
							)
						)
							throw new Error("business_logic_redirect_out_of_scope");
						const text = await readResponseTextBounded(response, 1024 * 1024);
						try {
							json = JSON.parse(text);
						} catch {
							json = undefined;
						}
					} catch (error) {
						errorCode =
							error instanceof Error
								? error.message
								: "business_logic_request_failed";
					} finally {
						clearTimeout(requestTimer);
					}
					lastRequestAt = performance.now();
					const evidence = await this.business.createEvidence({
						runId: run.id,
						stage: `${context.stage}:${context.index}`,
						method: request.method,
						path: new URL(request.path, "http://scope.invalid").pathname,
						statusCode,
						requestSha256: requestHash(request),
						durationMs: Math.round(performance.now() - startedAt),
						errorCode,
					});
					if (errorCode || statusCode === null)
						throw new Error(errorCode ?? "business_logic_no_status");
					return { status: statusCode, json, evidenceRef: evidence.id };
				},
			});
			let findingCount = 0;
			if (result.status === "observed") {
				const finding = await this.findings.createFinding({
					scanRunId: scan.id,
					projectId: params.projectId,
					sourceTool: "business-logic",
					ruleId: `BUSINESS_LOGIC_${saved.controlId.toUpperCase().replace(/-/g, "_")}`,
					title: `Business logic invariant violation: ${saved.controlId}`,
					description:
						"A bounded executable scenario observed an invariant violation.",
					severity: "high",
					confidence: "runtime",
					status: "open",
					primaryLocation: { path: scenario.actions[0]?.path ?? "/" },
					fingerprint: crypto
						.createHash("sha256")
						.update(
							`${saved.planHash}:${result.violatedInvariantIndexes.join(",")}`,
						)
						.digest("hex"),
					metadata: {
						evidenceStrength: "runtime_observed",
						businessLogicRunId: run.id,
						executableEvidenceRefs: result.evidenceRefs,
						controlId: saved.controlId,
					},
				});
				for (const evidenceRef of result.evidenceRefs)
					await this.findings.createEvidence({
						findingId: finding.id,
						kind: "tool-output",
						title: "Business logic executable observation",
						artifactId: null,
						location: { businessLogicEvidenceId: evidenceRef },
					});
				findingCount = 1;
			}
			await this.business.completeRun(run.id, {
				status: result.status,
				requestCount: result.requestCount,
				findingCount,
				cleanupSucceeded: result.cleanupSucceeded,
				baselineHash: scenario.expectedBaselineHash,
				result: {
					evidenceRefs: result.evidenceRefs,
					violatedInvariantIndexes: result.violatedInvariantIndexes,
					errors: result.errors,
				},
				errorCode: result.errors[0] ?? null,
			});
			await this.scans.updateScanRunStatus(
				scan.id,
				result.status === "failed_cleanup" ? "failed" : "completed",
				{
					summary: `Business logic scenario ${result.status}.`,
					metadata: {
						businessLogicRunId: run.id,
						businessLogicStatus: result.status,
						findingCount,
					},
				},
			);
			return { businessLogicRunId: run.id, scanRunId: scan.id, ...result };
		} catch (error) {
			const errorCode =
				error instanceof Error
					? error.message
					: "business_logic_execution_failed";
			await Promise.allSettled([
				this.business.completeRun(run.id, {
					status: "failed_cleanup",
					requestCount: executedRequestCount,
					findingCount: 0,
					cleanupSucceeded: false,
					baselineHash: scenario.expectedBaselineHash,
					result: { limitationCodes: [errorCode] },
					errorCode,
				}),
				this.scans.updateScanRunStatus(scan.id, "failed", {
					summary: "Business logic execution failed; cleanup state is unknown.",
					metadata: {
						businessLogicRunId: run.id,
						businessLogicStatus: "failed_cleanup",
						errorCode,
					},
				}),
			]);
			throw error;
		}
	}
}

async function readResponseTextBounded(
	response: Response,
	maxBytes: number,
): Promise<string> {
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes)
		throw new Error("business_logic_response_too_large");
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let output = "";
	let total = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error("business_logic_response_too_large");
		}
		output += decoder.decode(value, { stream: true });
	}
	return output + decoder.decode();
}

function bodyFor(request: ScenarioRequest): BodyInit | null {
	if (request.body === null) return null;
	return typeof request.body === "string"
		? request.body
		: JSON.stringify(request.body);
}

function requestHash(request: ScenarioRequest): string {
	return crypto
		.createHash("sha256")
		.update(
			canonicalJson({
				actorId: request.actorId,
				method: request.method,
				path: request.path,
				headers: Object.keys(request.headers).sort(),
				body: request.body,
			}),
		)
		.digest("hex");
}
